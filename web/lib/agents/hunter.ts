// Hunter.io email lookups (GrowJin's key: HUNTER_API_KEY). Hunter charges 1 credit per email it
// returns and nothing for a miss, so every request asks for one email only: a Domain Search for 10
// would cost up to 10 credits for the one we keep. The meter counts credits (emails returned).
// When the credits are used up (HTTP 429) the meter is flagged and Hunter isn't asked again this run.

import type { UsageMeter } from './store'
import { agentsDemo, demoFindEmail } from './demo'

const BASE = 'https://api.hunter.io/v2'

export function hunterConfigured(): boolean {
  return agentsDemo() || !!process.env.HUNTER_API_KEY
}

export interface FoundEmail { email: string; verified: boolean; name?: string; position?: string }

function splitName(name: string): { first: string; last: string } | null {
  const parts = name.replace(/[^\p{L}\s'-]/gu, ' ').trim().split(/\s+/)
  return parts.length >= 2 && parts[1].length > 1 ? { first: parts[0], last: parts[parts.length - 1] } : null
}

type E = { value?: string | null; email?: string | null; type?: string; confidence?: number; score?: number; first_name?: string | null; last_name?: string | null; position?: string | null; verification?: { status?: string } | null }

/** One Hunter request. null on a miss or an error; flags the meter when the credits are used up. */
async function ask(path: string, params: Record<string, string>, meter?: UsageMeter): Promise<E | null> {
  if (meter?.hunterOut) return null
  const url = `${BASE}/${path}?${new URLSearchParams({ ...params, api_key: process.env.HUNTER_API_KEY! })}`
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch(() => null)
  if (res?.status === 429) {
    if (meter) meter.hunterOut = true
    console.error('[hunter] usage limit reached: no credits left this period')
    return null
  }
  if (!res?.ok) return null
  const j = await res.json().catch(() => null) as { data?: E & { emails?: E[] } } | null
  const e = path === 'domain-search' ? j?.data?.emails?.[0] : j?.data
  const email = e?.value ?? e?.email
  if (!e || !email) return null
  if (meter) meter.hunter += 1
  return { ...e, value: email }
}

const toFound = (e: E, name?: string): FoundEmail => ({
  email: e.value!,
  verified: e.verification?.status === 'valid' || (e.confidence ?? e.score ?? 0) >= 90,
  name: name ?? ([e.first_name, e.last_name].filter(Boolean).join(' ') || undefined),
  position: e.position ?? undefined,
})

/** Best email at a company domain: the named person if we know them, else an owner or marketing
 *  person, else whatever single address Hunter ranks first. Costs at most 1 credit. */
export async function findEmail(domain: string, personName: string | undefined, meter?: UsageMeter): Promise<FoundEmail | null> {
  if (!hunterConfigured() || !domain) return null
  if (agentsDemo()) return demoFindEmail(domain, personName)
  const host = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]

  const person = personName ? splitName(personName) : null
  if (person) {
    const e = await ask('email-finder', { domain: host, first_name: person.first, last_name: person.last }, meter)
    if (e) return toFound(e, personName)
  }
  // The people worth writing to first; a miss is free, so then ask for anyone
  const lead = await ask('domain-search', { domain: host, limit: '1', type: 'personal', department: 'executive,management,marketing' }, meter)
  if (lead) return toFound(lead)
  const any = await ask('domain-search', { domain: host, limit: '1' }, meter)
  return any ? toFound(any) : null
}
