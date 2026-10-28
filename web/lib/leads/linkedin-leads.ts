// ── LinkedIn-style B2B lead search via Apify ─────────────────────────────────
// Actor: code_crafter/leads-finder (Apollo-style database: name, title, company,
// LinkedIn URL, email). Priced per lead, so every call is capped with fetch_count
// and maxItems. The token is developer-managed (APIFY_API_TOKEN), never per user.

import { ACTOR_INDUSTRIES, ACTOR_LOCATIONS } from './linkedin-options'

const ACTOR = 'code_crafter~leads-finder'
export const MAX_LEADS_PER_SEARCH = 50
export const DEFAULT_LEADS_PER_SEARCH = 25

export interface LeadSearchInput {
  jobTitles: string[]
  locations: string[]
  industries: string[]
  keywords: string[]
  count: number
}

export interface LinkedInLead {
  id: string
  name: string
  firstName: string
  lastName: string
  title: string | null
  email: string | null
  emailStatus: string | null
  linkedinUrl: string | null
  company: string | null
  domain: string | null
  industry: string | null
  location: string | null
}

export type LeadSearchResult =
  | { ok: true; leads: LinkedInLead[] }
  | { ok: false; error: string }

// The actor's output field names aren't documented on its page, so each value is
// read from the likely spellings. Anything missing comes back null.
function pick(item: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = item[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

function domainOf(value: string | null): string | null {
  if (!value) return null
  try {
    const host = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname
    return host.replace(/^www\./, '') || null
  } catch {
    return null
  }
}

export function normalizeLead(item: Record<string, unknown>, index: number): LinkedInLead | null {
  const firstName = pick(item, ['first_name', 'firstName']) ?? ''
  const lastName = pick(item, ['last_name', 'lastName']) ?? ''
  const name = pick(item, ['full_name', 'fullName', 'name']) ?? `${firstName} ${lastName}`.trim()
  const email = pick(item, ['email', 'business_email', 'work_email', 'personal_email'])
  const linkedinUrl = pick(item, ['linkedin', 'linkedin_url', 'linkedinUrl', 'person_linkedin_url'])
  if (!name && !email && !linkedinUrl) return null

  const website = pick(item, ['company_domain', 'company_website', 'website', 'domain', 'company_url'])
  const city = pick(item, ['city', 'contact_city'])
  const region = pick(item, ['state', 'region', 'country', 'location', 'contact_location'])

  return {
    id: pick(item, ['id', 'person_id']) ?? `lead-${index}`,
    name: name || email || 'Unknown',
    firstName,
    lastName,
    title: pick(item, ['job_title', 'title', 'position', 'headline']),
    email,
    emailStatus: pick(item, ['email_status', 'emailStatus']),
    linkedinUrl,
    company: pick(item, ['company_name', 'company', 'organization', 'organization_name']),
    domain: domainOf(website) ?? (email ? email.split('@')[1] ?? null : null),
    industry: pick(item, ['industry', 'company_industry']),
    location: [city, region].filter(Boolean).join(', ') || null,
  }
}

function apifyErrorMessage(status: number): string {
  if (status === 401)
    return 'The lead search service did not accept our key. This is a setup problem on our side, not yours. Please let support know.'
  if (status === 403)
    return 'The lead search service would not let us run this search. This is a setup problem on our side, not yours. Please let support know.'
  if (status === 402)
    return 'The lead search service is out of credit right now. Please try again later or let support know.'
  if (status === 404)
    return 'The lead search actor could not be found. It may have been renamed or removed. Please let support know.'
  if (status === 408 || status === 504)
    return 'The lead search took too long. Try narrower filters or fewer leads.'
  if (status === 429)
    return 'The lead search service is limiting requests right now. Wait a minute and try again.'
  if (status >= 500)
    return `The lead search service had a problem on its side (error ${status}). Try again in a few minutes.`
  return `The lead search service turned the request down (error ${status}). Check the filters and try again.`
}

const LOCATION_SET = new Set(ACTOR_LOCATIONS)
const INDUSTRY_SET = new Set(ACTOR_INDUSTRIES)

// The actor only accepts its own lists for location and industry (anything else is a 400), so what the
// user typed is matched to them: exactly, or by one unambiguous partial match. A place that doesn't match
// goes to the free-text city filter, and an industry that doesn't match becomes a company keyword.
export function mapFilters(input: Pick<LeadSearchInput, 'locations' | 'industries' | 'keywords'>) {
  const locations: string[] = []
  const cities: string[] = []
  for (const raw of input.locations) {
    const q = raw.trim().toLowerCase()
    if (!q) continue
    if (LOCATION_SET.has(q)) { locations.push(q); continue }
    const starts = ACTOR_LOCATIONS.filter((l) => l.startsWith(`${q},`))
    if (starts.length === 1) locations.push(starts[0])
    else cities.push(raw.trim())
  }
  const industries: string[] = []
  const keywords = [...input.keywords]
  for (const raw of input.industries) {
    const q = raw.trim().toLowerCase()
    if (!q) continue
    if (INDUSTRY_SET.has(q)) { industries.push(q); continue }
    const part = ACTOR_INDUSTRIES.filter((i) => i.includes(q))
    if (part.length === 1) industries.push(part[0])
    else keywords.push(raw.trim())
  }
  return { locations: [...new Set(locations)], cities: [...new Set(cities)], industries: [...new Set(industries)], keywords: [...new Set(keywords)] }
}

export async function searchLeads(input: LeadSearchInput): Promise<LeadSearchResult> {
  const token = process.env.APIFY_API_TOKEN?.trim()
  if (!token) return { ok: false, error: 'LinkedIn lead search is not switched on yet.' }

  const count = Math.max(1, Math.min(MAX_LEADS_PER_SEARCH, Math.floor(input.count) || DEFAULT_LEADS_PER_SEARCH))
  const body: Record<string, unknown> = {
    fetch_count: count,
    file_name: 'GrowJin leads',
    email_status: ['validated'],
  }
  const f = mapFilters(input)
  if (input.jobTitles.length) body.contact_job_title = input.jobTitles
  if (f.locations.length) body.contact_location = f.locations
  if (f.cities.length) body.contact_city = f.cities
  if (f.industries.length) body.company_industry = f.industries
  if (f.keywords.length) body.company_keywords = f.keywords

  try {
    // maxItems also caps what Apify can charge for pay-per-result runs
    const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?maxItems=${count}&timeout=150`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(170000),
    })
    if (!res.ok) {
      // Apify says why in the body ({ error: { type, message } }); log it for the developer, never show it
      const detail = await res.text().then((t) => t.slice(0, 300)).catch(() => '')
      console.error('[linkedin-leads] Apify returned', res.status, detail)
      return { ok: false, error: apifyErrorMessage(res.status) }
    }
    const items = (await res.json()) as unknown
    if (!Array.isArray(items)) return { ok: false, error: 'The lead search sent back something we could not read. Try again.' }

    const seen = new Set<string>()
    const leads: LinkedInLead[] = []
    items.forEach((raw, i) => {
      if (!raw || typeof raw !== 'object') return
      const lead = normalizeLead(raw as Record<string, unknown>, i)
      if (!lead) return
      const key = (lead.email ?? lead.linkedinUrl ?? lead.id).toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      leads.push(lead)
    })
    return { ok: true, leads: leads.slice(0, count) }
  } catch (e) {
    console.error('[linkedin-leads] request failed:', e)
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    return {
      ok: false,
      error: timedOut
        ? 'The lead search took too long. Try narrower filters or fewer leads.'
        : 'We could not reach the lead search service. Try again in a few minutes.',
    }
  }
}
