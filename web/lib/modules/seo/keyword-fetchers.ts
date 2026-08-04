import { createSign, createPrivateKey } from 'crypto'

// ── Helpers ───────────────────────────────────────────────────────────────────

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url')
}

// Extracts the primary keyword from page title/H1 for use as an Autocomplete/Trends seed
export function extractSeedKeyword(title: string, h1: string, brandName?: string): string {
  const source = h1 || title
  if (!source) return ''
  let seed = source
  // Remove brand name
  if (brandName) {
    seed = seed.replace(new RegExp(brandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '').trim()
  }
  // Take text before any separator (pipe, dash, em-dash)
  seed = seed.split(/[|–—\-]/)[0].trim()
  // Limit to 5 words, lowercase
  return seed.split(/\s+/).slice(0, 5).join(' ').trim().toLowerCase()
}

// ── Google Autocomplete ───────────────────────────────────────────────────────
// Free, no auth, no key. Returns up to 30 suggestions across 3 seed variants.

export async function fetchAutocompleteSuggestions(seed: string): Promise<string[]> {
  if (!seed) return []
  try {
    const seeds = [seed, `${seed} for`, `best ${seed}`]
    const results = await Promise.all(
      seeds.map(async (s) => {
        const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(s)}&hl=en`
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrowJinBot/1.0)' },
          signal: AbortSignal.timeout(5000),
        })
        if (!res.ok) return []
        const data = await res.json() as [string, string[]]
        return data[1] ?? []
      }),
    )
    return [...new Set(results.flat())].slice(0, 30)
  } catch {
    return []
  }
}

// ── Google Autocomplete — categorized (Section 4: Long-tail Opportunities) ───
// Runs targeted seed variants for each long-tail category in parallel.

export interface AutocompleteCategories {
  usecase: string[]     // "seed for ..." — use-case variants
  comparison: string[]  // "seed vs", "seed alternative" — comparison/alternative
  questions: string[]   // "how to seed", "what is seed" — question-based
  modifiers: string[]   // "best seed", "free seed", "top seed" — modifier-based
}

async function runSingleSeed(seed: string): Promise<string[]> {
  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(seed)}&hl=en`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrowJinBot/1.0)' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return []
    const data = await res.json() as [string, string[]]
    return data[1] ?? []
  } catch {
    return []
  }
}

export async function fetchCategorizedAutocomplete(seed: string): Promise<AutocompleteCategories> {
  if (!seed) return { usecase: [], comparison: [], questions: [], modifiers: [] }

  const [usecaseRaw, comparisonRaw1, comparisonRaw2, questionRaw1, questionRaw2, modifierRaw1, modifierRaw2] =
    await Promise.all([
      runSingleSeed(`${seed} for`),
      runSingleSeed(`${seed} vs`),
      runSingleSeed(`${seed} alternative`),
      runSingleSeed(`how to ${seed}`),
      runSingleSeed(`what is ${seed}`),
      runSingleSeed(`best ${seed}`),
      runSingleSeed(`free ${seed}`),
    ])

  return {
    usecase: [...new Set(usecaseRaw)].slice(0, 10),
    comparison: [...new Set([...comparisonRaw1, ...comparisonRaw2])].slice(0, 10),
    questions: [...new Set([...questionRaw1, ...questionRaw2])].slice(0, 10),
    modifiers: [...new Set(modifierRaw1)].slice(0, 10),
  }
}

// ── Google Trends ─────────────────────────────────────────────────────────────
// Free, no auth. Returns average interest score (0–100) over last 12 months.
// Uses the unofficial explore + widgetdata endpoint pair.

export async function fetchGoogleTrends(keyword: string): Promise<number | null> {
  if (!keyword) return null
  try {
    const req = JSON.stringify({
      comparisonItem: [{ keyword, geo: '', time: 'today 12-m' }],
      category: 0,
      property: '',
    })
    const exploreUrl = `https://trends.google.com/trends/api/explore?hl=en-US&tz=0&req=${encodeURIComponent(req)}`
    const exploreRes = await fetch(exploreUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrowJinBot/1.0)' },
      signal: AbortSignal.timeout(8000),
    })
    if (!exploreRes.ok) return null
    const exploreText = await exploreRes.text()
    // Google prefixes responses with )]}'  to prevent JSON hijacking
    const exploreJson = JSON.parse(exploreText.replace(/^\)\]\}'\n?/, '')) as {
      widgets?: { id: string; token: string; request: unknown }[]
    }
    const widget = exploreJson.widgets?.find((w) => w.id === 'TIMESERIES')
    if (!widget) return null

    const widgetUrl = `https://trends.google.com/trends/api/widgetdata?hl=en-US&tz=0&req=${encodeURIComponent(JSON.stringify(widget.request))}&token=${encodeURIComponent(widget.token)}`
    const widgetRes = await fetch(widgetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrowJinBot/1.0)' },
      signal: AbortSignal.timeout(8000),
    })
    if (!widgetRes.ok) return null
    const widgetText = await widgetRes.text()
    const widgetJson = JSON.parse(widgetText.replace(/^\)\]\}'\n?/, '')) as {
      default?: { timelineData?: { value: number[] }[] }
    }
    const timelineData = widgetJson.default?.timelineData ?? []
    if (timelineData.length === 0) return null

    const values = timelineData.map((d) => d.value[0] ?? 0)
    return Math.round(values.reduce((a, b) => a + b, 0) / values.length)
  } catch {
    return null
  }
}

// ── SerpAPI — People Also Ask ─────────────────────────────────────────────────
// Requires user's SerpAPI key (free tier: 100 searches/month).

export async function fetchSerpApiPAA(query: string, apiKey: string): Promise<string[]> {
  if (!query || !apiKey) return []
  try {
    const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(apiKey)}&engine=google&num=10`
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) })
    if (!res.ok) return []
    const data = await res.json() as { related_questions?: { question: string }[] }
    return (data.related_questions ?? []).map((q) => q.question).slice(0, 10)
  } catch {
    return []
  }
}

// ── Google Search Console — Service Account auth ──────────────────────────────

function parseGscPrivateKey(raw: string) {
  // Strip surrounding quotes if the user pasted the raw JSON string value (e.g. "-----BEGIN...")
  const stripped = raw.replace(/^["']|["']$/g, '')
  // Normalize line endings: replace literal \n sequences with real newlines
  const normalized = stripped.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()

  const candidates = [normalized, raw.trim()]
  for (const candidate of candidates) {
    try {
      return createPrivateKey(candidate)
    } catch {
      // try next
    }
  }
  throw new Error(
    'Could not parse the private key — paste the complete key including the -----BEGIN PRIVATE KEY----- and -----END PRIVATE KEY----- lines.',
  )
}

async function getGscAccessToken(clientEmail: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64url(JSON.stringify({
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))
  const signingInput = `${header}.${payload}`
  const sign = createSign('RSA-SHA256')
  sign.update(signingInput)
  const keyObj = parseGscPrivateKey(privateKey)
  const signature = sign.sign(keyObj, 'base64url')
  const jwt = `${signingInput}.${signature}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({})) as { error?: string; error_description?: string }
    throw new Error(`Google OAuth failed (${res.status}): ${errBody.error ?? ''} — ${errBody.error_description ?? res.statusText}`)
  }

  const data = await res.json() as { access_token?: string }
  if (!data.access_token) throw new Error('Google OAuth returned no access_token')
  return data.access_token
}

export interface GscRow {
  query: string
  impressions: number
  clicks: number
  position: number
}

// Tries URL-prefix property first, then domain property — GSC has two formats
// Throws on auth failure or hard errors so callers can surface the reason to users.
export async function fetchGscTopQueries(
  clientEmail: string,
  privateKey: string,
  siteUrl: string,
  rowLimit = 25,
): Promise<GscRow[]> {
  const accessToken = await getGscAccessToken(clientEmail, privateKey)
  if (!accessToken) {
    throw new Error('GSC auth failed — check your service account email and private key.')
  }

  const url = siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`
  const hostname = new URL(url).hostname
  const endDate = new Date().toISOString().split('T')[0]
  const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const body = JSON.stringify({
    startDate,
    endDate,
    dimensions: ['query'],
    rowLimit,
    orderBy: [{ fieldName: 'impressions', sortOrder: 'DESCENDING' }],
  })
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }

  const siteIds = [encodeURIComponent(url), `sc-domain%3A${hostname}`]
  const lastErrors: string[] = []

  for (const siteId of siteIds) {
    const res = await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${siteId}/searchAnalytics/query`,
      { method: 'POST', headers, body, signal: AbortSignal.timeout(15000) },
    )
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText)
      lastErrors.push(`${decodeURIComponent(siteId)}: HTTP ${res.status} — ${errText.slice(0, 200)}`)
      continue
    }
    const data = await res.json() as {
      rows?: { keys: string[]; impressions: number; clicks: number; position: number }[]
    }
    if (!data.rows?.length) {
      lastErrors.push(`${decodeURIComponent(siteId)}: no rows returned (site may have no Search Console data yet)`)
      continue
    }
    return data.rows.map((r) => ({
      query: r.keys[0],
      impressions: r.impressions,
      clicks: r.clicks,
      position: Math.round(r.position * 10) / 10,
    }))
  }

  throw new Error(`GSC returned no data. Tried:\n${lastErrors.join('\n')}`)
}
