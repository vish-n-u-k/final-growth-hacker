// Hunter.io email lookups for the Lead Agent (GrowJin's key: HUNTER_API_KEY). One lookup per
// call is added to the run's meter. Returns null when nothing usable is found.

import type { UsageMeter } from './store'

const BASE = 'https://api.hunter.io/v2'

export function hunterConfigured(): boolean {
  return !!process.env.HUNTER_API_KEY
}

export interface FoundEmail { email: string; verified: boolean; name?: string; position?: string }

function splitName(name: string): { first: string; last: string } | null {
  const parts = name.replace(/[^\p{L}\s'-]/gu, ' ').trim().split(/\s+/)
  return parts.length >= 2 && parts[1].length > 1 ? { first: parts[0], last: parts[parts.length - 1] } : null
}

/** Best email at a company domain: the named person if we know them, else its best personal (or generic) address. */
export async function findEmail(domain: string, personName: string | undefined, meter?: UsageMeter): Promise<FoundEmail | null> {
  if (!hunterConfigured() || !domain) return null
  const key = process.env.HUNTER_API_KEY!
  const host = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]

  const person = personName ? splitName(personName) : null
  if (person) {
    if (meter) meter.hunter += 1
    const url = `${BASE}/email-finder?${new URLSearchParams({ domain: host, first_name: person.first, last_name: person.last, api_key: key })}`
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch(() => null)
    if (res?.ok) {
      const j = await res.json() as { data?: { email?: string | null; score?: number; position?: string | null; verification?: { status?: string } } }
      const d = j.data
      if (d?.email) return { email: d.email, verified: d.verification?.status === 'valid' || (d.score ?? 0) >= 90, name: personName, position: d.position ?? undefined }
    }
  }

  if (meter) meter.hunter += 1
  const url = `${BASE}/domain-search?${new URLSearchParams({ domain: host, limit: '10', api_key: key })}`
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch(() => null)
  if (!res?.ok) return null
  type E = { value?: string; type?: string; confidence?: number; first_name?: string | null; last_name?: string | null; position?: string | null; verification?: { status?: string } | null }
  const j = await res.json() as { data?: { emails?: E[] } }
  const emails = (j.data?.emails ?? []).filter(e => e.value)
  // Owners, founders and marketing people first; then the most confident personal address; then generic
  const rank = (e: E) =>
    (e.type === 'personal' ? 100 : 0)
    + (/(founder|owner|ceo|director|marketing|head)/i.test(e.position ?? '') ? 50 : 0)
    + (e.confidence ?? 0) / 10
  const best = emails.sort((a, b) => rank(b) - rank(a))[0]
  if (!best) return null
  const name = [best.first_name, best.last_name].filter(Boolean).join(' ') || undefined
  return { email: best.value!, verified: best.verification?.status === 'valid' || (best.confidence ?? 0) >= 90, name, position: best.position ?? undefined }
}
