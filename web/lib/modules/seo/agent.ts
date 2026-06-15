import { callAI } from '@/lib/ai/client'
import type { SeoAuditResult } from '@/lib/audit/seo-audit'
import type { ModuleAnalysisResult } from '../types'
import { SEO_MODULE } from './definition'
import { getAllItems } from '../types'

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
  })

  const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()
  try {
    const rows = JSON.parse(clean) as { slug: string; narrative: string }[]
    return new Map(rows.filter((r) => r.slug && r.narrative).map((r) => [r.slug, r.narrative]))
  } catch {
    return new Map()
  }
}

export async function analyzeSeo(
  audit: SeoAuditResult,
  websiteUrl: string,
  brainContext?: string,
): Promise<ModuleAnalysisResult[]> {
  const findingMap = buildFindingMap(audit)
  const allItems = getAllItems(SEO_MODULE)

  const baseResults: (ModuleAnalysisResult & { isFail: boolean })[] = allItems.map((item) => {
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

  return baseResults.map(({ isFail: _, ...r }) => ({
    ...r,
    narrative: narrativeMap.get(r.slug) ?? '',
  }))
}
