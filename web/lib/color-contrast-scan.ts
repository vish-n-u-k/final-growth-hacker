// Scans a live URL for real WCAG color-contrast violations via Google PageSpeed Insights
// (Lighthouse's axe-core-powered color-contrast audit). Independent of lib/audit/audit.ts's
// own PSI call — this one is user-initiated (from the Contrast Checker widget) and only
// requests the accessibility category, so it stays fast and doesn't duplicate that call's
// accessibility+seo request.

import { fetchPsiAccessibility, clearPsiCache } from '@/lib/psi'

export interface ColorContrastViolation {
  ratio: number
  fg: string
  bg: string
  fontSize?: string
  selector?: string
  snippet?: string
}

export interface ColorContrastScanResult {
  score: number | null
  violations: ColorContrastViolation[]
}

// Matches axe-core's standard color-contrast explanation text, e.g.:
// "Element has insufficient color contrast of 2.85 (foreground color: #9a9a9a,
//  background color: #ffffff, font size: 10.5pt (14px), font weight: normal).
//  Expected contrast ratio of 4.5:1"
const EXPLANATION_RE = /insufficient color contrast of ([\d.]+) \(foreground color: (#[0-9a-fA-F]{3,8}), background color: (#[0-9a-fA-F]{3,8})(?:, font size: ([^,)]+))?/i

interface PsiNode {
  explanation?: string
  selector?: string
  snippet?: string
}

export async function scanColorContrast(url: string, fresh = false): Promise<ColorContrastScanResult | { error: string }> {
  try {
    if (fresh) clearPsiCache(url)
    const psi = await fetchPsiAccessibility(url)
    if (!psi.ok) return { error: psi.error }
    const lhr = psi.lhr
    const cats = lhr?.categories as Record<string, { score: number | null }> | undefined
    const audits = lhr?.audits as Record<string, { details?: { items?: Array<{ node?: PsiNode }> } }> | undefined

    const items = audits?.['color-contrast']?.details?.items ?? []
    const violations: ColorContrastViolation[] = []
    for (const item of items) {
      const explanation = item.node?.explanation ?? ''
      const m = EXPLANATION_RE.exec(explanation)
      if (!m) continue
      violations.push({
        ratio: parseFloat(m[1]),
        fg: m[2].toLowerCase(),
        bg: m[3].toLowerCase(),
        fontSize: m[4]?.trim(),
        selector: item.node?.selector,
        snippet: item.node?.snippet,
      })
    }

    const scoreRaw = cats?.accessibility?.score
    return {
      score: scoreRaw === null || scoreRaw === undefined ? null : Math.round(scoreRaw * 100),
      violations,
    }
  } catch {
    return { error: 'Could not read the scan results' }
  }
}
