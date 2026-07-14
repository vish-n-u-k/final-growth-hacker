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

// Truncates body text to only include 3 sentences before and after the seed keyword
function truncateToKeywordContext(bodyText: string, seedKeyword: string): string {
  if (!bodyText || !seedKeyword) return bodyText.slice(0, 500)

  const keywordLower = seedKeyword.toLowerCase()
  const bodyLower = bodyText.toLowerCase()
  const keywordIndex = bodyLower.indexOf(keywordLower)

  if (keywordIndex === -1) return bodyText.slice(0, 500)

  // Split by sentence markers
  const sentences = bodyText.split(/(?<=[.!?])\s+/)

  // Find which sentence contains the keyword
  let currentPos = 0
  let targetSentenceIdx = 0
  for (let i = 0; i < sentences.length; i++) {
    if (currentPos + sentences[i].length > keywordIndex) {
      targetSentenceIdx = i
      break
    }
    currentPos += sentences[i].length + 1
  }

  // Extract 3 sentences before and after (inclusive of target)
  const startIdx = Math.max(0, targetSentenceIdx - 3)
  const endIdx = Math.min(sentences.length - 1, targetSentenceIdx + 3)

  return sentences.slice(startIdx, endIdx + 1).join(' ').trim()
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
): Promise<Map<string, { highlight: string; narrative: string }>> {
  if (failedItems.length === 0) return new Map()

  const itemList = failedItems
    .map((i, idx) => `${idx + 1}. [${i.slug}] ${i.label}\n   Finding: ${i.detail}\n   Fix: ${i.action || 'No specific fix available'}`)
    .join('\n\n')

  const raw = await callAI({
    system: SEO_MODULE.systemPrompt,
    prompt: `Website: ${websiteUrl}

For each failing SEO check below, return two things in plain English any business owner can understand — no jargon:
- highlight: 5–8 plain English words capturing the key point (no period, no full sentence)
- narrative: exactly 1 plain English sentence on why this hurts the business; wrap the key risk in **double asterisks**

${itemList}

Return ONLY a valid JSON array:
[{ "slug": "...", "highlight": "...", "narrative": "..." }, ...]
No markdown fences, no text outside the array.`,
    maxTokens: 4000,
    model: 'claude-haiku-4-5-20251001',
  })

  const nStart = raw.indexOf('[')
  const nEnd = raw.lastIndexOf(']')
  if (nStart === -1 || nEnd === -1 || nEnd < nStart) return new Map()
  try {
    const rows = JSON.parse(raw.slice(nStart, nEnd + 1)) as { slug: string; highlight: string; narrative: string }[]
    return new Map(rows.filter((r) => r.slug && r.narrative).map((r) => [r.slug, { highlight: r.highlight ?? '', narrative: r.narrative }]))
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
- detail: 1 sentence — what this platform is and why it's a good fit for this specific product; wrap the platform name in **double asterisks**
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

// ── Helper: filter external data based on item type ──────────────────────────

function buildFilteredExternalData(
  itemSlugs: string[],
  externalDataCache: {
    autocomplete: string[]
    categorized: { usecase: string[]; questions: string[]; modifiers: string[]; comparison: string[] } | null
    trendsScore: number | null
    paaQuestions: string[]
    gscQueries: { query: string; impressions: number; clicks: number; position: number }[]
    gscConnected: boolean
    seed: string
  },
): string {
  const sections: string[] = []
  const { autocomplete, categorized, trendsScore, paaQuestions, gscQueries, gscConnected, seed } = externalDataCache

  const hasQuestionItems = itemSlugs.some((slug) => slug === 'kw-questions')
  const hasComparisonItems = itemSlugs.some((slug) => slug === 'kw-comparisons')
  const hasLongtailItems = itemSlugs.some((slug) => slug.startsWith('kw-longtail-'))
  const hasGscItems = itemSlugs.some((slug) => slug.startsWith('gsc-'))

  // Autocomplete and trends are relevant for all keyword items
  if (itemSlugs.some((s) => s.startsWith('kw-') || s.startsWith('gsc-'))) {
    if (autocomplete.length > 0) {
      sections.push(`Google Autocomplete suggestions for "${seed}":\n${autocomplete.map((s) => `  - ${s}`).join('\n')}`)
    }
    if (trendsScore !== null) {
      sections.push(`Google Trends interest score for "${seed}": ${trendsScore}/100 (average over last 12 months)`)
    }
  }

  // Include categorized data only if longtail items are present
  if (hasLongtailItems && categorized) {
    const catSections: string[] = []
    if (categorized.usecase.length > 0) {
      catSections.push(`Use-case suggestions ("${seed} for ..."):\n${categorized.usecase.map((s) => `  - ${s}`).join('\n')}`)
    }
    if (categorized.questions.length > 0) {
      catSections.push(`Question suggestions ("how to / what is ..."):\n${categorized.questions.map((s) => `  - ${s}`).join('\n')}`)
    }
    if (categorized.modifiers.length > 0) {
      catSections.push(`Modifier suggestions ("best / free / top ..."):\n${categorized.modifiers.map((s) => `  - ${s}`).join('\n')}`)
    }
    if (catSections.length > 0) {
      sections.push(catSections.join('\n\n'))
    }
  }

  // Include comparison data only if comparison items are present
  if (hasComparisonItems && categorized && categorized.comparison.length > 0) {
    sections.push(`Comparison/alternative suggestions:\n${categorized.comparison.map((s: string) => `  - ${s}`).join('\n')}`)
  }

  // Include PAA questions only if question items are present
  if (hasQuestionItems && paaQuestions.length > 0) {
    sections.push(`People Also Ask questions:\n${paaQuestions.map((q) => `  - ${q}`).join('\n')}`)
  }

  // Include GSC data only if GSC items are present
  if (hasGscItems) {
    if (!gscConnected) {
      sections.push('GSC data: Not connected. User must add Service Account credentials in Settings → Integrations → Google Search Console API.')
    } else if (gscQueries.length === 0) {
      sections.push('GSC data: Connected and verified. Search Analytics API returned no rows yet — this is normal for new properties or recently granted service account access. Data typically syncs within 24 hours. Do NOT suggest connecting GSC, adding a service account, or verifying the site — those steps are already done.')
    } else {
      const quickWins = gscQueries.filter((r) => r.position > 3 && r.position <= 20)
      const lowCtr = gscQueries.filter((r) => r.impressions >= 50 && r.clicks / r.impressions < 0.05)
      const gscSections: string[] = [
        `GSC top queries (last 90 days, by impressions):\n${gscQueries.slice(0, 10).map((r) => `  "${r.query}" — ${r.impressions} impressions, ${r.clicks} clicks, pos ${r.position}`).join('\n')}`,
      ]
      if (quickWins.length > 0) {
        gscSections.push(`GSC quick win keywords (positions 4–20):\n${quickWins.slice(0, 10).map((r) => `  "${r.query}" — pos ${r.position}, ${r.impressions} impressions`).join('\n')}`)
      } else {
        gscSections.push('GSC quick wins: No keywords currently ranking in positions 4–20.')
      }
      if (lowCtr.length > 0) {
        gscSections.push(`GSC low CTR keywords (≥50 impressions, <5% CTR):\n${lowCtr.slice(0, 10).map((r) => `  "${r.query}" — ${r.impressions} impressions, CTR ${((r.clicks / r.impressions) * 100).toFixed(1)}%, pos ${r.position}`).join('\n')}`)
      } else {
        gscSections.push('GSC low CTR: No high-impression, low-CTR keywords found.')
      }
      sections.push(gscSections.join('\n\n'))
    }
  }

  return sections.filter(Boolean).join('\n\n')
}

// ── Keyword research content generator ───────────────────────────────────────

function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

async function callHaikuForBatch(
  batchItems: ModuleItemDefinition[],
  websiteUrl: string,
  pageSnapshot: string,
  externalData: string,
  brainContext?: string,
): Promise<{ slug: string; detail: string; narrative: string; action: string }[]> {
  const itemList = batchItems
    .map((item, idx) => `${idx + 1}. [${item.slug}] ${item.label}\nInstructions: ${item.prompt}`)
    .join('\n\n')

  const maxTokens = Math.min(batchItems.length * 200, 2400)

  // Shared across all parallel batch calls — cached so only the first call pays full input price
  const cachePrefix = `Website: ${websiteUrl}
${brainContext ? `\nBrand context:\n${brainContext}\n` : ''}
── Page content ──
${pageSnapshot}
${externalData ? `\n── External keyword data ──\n${externalData}` : ''}

For each check, respond with ONLY this schema:
[{"slug": "...", "d": "...", "n": "...", "a": "..."}]`

  const raw = await callAI({
    system: 'You are a senior SEO strategist specialising in keyword research. Output ONLY terse JSON. Keep responses concise: d (detail) under 10 words, n (narrative) under 15 words, a (action) under 20 words. Name actual keywords and questions, not generic advice. In d wrap the single most important keyword or finding in **double asterisks**.',
    cachePrefix,
    prompt: itemList,
    maxTokens,
    model: 'claude-haiku-4-5-20251001',
  })

  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) return []
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { slug: string; d?: string; n?: string; a?: string; detail?: string; narrative?: string; action?: string }[]
    return parsed
      .map(r => ({
        slug: r.slug,
        detail: r.d ?? r.detail ?? '',
        narrative: r.n ?? r.narrative ?? '',
        action: r.a ?? r.action ?? '',
      }))
      .filter(r => r.slug && r.detail)
  } catch {
    return []
  }
}

async function generateKeywordResearchContent(
  websiteUrl: string,
  items: ModuleItemDefinition[],
  audit: SeoAuditResult,
  integrations: SeoIntegrations,
  pageContent: Awaited<ReturnType<typeof fetchPageContent>>,
  brainContext?: string,
): Promise<Map<string, { detail: string; narrative: string; action: string }>> {
  if (items.length === 0) return new Map()

  // Fallback: when cheerio returns empty (JS-rendered site), extract from audit findings
  const findingText = (key: string) => audit.findings.find((f) => f.key === key)?.text ?? ''
  const title = pageContent.title
  const description = pageContent.description || extractQuotedText(findingText('description.present'))
  const h1 = pageContent.h1 || extractQuotedText(findingText('h1.exists'))
  const headings = pageContent.headings.length > 0
    ? pageContent.headings
    : [findingText('hierarchy.h2_exists'), findingText('hierarchy.descriptive')].filter(Boolean)
  const bodyText = pageContent.bodyText || (brainContext ? '' : 'Page body text could not be extracted.')
  const internalLinks = pageContent.internalLinks

  const urlPath = pageContent.urlPath
  const urlLine = urlPath ? `URL slug: ${urlPath}` : `URL: homepage (${websiteUrl}) — no slug present`

  // Ultimate fallback: derive seed from URL hostname when page is JS-rendered and cheerio gets nothing
  const seed = extractSeedKeyword(title, h1) || (() => {
    try {
      const hostname = new URL(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`).hostname
      return hostname.replace(/^www\./, '').split('.')[0]
    } catch { return '' }
  })()
  const hasLongtailItems = items.some((i) => i.slug.startsWith('kw-longtail-'))
  const [autocomplete, categorized, trendsScore, paaQuestions, gscQueries] = await Promise.all([
    fetchAutocompleteSuggestions(seed),
    hasLongtailItems ? fetchCategorizedAutocomplete(seed) : Promise.resolve(null),
    fetchGoogleTrends(seed),
    items.some((i) => i.slug === 'kw-questions') && integrations.serpApiKey
      ? fetchSerpApiPAA(seed, integrations.serpApiKey)
      : Promise.resolve([] as string[]),
    items.some((i) => i.slug.startsWith('gsc-')) && integrations.gscClientEmail && integrations.gscPrivateKey
      ? fetchGscTopQueries(integrations.gscClientEmail, integrations.gscPrivateKey, websiteUrl)
      : Promise.resolve([] as Awaited<ReturnType<typeof fetchGscTopQueries>>),
  ])

  const truncatedBodyText = bodyText ? truncateToKeywordContext(bodyText, seed) : ''

  const pageSnapshot = [
    title ? `Title: ${title}` : '',
    description ? `Meta description: ${description}` : '',
    h1 ? `H1: ${h1}` : '',
    urlLine,
    headings.length > 0 ? `Headings (H2/H3):\n${headings.map((h) => `  - ${h}`).join('\n')}` : 'Headings: none found',
    internalLinks.length > 0 ? `Internal links (anchor texts):\n${internalLinks.map((l) => `  - ${l}`).join('\n')}` : '',
    truncatedBodyText ? `Body text excerpt:\n${truncatedBodyText}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  // Build external data with dynamic context pruning
  const externalData = buildFilteredExternalData(
    items.map((i) => i.slug),
    {
      autocomplete,
      categorized,
      trendsScore,
      paaQuestions,
      gscQueries,
      gscConnected: !!(integrations.gscClientEmail && integrations.gscPrivateKey),
      seed,
    },
  )

  // Split items into batches of 4 and call AI in parallel
  const batches = chunk(items, 4)
  const batchResults = await Promise.all(
    batches.map((batchItems) =>
      callHaikuForBatch(batchItems, websiteUrl, pageSnapshot, externalData, brainContext),
    ),
  )

  // Merge all batch results into a single map
  const resultMap = new Map<string, { detail: string; narrative: string; action: string }>()
  for (const batchRows of batchResults) {
    for (const row of batchRows) {
      if (row.slug && row.detail) {
        resultMap.set(row.slug, row)
      }
    }
  }

  return resultMap
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

  // Fetch page content once at the top (skip if no keyword items)
  const pageContent = kwItems.length > 0 || lbItems.length > 0 ? await fetchPageContent(websiteUrl) : { title: '', description: '', h1: '', headings: [], bodyText: '', urlPath: '', internalLinks: [] }

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

  const ruleResults: ModuleAnalysisResult[] = baseResults.map(({ isFail: _, ...r }) => {
    const enrichment = narrativeMap.get(r.slug)
    return {
      ...r,
      highlight: enrichment?.highlight ?? '',
      narrative: enrichment?.narrative ?? '',
    }
  })

  // Generate personalised content for lb-* and kw-* items in parallel
  const [lbContentMap, kwContentMap] = await Promise.all([
    generateLinkBuildingContent(websiteUrl, lbItems, brainContext),
    generateKeywordResearchContent(websiteUrl, kwItems, audit, integrations, pageContent, brainContext),
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

  const gscConnected = !!(integrations.gscClientEmail && integrations.gscPrivateKey)
  const kwResults: ModuleAnalysisResult[] = kwItems.map((item) => {
    const content = kwContentMap.get(item.slug)
    const fallbackDetail = item.slug.startsWith('gsc-')
      ? gscConnected
        ? 'GSC is connected but ranking data could not be retrieved. Ensure the service account email is added as a user in your GSC property, then re-analyse.'
        : 'Connect the GSC API in Settings → Integrations to unlock this ranking insight.'
      : 'Keyword analysis could not be completed — re-analyse to retry.'
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
