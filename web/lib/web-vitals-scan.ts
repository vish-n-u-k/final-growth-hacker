export interface WebVitalsScanResult {
  performanceScore: number | null
  lcpMs: number | null
  tbtMs: number | null
  clsScore: number | null
  renderBlockingCount: number | null
}

export async function scanWebVitals(url: string): Promise<WebVitalsScanResult | null> {
  try {
    const key = process.env.GOOGLE_PSI_API_KEY
    const params = new URLSearchParams({ url, strategy: 'mobile' })
    params.append('category', 'performance')
    if (key) params.set('key', key)
    const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 45000)
    const res = await fetch(endpoint, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) {
      console.error(`[web-vitals-scan] PSI request failed: ${res.status} ${res.statusText} (key present: ${!!key})`, await res.text().catch(() => ''))
      return null
    }

    const json = await res.json() as Record<string, unknown>
    const lhr = json.lighthouseResult as Record<string, unknown> | undefined
    const cats = lhr?.categories as Record<string, { score: number | null }> | undefined
    const audits = lhr?.audits as Record<string, {
      numericValue?: number
      details?: { items?: unknown[] }
    }> | undefined

    const perfRaw = cats?.performance?.score
    const renderBlockingItems = audits?.['render-blocking-resources']?.details?.items

    return {
      performanceScore: perfRaw === null || perfRaw === undefined ? null : Math.round(perfRaw * 100),
      lcpMs: audits?.['largest-contentful-paint']?.numericValue ?? null,
      tbtMs: audits?.['total-blocking-time']?.numericValue ?? null,
      clsScore: audits?.['cumulative-layout-shift']?.numericValue ?? null,
      renderBlockingCount: Array.isArray(renderBlockingItems) ? renderBlockingItems.length : null,
    }
  } catch (err) {
    console.error('[web-vitals-scan] scan failed:', err)
    return null
  }
}
