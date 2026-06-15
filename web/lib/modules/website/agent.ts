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

// Generate business-impact narratives for all failed items in one Claude call
async function generateNarratives(
  websiteUrl: string,
  failedItems: { slug: string; label: string; detail: string; action: string }[],
): Promise<Map<string, string>> {
  if (failedItems.length === 0) return new Map()

  const itemList = failedItems
    .map((i, idx) => `${idx + 1}. [${i.slug}] ${i.label}\n   Finding: ${i.detail}\n   Fix: ${i.action || 'No specific fix available'}`)
    .join('\n\n')

  const raw = await callAI({
    system: WEBSITE_MODULE.systemPrompt,
    prompt: `Website: ${websiteUrl}

For each failing check below, write 1–2 sentences of business impact — why this specific issue hurts growth, conversions, or trust for this site. Be specific, not generic.

${itemList}

Return ONLY a valid JSON array:
[{ "slug": "...", "narrative": "..." }, ...]
No markdown fences, no text outside the array.`,
    maxTokens: 4000,
  })
  const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()

  try {
    const rows = JSON.parse(clean) as { slug: string; narrative: string }[]
    return new Map(rows.filter((r) => r.slug && r.narrative).map((r) => [r.slug, r.narrative]))
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

  // Generate narratives for all failing items in one batch call
  const failedItems = baseResults
    .filter((r) => r.isFail)
    .map((r) => ({ slug: r.slug, label: allItems.find((i) => i.slug === r.slug)?.label ?? r.slug, detail: r.detail, action: r.action }))

  const narrativeMap = await generateNarratives(websiteUrl, failedItems)

  // Merge narratives back in
  return baseResults.map(({ isFail: _, ...r }) => ({
    ...r,
    narrative: narrativeMap.get(r.slug) ?? '',
  }))
}
