export interface AccessibleNameViolation {
  type: 'button' | 'link'
  selector: string
  snippet?: string
}

export interface AccessibleNamesScanResult {
  score: number | null
  violations: AccessibleNameViolation[]
}

interface PsiNode {
  selector?: string
  snippet?: string
}

export async function scanAccessibleNames(url: string, apiKey?: string): Promise<AccessibleNamesScanResult | null> {
  try {
    const key = apiKey || process.env.GOOGLE_PSI_API_KEY
    const params = new URLSearchParams({ url, strategy: 'mobile' })
    params.append('category', 'accessibility')
    if (key) params.set('key', key)
    const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 45000)
    const res = await fetch(endpoint, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) {
      console.error(`[accessible-names-scan] PSI request failed: ${res.status} ${res.statusText} (key present: ${!!key})`, await res.text().catch(() => ''))
      return null
    }

    const json = await res.json() as Record<string, unknown>
    const lhr = json.lighthouseResult as Record<string, unknown> | undefined
    const cats = lhr?.categories as Record<string, { score: number | null }> | undefined
    const audits = lhr?.audits as Record<string, { details?: { items?: Array<{ node?: PsiNode }> } }> | undefined

    const collect = (auditId: string, type: 'button' | 'link'): AccessibleNameViolation[] => {
      const items = audits?.[auditId]?.details?.items ?? []
      const out: AccessibleNameViolation[] = []
      for (const item of items) {
        const selector = item.node?.selector ?? ''
        const snippet = item.node?.snippet
        if (!selector && !snippet) continue
        out.push({ type, selector, snippet })
      }
      return out
    }

    const violations = [...collect('button-name', 'button'), ...collect('link-name', 'link')]

    const scoreRaw = cats?.accessibility?.score
    return {
      score: scoreRaw === null || scoreRaw === undefined ? null : Math.round(scoreRaw * 100),
      violations,
    }
  } catch (err) {
    console.error('[accessible-names-scan] scan failed:', err)
    return null
  }
}
