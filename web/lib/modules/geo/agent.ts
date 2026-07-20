import * as cheerio from 'cheerio'
import { callAI } from '@/lib/ai/client'
import { GEO_MODULE } from './definition'
import { getAllItems, type ModuleAnalysisResult } from '../types'
import { parseClaudeJsonArray } from '@/lib/modules/parse-utils'
import type { GeoFetchData } from './fetcher'

// ── Robots.txt parser ─────────────────────────────────────────────────────────

type BotStatus = 'allowed' | 'blocked' | 'not-mentioned'

function checkBotInRobots(robotsTxt: string, botName: string): BotStatus {
  if (!robotsTxt) return 'not-mentioned'

  const lines = robotsTxt.split('\n').map((l) => l.trim())
  const blocks: Array<{ agents: string[]; disallowAll: boolean; allowAll: boolean }> = []
  let current: { agents: string[]; disallowAll: boolean; allowAll: boolean } | null = null

  for (const line of lines) {
    if (line === '' || line.startsWith('#')) {
      if (current) { blocks.push(current); current = null }
      continue
    }
    const lower = line.toLowerCase()
    if (lower.startsWith('user-agent:')) {
      const agent = line.slice(line.indexOf(':') + 1).trim()
      if (!current) current = { agents: [], disallowAll: false, allowAll: false }
      current.agents.push(agent.toLowerCase())
    } else if (lower.startsWith('disallow:')) {
      const path = line.slice(line.indexOf(':') + 1).trim()
      if (current && path === '/') current.disallowAll = true
    } else if (lower.startsWith('allow:')) {
      const path = line.slice(line.indexOf(':') + 1).trim()
      if (current && (path === '/' || path === '')) current.allowAll = true
    }
  }
  if (current) blocks.push(current)

  const botLower = botName.toLowerCase()
  const botBlock = blocks.find((b) => b.agents.includes(botLower))
  const wildcardBlock = blocks.find((b) => b.agents.includes('*'))

  if (!botBlock) {
    return wildcardBlock?.disallowAll ? 'blocked' : 'not-mentioned'
  }
  if (botBlock.allowAll) return 'allowed'
  if (botBlock.disallowAll) return 'blocked'
  return 'allowed'
}

function checkTierBots(robotsTxt: string, bots: string[]): { blocked: string[]; allowed: string[]; notMentioned: string[] } {
  const blocked: string[] = []
  const allowed: string[] = []
  const notMentioned: string[] = []
  for (const bot of bots) {
    const status = checkBotInRobots(robotsTxt, bot)
    if (status === 'blocked') blocked.push(bot)
    else if (status === 'allowed') allowed.push(bot)
    else notMentioned.push(bot)
  }
  return { blocked, allowed, notMentioned }
}

// ── JSON-LD schema extractor ──────────────────────────────────────────────────

function extractSchemas(html: string): object[] {
  const $ = cheerio.load(html)
  const schemas: object[] = []
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const text = $(el).html() ?? ''
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) schemas.push(...parsed)
      else schemas.push(parsed)
    } catch { /* ignore malformed */ }
  })
  return schemas
}

function schemaHasType(schemas: object[], type: string): boolean {
  return schemas.some((s) => {
    const t = (s as Record<string, unknown>)['@type']
    if (typeof t === 'string') return t === type
    if (Array.isArray(t)) return t.includes(type)
    return false
  })
}

function getSchemaByType(schemas: object[], type: string): Record<string, unknown> | null {
  return (schemas.find((s) => {
    const t = (s as Record<string, unknown>)['@type']
    if (typeof t === 'string') return t === type
    if (Array.isArray(t)) return t.includes(type)
    return false
  }) as Record<string, unknown>) ?? null
}

// ── Page data extractor ───────────────────────────────────────────────────────

function extractPageData(html: string) {
  const $ = cheerio.load(html)
  const lang = $('html').attr('lang') ?? ''
  const title = $('title').text().trim()
  const h1 = $('h1').first().text().trim()
  const headings = $('h2, h3').map((_, el) => $(el).text().trim()).get().filter(Boolean).slice(0, 15)

  // Freshness signals
  const articleModifiedTime = $('meta[property="article:modified_time"]').attr('content') ?? ''
  const ogUpdatedTime = $('meta[property="og:updated_time"]').attr('content') ?? ''
  const rssLink = $('link[type="application/rss+xml"], link[type="application/atom+xml"]').attr('href') ?? ''

  $('script, style, nav, footer, header').remove()
  const bodyText = ($('main, article, [role="main"], body').first().text() ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1500)

  // Count signals for content checks
  const statPattern = /\d+(?:\.\d+)?(?:%|x|k|\+)|\$\d+|(?:increased?|decreased?|reduced?|improved?)\s+by\s+\d+/gi
  const statsCount = (bodyText.match(statPattern) ?? []).length
  const externalLinks = $('a[href^="http"]').filter((_, el) => {
    const href = $(el).attr('href') ?? ''
    return !href.includes(new URL(html.includes('<base') ? 'https://placeholder.com' : 'https://placeholder.com').hostname)
  }).length
  const listItems = $('ul li, ol li').length
  const tableCount = $('table').length
  const hasFaqHeadings = headings.some((h) => /\?$|^(what|how|why|when|where|who|can|does|is |are )/i.test(h)) ||
    /(?:faq|frequently asked|common questions)/i.test(bodyText.slice(0, 500))

  return {
    lang, title, h1, headings, bodyText,
    articleModifiedTime, ogUpdatedTime, rssLink,
    statsCount, externalLinks, listItems, tableCount, hasFaqHeadings,
  }
}

// ── Pre-compute rule findings ─────────────────────────────────────────────────

export function buildRuleFindings(data: GeoFetchData) {
  const tier1Bots = ['GPTBot', 'ClaudeBot', 'Google-Extended', 'Amazonbot', 'CCBot', 'Meta-ExternalAgent']
  const tier2Bots = ['OAI-SearchBot', 'PerplexityBot', 'YouBot', 'anthropic-ai']
  const tier3Bots = ['ChatGPT-User', 'Claude-User', 'Perplexity-User']

  const tier1 = checkTierBots(data.robotsTxt, tier1Bots)
  const tier2 = checkTierBots(data.robotsTxt, tier2Bots)
  const tier3 = checkTierBots(data.robotsTxt, tier3Bots)

  const schemas = extractSchemas(data.html)
  const hasFaq = schemaHasType(schemas, 'FAQPage')
  const hasWebSite = schemaHasType(schemas, 'WebSite')
  const hasArticle = schemaHasType(schemas, 'Article') || schemaHasType(schemas, 'BlogPosting')
  const orgSchema = getSchemaByType(schemas, 'Organization')
  const hasOrg = !!orgSchema
  const hasSameAs = hasOrg && Array.isArray((orgSchema as Record<string, unknown>)['sameAs']) && ((orgSchema as Record<string, unknown>)['sameAs'] as unknown[]).length > 0

  const page = extractPageData(data.html)

  // llms.txt structure
  const llmsPresent = data.llmsTxt !== null
  const llmsH1 = llmsPresent && /^#\s/m.test(data.llmsTxt ?? '')
  const llmsBlockquote = llmsPresent && /^>\s/m.test(data.llmsTxt ?? '')
  const llmsSections = llmsPresent && /^##\s/m.test(data.llmsTxt ?? '')
  const llmsLinks = llmsPresent && /\[.+\]\(https?:\/\/.+\)/m.test(data.llmsTxt ?? '')
  const llmsLinkCount = llmsPresent ? ((data.llmsTxt ?? '').match(/\[.+?\]\(https?:\/\/.+?\)/g) ?? []).length : 0
  const llmsSectionCount = llmsPresent ? ((data.llmsTxt ?? '').match(/^##\s/gm) ?? []).length : 0
  const llmsDepth = llmsLinkCount >= 5 && llmsSectionCount >= 2

  // dateModified in JSON-LD
  const hasDateModified = schemas.some((s) => !!(s as Record<string, unknown>)['dateModified'])

  return {
    tier1, tier2, tier3,
    hasFaq, hasWebSite, hasArticle, hasOrg, hasSameAs,
    llmsPresent, llmsH1, llmsBlockquote, llmsSections, llmsLinks,
    llmsDepth, llmsLinkCount, llmsSectionCount,
    llmsTxtContent: data.llmsTxt?.slice(0, 500) ?? null,
    aiTxtPresent: data.aiTxt !== null,
    aiSummaryPresent: data.aiSummaryJson !== null,
    aiFaqPresent: data.aiFaqJson !== null,
    aiServicePresent: data.aiServiceJson !== null,
    page,
    hasDateModified,
  }
}

// ── Rule-engine results (deterministic items — no Claude needed) ──────────────

const GEO_AI_SLUGS = new Set([
  'geo-entity-wikipedia',
  'geo-entity-sameas-depth',
  'geo-entity-nap',
  'geo-entity-about',
  'geo-structure-h1',
  'geo-content-citations',
  'geo-competitor-share',
  'geo-competitor-compare',
  'geo-competitor-diff',
  'geo-sentiment-known',
  'geo-sentiment-framing',
  'geo-sentiment-use-cases',
  'geo-sentiment-competitors',
])

function re(
  slug: string, verified: boolean,
  detail: string, highlight: string, narrative: string, action: string,
): ModuleAnalysisResult {
  return { slug, verified, detail, highlight, narrative, action }
}

function buildGeoRuleResults(f: ReturnType<typeof buildRuleFindings>): ModuleAnalysisResult[] {
  const results: ModuleAnalysisResult[] = []

  // ── llms.txt ──
  results.push(f.llmsPresent
    ? re('geo-llms-present', true,
        '**AI guidance file** found at /llms.txt.',
        'AI guidance file exists',
        'AI engines have a dedicated file to read the site summary and structure.',
        '')
    : re('geo-llms-present', false,
        '**No AI guidance file** found — /llms.txt returns 404.',
        'AI guidance file is missing',
        '**Without this file AI engines have no curated summary** to cite — they must guess from raw page content.',
        'Create /llms.txt at your domain root. Start with: # BrandName\\n> One-line description\\n## Key Pages\\n- [Home](https://yourdomain.com)')
  )

  results.push(f.llmsH1
    ? re('geo-llms-h1', true,
        '**Description heading** (# line) found in llms.txt.',
        'Site description heading present',
        'AI engines can identify what the site is about from the first line.',
        '')
    : re('geo-llms-h1', false,
        f.llmsPresent ? '**llms.txt exists but has no description heading** (# line).' : '**llms.txt is missing** — no heading can be present.',
        'AI guidance file missing heading',
        '**Without a heading AI cannot tell what the site is about** from the guidance file.',
        'Add a heading as the first line of llms.txt: # BrandName — short tagline')
  )

  results.push(f.llmsBlockquote
    ? re('geo-llms-blockquote', true,
        '**One-line product summary** (blockquote) found in llms.txt.',
        'Product summary in AI file',
        'AI engines can give a brief, accurate description of the product.',
        '')
    : re('geo-llms-blockquote', false,
        f.llmsPresent ? '**llms.txt has no one-line product summary** (> blockquote line).' : '**llms.txt is missing** — no product summary can be present.',
        'No product summary in AI file',
        '**Without a one-liner AI engines cannot give brief accurate mentions** of the product.',
        'Add a blockquote summary: > BrandName helps [audience] do [outcome] without [pain].')
  )

  results.push(f.llmsSections
    ? re('geo-llms-sections', true,
        `**${f.llmsSectionCount} named section${f.llmsSectionCount > 1 ? 's' : ''}** (## headings) found in llms.txt.`,
        `${f.llmsSectionCount} content sections present`,
        'AI can match specific sections of the site to specific user queries.',
        '')
    : re('geo-llms-sections', false,
        f.llmsPresent
          ? `**llms.txt has no named sections** — ${f.llmsSectionCount === 0 ? 'no ## headings found' : `only ${f.llmsSectionCount} section`}.`
          : '**llms.txt is missing** — no sections can be present.',
        'No content sections in AI file',
        '**Without sections AI cannot match content to specific queries** — everything looks like one undifferentiated block.',
        'Add at least 2 sections with ## headings, e.g. ## Features, ## Use Cases, ## Pricing')
  )

  results.push(f.llmsLinks
    ? re('geo-llms-links', true,
        `**${f.llmsLinkCount} link${f.llmsLinkCount > 1 ? 's' : ''}** to key pages found in llms.txt.`,
        `${f.llmsLinkCount} page links in AI file`,
        'AI can navigate directly to specific content pages from the guidance file.',
        '')
    : re('geo-llms-links', false,
        f.llmsPresent
          ? `**llms.txt contains no markdown links** — ${f.llmsLinkCount} found.`
          : '**llms.txt is missing** — no links can be present.',
        'No page links in AI file',
        '**Without links AI cannot navigate to specific content** even if it knows the guidance file exists.',
        'Add links: - [Features](https://yourdomain.com/features)\\n- [Pricing](https://yourdomain.com/pricing)')
  )

  results.push(f.llmsDepth
    ? re('geo-llms-depth', true,
        `**Good depth** — llms.txt has ${f.llmsLinkCount} links across ${f.llmsSectionCount} sections.`,
        'AI guidance file has good depth',
        'The file gives AI engines enough structure to navigate and cite specific content.',
        '')
    : re('geo-llms-depth', false,
        f.llmsPresent
          ? `**llms.txt is too thin** — ${f.llmsLinkCount} link${f.llmsLinkCount !== 1 ? 's' : ''} and ${f.llmsSectionCount} section${f.llmsSectionCount !== 1 ? 's' : ''} (target: 5+ links, 2+ sections).`
          : '**llms.txt is missing** — cannot assess depth.',
        'AI guidance file needs more content',
        '**A near-empty guidance file gives AI engines almost nothing to navigate** — citation chances drop significantly.',
        'Expand llms.txt to at least 5 links across 2+ sections covering your core pages.')
  )

  // ── AI discovery endpoints ──
  results.push(f.aiTxtPresent
    ? re('geo-discovery-aitxt', true,
        '**AI policy file** found at /.well-known/ai.txt.',
        'AI policy file is present',
        'AI systems know exactly how this site permits AI interaction and citation.',
        '')
    : re('geo-discovery-aitxt', false,
        '**No AI policy file** found at /.well-known/ai.txt.',
        'AI policy file missing',
        '**Without a policy file AI systems have no explicit guidance** on how to interact with this site.',
        'Create /.well-known/ai.txt declaring your AI usage policy. See ai.robots.txt for the format.')
  )

  results.push(f.aiSummaryPresent
    ? re('geo-discovery-summary', true,
        '**AI-readable site summary** file found at /ai/summary.json.',
        'AI site summary file exists',
        'AI engines can understand the product without crawling every page.',
        '')
    : re('geo-discovery-summary', false,
        '**No AI-readable site summary** found at /ai/summary.json.',
        'AI site summary file missing',
        '**Without a machine-readable summary AI must guess your product** from unstructured page content.',
        'Create /ai/summary.json with name, description, category, audience, and url fields.')
  )

  results.push(f.aiFaqPresent
    ? re('geo-discovery-faq', true,
        '**AI-readable FAQ** file found at /ai/faq.json.',
        'AI FAQ file exists',
        'AI can answer questions about this product directly from structured data.',
        '')
    : re('geo-discovery-faq', false,
        '**No AI-readable FAQ** found at /ai/faq.json.',
        'AI FAQ file missing',
        '**Without a structured FAQ AI must guess answers** to common questions about the product.',
        'Create /ai/faq.json as an array of {question, answer} objects covering the top 10 user questions.')
  )

  results.push(f.aiServicePresent
    ? re('geo-discovery-service', true,
        '**AI-readable product description** file found at /ai/service.json.',
        'AI product file exists',
        'AI can accurately describe the product category, pricing, and audience.',
        '')
    : re('geo-discovery-service', false,
        '**No AI-readable product description** found at /ai/service.json.',
        'AI product file missing',
        '**Without a product file AI guesses the category and pricing** — often incorrectly.',
        'Create /ai/service.json with type, description, pricing, targetAudience, and features fields.')
  )

  // ── robots.txt AI bots ──
  const t1Pass = f.tier1.blocked.length === 0
  results.push(t1Pass
    ? re('geo-robots-tier1', true,
        `**No AI training bots blocked** — ${f.tier1.allowed.length > 0 ? `${f.tier1.allowed.join(', ')} explicitly allowed` : 'all allowed by default'}.`,
        'AI training bots have access',
        'AI engines can train on this content and may cite it in future responses.',
        '')
    : re('geo-robots-tier1', false,
        `**${f.tier1.blocked.length} AI training bot${f.tier1.blocked.length > 1 ? 's' : ''} blocked**: ${f.tier1.blocked.join(', ')}.`,
        `${f.tier1.blocked.length} training bot${f.tier1.blocked.length > 1 ? 's' : ''} blocked`,
        '**Blocked training bots cannot learn from this content** — it will be excluded from AI knowledge bases.',
        `Remove Disallow: / rules for ${f.tier1.blocked.join(', ')} in robots.txt, or add Allow: / for each.`)
  )

  const t2Pass = f.tier2.blocked.length === 0
  results.push(t2Pass
    ? re('geo-robots-tier2', true,
        `**No AI search bots blocked** — ${f.tier2.allowed.length > 0 ? `${f.tier2.allowed.join(', ')} explicitly allowed` : 'all allowed by default'}.`,
        'AI search bots have access',
        'This site can appear in AI-powered search results like Perplexity and ChatGPT.',
        '')
    : re('geo-robots-tier2', false,
        `**${f.tier2.blocked.length} AI search bot${f.tier2.blocked.length > 1 ? 's' : ''} blocked**: ${f.tier2.blocked.join(', ')}.`,
        `${f.tier2.blocked.length} search bot${f.tier2.blocked.length > 1 ? 's' : ''} blocked`,
        '**Blocked search bots cannot surface this site** in AI-powered search results.',
        `Remove Disallow: / rules for ${f.tier2.blocked.join(', ')} in robots.txt.`)
  )

  const t3Pass = f.tier3.blocked.length === 0
  results.push(t3Pass
    ? re('geo-robots-tier3', true,
        `**No AI assistant bots blocked** — ${f.tier3.allowed.length > 0 ? `${f.tier3.allowed.join(', ')} explicitly allowed` : 'all allowed by default'}.`,
        'AI assistant bots have access',
        'AI assistants can fetch this site in real time when answering user questions.',
        '')
    : re('geo-robots-tier3', false,
        `**${f.tier3.blocked.length} AI assistant bot${f.tier3.blocked.length > 1 ? 's' : ''} blocked**: ${f.tier3.blocked.join(', ')}.`,
        `${f.tier3.blocked.length} assistant bot${f.tier3.blocked.length > 1 ? 's' : ''} blocked`,
        '**Blocked assistant bots cannot fetch this page** when answering live user queries.',
        `Remove Disallow: / rules for ${f.tier3.blocked.join(', ')} in robots.txt.`)
  )

  // ── schema ──
  results.push(f.hasFaq
    ? re('geo-schema-faq', true,
        '**FAQ structured data** (FAQPage) found on the page.',
        'FAQ schema markup present',
        'AI engines can directly extract Q&A pairs from this page to cite in answers.',
        '')
    : re('geo-schema-faq', false,
        '**No FAQ structured data** found on the page.',
        'No FAQ schema markup',
        '**FAQ markup is the most valuable schema for AI citations** — without it AI cannot extract Q&A pairs cleanly.',
        'Add a FAQPage JSON-LD block inside <script type="application/ld+json"> listing your top questions and answers.')
  )

  results.push(
    f.hasOrg && f.hasSameAs
      ? re('geo-schema-org', true,
          '**Organization schema with sameAs profile links** found.',
          'Company schema with profile links',
          'AI engines can confirm this is a real entity and link it to known profiles.',
          '')
      : f.hasOrg && !f.hasSameAs
        ? re('geo-schema-org', false,
            '**Organization schema found but sameAs links are missing** — no external profile links declared.',
            'Company schema missing profile links',
            '**Without sameAs links AI may confuse this brand** with similarly named companies.',
            'Add a sameAs array to your Organization schema linking to Wikipedia, Crunchbase, LinkedIn, and other profiles.')
        : re('geo-schema-org', false,
            '**No Organization schema** found on the page.',
            'No company schema markup',
            '**Without company markup AI has no authoritative source** to build an entity profile from.',
            'Add an Organization JSON-LD block with name, url, logo, and sameAs fields.')
  )

  results.push(f.hasWebSite
    ? re('geo-schema-website', true,
        '**WebSite structured data** found on the page.',
        'Website schema is present',
        'AI engines know the official site name and URL for this brand.',
        '')
    : re('geo-schema-website', false,
        '**No WebSite structured data** found on the page.',
        'No website schema markup',
        '**Without website markup AI has no authoritative name and URL** for this brand.',
        'Add a WebSite JSON-LD block with name and url fields inside your homepage <head>.')
  )

  results.push(f.hasArticle
    ? re('geo-schema-article', true,
        '**Article or BlogPosting schema** found on the page.',
        'Article schema is present',
        'Blog posts are marked as citable sources for AI engines.',
        '')
    : re('geo-schema-article', false,
        '**No Article or BlogPosting schema** detected.',
        'No article schema on content pages',
        '**Without article markup blog posts are treated as generic pages** — not as citable sources.',
        'Add an Article JSON-LD block to each blog post with headline, datePublished, dateModified, and author.')
  )

  // ── freshness signals ──
  results.push(f.page.lang
    ? re('geo-signals-lang', true,
        `**Page language declared**: lang="${f.page.lang}".`,
        'Page language is declared',
        'AI engines use this to match the page to language-specific queries.',
        '')
    : re('geo-signals-lang', false,
        '**No lang attribute** found on the <html> element.',
        'Page language not declared',
        '**Without a language declaration AI may skip this page** for language-specific queries.',
        'Add lang="en" (or your language code) to the opening <html> tag.')
  )

  const hasModified = !!(f.page.articleModifiedTime || f.page.ogUpdatedTime || f.hasDateModified)
  const modifiedSource = f.page.articleModifiedTime
    ? `article:modified_time: ${f.page.articleModifiedTime}`
    : f.page.ogUpdatedTime
      ? `og:updated_time: ${f.page.ogUpdatedTime}`
      : f.hasDateModified ? 'dateModified in JSON-LD' : null
  results.push(hasModified
    ? re('geo-signals-modified', true,
        `**Content freshness date declared** — ${modifiedSource}.`,
        'Content freshness date set',
        'AI engines treat this page as current and rank it above undated competitors.',
        '')
    : re('geo-signals-modified', false,
        '**No last-updated date declared** — the page appears undated to AI engines.',
        'No content freshness date',
        '**Undated content is assumed stale by AI** and ranked below competitors who declare update dates.',
        'Add <meta property="article:modified_time" content="YYYY-MM-DDThh:mm:ssZ"> in <head>, or add dateModified to your JSON-LD schema.')
  )

  results.push(f.page.rssLink
    ? re('geo-signals-rss', true,
        `**RSS/Atom feed** found: ${f.page.rssLink}.`,
        'RSS feed is present',
        'AI crawlers can automatically discover new content as it is published.',
        '')
    : re('geo-signals-rss', false,
        '**No RSS or Atom feed** detected on the page.',
        'No RSS feed present',
        '**Without a feed AI crawlers must check manually** — new content takes longer to be discovered and cited.',
        'Add <link type="application/rss+xml" rel="alternate" href="/feed.xml"> inside your <head>.')
  )

  // ── content signals (thresholds from pre-computed data) ──
  results.push(f.page.statsCount >= 2
    ? re('geo-content-stats', true,
        `**${f.page.statsCount} statistic${f.page.statsCount > 1 ? 's' : ''} or data point${f.page.statsCount > 1 ? 's' : ''}** detected in page content.`,
        `${f.page.statsCount} data points in content`,
        'Data-backed content is cited ~33% more often by AI engines than opinion-only copy.',
        '')
    : re('geo-content-stats', false,
        f.page.statsCount === 1
          ? '**Only 1 statistic detected** — more quantified claims are needed.'
          : '**No statistics or data points** detected in the page content.',
        'Content lacks specific data',
        '**Content without numbers is skipped by AI** in favour of pages with specific, verifiable statistics.',
        'Add 3–5 specific data points: percentages, time saved, customer counts, or study results with source attribution.')
  )

  results.push(f.page.listItems >= 3 || f.page.tableCount >= 1
    ? re('geo-content-lists', true,
        `**Structured content present** — ${f.page.listItems} list item${f.page.listItems !== 1 ? 's' : ''}${f.page.tableCount > 0 ? `, ${f.page.tableCount} table${f.page.tableCount > 1 ? 's' : ''}` : ''}.`,
        'Lists and tables present',
        'AI engines extract structured content far more readily than dense paragraphs.',
        '')
    : re('geo-content-lists', false,
        `**Minimal structured content** — ${f.page.listItems} list items, ${f.page.tableCount} tables.`,
        'No lists or tables in content',
        '**AI skips dense paragraphs** and prefers extracting bullet points and tables as direct citations.',
        'Break key information into bullet lists or comparison tables — features, benefits, and use cases.')
  )

  results.push(f.page.hasFaqHeadings
    ? re('geo-structure-faq-content', true,
        '**FAQ-style Q&A headings** detected in the page content.',
        'FAQ content present on page',
        'AI engines can cite this page when answering the specific questions covered.',
        '')
    : re('geo-structure-faq-content', false,
        '**No FAQ-style Q&A content** detected in page headings or body.',
        'No FAQ content on page',
        '**Pages without Q&A content miss the most common AI citation trigger** — direct question matching.',
        'Add a FAQ section with 5–8 questions as H2/H3 headings followed by clear 2–3 sentence answers.')
  )

  return results
}

// ── Build context string for Claude ──────────────────────────────────────────

function buildRuleContext(f: ReturnType<typeof buildRuleFindings>, itemSlugs?: string[]): string {
  const botLine = (tier: ReturnType<typeof checkTierBots>, name: string) => {
    const parts = []
    if (tier.blocked.length) parts.push(`BLOCKED: ${tier.blocked.join(', ')}`)
    if (tier.allowed.length) parts.push(`explicitly allowed: ${tier.allowed.join(', ')}`)
    if (tier.notMentioned.length) parts.push(`not mentioned (neutral): ${tier.notMentioned.join(', ')}`)
    return `${name}: ${parts.join(' | ') || 'no bots found'}`
  }

  const needsContent = !itemSlugs || itemSlugs.some(s => s.includes('content') || s.includes('faq') || s.includes('stat'))

  const sections = [
    '── robots.txt AI bot status ──',
    botLine(f.tier1, 'Training bots (Tier 1)'),
    botLine(f.tier2, 'Search bots (Tier 2)'),
    botLine(f.tier3, 'User bots (Tier 3)'),
    '',
    '── llms.txt ──',
    `Present: ${f.llmsPresent ? 'yes' : 'no (404)'}`,
    f.llmsPresent ? `Has H1 (#): ${f.llmsH1}` : '',
    f.llmsPresent ? `Has blockquote (>): ${f.llmsBlockquote}` : '',
    f.llmsPresent ? `Has sections (##): ${f.llmsSections} (${f.llmsSectionCount} sections found)` : '',
    f.llmsPresent ? `Has links: ${f.llmsLinks} (${f.llmsLinkCount} links found)` : '',
    f.llmsPresent ? `Has depth (5+ links, 2+ sections): ${f.llmsDepth}` : '',
    f.llmsTxtContent ? `Content preview:\n${f.llmsTxtContent}` : '',
    '',
    '── JSON-LD schema types found ──',
    `FAQPage: ${f.hasFaq}`,
    `Organization: ${f.hasOrg}${f.hasOrg ? ` | sameAs: ${f.hasSameAs}` : ''}`,
    `WebSite: ${f.hasWebSite}`,
    `Article/BlogPosting: ${f.hasArticle}`,
    '',
    '── Technical signals ──',
    `html lang: ${f.page.lang || 'not set'}`,
    `article:modified_time: ${f.page.articleModifiedTime || 'not set'}`,
    `dateModified in JSON-LD: ${f.hasDateModified}`,
    `RSS/Atom feed link: ${f.page.rssLink || 'not found'}`,
    `/.well-known/ai.txt: ${f.aiTxtPresent ? 'present (200)' : 'not found (404)'}`,
    `/ai/summary.json: ${f.aiSummaryPresent ? 'present (200)' : 'not found (404)'}`,
    `/ai/faq.json: ${f.aiFaqPresent ? 'present (200)' : 'not found (404)'}`,
    `/ai/service.json: ${f.aiServicePresent ? 'present (200)' : 'not found (404)'}`,
    '',
    '── Page content signals ──',
    `Title: ${f.page.title || 'none'}`,
    `H1: ${f.page.h1 || 'none'}`,
    `Headings: ${f.page.headings.slice(0, 8).join(' | ') || 'none'}`,
    `Stats/numbers detected: ${f.page.statsCount} matches`,
    `External links count: ${f.page.externalLinks}`,
    `List items count: ${f.page.listItems} | Tables: ${f.page.tableCount}`,
    `FAQ-style headings detected: ${f.page.hasFaqHeadings}`,
    `Body excerpt: ${f.page.bodyText.slice(0, 400)}`,
  ].filter(Boolean).join('\n')
  return sections
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function analyzeGeo(
  data: GeoFetchData,
  brainContext?: string,
  brandName?: string,
): Promise<ModuleAnalysisResult[]> {
  const findings = buildRuleFindings(data)
  const allItems = getAllItems(GEO_MODULE)

  // Rule engine handles 23 deterministic items
  const ruleResults = buildGeoRuleResults(findings)
  const ruleResultMap = new Map(ruleResults.map(r => [r.slug, r]))

  // AI handles 13 judgment items (training knowledge + content quality)
  const aiItems = allItems.filter(item => GEO_AI_SLUGS.has(item.slug))

  const itemList = aiItems
    .map((item, idx) => `${idx + 1}. [${item.slug}] ${item.label}\nInstructions: ${item.prompt}`)
    .join('\n\n')

  const maxTokens = Math.min(aiItems.length * 120, 2000)

  const raw = await callAI({
    system: GEO_MODULE.systemPrompt,
    prompt: `Website: ${data.url}${brandName ? `\nBrand name: ${brandName}` : ''}
${brainContext ? `\nBrand context:\n${brainContext}\n` : ''}
── Page content ──
Title: ${findings.page.title || 'none'}
H1: ${findings.page.h1 || 'none'}
Headings: ${findings.page.headings.slice(0, 8).join(' | ') || 'none'}
Body excerpt: ${findings.page.bodyText.slice(0, 800)}
Organization schema: ${findings.hasOrg ? `present${findings.hasSameAs ? ' with sameAs links' : ', no sameAs links'}` : 'not found'}

── Checks to evaluate ──
For each check respond with ONLY this schema:
[{"slug": "...", "d": "**key fact** in plain English under 12 words", "h": "5-8 plain words", "n": "why it matters — **key risk** under 20 words", "a": "concrete next step under 25 words", "verified": true or false}]

${itemList}`,
    maxTokens,
    model: 'claude-haiku-4-5-20251001',
  })

  let aiRows: unknown[]
  try {
    aiRows = parseClaudeJsonArray(raw)
  } catch {
    aiRows = []
  }

  const aiResultMap = new Map(
    (aiRows as any[])
      .map(r => ({
        slug: r.slug,
        detail: r.d ?? r.detail ?? '',
        highlight: r.h ?? r.highlight ?? '',
        narrative: r.n ?? r.narrative ?? '',
        action: r.a ?? r.action ?? '',
        verified: typeof r.verified === 'boolean' ? r.verified : false,
      }))
      .filter(r => typeof r.slug === 'string' && r.detail)
      .map(r => [r.slug, r as ModuleAnalysisResult]),
  )

  // Merge: rule engine results + AI results, preserving definition order
  return allItems.map(item => {
    if (GEO_AI_SLUGS.has(item.slug)) {
      return aiResultMap.get(item.slug) ?? {
        slug: item.slug,
        verified: false,
        detail: 'Could not evaluate — please review manually.',
        highlight: 'Manual check needed',
        narrative: 'Review this item manually to confirm it is in place.',
        action: '',
      }
    }
    return ruleResultMap.get(item.slug) ?? {
      slug: item.slug,
      verified: false,
      detail: 'Could not be checked automatically.',
      highlight: 'Manual check needed',
      narrative: '',
      action: '',
    }
  })
}
