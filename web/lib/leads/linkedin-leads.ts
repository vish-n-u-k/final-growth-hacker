// ── B2B lead search via Apify ────────────────────────────────────────────────
// Actor: pipelinelabs/leads-finder-with-emails-apollo-lusha-zoominfo (a 250M-contact database: name,
// title, company, website, LinkedIn, checked work email). It works from the free Apify plan through the
// API (the other leads actors we tried do not). Priced per lead, so every call is capped.
// The token is developer-managed (APIFY_API_TOKEN), never per user.

import { ACTOR_COUNTRIES, ACTOR_INDUSTRIES, ACTOR_SIZES, ACTOR_TECHNOLOGIES } from './linkedin-options'

export const ACTOR = 'pipelinelabs~leads-finder-with-emails-apollo-lusha-zoominfo'
export const MAX_LEADS_PER_SEARCH = 50
export const DEFAULT_LEADS_PER_SEARCH = 25
const PRICE_PER_LEAD = 0.002   // USD on the free tier; the call is capped at about 1.5x this

export interface LeadSearchInput {
  jobTitles: string[]
  industries: string[]
  keywords: string[]
  countries: string[]
  sizes: string[]
  technologies: string[]
  count: number
  extra?: number    // more than `count` are fetched, so people left out later (already contacted) can be replaced
  offset?: number   // skip this many matches: each search of the same filters moves on to new people
  domains?: string[] // only people at these companies' websites (the Lead Agent's "someone at this company" lookup)
  timeoutSec?: number // how long the search may take (default 150 s)
}

export interface LinkedInLead {
  id: string
  name: string
  firstName: string
  lastName: string
  title: string | null
  email: string | null
  emailShared: boolean            // info@, admin@ ...: a shared inbox, not the person
  linkedinUrl: string | null
  company: string | null
  domain: string | null
  website: string | null          // https://domain
  companyDescription: string | null
  companySize: number | null
  industry: string | null
  location: string | null
}

export type LeadSearchResult =
  | { ok: true; leads: LinkedInLead[]; fetched: number }   // fetched = how many the provider sent (before repeats were dropped)
  | { ok: false; error: string }

// ── Matching what the user typed to the actor's allowed values ───────────────

const lower = (list: string[]) => new Map(list.map((v) => [v.toLowerCase(), v]))
const INDUSTRIES = lower(ACTOR_INDUSTRIES)
const COUNTRIES = lower(ACTOR_COUNTRIES)
const TECHNOLOGIES = lower(ACTOR_TECHNOLOGIES)
const SIZES = new Set(ACTOR_SIZES)
const COUNTRY_ALIASES: Record<string, string> = { us: 'United States', usa: 'United States', america: 'United States', uk: 'United Kingdom', britain: 'United Kingdom', 'great britain': 'United Kingdom', england: 'United Kingdom', uae: 'United Arab Emirates' }
const TECH_ALIASES: Record<string, string> = { woocommerce: 'Woo Commerce', 'woo commerce': 'Woo Commerce', wp: 'WordPress', mailchimp: 'MailChimp' }

/** Exact (any case) or one unambiguous partial match; otherwise null. */
function match(q: string, map: Map<string, string>): string | null {
  const k = q.trim().toLowerCase()
  if (!k) return null
  const exact = map.get(k)
  if (exact) return exact
  const part = [...map.entries()].filter(([key]) => key.includes(k))
  return part.length === 1 ? part[0][1] : null
}

// The actor only accepts its own lists for industry, country, size and technology (anything else is a
// 400). A place that is not a country goes to the free-text city filter, an industry that does not match
// becomes a company keyword, and a technology or size that does not match is dropped.
export function mapFilters(input: Omit<LeadSearchInput, 'count' | 'jobTitles'>) {
  const countries: string[] = []
  const cities: string[] = []
  for (const raw of input.countries) {
    const q = raw.trim()
    if (!q) continue
    const hit = match(COUNTRY_ALIASES[q.toLowerCase()] ?? q, COUNTRIES)
    if (hit) countries.push(hit)
    else cities.push(q)
  }
  const industries: string[] = []
  const keywords = [...input.keywords]
  for (const raw of input.industries) {
    const hit = match(raw, INDUSTRIES)
    if (hit) industries.push(hit)
    else if (raw.trim()) keywords.push(raw.trim())
  }
  const technologies = input.technologies.map((t) => match(TECH_ALIASES[t.trim().toLowerCase()] ?? t, TECHNOLOGIES)).filter((t): t is string => !!t)
  const sizes = input.sizes.map((s) => s.trim()).filter((s) => SIZES.has(s))
  const uniq = (l: string[]) => [...new Set(l)]
  return { countries: uniq(countries), cities: uniq(cities), industries: uniq(industries), keywords: uniq(keywords), technologies: uniq(technologies), sizes: uniq(sizes) }
}

// ── Reading what comes back ──────────────────────────────────────────────────
// Values are looked up by key with case, spaces, dashes and underscores ignored, one level into nested
// objects too, so a small change in the actor's field names doesn't blank every lead.

const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '')

function flatten(item: Record<string, unknown>): Map<string, unknown> {
  const out = new Map<string, unknown>()
  for (const [k, v] of Object.entries(item)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) if (!out.has(norm(k2))) out.set(norm(k2), v2)
    }
  }
  for (const [k, v] of Object.entries(item)) if (!(v && typeof v === 'object' && !Array.isArray(v))) out.set(norm(k), v)
  return out
}

function pickFrom(flat: Map<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = flat.get(norm(k))
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number') return String(v)
    if (Array.isArray(v)) {
      const first = v.find((x) => typeof x === 'string' && x.trim())
      if (first) return String(first).trim()
    }
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

const withScheme = (u: string | null) => (u ? (/^https?:\/\//i.test(u) ? u : `https://${u}`) : null)
const SHARED_INBOX = /^(info|admin|ecare|care|support|help|hello|hi|contact|sales|billing|office|team|mail|enquiries|inquiries|service|accounts?|orders?|shop|store|webmaster|marketing|press|hr|jobs)@/i

export function normalizeLead(item: Record<string, unknown>, index: number): LinkedInLead | null {
  const flat = flatten(item)
  const pick = (keys: string[]) => pickFrom(flat, keys)
  // Rows that are not leads (run summaries, diagnostics)
  const rowType = pick(['rowType'])
  if (rowType && rowType !== 'lead') return null

  const firstName = pick(['firstName', 'first_name']) ?? ''
  const lastName = pick(['lastName', 'last_name']) ?? ''
  const name = pick(['fullName', 'full_name', 'name']) ?? `${firstName} ${lastName}`.trim()
  const email = pick(['email', 'business_email', 'work_email', 'professional_email'])
  const linkedinUrl = withScheme(pick(['linkedinUrl', 'linkedin', 'linkedin_url', 'person_linkedin_url']))
  if (!name && !email && !linkedinUrl) return null

  const domain = domainOf(pick(['companyDomain', 'company_domain', 'company_website', 'website'])) ?? (email ? email.split('@')[1] ?? null : null)
  const city = pick(['personCity', 'city'])
  const place = pick(['personState', 'state']) ?? pick(['personCountry', 'country'])
  const size = Number(pick(['companySize', 'company_size']))

  return {
    id: pick(['id', 'person_id']) ?? `lead-${index}`,
    name: name || email || 'Unknown',
    firstName,
    lastName,
    title: pick(['title', 'position', 'job_title', 'headline']),
    email,
    emailShared: !!email && SHARED_INBOX.test(email),
    linkedinUrl,
    company: pick(['companyName', 'company_name', 'company', 'organization']),
    domain,
    website: domain ? `https://${domain}` : null,
    companyDescription: pick(['companyDescription', 'company_description'])?.replace(/\\+/g, ' ').replace(/\s+/g, ' ').slice(0, 240) ?? null,
    companySize: Number.isFinite(size) && size > 0 ? size : null,
    industry: pick(['companyIndustry', 'industry', 'company_industry']),
    location: [city, place].filter(Boolean).join(', ') || null,
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

export async function searchLeads(input: LeadSearchInput): Promise<LeadSearchResult> {
  const token = process.env.APIFY_API_TOKEN?.trim()
  if (!token) return { ok: false, error: 'LinkedIn lead search is not switched on yet.' }

  const count = Math.max(1, Math.min(MAX_LEADS_PER_SEARCH, Math.floor(input.count) || DEFAULT_LEADS_PER_SEARCH))
  const want = count + Math.max(0, Math.min(40, Math.floor(input.extra ?? 0)))
  const f = mapFilters(input)
  const body: Record<string, unknown> = {
    totalResults: want,
    emailStatusIncludes: ['verified'],
    // Every filter has to hold, not just one of them (the default is "any", which brings in strangers)
    roleMatchMode: 'all',
    companyMatchMode: 'all',
    includeTitleVariants: true,
    // A search always starts from the top; saved progress would skip leads already seen by this account
    dontSaveProgress: true,
  }
  if ((input.offset ?? 0) > 0) body.customOffset = Math.floor(input.offset!)
  if (input.jobTitles.length) body.personTitleIncludes = input.jobTitles
  if (f.industries.length) body.companyIndustryIncludes = f.industries
  if (f.keywords.length) body.companyKeywordIncludes = f.keywords
  if (f.technologies.length) body.technologiesIncludes = f.technologies
  if (f.sizes.length) body.companySizeIncludes = f.sizes
  if (f.countries.length) body.personLocationCountryIncludes = f.countries
  if (f.cities.length) body.personLocationCityIncludes = f.cities
  if (input.domains?.length) body.companyDomainIncludes = input.domains

  try {
    // maxItems / maxTotalChargeUsd cap what Apify can bill for this call
    const cap = (want * PRICE_PER_LEAD * 1.5 + 0.02).toFixed(3)
    const wait = Math.max(30, Math.min(150, Math.floor(input.timeoutSec ?? 150)))
    const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?maxItems=${want}&maxTotalChargeUsd=${cap}&timeout=${wait}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout((wait + 20) * 1000),
    })
    if (!res.ok) {
      // Apify says why in the body ({ error: { type, message } }); log it for the developer, never show it
      const detail = await res.text().then((t) => t.slice(0, 300)).catch(() => '')
      console.error('[linkedin-leads] Apify returned', res.status, detail)
      return { ok: false, error: apifyErrorMessage(res.status) }
    }
    const items = (await res.json()) as unknown
    if (!Array.isArray(items)) return { ok: false, error: 'The lead search sent back something we could not read. Try again.' }

    // For the developer: how many came back and what fields they carry (never the values)
    const first = items.find((x) => x && typeof x === 'object') as Record<string, unknown> | undefined
    console.log('[linkedin-leads] Apify sent', items.length, 'items; fields:', first ? Object.keys(first).join(', ') : 'none')

    // A refused run answers with one item that only has an "error" field
    const refusal = items.length === 1 && first && typeof first.error === 'string' && Object.keys(first).length === 1 ? first.error : null
    if (refusal) {
      console.error('[linkedin-leads] actor refused the run:', refusal.slice(0, 200))
      return { ok: false, error: 'The lead search is not available on our current plan yet. This is a setup problem on our side, not yours. Please let support know.' }
    }

    const seen = new Set<string>()
    const leads: LinkedInLead[] = []
    items.forEach((raw, i) => {
      if (!raw || typeof raw !== 'object') return
      const lead = normalizeLead(raw as Record<string, unknown>, i)
      if (!lead) return
      // The database often holds one person twice (two company records, a work and a shared address)
      const key = (lead.email ?? lead.linkedinUrl ?? lead.id).toLowerCase()
      const person = `${lead.name.toLowerCase()}|${lead.domain ?? ''}`
      if (seen.has(key) || seen.has(person)) return
      seen.add(key); seen.add(person)
      leads.push(lead)
    })
    if (items.length > 0 && leads.length === 0) {
      return { ok: false, error: 'The lead search found people, but we could not read them. Please let support know.' }
    }
    return { ok: true, leads: leads.slice(0, want), fetched: items.length }
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
