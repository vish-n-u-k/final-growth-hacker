import { callAI } from '@/lib/ai/client'
import { FOUNDATION_MODULE } from './definition'
import { getAllItems, type ModuleAnalysisResult } from '../types'
import type { FoundationFetchResult } from './fetcher'
import { runFoundationRuleEngine } from './rule-engine'

export async function analyzeFoundation(
  data: FoundationFetchResult,
  gscMeta: Record<string, string> = {},
): Promise<{ brandColor: string; results: ModuleAnalysisResult[] }> {
  // Run rule engine — decides pass/fail for 13 of 15 items
  const { results: ruleResults, aiSlugs } = runFoundationRuleEngine(data, gscMeta)

  if (!data.extracted) {
    return { brandColor: '', results: ruleResults }
  }

  const e = data.extracted

  // Build a map of the 2 AI items from the module definition
  const allDefItems = getAllItems(FOUNDATION_MODULE)
  const aiItems = allDefItems
    .filter(item => aiSlugs.includes(item.slug))
    .map(item => ({ slug: item.slug, prompt: item.prompt }))

  // Single small Claude call: judge the 2 content items + extract brand color
  const raw = await callAI({
    system: FOUNDATION_MODULE.systemPrompt,
    prompt: `Audit this website's content foundations.

URL: ${data.url}
Page title: ${e.title || '(none)'}
H1: ${e.h1 || '(none)'}
H2s: ${e.h2s.join(' | ') || '(none)'}
Body text (first 800 chars): ${e.bodyTextSnippet}
CTA buttons: ${e.ctaTexts.join(', ') || '(none)'}

Evaluate these ${aiItems.length} checks. You MUST return exactly one result for every slug listed — never skip a slug. If data is limited, make your best inference and set verified: false.
${JSON.stringify(aiItems, null, 2)}

Also determine "brandColor": the primary brand/accent color as a 6-digit hex (e.g. "#3b82f6"). Look at CSS variables (--primary, --brand, --color-primary, --accent etc.) and button/CTA backgrounds in the style content below. Use "" if unsure.

Style content: ${e.styleContent.slice(0, 2000)}

Return ONLY a JSON object:
{
  "brandColor": "#xxxxxx",
  "results": [
    {
      "slug": "...",
      "detail": "ONE sentence max 120 chars — what was found; wrap key fact in **double asterisks**",
      "highlight": "5–8 plain English words, no period",
      "narrative": "ONE sentence max 150 chars — why this matters; wrap key risk in **double asterisks**",
      "action": "ONE concrete next step starting with a verb",
      "verified": true or false
    }
  ]
}
No markdown, no text outside the JSON.`,
    maxTokens: 1200,
    model: 'claude-haiku-4-5-20251001',
  })

  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  let brandColor = ''
  let aiResults: ModuleAnalysisResult[] = []

  if (start !== -1 && end !== -1) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1)) as {
        brandColor?: string
        results?: ModuleAnalysisResult[]
      }
      if (/^#[0-9a-fA-F]{3,8}$/.test(parsed.brandColor?.trim() ?? '')) {
        brandColor = parsed.brandColor!.trim()
      }
      aiResults = (parsed.results ?? []).filter(
        (r) =>
          typeof r.slug === 'string' &&
          typeof r.detail === 'string' &&
          typeof r.narrative === 'string' &&
          typeof r.action === 'string' &&
          typeof r.verified === 'boolean',
      )
    } catch {
      // Non-fatal — AI items will fall back to unverified
    }
  }

  // Merge: rule engine results + AI results for the 2 judgment items
  const aiResultMap = new Map(aiResults.map(r => [r.slug, r]))
  const allResults: ModuleAnalysisResult[] = [
    ...ruleResults,
    ...aiSlugs.map(slug =>
      aiResultMap.get(slug) ?? {
        slug,
        verified: false,
        detail: 'Could not evaluate — please review manually.',
        highlight: 'Manual check needed',
        narrative: 'Review this item manually to confirm it is in place.',
        action: '',
      }
    ),
  ]

  return { brandColor, results: allResults }
}
