export interface TapTargetViolation {
  selector: string
  size?: string
  snippet?: string
  overlappingSelector?: string
}

export interface TapTargetsScanResult {
  score: number | null
  violations: TapTargetViolation[]
}

interface PsiNode {
  selector?: string
  snippet?: string
}

export async function scanTapTargets(url: string): Promise<TapTargetsScanResult | null> {
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
    if (!res.ok) {
      console.error(`[tap-targets-scan] PSI request failed: ${res.status} ${res.statusText} (key present: ${!!key})`, await res.text().catch(() => ''))
      return null
    }

    const json = await res.json() as Record<string, unknown>
    const lhr = json.lighthouseResult as Record<string, unknown> | undefined
    const cats = lhr?.categories as Record<string, { score: number | null }> | undefined
    const audits = lhr?.audits as Record<string, {
      details?: { items?: Array<{ tapTarget?: PsiNode; size?: string; overlappingTarget?: PsiNode }> }
    }> | undefined

    const items = audits?.['tap-targets']?.details?.items ?? []
    const violations: TapTargetViolation[] = []
    for (const item of items) {
      const selector = item.tapTarget?.selector ?? ''
      const snippet = item.tapTarget?.snippet
      if (!selector && !snippet) continue
      violations.push({
        selector,
        snippet,
        size: item.size,
        overlappingSelector: item.overlappingTarget?.selector,
      })
    }

    const scoreRaw = cats?.accessibility?.score
    return {
      score: scoreRaw === null || scoreRaw === undefined ? null : Math.round(scoreRaw * 100),
      violations,
    }
  } catch (err) {
    console.error('[tap-targets-scan] scan failed:', err)
    return null
  }
}
