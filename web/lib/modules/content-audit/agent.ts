import { callAI } from '@/lib/ai/client'
import { CONTENT_AUDIT_MODULE } from './definition'
import type { DynamicModuleAnalysisResult, DynamicModuleCategoryDefinition } from '../types'
import type { ContentAuditFetchResult, PageSummary } from './fetcher'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PageVerdict {
  url: string
  title: string | null
  wordCount: number
  verdict: 'Keep' | 'Refresh' | 'Consolidate' | 'Repurpose' | 'Remove'
  urgency: 'High' | 'Medium' | 'Low'
  reason: string
  action: string
}

export interface CalendarEntry {
  date: string
  topic: string
  category: string
  format: string
  priority: 'High' | 'Medium' | 'Low'
  stage: 'Awareness' | 'Consideration' | 'Decision'
}

export interface ContentAuditAnalysisOutput {
  findings: DynamicModuleAnalysisResult[]
  pageVerdicts: PageVerdict[]
  calendarData: CalendarEntry[] | null
}

// ── Format helpers ─────────────────────────────────────────────────────────────

function formatPageSummary(p: PageSummary, index: number): string {
  const lines: string[] = []
  lines.push(`[${index + 1}] ${p.url}`)
  if (p.fetchError) {
    lines.push(`  ERROR: ${p.fetchError}`)
    return lines.join('\n')
  }
  if (p.title)           lines.push(`  Title: ${p.title}`)
  if (p.metaDescription) lines.push(`  Meta: ${p.metaDescription.slice(0, 160)}`)
  if (p.h1)              lines.push(`  H1: ${p.h1}`)
  if (p.bodyExcerpt)     lines.push(`  Body: ${p.bodyExcerpt.slice(0, 300)}`)
  lines.push(`  Stats: ${p.wordCount} words | ${p.imageCount} images | ${p.internalLinkCount} internal links | ${p.externalLinkCount} external links`)
  return lines.join('\n')
}

function formatCompetitorPage(p: PageSummary): string {
  const lines: string[] = []
  lines.push(`COMPETITOR: ${p.url}`)
  if (p.fetchError) {
    lines.push(`  ERROR: Failed to fetch — note as data-unavailable`)
    return lines.join('\n')
  }
  if (p.title)           lines.push(`  Title: ${p.title}`)
  if (p.metaDescription) lines.push(`  Meta: ${p.metaDescription.slice(0, 160)}`)
  if (p.h1)              lines.push(`  H1: ${p.h1}`)
  if (p.bodyExcerpt)     lines.push(`  Body: ${p.bodyExcerpt.slice(0, 300)}`)
  lines.push(`  Stats: ${p.wordCount} words | ${p.imageCount} images | ${p.internalLinkCount} internal links`)
  return lines.join('\n')
}

function buildSiteStats(pages: PageSummary[]): string {
  const successful = pages.filter(p => !p.fetchError)
  if (successful.length === 0) return 'No pages successfully fetched.'

  const totalWords = successful.reduce((s, p) => s + p.wordCount, 0)
  const avgWords = Math.round(totalWords / successful.length)
  const below300 = successful.filter(p => p.wordCount < 300).length
  const below500 = successful.filter(p => p.wordCount < 500).length
  const noImages = successful.filter(p => p.imageCount === 0).length
  const noInternalLinks = successful.filter(p => p.internalLinkCount < 3).length

  return [
    `Total pages audited: ${successful.length}`,
    `Average word count: ${avgWords}`,
    `Pages below 300 words: ${below300}`,
    `Pages below 500 words: ${below500}`,
    `Pages with 0 images: ${noImages}`,
    `Pages with fewer than 3 internal links: ${noInternalLinks}`,
  ].join('\n')
}

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildFindingsPrompt(data: ContentAuditFetchResult, brainContext?: string): string {
  const categories = CONTENT_AUDIT_MODULE.categories as DynamicModuleCategoryDefinition[]

  const pagesSection = data.pages.map((p, i) => formatPageSummary(p, i)).join('\n\n')

  const competitorSection = data.competitorPages.length > 0
    ? data.competitorPages.map(formatCompetitorPage).join('\n\n')
    : 'No competitor URLs provided — base gap analysis on industry best practices for this brand\'s space.'

  const categoryInstructions = categories
    .map(c => `--- Category: "${c.slug}" (label: "${c.label}") ---\n${c.prompt}`)
    .join('\n\n')

  return `${brainContext ? `=== Prior context about this brand ===\n${brainContext}\n\n` : ''}=== Brand Context ===
Brand: ${data.brandName || 'not provided'}
Website: ${data.websiteUrl}
Target audience: ${data.targetAudience ?? 'not provided'}
Business goals: ${data.businessGoals ?? 'not provided'}
Tech stack: ${data.techStack ?? 'unknown'}
${data.isCsr ? 'NOTE: Site appears to be client-side rendered — some pages may have limited body content. Base findings on what is available.' : ''}

=== Site-Level Statistics ===
${buildSiteStats(data.pages)}

=== Your Pages (${data.pages.length} pages) ===

${pagesSection}

=== Competitor Data ===

${competitorSection}

=== Category Instructions ===
${categoryInstructions}

=== Output requirements ===
Analyse all page data above. Generate findings for ALL 7 categories.

Return ONLY a valid JSON array. No markdown fences, no text outside the array. Each element:
{
  "category": string — exactly one of: "content-gap", "foundational-inventory", "business-alignment", "quality-substance", "blog-topics", "content-calendar", "content-categories",
  "slug": string — kebab-case unique identifier,
  "label": string — specific, cite actual page titles or metrics,
  "weight": 1 | 2 | 3,
  "detail": string — one sentence with exact data,
  "narrative": string — 2–3 sentences on business impact,
  "action": string — specific next step (for content-calendar-30-day: ONLY the raw JSON array, no other text),
  "verified": boolean,
  "fixable": false
}`
}

// ── Deterministic verdict engine ──────────────────────────────────────────────

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has',
  'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
  'this', 'that', 'these', 'those', 'your', 'our', 'their', 'how', 'what', 'why',
  'when', 'where', 'who',
])

function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w))
}

function findConsolidateTarget(page: PageSummary, allPages: PageSummary[]): string | null {
  if (!page.title) return null
  const myWords = significantWords(page.title)
  if (myWords.length < 2) return null

  for (const other of allPages) {
    if (other.url === page.url || !other.title || other.fetchError) continue
    const otherWords = significantWords(other.title)
    const overlap = myWords.filter(w => otherWords.includes(w)).length
    const threshold = Math.min(myWords.length, otherWords.length) * 0.5
    if (overlap >= 2 && overlap >= threshold && other.wordCount > page.wordCount) {
      return other.url
    }
  }
  return null
}

function computeVerdicts(pages: PageSummary[]): PageVerdict[] {
  const successful = pages.filter(p => !p.fetchError)

  return successful.map(page => {
    const { url, title, wordCount, imageCount, internalLinkCount } = page

    // 1. REMOVE
    if (wordCount < 200 || (imageCount === 0 && internalLinkCount < 3 && wordCount < 300)) {
      return {
        url,
        title: title ?? null,
        wordCount,
        verdict: 'Remove' as const,
        urgency: 'High' as const,
        reason: wordCount < 200
          ? `Only ${wordCount} words — far below the minimum viable content threshold.`
          : `${wordCount} words with no images and fewer than 3 internal links — too thin to justify a standalone page.`,
        action: wordCount < 50
          ? 'Delete this page and set up a 301 redirect to the most relevant existing page.'
          : 'Either expand to 600+ words with at least one image and 3+ internal links, or delete and set up a 301 redirect.',
      }
    }

    // 2. CONSOLIDATE (title word-overlap heuristic)
    const consolidateTarget = findConsolidateTarget(page, successful)
    if (consolidateTarget) {
      return {
        url,
        title: title ?? null,
        wordCount,
        verdict: 'Consolidate' as const,
        urgency: 'High' as const,
        reason: `Title overlaps significantly with ${consolidateTarget} — covering the same topic splits authority and confuses search engines.`,
        action: `Merge this page's unique content into ${consolidateTarget}, then set up a 301 redirect from this URL to that page.`,
      }
    }

    // 3. REFRESH
    if (wordCount < 500 && (imageCount === 0 || internalLinkCount < 3)) {
      const issues: string[] = []
      if (wordCount < 500) issues.push(`expand from ${wordCount} to 600+ words`)
      if (imageCount === 0) issues.push('add at least one relevant image')
      if (internalLinkCount < 3) issues.push(`add ${3 - internalLinkCount} more internal link${3 - internalLinkCount !== 1 ? 's' : ''}`)

      return {
        url,
        title: title ?? null,
        wordCount,
        verdict: 'Refresh' as const,
        urgency: 'Medium' as const,
        reason: `${wordCount} words${imageCount === 0 ? ', no images' : ''}${internalLinkCount < 3 ? `, only ${internalLinkCount} internal link${internalLinkCount !== 1 ? 's' : ''}` : ''} — below quality thresholds.`,
        action: `Update this page: ${issues.join('; ')}.`,
      }
    }

    // 4. KEEP
    return {
      url,
      title: title ?? null,
      wordCount,
      verdict: 'Keep' as const,
      urgency: 'Low' as const,
      reason: `${wordCount} words, ${imageCount} image${imageCount !== 1 ? 's' : ''}, ${internalLinkCount} internal link${internalLinkCount !== 1 ? 's' : ''} — meets content quality thresholds.`,
      action: 'Monitor performance in Google Search Console and refresh content annually to maintain rankings.',
    }
  })
}

// ── JSON parsing helpers ──────────────────────────────────────────────────────

import { parseClaudeJsonArray } from '@/lib/modules/parse-utils'

function parseJsonArray<T>(raw: string): T[] {
  return parseClaudeJsonArray(raw) as T[]
}

function validateFinding(r: unknown): r is DynamicModuleAnalysisResult {
  if (!r || typeof r !== 'object') return false
  const obj = r as Record<string, unknown>
  const validCategories = new Set([
    'content-gap', 'foundational-inventory', 'business-alignment',
    'quality-substance', 'blog-topics', 'content-calendar', 'content-categories',
  ])
  return (
    typeof obj['category'] === 'string' && validCategories.has(obj['category']) &&
    typeof obj['slug'] === 'string' &&
    typeof obj['label'] === 'string' &&
    (obj['weight'] === 1 || obj['weight'] === 2 || obj['weight'] === 3) &&
    typeof obj['detail'] === 'string' &&
    typeof obj['narrative'] === 'string' &&
    typeof obj['action'] === 'string' &&
    typeof obj['verified'] === 'boolean'
  )
}


function extractCalendarData(findings: DynamicModuleAnalysisResult[]): CalendarEntry[] | null {
  const calendarFinding = findings.find(f => f.slug === 'content-calendar-30-day')
  if (!calendarFinding) return null

  try {
    const entries = parseJsonArray<CalendarEntry>(calendarFinding.action)
    if (!Array.isArray(entries) || entries.length === 0) return null

    // Validate entries have required fields
    const valid = entries.filter(e =>
      typeof e.date === 'string' &&
      typeof e.topic === 'string' &&
      typeof e.category === 'string',
    )
    return valid.length > 0 ? valid : null
  } catch {
    return null
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function analyzeContentAudit(
  data: ContentAuditFetchResult,
  brainContext?: string,
): Promise<ContentAuditAnalysisOutput> {
  if (data.pages.length === 0) {
    throw new Error('No pages could be fetched for content audit. Check that the website URL is accessible.')
  }

  const findingsPrompt = buildFindingsPrompt(data, brainContext)

  const findingsRaw = await callAI({
    system: CONTENT_AUDIT_MODULE.systemPrompt,
    prompt: findingsPrompt,
    maxTokens: 16000,
  })

  // Parse findings
  let findings: DynamicModuleAnalysisResult[] = []
  try {
    const parsed = parseJsonArray<unknown>(findingsRaw)
    findings = parsed
      .filter(validateFinding)
      .map(r => ({ ...r, fixable: false }))
  } catch (err) {
    throw new Error(`Content audit findings agent returned invalid JSON: ${err instanceof Error ? err.message : findingsRaw.slice(0, 300)}`)
  }

  // Compute page verdicts deterministically (no AI call needed)
  const pageVerdicts = computeVerdicts(data.pages)

  // Extract calendar data from the calendar finding's action field
  const calendarData = extractCalendarData(findings)

  // Replace the calendar action field with a human-readable summary
  // (the raw JSON in action is not user-friendly)
  findings = findings.map(f => {
    if (f.slug === 'content-calendar-30-day' && calendarData) {
      return {
        ...f,
        action: `Your 30-day editorial calendar has been generated with ${calendarData.length} scheduled posts. Download it using the button below.`,
      }
    }
    return f
  })

  return { findings, pageVerdicts, calendarData }
}
