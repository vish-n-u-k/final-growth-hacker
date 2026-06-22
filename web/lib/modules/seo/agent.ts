import * as cheerio from 'cheerio'
import { callAI } from '@/lib/ai/client'
import type { SeoAuditResult } from '@/lib/audit/seo-audit'
import type { ModuleAnalysisResult, ModuleItemDefinition } from '../types'
import { SEO_MODULE } from './definition'
import { getAllItems } from '../types'

// ── Page content extractor (lightweight cheerio fetch for keyword analysis) ───

async function fetchPageContent(websiteUrl: string): Promise<{
  title: string
  description: string
  h1: string
  headings: string[]
  bodyText: string
}> {
  const empty = { title: '', description: '', h1: '', headings: [], bodyText: '' }
  try {
    const url = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrowthHackerBot/1.0; +https://growthhacker.app)' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return empty
    const html = await res.text()
    const $ = cheerio.load(html)
    const title = $('title').text().trim()
    const description = $('meta[name="description"]').attr('content') ?? ''
    const h1 = $('h1').first().text().trim()
    const headings = $('h2, h3').map((_, el) => $(el).text().trim()).get().slice(0, 20)
    $('script, style, nav, footer, header').remove()
    const bodyText = ($('main, article, [role="main"], body').first().text() ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000)
    return { title, description, h1, headings, bodyText }
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

  const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()
  try {
    const rows = JSON.parse(clean) as { slug: string; narrative: string }[]
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

  try {
    const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()
    const rows = JSON.parse(clean) as { slug: string; detail: string; narrative: string; action: string }[]
    return new Map(rows.filter((r) => r.slug && r.detail).map((r) => [r.slug, r]))
  } catch {
    return new Map()
  }
}

// ── Keyword research content generator ───────────────────────────────────────

async function generateKeywordResearchContent(
  websiteUrl: string,
  items: ModuleItemDefinition[],
  brainContext?: string,
): Promise<Map<string, { detail: string; narrative: string; action: string }>> {
  if (items.length === 0) return new Map()

  const pageContent = await fetchPageContent(websiteUrl)

  const pageSnapshot = [
    pageContent.title ? `Title: ${pageContent.title}` : '',
    pageContent.description ? `Meta description: ${pageContent.description}` : '',
    pageContent.h1 ? `H1: ${pageContent.h1}` : '',
    pageContent.headings.length > 0 ? `Headings (H2/H3):\n${pageContent.headings.map((h) => `  - ${h}`).join('\n')}` : '',
    pageContent.bodyText ? `Body text excerpt:\n${pageContent.bodyText}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const itemList = items
    .map((item, idx) => `${idx + 1}. [${item.slug}] ${item.label}\nInstructions: ${item.prompt}`)
    .join('\n\n')

  const raw = await callAI({
    system: 'You are a senior SEO strategist specialising in keyword research for early-stage SaaS and AI products. Analyse the page content provided and give specific, actionable keyword insights — not generic advice.',
    prompt: `Website: ${websiteUrl}
${brainContext ? `\nBrand context:\n${brainContext}\n` : ''}
Page content:
${pageSnapshot}

For each keyword research check below, generate:
- detail: 1–2 sentences — the specific finding based on the page content above
- narrative: 1–2 sentences — why this matters for organic traffic and rankings
- action: Specific next step the team should take (be concrete, name actual keywords where possible)

${itemList}

Return ONLY a valid JSON array. No markdown fences, no text outside the array:
[{"slug": "...", "detail": "...", "narrative": "...", "action": "..."}]`,
    maxTokens: 4000,
    model: 'claude-haiku-4-5-20251001',
  })

  try {
    const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()
    const rows = JSON.parse(clean) as { slug: string; detail: string; narrative: string; action: string }[]
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
): Promise<ModuleAnalysisResult[]> {
  const findingMap = buildFindingMap(audit)
  const allItems = getAllItems(SEO_MODULE)

  // Separate AI-generated items from rule-engine items
  const lbItems = allItems.filter((item) => item.slug.startsWith('lb-'))
  const kwItems = allItems.filter((item) => item.slug.startsWith('kw-'))
  const ruleItems = allItems.filter((item) => !item.slug.startsWith('lb-') && !item.slug.startsWith('kw-'))

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
    generateKeywordResearchContent(websiteUrl, kwItems, brainContext),
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
    return {
      slug: item.slug,
      detail: content?.detail ?? 'Keyword analysis could not be completed for this check.',
      narrative: content?.narrative ?? '',
      action: content?.action ?? '',
      verified: false,
    }
  })

  return [...ruleResults, ...lbResults, ...kwResults]
}
