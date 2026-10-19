// Shared Google PageSpeed Insights (Lighthouse) accessibility fetch.
// A mobile PSI run routinely takes 20–40s+, so callers need a generous timeout.
// Results are cached per URL for a few minutes (and in-flight calls are shared) so the
// audit + the three dashboard widgets don't each trigger their own Lighthouse run.

// Real visitors' Core Web Vitals from Chrome (CrUX), 75th percentile. 'page' = this URL's own
// visitors; 'site' = the whole site's, when the page alone doesn't have enough traffic.
export interface PsiFieldData {
  scope: 'page' | 'site'
  lcpMs?: number
  inpMs?: number
  cls?: number
}

export type PsiResult =
  | { ok: true; lhr: Record<string, unknown>; field: PsiFieldData | null }
  | { ok: false; error: string }

type CruxMetrics = Record<string, { percentile?: number } | undefined>

function readField(json: Record<string, unknown>): PsiFieldData | null {
  const pick = (le: unknown): Omit<PsiFieldData, 'scope'> | null => {
    const m = (le as { metrics?: CruxMetrics } | undefined)?.metrics
    if (!m) return null
    const lcpMs = m.LARGEST_CONTENTFUL_PAINT_MS?.percentile
    const inpMs = m.INTERACTION_TO_NEXT_PAINT?.percentile
    const clsX100 = m.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile
    if (lcpMs == null && inpMs == null && clsX100 == null) return null
    return { lcpMs, inpMs, cls: clsX100 == null ? undefined : clsX100 / 100 }
  }
  const le = json.loadingExperience as { origin_fallback?: boolean } | undefined
  const page = le && !le.origin_fallback ? pick(le) : null
  if (page) return { scope: 'page', ...page }
  const site = pick(json.originLoadingExperience) ?? (le?.origin_fallback ? pick(le) : null)
  return site ? { scope: 'site', ...site } : null
}

const CACHE_TTL_MS = 10 * 60 * 1000
const cache = new Map<string, { at: number; result: PsiResult }>()
const inFlight = new Map<string, Promise<PsiResult>>()

async function runPsi(url: string, timeoutMs: number): Promise<PsiResult> {
  const key = process.env.GOOGLE_PSI_API_KEY
  const params = new URLSearchParams({ url, strategy: 'mobile' })
  params.append('category', 'accessibility')
  params.append('category', 'seo') // crawlable-anchors etc., for the SEO Health Audit
  params.append('category', 'performance') // lab Core Web Vitals, for the SEO Health Audit
  if (key) params.set('key', key)
  const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`

  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { error?: { message?: string } } | null
      const msg = body?.error?.message ?? ''
      if (res.status === 429) return { ok: false, error: 'Google PageSpeed rate limit reached — try again in a minute' }
      if (/FAILED_DOCUMENT_REQUEST|ERRORED_DOCUMENT_REQUEST|NO_FCP|DNS_FAILURE/i.test(msg)) {
        return { ok: false, error: 'Google could not load your page — it may block automated scanners' }
      }
      return { ok: false, error: `Google PageSpeed returned ${res.status}` }
    }
    const json = await res.json() as Record<string, unknown>
    const lhr = json.lighthouseResult as Record<string, unknown> | undefined
    if (!lhr) return { ok: false, error: 'Google PageSpeed returned no results' }
    const runtimeError = lhr.runtimeError as { code?: string } | undefined
    if (runtimeError?.code && runtimeError.code !== 'NO_ERROR') {
      return { ok: false, error: 'Google could not load your page — it may block automated scanners' }
    }
    return { ok: true, lhr, field: readField(json) }
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    return { ok: false, error: timedOut ? 'Google PageSpeed took too long — try again' : 'Could not reach Google PageSpeed' }
  }
}

export async function fetchPsiAccessibility(url: string, timeoutMs = 50_000): Promise<PsiResult> {
  const cached = cache.get(url)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result

  const pending = inFlight.get(url)
  if (pending) return pending

  const p = runPsi(url, timeoutMs).then((result) => {
    // Only cache successes — failures should be retryable immediately
    if (result.ok) cache.set(url, { at: Date.now(), result })
    inFlight.delete(url)
    return result
  })
  inFlight.set(url, p)
  return p
}

// Bypass the cache — used by the "Re-check" buttons after the user changes their site
export function clearPsiCache(url: string) {
  cache.delete(url)
}
