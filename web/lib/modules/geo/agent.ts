import * as cheerio from 'cheerio'
import { callAI } from '@/lib/ai/client'
import { GEO_MODULE } from './definition'
import { getAllItems, type ModuleAnalysisResult } from '../types'
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
    .slice(0, 3000)

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

function buildRuleFindings(data: GeoFetchData) {
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

  // dateModified in JSON-LD
  const hasDateModified = schemas.some((s) => !!(s as Record<string, unknown>)['dateModified'])

  return {
    tier1, tier2, tier3,
    hasFaq, hasWebSite, hasArticle, hasOrg, hasSameAs,
    llmsPresent, llmsH1, llmsBlockquote, llmsSections, llmsLinks,
    llmsTxtContent: data.llmsTxt?.slice(0, 500) ?? null,
    aiTxtPresent: data.aiTxt !== null,
    aiSummaryPresent: data.aiSummaryJson !== null,
    page,
    hasDateModified,
  }
}

// ── Build context string for Claude ──────────────────────────────────────────

function buildRuleContext(f: ReturnType<typeof buildRuleFindings>): string {
  const botLine = (tier: ReturnType<typeof checkTierBots>, name: string) => {
    const parts = []
    if (tier.blocked.length) parts.push(`BLOCKED: ${tier.blocked.join(', ')}`)
    if (tier.allowed.length) parts.push(`explicitly allowed: ${tier.allowed.join(', ')}`)
    if (tier.notMentioned.length) parts.push(`not mentioned (neutral): ${tier.notMentioned.join(', ')}`)
    return `${name}: ${parts.join(' | ') || 'no bots found'}`
  }

  return [
    '── robots.txt AI bot status ──',
    botLine(f.tier1, 'Training bots (Tier 1)'),
    botLine(f.tier2, 'Search bots (Tier 2)'),
    botLine(f.tier3, 'User bots (Tier 3)'),
    '',
    '── llms.txt ──',
    `Present: ${f.llmsPresent ? 'yes' : 'no (404)'}`,
    f.llmsPresent ? `Has H1 (#): ${f.llmsH1}` : '',
    f.llmsPresent ? `Has blockquote (>): ${f.llmsBlockquote}` : '',
    f.llmsPresent ? `Has sections (##): ${f.llmsSections}` : '',
    f.llmsPresent ? `Has links: ${f.llmsLinks}` : '',
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
    '',
    '── Page content signals ──',
    `Title: ${f.page.title || 'none'}`,
    `H1: ${f.page.h1 || 'none'}`,
    `Headings: ${f.page.headings.slice(0, 8).join(' | ') || 'none'}`,
    `Stats/numbers detected: ${f.page.statsCount} matches`,
    `External links count: ${f.page.externalLinks}`,
    `List items count: ${f.page.listItems} | Tables: ${f.page.tableCount}`,
    `FAQ-style headings detected: ${f.page.hasFaqHeadings}`,
    `Body excerpt: ${f.page.bodyText.slice(0, 800)}`,
  ].filter(Boolean).join('\n')
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function analyzeGeo(
  data: GeoFetchData,
  brainContext?: string,
): Promise<ModuleAnalysisResult[]> {
  const findings = buildRuleFindings(data)
  const ruleContext = buildRuleContext(findings)
  const allItems = getAllItems(GEO_MODULE)

  const itemList = allItems
    .map((item, idx) => `${idx + 1}. [${item.slug}] ${item.label}\nInstructions: ${item.prompt}`)
    .join('\n\n')

  const raw = await callAI({
    system: GEO_MODULE.systemPrompt,
    prompt: `Website: ${data.url}
${brainContext ? `\nBrand context:\n${brainContext}\n` : ''}
── Pre-computed rule findings ──
${ruleContext}

── Checks to complete ──
For each check below, return:
- slug: exactly as given
- detail: one sentence — state the specific finding using the pre-computed data above for structural checks; evaluate from page content signals for content checks
- narrative: 1–2 sentences — why this matters for AI citation visibility
- action: concrete next step with exact code, file content, or commands where applicable
- verified: true if the check passes, false if it fails or is missing

${itemList}

Start your response with [
[{"slug": "...", "detail": "...", "narrative": "...", "action": "...", "verified": true}]`,
    maxTokens: 6000,
    model: 'claude-haiku-4-5-20251001',
  })

  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) return []

  try {
    const rows = JSON.parse(raw.slice(start, end + 1)) as ModuleAnalysisResult[]
    const validSlugs = new Set(allItems.map((i) => i.slug))
    return rows.filter(
      (r) =>
        typeof r.slug === 'string' &&
        validSlugs.has(r.slug) &&
        typeof r.detail === 'string' &&
        typeof r.verified === 'boolean',
    )
  } catch {
    return []
  }
}
