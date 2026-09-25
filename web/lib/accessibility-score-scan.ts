import { fetchPsiAccessibility, clearPsiCache } from '@/lib/psi'

export interface AccessibilityScoreResult {
  score: number
  colorContrastPass: boolean | null
  fontSizePass: boolean | null
  tapTargetsPass: boolean | null
  accessibleNamesPass: boolean | null
}

export async function scanAccessibilityScore(url: string, fresh = false): Promise<AccessibilityScoreResult | { error: string }> {
  try {
    if (fresh) clearPsiCache(url)
    const psi = await fetchPsiAccessibility(url)
    if (!psi.ok) return { error: psi.error }
    const lhr = psi.lhr
    const cats = lhr?.categories as Record<string, { score: number | null }> | undefined
    const audits = lhr?.audits as Record<string, { score: number | null }> | undefined

    const auditPass = (id: string): boolean | null => {
      const a = audits?.[id]
      if (!a || a.score === null || a.score === undefined) return null
      return a.score === 1
    }

    const buttonName = auditPass('button-name')
    const linkName = auditPass('link-name')
    const accessibleNamesPass = buttonName === null && linkName === null
      ? null
      : (buttonName ?? true) && (linkName ?? true)

    return {
      score: Math.round((cats?.accessibility?.score ?? 0) * 100),
      colorContrastPass: auditPass('color-contrast'),
      fontSizePass: auditPass('font-size'),
      tapTargetsPass: auditPass('tap-targets'),
      accessibleNamesPass,
    }
  } catch {
    return { error: 'Could not read the scan results' }
  }
}
