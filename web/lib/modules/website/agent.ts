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
  brandName?: string,
): Promise<Map<string, { highlight: string; narrative: string; action: string; exportType?: 'auto' | 'needs_choice' | 'external'; choiceOptions?: string[] }>> {
  if (failedItems.length === 0) return new Map()

  const itemList = failedItems
    .map((i, idx) => `${idx + 1}. [${i.slug}] ${i.label}\n   Finding: ${i.detail}`)
    .join('\n\n')

  const raw = await callAI({
    system: WEBSITE_MODULE.systemPrompt,
    prompt: `Website: ${websiteUrl}${brandName ? `\nBrand: ${brandName}` : ''}

For each failing check, return — be specific to this site, never generic. Write highlight and narrative in plain English that any business owner can understand — no technical jargon. Technical specifics go only in action.
- highlight: 5–8 plain English words capturing the key point (no period, no jargon)
- narrative: exactly 1 plain English sentence explaining why this hurts growth, conversions, or trust; wrap the key risk in **double asterisks** e.g. "Without this, **Google cannot index your page**"
- action: exactly 1 sentence starting with a verb; wrap the specific thing to do in **double asterisks** e.g. "Add **<title>YourBrand: tagline</title>** to your homepage head"
- exportType: classify how this fix can be implemented — one of:
  "auto" = Claude Code can implement it from code alone with no input (inserting tags, fixing layout issues, adding attributes — deterministic code changes)
  "needs_choice" = the fix needs the user to decide the exact value (H1 wording, CTA copy, hero headline, alt text — content decisions only a human can make for their brand)
  "external" = requires action outside the codebase entirely (third-party account creation, DNS changes, social media registration, external service setup)
- choiceOptions: (ONLY when exportType is "needs_choice") exactly 3 specific, ready-to-use text values the user can pick. For H1 tags: 3 actual H1 strings. For CTA copy: 3 button label options. For value proposition: 3 actual headline options. Specific to this brand — never generic placeholders. Omit for auto/external.

${itemList}

Return ONLY a valid JSON array:
[{ "slug": "...", "highlight": "...", "narrative": "...", "action": "...", "exportType": "auto|needs_choice|external", "choiceOptions": ["...", "...", "..."] }, ...]
No markdown fences, no text outside the array.`,
    maxTokens: 6000,
    model: 'claude-haiku-4-5-20251001',
  })
  const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()

  try {
    const rows = JSON.parse(clean) as { slug: string; highlight: string; narrative: string; action: string; exportType?: string; choiceOptions?: string[] }[]
    return new Map(
      rows
        .filter((r) => r.slug && r.narrative)
        .map((r) => [r.slug, {
          highlight: r.highlight ?? '',
          narrative: r.narrative,
          action: r.action ?? '',
          exportType: (r.exportType === 'auto' || r.exportType === 'needs_choice' || r.exportType === 'external') ? r.exportType : undefined,
          choiceOptions: r.choiceOptions,
        }]),
    )
  } catch {
    return new Map()
  }
}

export async function analyzeWebsite(
  audit: AuditResult,
  websiteUrl: string,
  brandName?: string,
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
    .map((r) => {
      const defItem = allItems.find((i) => i.slug === r.slug)
      return {
        slug: r.slug,
        label: defItem?.label ?? r.slug,
        detail: r.detail,
      }
    })

  const enrichmentMap = await generateEnrichment(websiteUrl, failedItems, brandName)

  // Merge enrichment back in
  return baseResults.map(({ isFail: _, ...r }) => {
    const enriched = enrichmentMap.get(r.slug)
    return {
      ...r,
      highlight: enriched?.highlight ?? '',
      narrative: enriched?.narrative ?? '',
      // Claude's action overrides rule-engine action for failed items (more specific)
      action: (enriched?.action || r.action) ?? '',
      exportType: enriched?.exportType,
      choiceOptions: enriched?.choiceOptions,
    }
  })
}
