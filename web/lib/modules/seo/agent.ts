import * as cheerio from 'cheerio'
import { callAI } from '@/lib/ai/client'
import type { SeoAuditResult } from '@/lib/audit/seo-audit'
import type { ModuleAnalysisResult, ModuleItemDefinition } from '../types'
import { SEO_MODULE } from './definition'
import { getAllItems } from '../types'
import {
  extractSeedKeyword,
  fetchAutocompleteSuggestions,
  fetchCategorizedAutocomplete,
  fetchGoogleTrends,
  fetchSerpApiPAA,
  fetchGscTopQueries,
} from './keyword-fetchers'

export interface SeoIntegrations {
  serpApiKey?: string
  gscClientEmail?: string
  gscPrivateKey?: string
}

// ── Page content extractor (lightweight cheerio fetch for keyword analysis) ───

// Extracts a quoted string from audit finding text e.g. 'Title tag found: "My Title"' → 'My Title'
function extractQuotedText(text: string): string {
  return text.match(/[""''](.+?)[""'']/)?.[1] ?? ''
}

async function fetchPageContent(websiteUrl: string): Promise<{
  title: string
  description: string
  h1: string
  headings: string[]
  bodyText: string
  urlPath: string
  internalLinks: string[]
}> {
  const empty = { title: '', description: '', h1: '', headings: [], bodyText: '', urlPath: '', internalLinks: [] }
  try {
    const url = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`
    const urlPath = new URL(url).pathname.replace(/\/$/, '')
    const domain = new URL(url).hostname
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrowthHackerBot/1.0; +https://growthhacker.app)' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return { ...empty, urlPath }
    const html = await res.text()
    const $ = cheerio.load(html)
    const title = $('title').text().trim()
    const description = $('meta[name="description"]').attr('content') ?? ''
    const h1 = $('h1').first().text().trim()
    const headings = $('h2, h3').map((_, el) => $(el).text().trim()).get().filter(Boolean).slice(0, 20)
    // Extract internal link anchor texts for topic coverage analysis
    const internalLinks = $('a[href]')
      .map((_, el) => {
        const href = $(el).attr('href') ?? ''
        const text = $(el).text().trim()
        if (!text || text.length < 2 || text.length > 60) return null
        if (href.startsWith('/') || href.startsWith('#') || href.includes(domain)) return text
        return null
      })
      .get()
      .filter((t): t is string => Boolean(t))
      .slice(0, 25)
    $('script, style, nav, footer, header').remove()
    const bodyText = ($('main, article, [role="main"], body').first().text() ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000)
    return { title, description, h1, headings, bodyText, urlPath, internalLinks }
  } catch {
    return empty
  }
}

function buildFindingMap(audit: SeoAuditResult): Map<string, { text: string; level: string; fix?: string }> {
  const map = new Map<string, { text: string; level: string; fix?: string }>()
  for (const finding of audit.findings) {
    map.set(finding.key, { text: finding.text, level: finding.level, fix: finding.fix })
  }
  return map
}

async function generateNarratives(
  websiteUrl: string,
  failedItems: { slug: string; label: string; detail: string; action: string }[],
): Promise<Map<string, string>> {
  if (failedItems.length === 0) return new Map()

  const itemList = failedItems
    .map((i, idx) => `${idx + 1}. [${i.slug}] ${i.label}\n   Finding: ${i.detail}\n   Fix: ${i.action || 'No specific fix available'}`)
    .join('\n\n')

  const raw = await callAI({
    system: SEO_MODULE.systemPrompt,
    prompt: `Website: ${websiteUrl}

For each failing SEO check below, write 1–2 sentences of business impact — why this specific issue hurts search rankings, click-through rates, or organic traffic. Be concrete, not generic.

${itemList}

Return ONLY a valid JSON array:
[{ "slug": "...", "narrative": "..." }, ...]
No markdown fences, no text outside the array.`,
    maxTokens: 4000,
    model: 'claude-haiku-4-5-20251001',
  })

  const nStart = raw.indexOf('[')
  const nEnd = raw.lastIndexOf(']')
  if (nStart === -1 || nEnd === -1 || nEnd < nStart) return new Map()
  try {
    const rows = JSON.parse(raw.slice(nStart, nEnd + 1)) as { slug: string; narrative: string }[]
    return new Map(rows.filter((r) => r.slug && r.narrative).map((r) => [r.slug, r.narrative]))
  } catch {
    return new Map()
  }
}

// ── Link building content generator ──────────────────────────────────────────

async function generateLinkBuildingContent(
  websiteUrl: string,
  items: ModuleItemDefinition[],
  brainContext?: string,
): Promise<Map<string, { detail: string; narrative: string; action: string }>> {
  if (items.length === 0) return new Map()

  const itemList = items
    .map((item, idx) => `${idx + 1}. [${item.slug}] ${item.label}\nGuidance: ${item.prompt}`)
    .join('\n\n')

  const raw = await callAI({
    system: 'You are a link building specialist for early-stage SaaS and AI tools. Generate specific, actionable submission advice for each platform based on the website context. Be direct and include exact URLs and steps.',
    prompt: `Website: ${websiteUrl}
${brainContext ? `\nBrand context:\n${brainContext}\n` : ''}
For each platform below, generate:
- detail: 1 sentence — what this platform is and why it's a good fit for this specific product
- narrative: 1-2 sentences — what a successful listing here achieves (traffic, backlink authority, credibility)
- action: Exact step-by-step instructions following the guidance provided. Include the direct submission URL.

${itemList}

Return ONLY a valid JSON array. No markdown fences, no text outside the array:
[{"slug": "...", "detail": "...", "narrative": "...", "action": "..."}]`,
    maxTokens: 7000,
    model: 'claude-haiku-4-5-20251001',
  })

  const lbStart = raw.indexOf('[')
  const lbEnd = raw.lastIndexOf(']')
  if (lbStart === -1 || lbEnd === -1 || lbEnd < lbStart) return new Map()
  try {
    const rows = JSON.parse(raw.slice(lbStart, lbEnd + 1)) as { slug: string; detail: string; narrative: string; action: string }[]
    return new Map(rows.filter((r) => r.slug && r.detail).map((r) => [r.slug, r]))
  } catch {
    return new Map()
  }
}

// ── Keyword research content generator ───────────────────────────────────────

async function generateKeywordResearchContent(
  websiteUrl: string,
  items: ModuleItemDefinition[],
  audit: SeoAuditResult,
  integrations: SeoIntegrations,
  brainContext?: string,
): Promise<Map<string, { detail: string; narrative: string; action: string }>> {
  if (items.length === 0) return new Map()

  const pageContent = await fetchPageContent(websiteUrl)

  // Fallback: when cheerio returns empty (JS-rendered site), extract from audit findings
  const findingText = (key: string) => audit.findings.find((f) => f.key === key)?.text ?? ''
  const title = pageContent.title || extractQuotedText(findingText('title.present'))
  const description = pageContent.description || extractQuotedText(findingText('description.present'))
  const h1 = pageContent.h1 || extractQuotedText(findingText('h1.exists'))
  const headings = pageContent.headings.length > 0
    ? pageContent.headings
    : [findingText('hierarchy.h2_exists'), findingText('hierarchy.descriptive')].filter(Boolean)
  const bodyText = pageContent.bodyText || (brainContext ? '' : 'Page body text could not be extracted.')
  const internalLinks = pageContent.internalLinks

  const urlPath = pageContent.urlPath
  const urlLine = urlPath ? `URL slug: ${urlPath}` : `URL: homepage (${websiteUrl}) — no slug present`

  // Extract seed keyword — pass undefined for brandName since brainContext is the full context string, not just the name
  const seed = extractSeedKeyword(title, h1)
  const hasLongtailItems = items.some((i) => i.slug.startsWith('kw-longtail-'))
  const [autocomplete, categorized, trendsScore, paaQuestions, gscQueries] = await Promise.all([
    fetchAutocompleteSuggestions(seed),
    hasLongtailItems ? fetchCategorizedAutocomplete(seed) : Promise.resolve(null),
    fetchGoogleTrends(seed),
    integrations.serpApiKey
      ? fetchSerpApiPAA(seed, integrations.serpApiKey)
      : Promise.resolve([] as string[]),
    integrations.gscClientEmail && integrations.gscPrivateKey
      ? fetchGscTopQueries(integrations.gscClientEmail, integrations.gscPrivateKey, websiteUrl)
      : Promise.resolve([] as Awaited<ReturnType<typeof fetchGscTopQueries>>),
  ])

  const pageSnapshot = [
    title ? `Title: ${title}` : '',
    description ? `Meta description: ${description}` : '',
    h1 ? `H1: ${h1}` : '',
    urlLine,
    headings.length > 0 ? `Headings (H2/H3):\n${headings.map((h) => `  - ${h}`).join('\n')}` : 'Headings: none found',
    internalLinks.length > 0 ? `Internal links (anchor texts):\n${internalLinks.map((l) => `  - ${l}`).join('\n')}` : '',
    bodyText ? `Body text excerpt:\n${bodyText}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const externalData = [
    autocomplete.length > 0
      ? `Google Autocomplete suggestions for "${seed}":\n${autocomplete.map((s) => `  - ${s}`).join('\n')}`
      : '',
    categorized
      ? [
          categorized.usecase.length > 0
            ? `Use-case suggestions ("${seed} for ..."):\n${categorized.usecase.map((s) => `  - ${s}`).join('\n')}`
            : '',
          categorized.comparison.length > 0
            ? `Comparison/alternative suggestions:\n${categorized.comparison.map((s) => `  - ${s}`).join('\n')}`
            : '',
          categorized.questions.length > 0
            ? `Question suggestions ("how to / what is ..."):\n${categorized.questions.map((s) => `  - ${s}`).join('\n')}`
            : '',
          categorized.modifiers.length > 0
            ? `Modifier suggestions ("best / free / top ..."):\n${categorized.modifiers.map((s) => `  - ${s}`).join('\n')}`
            : '',
        ].filter(Boolean).join('\n\n')
      : '',
    trendsScore !== null
      ? `Google Trends interest score for "${seed}": ${trendsScore}/100 (average over last 12 months)`
      : '',
    paaQuestions.length > 0
      ? `People Also Ask questions:\n${paaQuestions.map((q) => `  - ${q}`).join('\n')}`
      : '',
    // GSC sections — include connection status so Claude can give the right message when not connected
    (() => {
      const gscConnected = !!(integrations.gscClientEmail && integrations.gscPrivateKey)
      if (!gscConnected) {
        return 'GSC data: Not connected. User must add Service Account credentials in Settings → Integrations → Google Search Console API.'
      }
      if (gscQueries.length === 0) {
        return 'GSC data: Connected but no search data returned. The site may be new, not yet verified in GSC, or the service account email may not have been added to the GSC property.'
      }
      const quickWins = gscQueries.filter((r) => r.position > 3 && r.position <= 20)
      const lowCtr = gscQueries.filter((r) => r.impressions >= 50 && r.clicks / r.impressions < 0.05)
      return [
        `GSC top queries (last 90 days, by impressions):\n${gscQueries.slice(0, 10).map((r) => `  "${r.query}" — ${r.impressions} impressions, ${r.clicks} clicks, pos ${r.position}`).join('\n')}`,
        quickWins.length > 0
          ? `GSC quick win keywords (positions 4–20):\n${quickWins.slice(0, 10).map((r) => `  "${r.query}" — pos ${r.position}, ${r.impressions} impressions`).join('\n')}`
          : 'GSC quick wins: No keywords currently ranking in positions 4–20.',
        lowCtr.length > 0
          ? `GSC low CTR keywords (≥50 impressions, <5% CTR):\n${lowCtr.slice(0, 10).map((r) => `  "${r.query}" — ${r.impressions} impressions, CTR ${((r.clicks / r.impressions) * 100).toFixed(1)}%, pos ${r.position}`).join('\n')}`
          : 'GSC low CTR: No high-impression, low-CTR keywords found.',
      ].join('\n\n')
    })(),
  ]
    .filter(Boolean)
    .join('\n\n')

  const itemList = items
    .map((item, idx) => `${idx + 1}. [${item.slug}] ${item.label}\nInstructions: ${item.prompt}`)
    .join('\n\n')

  const raw = await callAI({
    system: 'You are a senior SEO strategist specialising in keyword research for early-stage SaaS and AI products. Analyse the page content and external data provided. Give specific, concrete findings — name actual keywords and questions, not generic advice.',
    prompt: `Website: ${websiteUrl}
${brainContext ? `\nBrand context:\n${brainContext}\n` : ''}
── Page content ──
${pageSnapshot}
${externalData ? `\n── External keyword data ──\n${externalData}` : ''}

For each keyword research check below, generate:
- detail: 1–2 sentences — the specific finding grounded in the data above
- narrative: 1–2 sentences — why this matters for organic traffic and rankings
- action: Concrete next step — name actual keyword phrases or questions where possible

${itemList}

Return ONLY a valid JSON array. No markdown fences, no text outside the array. Start your response with [ immediately:
[{"slug": "...", "detail": "...", "narrative": "...", "action": "..."}]`,
    maxTokens: 8000,
    model: 'claude-haiku-4-5-20251001',
  })

  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) return new Map()
  try {
    const rows = JSON.parse(raw.slice(start, end + 1)) as { slug: string; detail: string; narrative: string; action: string }[]
    return new Map(rows.filter((r) => r.slug && r.detail).map((r) => [r.slug, r]))
  } catch {
    return new Map()
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function analyzeSeo(
  audit: SeoAuditResult,
  websiteUrl: string,
  brainContext?: string,
  integrations: SeoIntegrations = {},
): Promise<ModuleAnalysisResult[]> {
  const findingMap = buildFindingMap(audit)
  const allItems = getAllItems(SEO_MODULE)

  // Separate AI-generated items from rule-engine items
  const lbItems = allItems.filter((item) => item.slug.startsWith('lb-'))
  const kwItems = allItems.filter((item) => item.slug.startsWith('kw-') || item.slug.startsWith('gsc-'))
  const ruleItems = allItems.filter((item) => !item.slug.startsWith('lb-') && !item.slug.startsWith('kw-') && !item.slug.startsWith('gsc-'))

  const baseResults: (ModuleAnalysisResult & { isFail: boolean })[] = ruleItems.map((item) => {
    const finding = findingMap.get(item.slug)

    if (!finding) {
      // Item wasn't returned by engine (e.g. no images on page → image checks return nothing)
      return {
        slug: item.slug,
        detail: 'Could not be checked automatically for this page.',
        narrative: '',
        action: '',
        verified: false,
        isFail: false,
      }
    }

    const verified = finding.level === 'good' || finding.level === 'info'
    return {
      slug: item.slug,
      detail: finding.text,
      narrative: '',
      action: finding.fix ?? '',
      verified,
      isFail: !verified,
    }
  })

  // Generate narratives for failing items in one batch call
  const failedItems = baseResults
    .filter((r) => r.isFail)
    .map((r) => ({
      slug: r.slug,
      label: allItems.find((i) => i.slug === r.slug)?.label ?? r.slug,
      detail: r.detail,
      action: r.action,
    }))

  const narrativeMap = await generateNarratives(websiteUrl, failedItems)

  const ruleResults: ModuleAnalysisResult[] = baseResults.map(({ isFail: _, ...r }) => ({
    ...r,
    narrative: narrativeMap.get(r.slug) ?? '',
  }))

  // Generate personalised content for lb-* and kw-* items in parallel
  const [lbContentMap, kwContentMap] = await Promise.all([
    generateLinkBuildingContent(websiteUrl, lbItems, brainContext),
    generateKeywordResearchContent(websiteUrl, kwItems, audit, integrations, brainContext),
  ])

  const lbResults: ModuleAnalysisResult[] = lbItems.map((item) => {
    const content = lbContentMap.get(item.slug)
    return {
      slug: item.slug,
      detail: content?.detail ?? 'Submit your product to this platform to earn a quality backlink.',
      narrative: content?.narrative ?? '',
      action: content?.action ?? '',
      verified: false,
    }
  })

  const kwResults: ModuleAnalysisResult[] = kwItems.map((item) => {
    const content = kwContentMap.get(item.slug)
    const fallbackDetail = item.slug.startsWith('gsc-')
      ? 'Connect the GSC API in Settings → Integrations to unlock this ranking insight.'
      : 'Keyword analysis could not be completed for this check.'
    return {
      slug: item.slug,
      detail: content?.detail ?? fallbackDetail,
      narrative: content?.narrative ?? '',
      action: content?.action ?? '',
      verified: false,
    }
  })

  return [...ruleResults, ...lbResults, ...kwResults]
}
