import { callAI } from '@/lib/ai/client'
import type { AuditResult, Finding } from '@/lib/audit/audit'
import type { ModuleAnalysisResult } from '../types'
import { WEBSITE_MODULE } from './definition'
import { getAllItems } from '../types'

// Build a flat slug → Finding map from all 8 sections
function buildFindingMap(audit: AuditResult): Map<string, Finding> {
  const map = new Map<string, Finding>()
  for (const section of audit.sections) {
    for (const finding of section.findings) {
      map.set(finding.key, finding)
    }
  }
  return map
}

// Generate highlight + narrative + action for all failed items in one Claude call
async function generateEnrichment(
  websiteUrl: string,
  failedItems: { slug: string; label: string; detail: string }[],
): Promise<Map<string, { highlight: string; narrative: string; action: string }>> {
  if (failedItems.length === 0) return new Map()

  const itemList = failedItems
    .map((i, idx) => `${idx + 1}. [${i.slug}] ${i.label}\n   Finding: ${i.detail}`)
    .join('\n\n')

  const raw = await callAI({
    system: WEBSITE_MODULE.systemPrompt,
    prompt: `Website: ${websiteUrl}

For each failing check, return three things — be specific to this site, never generic. Write highlight and narrative in plain English that any business owner can understand — no technical jargon. Technical specifics go only in action.
- highlight: 5–8 plain English words capturing the key point (no period, no jargon)
- narrative: exactly 1 plain English sentence explaining why this hurts growth, conversions, or trust; wrap the key risk in **double asterisks** e.g. "Without this, **Google cannot index your page**"
- action: exactly 1 sentence starting with a verb; wrap the specific thing to do in **double asterisks** e.g. "Add **<title>YourBrand: tagline</title>** to your homepage head"

${itemList}

Return ONLY a valid JSON array:
[{ "slug": "...", "highlight": "...", "narrative": "...", "action": "..." }, ...]
No markdown fences, no text outside the array.`,
    maxTokens: 5000,
    model: 'claude-haiku-4-5-20251001',
  })
  const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()

  try {
    const rows = JSON.parse(clean) as { slug: string; highlight: string; narrative: string; action: string }[]
    return new Map(
      rows
        .filter((r) => r.slug && r.narrative)
        .map((r) => [r.slug, { highlight: r.highlight ?? '', narrative: r.narrative, action: r.action ?? '' }]),
    )
  } catch {
    return new Map()
  }
}

export async function analyzeWebsite(
  audit: AuditResult,
  websiteUrl: string,
): Promise<ModuleAnalysisResult[]> {
  const findingMap = buildFindingMap(audit)
  const allItems = getAllItems(WEBSITE_MODULE)

  // Map every static item to its rule-engine finding
  const baseResults: (ModuleAnalysisResult & { isFail: boolean })[] = allItems.map((item) => {
    const finding = findingMap.get(item.slug)

    if (!finding) {
      // Item wasn't returned by the engine (e.g. no forms on page → form checks return info)
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

  // Generate highlight + narrative + action for all failing items in one batch call
  const failedItems = baseResults
    .filter((r) => r.isFail)
    .map((r) => ({ slug: r.slug, label: allItems.find((i) => i.slug === r.slug)?.label ?? r.slug, detail: r.detail }))

  const enrichmentMap = await generateEnrichment(websiteUrl, failedItems)

  // Merge enrichment back in
  return baseResults.map(({ isFail: _, ...r }) => {
    const enriched = enrichmentMap.get(r.slug)
    return {
      ...r,
      highlight: enriched?.highlight ?? '',
      narrative: enriched?.narrative ?? '',
      // Claude's action overrides rule-engine action for failed items (more specific)
      action: (enriched?.action || r.action) ?? '',
    }
  })
}
