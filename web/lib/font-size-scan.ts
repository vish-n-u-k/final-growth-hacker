export interface FontSizeViolation {
  selector: string
  fontSize: string
  percentageOfPageText?: number
  snippet?: string
}

export interface FontSizeScanResult {
  score: number | null
  violations: FontSizeViolation[]
}

export async function scanFontSize(url: string): Promise<FontSizeScanResult | null> {
  try {
    const key = process.env.GOOGLE_PSI_API_KEY
    const params = new URLSearchParams({ url, strategy: 'mobile' })
    params.append('category', 'accessibility')
    if (key) params.set('key', key)
    const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 25000)
    const res = await fetch(endpoint, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const json = await res.json() as Record<string, unknown>
    const lhr = json.lighthouseResult as Record<string, unknown> | undefined
    const cats = lhr?.categories as Record<string, { score: number | null }> | undefined
    const audits = lhr?.audits as Record<string, { details?: { items?: Record<string, unknown>[] } }> | undefined

    const items = audits?.['font-size']?.details?.items ?? []

    const violations: FontSizeViolation[] = items
      .map((item): FontSizeViolation | null => {
        const fontSizeRaw = item.fontSize
        const fontSize = typeof fontSizeRaw === 'string'
          ? fontSizeRaw
          : typeof fontSizeRaw === 'number' ? `${fontSizeRaw}px` : ''
        if (!fontSize) return null

        const selector = typeof item.selector === 'string' ? item.selector : ''
        const pctRaw = item.percentageOfPageText ?? item.visualImpactPercentage
        const percentageOfPageText = typeof pctRaw === 'number' ? pctRaw : undefined

        const source = item.source as Record<string, unknown> | undefined
        const snippet = source && typeof source.snippet === 'string' ? source.snippet : undefined

        return { selector, fontSize, percentageOfPageText, snippet }
      })
      .filter((v): v is FontSizeViolation => v !== null)

    return {
      score: cats?.accessibility?.score !== undefined && cats.accessibility.score !== null
        ? Math.round(cats.accessibility.score * 100)
        : null,
      violations,
    }
  } catch {
    return null
  }
}
