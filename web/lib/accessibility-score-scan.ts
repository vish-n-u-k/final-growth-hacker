export interface AccessibilityScoreResult {
  score: number
  colorContrastPass: boolean | null
  fontSizePass: boolean | null
  tapTargetsPass: boolean | null
  accessibleNamesPass: boolean | null
}

export async function scanAccessibilityScore(url: string): Promise<AccessibilityScoreResult | null> {
  try {
    const key = process.env.GOOGLE_PSI_API_KEY
    const params = new URLSearchParams({ url, strategy: 'mobile' })
    params.append('category', 'accessibility')
    if (key) params.set('key', key)
    const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 45000)
    const res = await fetch(endpoint, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const json = await res.json() as Record<string, unknown>
    const lhr = json.lighthouseResult as Record<string, unknown> | undefined
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
    return null
  }
}
