// The Lead Agent. Each run (daily cron or "Run now"):
//   1. checks sent emails for replies, opt-outs and bounces, and sends due follow-ups
//   2. sends approved emails that waited for today's sending limit
//   3. finds new leads: Reddit / Hacker News posts asking for this kind of product, local
//      businesses on Google Maps, and online companies like the brand's customers (websites from
//      DataForSEO, emails from Hunter)
//   4. scores them (Claude), finds an email (Hunter, else the company website), drafts a short
//      personal email or a forum reply, and waits for the user's OK (or sends on its own in
//      auto mode, once the user has approved 20)
// Nothing is posted on Reddit by the agent: replies are drafts the user posts by hand.

import { stripEmDashes } from '@/lib/email/clean'
import { callAI, withAIContext } from '@/lib/ai/client'
import { sendGmailMessage, GmailSendError } from '@/lib/gmail/send'
import { getValidGmailToken } from '@/lib/gmail/token'
import { checkThreadReply } from '@/lib/gmail/reply-check'
import { openSignal, clearSignals } from '@/lib/signals'
import { fetchHtml } from '@/lib/lead-finder/reviews'
import { searchDataReady, googleResults, mapsBusinesses, storesByPlatform, similarSites, siteVisits, DfsBusyError } from './dataforseo'
import { planLeadQueries, ownerExamples } from './lead-playbook'
import { agentsDemo, demoLocalQuery, demoReply, demoSend, setDemoContext } from './demo'
import { Progress } from './progress'
import { hunterConfigured, findEmail } from './hunter'
import { profileOf } from './profiles'
import { contactEmail, inBatches, marketingFacts, marketingLine, storeFacts, storeLine, type MarketingFacts, type StoreFacts } from './site-facts'
import { costNote } from './services'
import {
  addUsage, defaultLeadData, newMeter, readLeadData, updateLeadData,
  type Icp, type IcpKind, type Lead, type LeadAgentData, type LeadSettings, type LeadQuery, type LeadSource, type MaybeLead, type UsageMeter, type WaitingPost, type WaitingSite,
} from './store'
import { brandBlock, leadBrandBlock, daysFrom, domainOf, firstName, idOf, loadBrandContext, parseJsonLoose, textToHtml, type BrandContext } from './context'

const EU = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'])
const MIN_SCORE = 7
// Companies are already filtered (small, not PR/B2B, read from their own site), so 6 is good enough to email
const MIN_COMPANY_SCORE = 6
// Hacker News launches are often developer tools, so they need a clearer fit
const MIN_LAUNCH_SCORE = 7
const MAX_NEW_PER_RUN = 12
const OPT_OUT = 'If this isn\'t relevant, just reply "no" and I won\'t email again.'

// New finds per source per run, and Hunter email lookups per run. Kept at 3 while testing, to save
// DataForSEO money, Hunter credits and AI tokens; AGENTS_LEADS_PER_SOURCE raises it (up to 10).
const PER_SOURCE = Math.max(1, Math.min(10, Number(process.env.AGENTS_LEADS_PER_SOURCE) || 3))
// Companies are cheap to check (home page, store facts, one AI call for all) and only the best get a
// Hunter lookup, so many more are checked than looked up: up to 30 checked, at most PER_SOURCE Hunter emails
const COMPANY_CHECK = Math.max(PER_SOURCE, 30)
const PLATFORMS = ['Shopify', 'WooCommerce', 'Wix', 'Squarespace']
// Not small-business buyers: PR and B2B firms, consultancies, big agencies
const NOT_A_FIT = /\b(public relations|pr agency|pr firm|b2b|enterprise|consult(ing|ancy|ants?)|investor relations|fortune 500|global (agency|leader)|award[- ]winning|staffing|recruit(ing|ment))\b/i
// Sites that aren't one business: marketplaces, social networks, site builders, review and job sites
const NOT_A_SITE = /(^|\.)(amazon|etsy|ebay|walmart|aliexpress|alibaba|flipkart|pinterest|facebook|instagram|tiktok|youtube|linkedin|twitter|reddit|quora|medium|wikipedia|yelp|tripadvisor|google|apple|shopify|wordpress|wix|squarespace|blogspot|substack|trustpilot|indeed|glassdoor|forbes|nytimes)\.[a-z.]+$/
// Estimated visits from Google a month above which a site isn't a small business
// A site on a builder's free address is still the business's own site (it has a contact page)
const BUILDER_SITE = /^[a-z0-9-]+\.(blogspot\.com|wixsite\.com|squarespace\.com|myshopify\.com|weebly\.com|webflow\.io|carrd\.co|square\.site)$/
const ownSite = (domain: string) => !NOT_A_SITE.test(domain) || BUILDER_SITE.test(domain)
const BIG_VISITS = 20_000
// DataForSEO dollars a run may spend on the company questions (each question checks before asking)
const DFS_CAP = Number(process.env.AGENTS_LEADS_DFS_CAP) || 0.25
const DEMO_EMAIL_LEADS = 5   // demo mode: businesses to email per run, at least

export const leadFallback = (b: BrandContext) => () => defaultLeadData(b, b.competitors.map(c => c.domain))

const today = () => new Date().toISOString().slice(0, 10)
export const sentToday = (d: LeadAgentData) => d.sentLog.filter(t => t.slice(0, 10) === today()).length

// ── Sending ───────────────────────────────────────────────────────────────────

/** Sends a lead's first email now. Returns the fields to save on the lead. */
export async function sendFirstEmail(brandId: string, lead: Lead, followUpDays: number[]): Promise<Partial<Lead>> {
  if (!lead.email || !lead.draft) return { error: 'No email or draft.' }
  try {
    // Demo mode: recorded as sent, nothing leaves GrowJin
    const sent = agentsDemo() ? demoSend() : await sendGmailMessage(brandId, { to: lead.email, subject: lead.draft.subject, body: textToHtml(`${lead.draft.body}\n\n${OPT_OUT}`) }, { source: 'lead-agent', toName: lead.name ?? null })
    const now = new Date().toISOString()
    return {
      status: 'sent', sentAt: now, threadId: sent.threadId, followupsSent: 0, error: undefined,
      nextFollowUpAt: followUpDays[0] ? daysFrom(now, followUpDays[0]) : undefined,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Send failed'
    if (e instanceof GmailSendError && e.code === 'suppressed') return { status: 'opted_out', error: msg }
    return { error: msg }
  }
}

/**
 * The user approved a lead's email (optionally edited): sends it now, or queues it for
 * tomorrow if today's limit is reached. Returns a short message for the page.
 */
export async function approveLead(brandId: string, leadId: string, edits?: { subject?: string; body?: string }, by: 'user' | 'auto' = 'user'): Promise<{ ok: boolean; message: string }> {
  const b = await loadBrandContext(brandId)
  if (!b) return { ok: false, message: 'Brand not found.' }
  const fallback = leadFallback(b)
  const d = (await readLeadData(brandId)) ?? fallback()
  const lead = d.leads.find(l => l.id === leadId)
  if (!lead) return { ok: false, message: 'Lead not found.' }
  if (lead.status !== 'ready' && lead.status !== 'queued') return { ok: false, message: 'Already handled.' }
  const draft = lead.draft && edits ? { subject: edits.subject?.trim() || lead.draft.subject, body: edits.body?.trim() || lead.draft.body } : lead.draft
  const withDraft = { ...lead, draft }

  if (sentToday(d) >= d.settings.dailyLimit) {
    await updateLeadData(brandId, fallback, x => {
      const l = x.leads.find(y => y.id === leadId)
      if (!l) return
      Object.assign(l, { draft, status: 'queued', approvedBy: by })
      if (by === 'user') x.approvedCount += 1
    })
    return { ok: true, message: `Today's limit of ${d.settings.dailyLimit} is reached. It will go out tomorrow.` }
  }

  const patch = await sendFirstEmail(brandId, withDraft, d.settings.followUpDays)
  await updateLeadData(brandId, fallback, x => {
    const l = x.leads.find(y => y.id === leadId)
    if (!l) return
    Object.assign(l, { draft, approvedBy: by }, patch)
    if (patch.status === 'sent') x.sentLog.push(patch.sentAt!)
    if (by === 'user' && patch.status === 'sent') x.approvedCount += 1
  })
  return patch.status === 'sent'
    ? { ok: true, message: `Sent to ${lead.email}.` }
    : { ok: false, message: patch.error ?? 'Could not send.' }
}

// ── Follow-ups and replies ────────────────────────────────────────────────────

function followUpText(n: number, lead: Lead, b: BrandContext): string {
  const hi = firstName(lead.name) ? `Hi ${firstName(lead.name)},` : 'Hi,'
  return n === 0
    ? `${hi}\n\nJust bringing this back to the top of your inbox in case it got buried. Would it be worth a quick look?\n\n${b.name}`
    : `${hi}\n\nLast note from me. If ${b.name} isn't a fit right now, no problem at all. If it would help later, just reply and I'll pick it up.\n\n${b.name}`
}

async function processSentLeads(brandId: string, b: BrandContext, d: LeadAgentData, deadline: number): Promise<{ patches: Map<string, Partial<Lead>>; replies: Lead[]; error?: string }> {
  const patches = new Map<string, Partial<Lead>>()
  const replies: Lead[] = []
  const sent = d.leads.filter(l => l.status === 'sent' && l.threadId && l.email)
  if (!sent.length) return { patches, replies }
  const demo = agentsDemo()
  let token = ''
  if (!demo) {
    try {
      token = await getValidGmailToken(brandId)
    } catch (e) {
      return { patches, replies, error: e instanceof Error ? e.message : 'Gmail not connected' }
    }
  }
  for (const lead of sent) {
    if (Date.now() > deadline) break
    try {
      const firstReply = demo && !replies.length && !d.leads.some(l => l.status === 'replied')
      const r = demo ? demoReply(lead.id, lead.sentAt!, firstReply) : await checkThreadReply(brandId, token, lead.threadId!, lead.email!, Date.parse(lead.sentAt!) - 60_000)
      if (r.outcome === 'replied' || r.outcome === 'opted_out' || r.outcome === 'bounced') {
        patches.set(lead.id, { status: r.outcome, replyNote: r.note, replyIntent: r.intent, repliedAt: new Date().toISOString(), nextFollowUpAt: undefined })
        if (r.outcome === 'replied') replies.push({ ...lead, replyNote: r.note })
        continue
      }
      const due = lead.nextFollowUpAt && Date.parse(lead.nextFollowUpAt) <= Date.now()
      if (due && lead.followupsSent < d.settings.followUpDays.length && lead.draft) {
        const subject = /^re:/i.test(lead.draft.subject) ? lead.draft.subject : `Re: ${lead.draft.subject}`
        if (!demo) await sendGmailMessage(brandId, { to: lead.email!, subject, body: textToHtml(`${followUpText(lead.followupsSent, lead, b)}\n\n${OPT_OUT}`), threadId: lead.threadId }, { source: 'lead-agent', toName: lead.name ?? null })
        const n = lead.followupsSent + 1
        const next = d.settings.followUpDays[n]
        patches.set(lead.id, { followupsSent: n, nextFollowUpAt: next ? daysFrom(lead.sentAt!, next) : undefined })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Follow-up failed'
      patches.set(lead.id, e instanceof GmailSendError && e.code === 'suppressed' ? { status: 'opted_out', error: msg, nextFollowUpAt: undefined } : { error: msg })
    }
  }
  return { patches, replies }
}

// ── The ideal customer ────────────────────────────────────────────────────────

const ICP_KINDS: IcpKind[] = ['ecommerce', 'saas', 'local', 'creator', 'other']

/** Who we look for, for every AI prompt: the ideal-customer card when there is one, else the plain line. */
export function customerBlock(b: BrandContext, s: LeadSettings): string {
  const c = s.icp
  const lead = 'Who to look for (from the search settings; where it differs from the brand\'s "Who it\'s for", follow this):'
  // Searches for the buyers' trade still bring up products like the brand's own; those are rivals, not buyers
  const rivals = `Never a fit (score 1, never keep): anyone who sells a product or service that does what ${b.name} does, or competes with it${b.competitors.length ? ` (like ${b.competitors.map(x => x.name).join(', ')})` : ''}. They are competitors, not buyers.`
  if (!c?.who) return `${lead}\nIdeal customer: ${s.customer || (s.useBrand !== false ? b.targetAudience : '') || 'not given'}\n${rivals}`
  return [
    lead,
    `Ideal customer: ${c.who}`,
    c.marketing ? `How they market today: ${c.marketing}` : null,
    c.trades?.length ? `Kinds of business we search for: ${c.trades.join(', ')}` : null,
    c.fit.length ? `Signs of a good fit: ${c.fit.join('; ')}` : null,
    c.notFit.length ? `NOT a fit (score 1-3, never keep): ${c.notFit.join('; ')}` : null,
    c.examples.length ? `Examples of ideal customers: ${c.examples.join(', ')}` : null,
    rivals,
  ].filter(Boolean).join('\n')
}

/** A short key for the card, so saved search words are redone when it changes. */
// The brand switch is part of it too: turning the brand profile off changes every search
export const icpKey = (s: LeadSettings) => (s.icp ? idOf(JSON.stringify([s.icp.kind, s.icp.who, s.icp.marketing, s.icp.fit, s.icp.notFit, s.icp.examples, s.icp.trades ?? []])).slice(0, 8) : '') + (s.useBrand === false ? ':own' : '')

/**
 * Drafts the ideal-customer card from the brand and, when given, a few example customers' sites
 * (read for free): who they are, how they market today, signs of fit, and who is not a fit.
 */
export async function draftIcp(b: BrandContext, s: LeadSettings, examples: string[]): Promise<{ icp: Icp; companyQuery: string } | null> {
  const domains = [...new Set(examples.map(domainOf).filter(x => x.includes('.')))].slice(0, 5)
  const read = await inBatches(domains, 5, async d => `${d}: ${(await aboutSite(d)).text.slice(0, 300) || 'could not read the site'}`)
  const raw = await withAIContext({ brandId: b.id, moduleType: 'lead-agent', websiteUrl: b.websiteUrl }, () => callAI({
    feature: 'lead-agent',
    model: 'claude-sonnet-4-6',
    maxTokens: 900,
    system: 'You describe a product\'s ideal customer so a lead finder can tell good leads from bad. Be specific and practical. Return only a raw JSON object.',
    prompt: `${brandBlock(b)}
What the owner wrote about their customer: ${s.customer || 'nothing'}
${read.length ? `Examples of ideal customers the owner gave (find what they have in common):\n${read.join('\n')}\n` : ''}
Return {"kind":"...","who":"...","marketing":"...","trades":[...],"fit":[...],"notFit":[...],"companyQuery":"..."}
- kind: what the buyers mostly are: "ecommerce" (online stores), "saas" (software / app founders), "local" (shops with a street address), "creator" (individual creators or freelancers), or "other"
- who: one plain sentence, e.g. "Founders of small SaaS products (1-10 people) who do their own marketing"
- trades: 5-8 concrete kinds of business these buyers are, each 1-3 words a business of that kind uses on its own website, so a Google search for it brings back such businesses (e.g. "yoga studio", "hair salon", "candle maker", "bakery", "life coach", "skincare brand"). Pick the ones most likely to buy, most likely first. Never this product's own category, and never businesses that sell what this product does (for a social media tool: no "social media agency", "marketing agency" or "content creator"). No vague words like "small business", "startup" or "brand" on their own.
- marketing: how they market today, in one sentence, e.g. "The founder posts on X and LinkedIn themselves, with no marketing hire"
- fit: 3-5 short signs someone is a good fit that can be seen on their website or posts (e.g. "launched in the last year", "founder links their own X account", "blog not updated in months")
- notFit: 3-6 short signs someone is NOT a fit (e.g. "has a marketing team or agency", "hires influencers or creators", "big brand", "sells a tool or service like ours", and the buyer types this product is wrongly confused with)
- companyQuery: who to search for, in plain words, e.g. "small SaaS and app startups, 1-10 people"`,
  }))
  const j = parseJsonLoose<Partial<Icp> & { companyQuery?: string }>(raw, 'object')
  if (!j?.who) return null
  const list = (x: unknown, n: number) => (Array.isArray(x) ? x : []).filter((v): v is string => typeof v === 'string' && !!v.trim()).map(v => v.trim().slice(0, 140)).slice(0, n)
  return {
    icp: {
      kind: ICP_KINDS.includes(j.kind as IcpKind) ? j.kind as IcpKind : 'other',
      who: String(j.who).trim().slice(0, 300),
      marketing: typeof j.marketing === 'string' ? j.marketing.trim().slice(0, 300) : '',
      trades: list(j.trades, 8).map(t => t.slice(0, 40)),
      fit: list(j.fit, 6), notFit: list(j.notFit, 8), examples: domains, by: 'ai',
    },
    companyQuery: typeof j.companyQuery === 'string' ? j.companyQuery.trim().slice(0, 200) : '',
  }
}

// ── Finding ───────────────────────────────────────────────────────────────────

interface Candidate {
  source: LeadSource
  url: string
  title: string
  snippet: string
  name?: string
  website?: string
  phone?: string
  rating?: number | null
  email?: string                // already known from the source (no Hunter lookup needed)
  judge?: string                // companies: everything the AI checks (page text, store facts), not shown
  launch?: boolean              // companies: found as a Hacker News launch
  queryId?: string              // companies: the DataForSEO question that found it (LeadQuery.id)
}

async function searchQueries(b: BrandContext, s: LeadSettings, d: LeadAgentData): Promise<string[]> {
  const key = `${s.customer}|${b.usp ?? ''}|${icpKey(s)}`
  if (d.queries?.for === key && d.queries.list.length) return d.queries.list
  const raw = await callAI({
    feature: 'lead-agent',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 300,
    system: 'You write Google search phrases that find forum posts where people ask for a product like this one. Return only a JSON array of strings.',
    prompt: `${leadBrandBlock(b, s.useBrand !== false)}\n${customerBlock(b, s)}\n\nWrite 6 short phrases (3-7 words) a potential customer would write when asking for help, e.g. "looking for a tool to", "any app that", "how do you manage". Describe the problem in their words, never the brand name.`,
  })
  const list = (parseJsonLoose<string[]>(raw, 'array') ?? []).filter(q => typeof q === 'string' && q.length > 3).slice(0, 6)
  d.queries = { for: key, list }
  return list
}

// Where founders ask for help: used instead of all of Reddit when the buyers are SaaS founders
const FOUNDER_SUBS = ['SaaS', 'indiehackers', 'startups', 'Entrepreneur', 'microsaas']

async function findReddit(queries: string[], country: string, meter: UsageMeter, turn: number, kind?: IcpKind): Promise<Candidate[]> {
  if (!searchDataReady() || !queries.length) return []
  // Each search moves on to the next phrase (`turn` counts searches); one Google search when few
  // finds are wanted, two otherwise
  const picks = (PER_SOURCE <= 3 ? [queries[turn % queries.length]] : [queries[turn % queries.length], queries[(turn + 1) % queries.length]]).filter((q, i, a) => a.indexOf(q) === i)
  // Google sometimes chokes on long phrases with quotes behind site:, so a second try uses a plain, short version
  const plain = (q: string) => q.replace(/["“”'()]/g, ' ').replace(/\b(OR|AND)\b/g, ' ').split(/\s+/).filter(Boolean).slice(0, 6).join(' ')
  const where = kind === 'saas' ? `(${FOUNDER_SUBS.map(r => `site:reddit.com/r/${r}`).join(' OR ')})` : 'site:reddit.com'
  const search = (q: string) => googleResults(`${where} ${q}`, country, meter, { recent: true })
    .catch(e => (plain(q) && plain(q) !== q ? googleResults(`site:reddit.com ${plain(q)}`, country, meter) : Promise.reject(e)))
  const settled = await Promise.allSettled(picks.map(search))
  const results = settled.flatMap(r => (r.status === 'fulfilled' ? [r.value] : []))
  // Only an error when every search failed (one bad phrase shouldn't flag the whole run). Google not
  // answering (DfsBusyError) isn't the user's to fix: logged, and the next search uses the next phrase
  if (!results.length) {
    const r = settled.find(x => x.status === 'rejected') as PromiseRejectedResult | undefined
    if (r && r.reason instanceof DfsBusyError) { console.log(`[lead-agent] Reddit: Google didn’t answer “${picks.join('”, “')}”; the next search tries the next phrase`); return [] }
    if (r) throw r.reason
  }
  return results.flat()
    .filter(r => /reddit\.com\/r\/[^/]+\/comments\//.test(r.url))
    .map(r => ({
      source: 'reddit' as const,
      url: r.url.split('?')[0],
      title: r.title.replace(/\s*[:|-]\s*r\/\w+.*$/i, '').replace(/\s*-\s*Reddit$/i, '').trim(),
      snippet: r.description,
      name: r.url.match(/\/r\/([^/]+)\//)?.[1] ? `r/${r.url.match(/\/r\/([^/]+)\//)![1]}` : undefined,
    }))
}

async function findHackerNews(queries: string[], turn: number): Promise<Candidate[]> {
  const since = Math.floor(Date.now() / 1000) - 30 * 86400
  const q = queries[turn % Math.max(1, queries.length)]
  if (!q) return []
  try {
    const res = await fetch(`https://hn.algolia.com/api/v1/search_by_date?${new URLSearchParams({ query: q, tags: 'story', numericFilters: `created_at_i>${since}`, hitsPerPage: String(Math.max(5, PER_SOURCE * 2)) })}`, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return []
    const j = await res.json() as { hits?: { objectID: string; title?: string; story_text?: string | null; author?: string }[] }
    return (j.hits ?? []).filter(h => h.title).map(h => ({
      source: 'forum' as const,
      url: `https://news.ycombinator.com/item?id=${h.objectID}`,
      title: h.title!,
      snippet: (h.story_text ?? '').replace(/<[^>]+>/g, ' ').slice(0, 400),
      name: h.author,
    }))
  } catch {
    return []
  }
}

// ── Companies like your customers ─────────────────────────────────────────────

// Not a product's own site: code hosts, app stores, blogs and social networks
const NOT_A_PRODUCT_SITE = /(^|\.)(github\.com|gitlab\.com|youtube\.com|youtu\.be|medium\.com|substack\.com|apps\.apple\.com|play\.google\.com|chromewebstore\.google\.com|chrome\.google\.com|npmjs\.com|pypi\.org|huggingface\.co|x\.com|twitter\.com|reddit\.com|ycombinator\.com|linkedin\.com|notion\.site|github\.io|docs\.google\.com|arxiv\.org|wikipedia\.org)$/i

/**
 * Founders who just launched their product on Hacker News ("Show HN"), newest first, a new page
 * each search. Free (Algolia's HN search). Founders who launch there mostly do their own marketing.
 */
async function showHnSites(turn: number): Promise<WaitingSite[]> {
  if (agentsDemo()) return []
  const since = Math.floor(Date.now() / 1000) - 90 * 86400
  try {
    const res = await fetch(`https://hn.algolia.com/api/v1/search_by_date?${new URLSearchParams({ tags: 'show_hn', numericFilters: `created_at_i>${since}`, hitsPerPage: '50', page: String(turn % 15) })}`, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return []
    const j = await res.json() as { hits?: { title?: string; url?: string | null; author?: string; created_at_i?: number; points?: number | null }[] }
    const seen = new Set<string>()
    return (j.hits ?? []).flatMap(h => {
      const domain = h.url ? domainOf(h.url) : ''
      if (!domain || !domain.includes('.') || NOT_A_PRODUCT_SITE.test(domain) || seen.has(domain)) return []
      seen.add(domain)
      const title = (h.title ?? '').replace(/^show hn:\s*/i, '').trim()
      const days = h.created_at_i ? Math.round((Date.now() / 1000 - h.created_at_i) / 86400) : null
      return [{ domain, name: title.split(/\s[–—-]\s|:\s/)[0].slice(0, 60) || domain, about: title, from: `Launched on Hacker News${days !== null ? ` ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}` : ''} by ${h.author ?? 'its maker'}` }]
    })
  } catch {
    return []
  }
}


const HEADCOUNTS = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001-10000', '10001+']

/** The company search in plain words, turned into DataForSEO search terms once per wording. */
async function companyFilters(b: BrandContext, s: LeadSettings, d: LeadAgentData): Promise<{ keywords: string[]; headcount: string[]; platforms: string[] }> {
  // v3: the ideal-customer card is part of the key, so editing it redoes the search words
  const what = s.companyQuery.trim() || s.icp?.who || s.customer
  const want = `v3:${icpKey(s)}:${what}`
  const saved = d.companyFilters
  if (saved?.for === want && saved.keywords.length && saved.platforms) return { ...saved, platforms: saved.platforms }
  const raw = await callAI({
    feature: 'lead-agent',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 300,
    system: 'You turn a description of target companies into search filters. Return only a raw JSON object.',
    prompt: `${leadBrandBlock(b, s.useBrand !== false)}
${customerBlock(b, s)}
Companies to find: ${what || 'companies that would buy this product'}

Return {"keywords":[...],"headcount":[...],"platforms":[...]}:
- keywords: 8 single words or short phrases (1-2 words) these companies use to describe themselves on their own website, e.g. "skincare", "handmade jewelry", "coffee roaster", "yoga studio". Their products or trade, not ${b.name}'s. Never "PR", "public relations", "B2B", "enterprise" or "consulting": those are big firms, not small businesses. Never a describing word on its own ("boutique", "creative", "premium", "luxury"): law and property firms call themselves boutique too. Name what they make or sell ("candles", "handmade jewelry", "etsy").
- headcount: company sizes to include, from ${HEADCOUNTS.join(', ')}. Small businesses: ["1-10","11-50"].
- platforms: only if the ideal customers are online stores, the store platforms to search, from ${PLATFORMS.join(', ')} (e.g. ["Shopify","WooCommerce"]); else [].`,
  })
  const j = parseJsonLoose<{ keywords?: string[]; headcount?: string[]; platforms?: string[] }>(raw, 'object') ?? {}
  const f = {
    keywords: (j.keywords ?? []).filter(k => typeof k === 'string' && k.trim()).map(k => k.trim().toLowerCase()).slice(0, 8),
    headcount: (j.headcount ?? []).filter(h => HEADCOUNTS.includes(h)),
    // A card that says the buyers aren't online stores never searches store platforms
    platforms: s.icp && s.icp.kind !== 'ecommerce' ? [] : (j.platforms ?? []).filter(p => PLATFORMS.includes(p)).slice(0, 2),
  }
  d.companyFilters = { for: want, ...f }
  return f
}

/** Title, description and social links from a site's home page, so the fit score has something to go on. */
// Words in a home page's title that aren't the business's name ("Home | Dailot")
const GENERIC_TITLE = /^(home|homepage|welcome|shop|store|online store|official site|official website|index|main)$/i

/** The business's own name: og:site_name, else the part of its home page title that isn't "Home" or a slogan. */
function siteNameOf(html: string, title: string): string {
  const og = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{1,80})/i)?.[1]
    ?? html.match(/<meta[^>]+content=["']([^"']{1,80})["'][^>]+property=["']og:site_name["']/i)?.[1]
  const clean = (x: string) => x.replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/\s+/g, ' ').trim()
  if (og && !GENERIC_TITLE.test(clean(og))) return clean(og).slice(0, 60)
  const parts = clean(title).split(/\s[|–—-]\s|\s·\s|:\s/).map(x => x.trim()).filter(x => x && !GENERIC_TITLE.test(x))
  // The shortest part is usually the name ("Dailot" in "Handmade beaded jewelry | Dailot")
  return (parts.sort((a, b) => a.length - b.length)[0] ?? '').slice(0, 60)
}

async function aboutSite(domain: string): Promise<{ text: string; socials: string[]; page: string; html: string; name: string }> {
  const html = await fetchHtml(`https://${domain}`).catch(() => null)
  if (!html) return { text: '', socials: [], page: '', html: '', name: '' }
  const title = html.match(/<title[^>]*>([^<]{1,160})/i)?.[1] ?? ''
  const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,300})/i)?.[1]
    ?? html.match(/<meta[^>]+content=["']([^"']{1,300})["'][^>]+name=["']description["']/i)?.[1] ?? ''
  const page = html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').slice(0, 8000)
  return { text: [title, desc].map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' · '), socials: socialsIn(html), page, html, name: siteNameOf(html, title) }
}

// Words too common to show a trade ("etsy shop" is about Etsy, not "shop")
// and describing words ("boutique" law firm, "creative" agency) that say nothing about the trade
const PLAIN_WORDS = new Set(['shop', 'shops', 'store', 'stores', 'online', 'brand', 'brands', 'small', 'business', 'businesses', 'company', 'companies', 'agency', 'agencies', 'studio', 'services', 'service', 'digital', 'local', 'the', 'and', 'for', 'co', 'boutique', 'creative', 'premium', 'luxury', 'independent', 'modern', 'custom', 'quality', 'best', 'top', 'global', 'group', 'firm'])

/**
 * Does the business's own site say it is what we look for? True when its name, description or page
 * text has one of the trade words ("handmade", "etsy"…), or a whole keyword phrase. Free, and it
 * stops Hunter's loose keyword matches (an estate agent "matching" etsy shop) before any scoring.
 */
function tradeMatch(keywords: string[], text: string): boolean {
  if (!keywords.length) return true
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9&]+/g, ' ')} `
  return keywords.some(k => {
    const phrase = k.toLowerCase().replace(/[^a-z0-9&]+/g, ' ').trim()
    if (!phrase) return false
    const words = phrase.split(' ')
    const trade = words.filter(w => w.length > 2 && !PLAIN_WORDS.has(w))
    // A lone describing word ("boutique") never counts; a phrase of them ("online boutique") only as a whole
    if (words.length > 1 && (t.includes(` ${phrase} `) || t.includes(` ${phrase}s `))) return true
    return trade.some(w => t.includes(` ${w} `) || t.includes(` ${w}s `))
  })
}

/** Which social networks a page links to (a business that links Instagram cares about posting). */
function socialsIn(text: string): string[] {
  const nets: [string, RegExp][] = [['Instagram', /instagram\.com\/[\w.]+/i], ['Facebook', /facebook\.com\/[\w.-]+/i], ['TikTok', /tiktok\.com\/@[\w.]+/i], ['LinkedIn', /linkedin\.com\/company\//i], ['Pinterest', /pinterest\.[a-z.]+\/[\w-]+/i], ['YouTube', /youtube\.com\/(@|c\/|channel\/)/i], ['X', /(twitter|x)\.com\/(?!intent|share|home|search)\w{2,15}["'/?]/i]]
  return nets.filter(([, re]) => re.test(text)).map(([n]) => n)
}

/**
 * Websites to check: first the ones waiting from an earlier search (`queue`), then, when there
 * aren't `limit` of them, a new search on the next page (`turn`). Sites beyond `limit` go back to
 * the waiting list through `rest`, for "Show 10 more".
 */
async function findCompanies(b: BrandContext, s: LeadSettings, d: LeadAgentData, known: Set<string>, meter: UsageMeter, warn: (msg: string) => void,
  o: { turn: number; limit: number; queue: WaitingSite[]; searched: () => void; rest: (sites: WaitingSite[]) => void }): Promise<Candidate[]> {
  const f = await companyFilters(b, s, d)
  const skip = new Set([b.domain, ...b.competitors.map(c => domainOf(c.domain))])
  const fresh = (domain: string) => !skip.has(domain) && !known.has(idOf(`https://${domain}`))
  type Found = WaitingSite
  const queued = o.queue.filter(x => fresh(x.domain))
  if (queued.length >= o.limit) { o.rest(queued.slice(o.limit)); return checkSites(queued.slice(0, o.limit)) }

  // SaaS buyers: products their founders just launched on Hacker News come first (free)
  const launches = s.icp?.kind === 'saas' ? (await showHnSites(o.turn)).filter(x => fresh(x.domain) && !queued.some(q => q.domain === x.domain)) : []
  if (launches.length) console.log(`[lead-agent] Show HN launches: ${launches.length} new`)
  if (queued.length + launches.length >= o.limit) { o.searched(); const pool = [...queued, ...launches]; o.rest(pool.slice(o.limit)); return checkSites(pool.slice(0, o.limit)) }
  if (!searchDataReady()) { if (launches.length) { o.searched(); return checkSites([...queued, ...launches]) } warn('Companies: needs GrowJin’s DataForSEO account, which isn’t set up'); return [] }
  // DataForSEO finds the websites, with the questions planned from the playbook (lead-playbook.ts):
  // Google searches with operators, the technology index and sites like a customer. Each question
  // asks for its next page. Hunter only finds emails, later.
  // The card's kinds of business are the search words when it has them, searched one at a time
  const trades = s.icp?.trades ?? []
  const plan = await planLeadQueries(b, s, d, { keywords: trades.length ? trades : f.keywords, trades, platforms: f.platforms, customer: customerBlock(b, s), examples: s.icp?.examples ?? [], card: icpKey(s) })
  d.plan = plan
  if (!plan.queries.length) { if (launches.length) o.searched(); return checkSites([...queued, ...launches]) }
  o.searched()
  const seen = new Set([...queued, ...launches].map(x => x.domain))
  const pool: Found[] = [...queued, ...launches]
  // A failed question is only reported on the page when every question failed (one hiccup isn't
  // the user's problem); it counts as an empty try, so one that keeps failing is replaced
  const failures: string[] = []
  let asked = 0
  for (const q of plan.queries) {
    if (meter.dataforseo >= DFS_CAP) { console.log(`[lead-agent] DataForSEO cap of $${DFS_CAP} reached, “${q.q}” waits for the next search`); break }
    asked += 1
    const rows = await askQuery(q, s.country, meter).catch(e => {
      console.error(`[lead-agent] ${q.kind} “${q.q}” failed: ${e instanceof Error ? e.message : e}`)
      failures.push(e instanceof DfsBusyError ? `“${q.q}”: Google didn’t answer (a hiccup on DataForSEO’s side)` : `“${q.q}”: ${e instanceof Error ? e.message : 'failed'}`)
      q.empty += 1
      return null
    })
    if (!rows) continue
    q.page += 1
    // A marketplace or social page is kept only when it's one seller's page (an Etsy shop, an Instagram account)
    const found = rows.filter(x => fresh(x.domain) && !seen.has(x.domain) && (!!x.profile || ownSite(x.domain)))
    found.forEach(x => seen.add(x.domain))
    q.empty = found.length ? 0 : q.empty + 1
    pool.push(...found)
    console.log(`[lead-agent] ${q.kind} “${q.q}”: ${rows.length} back, ${found.length} new${found[0] ? `, e.g. ${found.slice(0, 3).map(x => x.domain).join(', ')}` : ''}`)
  }
  // How big each site is: estimated visits from Google, one call for all; big sites aren't small businesses
  const unmeasured = pool.filter(x => x.visits === undefined && !x.profile).map(x => x.domain)
  if (unmeasured.length) {
    const v = await siteVisits(unmeasured, s.country, meter).catch(e => { console.error(`[lead-agent] site visits failed: ${e instanceof Error ? e.message : e}`); return null })
    if (v) for (const x of pool) if (x.visits === undefined) x.visits = v.get(x.domain) ?? null
  }
  const small = mix(pool.filter(x => (x.visits ?? 0) <= BIG_VISITS))
  console.log(`[lead-agent] companies: ${pool.length} new sites · ${pool.length - small.length} too big (over ${BIG_VISITS.toLocaleString('en')} visits a month)`)
  if (asked && failures.length === asked) warn(`Companies: every search failed this time (${failures.join('; ')}). It tries again on the next search.`)
  else if (!pool.length) warn(`Companies: DataForSEO found no new sites this time (${plan.queries.map(q => `“${q.q}”`).join(', ')}). The weak searches are replaced on the next run.`)
  o.rest(small.slice(o.limit))
  return checkSites(small.slice(0, o.limit))
}

/** Takes turns between the questions, so one that brought back many sites doesn't fill the whole check. */
function mix(list: WaitingSite[]): WaitingSite[] {
  const groups = new Map<string, WaitingSite[]>()
  for (const x of list) groups.set(x.queryId ?? '', [...(groups.get(x.queryId ?? '') ?? []), x])
  const out: WaitingSite[] = []
  for (let i = 0; out.length < list.length; i++) for (const g of groups.values()) if (g[i]) out.push(g[i])
  return out
}

/**
 * A Google search with operators, made simpler when DataForSEO's Google errors on it ("Internal SE
 * Server Error" comes back for some operator mixes): first without the inurl: / intitle: / -site: parts,
 * then as plain words.
 */
async function googleWithFallback(q: string, country: string, meter: UsageMeter, depth: number) {
  // A site: that says where to look (site:etsy.com/shop) stays; -site:, inurl: and the like go
  const noOps = q.replace(/-site:\S+/gi, ' ').replace(/\b(inurl|intitle|intext|allinurl|allintitle):\S+/gi, ' ').replace(/\s+/g, ' ').trim()
  const where = noOps.match(/(?:^|\s)(site:\S+)/i)?.[1]
  const words = noOps.replace(/(?:^|\s)site:\S+/gi, ' ').replace(/["“”]/g, ' ').replace(/\b(OR|AND)\b/g, ' ').split(/\s+/).filter(Boolean).slice(0, 6)
  const plain = [where, ...words].filter(Boolean).join(' ')
  const tries = [...new Set([q, noOps, plain])].filter(Boolean)
  for (let i = 0; ; i++) {
    try {
      return await googleResults(tries[i], country, meter, { depth })
    } catch (e) {
      if (!(e instanceof DfsBusyError) || i === tries.length - 1) throw e
      console.log(`[lead-agent] google “${tries[i]}” failed, trying “${tries[i + 1]}”`)
    }
  }
}

// Help articles, docs and forums about a platform, not a business selling things ("Remove Powered by Shopify")
const HELP_PAGE = /\/(help|support|docs?|documentation|kb|knowledge-?base|community|forums?|threads?|questions|tutorials?|how-to|faq)(\/|$)|^https?:\/\/(help|support|docs|community|forum)\./i
const HELP_TITLE = /^(how to|how do i|remove|hide|edit|change|fix|setting up|tutorial)\b/i

/** Asks DataForSEO one question from the plan, for its next page. */
async function askQuery(q: LeadQuery, country: string, meter: UsageMeter): Promise<WaitingSite[]> {
  if (q.kind === 'google') {
    // Google's live results have no "page 2": each search reads 20 deeper (up to 100), and sites
    // already checked are dropped as known
    // Searches of one platform's pages (site:…) read 50 deep: most results are listings, few are sellers' own pages
    const step = /^site:/i.test(q.q) ? 50 : 20
    const rows = await googleWithFallback(q.q, country, meter, Math.min(100, step * (q.page + 1)))
    const byDomain = new Map<string, WaitingSite>()
    for (const r of rows) {
      // A seller's page on a marketplace or social network is kept by its own link, not the site's name
      const page = profileOf(r.url)
      if (page) {
        if (!byDomain.has(page.key)) byDomain.set(page.key, { domain: page.key, name: r.title.split(/\s[|–•(-]\s?|\s\(@/)[0].trim().slice(0, 60) || page.handle, about: [r.title, r.description].filter(Boolean).join(' · '), from: `${page.platform} page`, queryId: q.id, profile: page.platform })
        continue
      }
      const domain = domainOf(r.domain || r.url)
      if (!domain || byDomain.has(domain) || HELP_PAGE.test(r.url) || HELP_TITLE.test(r.title)) continue
      byDomain.set(domain, { domain, name: r.title.split(/\s[|–-]\s/)[0].slice(0, 60) || domain, about: [r.title, r.description].filter(Boolean).join(' · '), from: 'Google search', queryId: q.id })
    }
    return [...byDomain.values()]
  }
  if (q.kind === 'stores') {
    const platforms = q.platforms ?? []
    const rows = await storesByPlatform(platforms, country, meter, { limit: 50, offset: q.page * 50, keywords: q.q.split(',').map(w => w.trim()).filter(Boolean) })
    return rows.map(x => ({ domain: x.domain, name: x.title.split(/\s[|–-]\s/)[0].slice(0, 60) || x.domain, about: [x.title, x.description].filter(Boolean).join(' · '), socials: socialsIn(x.socials.join(' ')), email: x.emails.find(e => e.endsWith(x.domain)) ?? x.emails[0], from: platforms.length ? `${platforms.join(' / ')} store` : 'website', queryId: q.id }))
  }
  const rows = await similarSites(q.q, country, meter, { limit: 30, offset: q.page * 30 })
  return rows.map(x => ({ domain: x.domain, name: x.domain, from: `like ${q.q}`, queryId: q.id, ...(x.visits === null ? {} : { visits: Math.round(x.visits) }) }))
}

/** Reads each site for free (home page, store facts) and turns it into a candidate for the AI check. */
async function checkSites(all: WaitingSite[]): Promise<Candidate[]> {
  // Seller pages (Etsy shops, Instagram accounts…) can't be read (those sites block it) and have no
  // email: they're judged from what Google shows, scored like posts, and get a message to send by hand
  const pages: Candidate[] = all.filter(x => x.profile && !NOT_A_FIT.test(`${x.name} ${x.about ?? ''}`)).map(x => ({
    source: 'profile' as const,
    url: `https://${x.domain}`,
    title: x.name,
    snippet: [`${x.profile} page`, (x.about ?? '').slice(0, 300)].filter(Boolean).join(' · '),
    queryId: x.queryId,
  }))
  const list = all.filter(x => !x.profile)
  if (pages.length) console.log(`[lead-agent] seller pages: ${pages.length} (${[...new Set(all.filter(x => x.profile).map(x => x.profile))].join(', ')})`)
  if (!list.length) return pages

  // Every site is read for free: its home page (title, description, text, social links) and, for
  // online stores, its public product list (what it sells, how many products, when it last added one)
  const read = await inBatches(list, 8, async c => {
    const [page, store] = await Promise.all([aboutSite(c.domain), storeFacts(c.domain).catch(() => null)])
    // Who does their marketing: careers, team and blog pages (only for sites that answered)
    const team = page.html ? await marketingFacts(c.domain, page.html).catch(() => null) : null
    return { page, store, team }
  })
  const checked = list.map((c, i) => ({ c, text: [c.about, read[i].page.text].filter(Boolean).join(' · '), socials: c.socials?.length ? c.socials : read[i].page.socials, page: read[i].page.page, store: read[i].store, team: read[i].team,
    siteName: read[i].page.name }))
  // Big PR / B2B / consulting firms aren't small-business buyers: don't spend AI on them
  const small = checked.filter(x => !NOT_A_FIT.test(`${x.c.name} ${x.text}`))
  console.log(`[lead-agent] companies: ${list.length} found · ${checked.length - small.length} big or B2B dropped · ${small.filter(x => x.store).length} with a readable product list · ${Math.min(small.length, COMPANY_CHECK)} to the AI check`)
  return [...pages, ...small
    .slice(0, COMPANY_CHECK)
    .map(({ c, text, socials, page, store, team, siteName }) => ({
      source: 'company' as const,
      url: `https://${c.domain}`,
      // A launch post's title can read like a sentence ("I made a benchmark…"): use the site's own name then
      // …and a site found by "sites like" comes with only its domain
      // …and a Google result's title is often a blog post or page on the site ("The History of Handmade Jewelry"), not its name
      title: siteName && (c.name === c.domain || c.from === 'Google search' || (c.from.startsWith('Launched') && (c.name.split(/\s+/).length > 4 || /^(i|we|my|our)\b/i.test(c.name)))) ? siteName : c.name,
      launch: c.from.startsWith('Launched'),
      // What the user sees on the card: the store facts and social links first, then their own words
      snippet: [c.from.startsWith('Launched') ? c.from : null, store ? storeLine(store) : null, team?.hiring.length ? `Hiring: ${team.hiring.join(', ')}` : null, socials.length ? `Links to ${socials.join(', ')}` : 'No social links on their home page', text.slice(0, 200) || 'no description on their home page', `website ${c.domain}`].filter(Boolean).join(' · '),
      website: c.domain,
      email: c.email,
      judge: judgeText(c.name, c.domain, text, page, socials, store, team, c.from, c.visits),
      queryId: c.queryId,
    }))]
}

/** Everything the AI looks at for one company, in a fixed order. */
function judgeText(name: string, domain: string, about: string, page: string, socials: string[], store: StoreFacts | null, team: MarketingFacts | null, from: string, visits?: number | null): string {
  return [
    `${name} (${domain})`,
    `Found: ${from}`,
    `Who does their marketing: ${team ? marketingLine(team) : 'unknown (site not read)'}`,
    store
      ? `Online store: ${store.platform}, ${store.products}${store.more ? '+' : ''} products${store.types.length ? `; sells: ${store.types.join(', ')}` : ''}${store.examples.length ? `; e.g. ${store.examples.join(', ')}` : ''}${store.newestDays === null ? '' : `; newest product added ${store.newestDays} days ago`}`
      : 'No public product list (not a Shopify / WooCommerce store we could read)',
    `Social links on the site: ${socials.join(', ') || 'none'}`,
    `Visits from Google a month (estimate): ${visits === undefined || visits === null ? 'unknown' : visits === 0 ? 'too few to measure' : `about ${visits.toLocaleString('en')}`}`,
    `Title and description: ${about.slice(0, 250) || 'none'}`,
    `Page text: ${page.slice(0, 600) || 'none'}`,
  ].join('\n')
}

/**
 * The AI's check of each company, as separate yes/no answers so it's clear which part failed:
 * the right trade, small, still active, and a need for help with social posts. Only all-yes are
 * kept; the score orders them.
 */
interface CompanyCheck extends Scored { rival?: boolean; trade?: boolean; small?: boolean; active?: boolean | null; need?: boolean; diy?: boolean | null; reach?: boolean | null }
async function judgeCompanies(b: BrandContext, s: LeadSettings, list: Candidate[], examples: { kept: string[]; skipped: string[] } = { kept: [], skipped: [] }): Promise<CompanyCheck[]> {
  if (!list.length) return []
  // The owner's own choices so far: the clearest picture of a good lead there is
  const owner = examples.kept.length || examples.skipped.length ? `
The owner's choices so far (judge new businesses the same way):
Approved: ${examples.kept.join(' | ') || 'none yet'}
Skipped: ${examples.skipped.join(' | ') || 'none yet'}
` : ''
  const raw = await callAI({
    feature: 'lead-agent',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 4000,
    system: 'You check whether businesses are the right customers for a product. Judge only from the facts given. Return only a raw JSON array.',
    prompt: `${leadBrandBlock(b, s.useBrand !== false)}
${customerBlock(b, s)}
Companies we look for: ${s.companyQuery.trim() || s.icp?.who || s.customer || 'not given'}
${owner}
For each business answer:
- rival: true if it sells a product or service that does the same job as ${b.name} (${b.usp ? `${b.usp}; ` : ''}a competitor, a similar tool or app, or an agency selling the same service). A competitor is never a customer, however well it matches otherwise.
- trade: true only if what it actually sells or does (product list first, then its own words) matches "Companies we look for" or one of the kinds of business we search for. A passing mention of a word is not enough; a law firm, estate agent, software company, marketplace or directory is false.
- small: true for a one-person to small team business (a product list under about 500 items, under about 20,000 visits a month, no corporate wording). False for big brands, chains, agencies with many offices.
- active: true if it looks alive (a product added in the last 6 months, or a current-looking site); false if clearly abandoned (newest product over a year ago, "closed", "coming soon" only); null if unknown.
- need: true if it would plausibly want what ${b.name} offers now, judged against the ideal customer above. False if it shows any "NOT a fit" sign.
- diy: who does their marketing. true if the founder or a tiny team seems to do it themselves (no marketing roles on careers or team pages, their own X account (the founder's or the company's) or a founder's LinkedIn, a quiet blog or social links but little posting); false if they have a marketing team or agency, are hiring marketers or content people, or work with influencers / creators; null if unknown.
- score: 1-10, how good a lead it is overall.
- why: one plain sentence a non-technical owner understands, naming what they sell.

${list.map((c, i) => `[${i}]\n${c.judge ?? `${c.title}\n${c.snippet}`}`).join('\n\n')}

- reach: does ${b.name} help this business reach ITS OWN buyers? Think about who they sell to. For a social media tool: true when their buyers find products on social media (consumers, creators, small businesses, marketers, founders, everyday software users); false when they sell to developers, engineers, hardware makers, IT or enterprise buyers, or investors who don't pick products from social posts. Judge the same way for any other kind of product. null if unknown.

Return [{"i":0,"rival":false,"trade":true,"small":true,"active":true,"need":true,"diy":true,"reach":true,"score":8,"why":"..."}]`,
  })
  return (parseJsonLoose<CompanyCheck[]>(raw, 'array') ?? []).filter(x => typeof x.i === 'number' && x.i >= 0 && x.i < list.length)
}

/** Which check a company failed, for the run summary. */
function failed(x: CompanyCheck): 'rival' | 'trade' | 'small' | 'active' | 'need' | 'diy' | 'reach' | null {
  if (x.rival === true) return 'rival'
  if (x.trade === false) return 'trade'
  if (x.small === false) return 'small'
  if (x.active === false) return 'active'
  if (x.need === false) return 'need'
  if (x.diy === false) return 'diy'
  if (x.reach === false) return 'reach'
  return null
}

// ── Where to look, picked from the brand ──────────────────────────────────────

export interface SourcePick { local: boolean; companies: boolean; reddit: boolean; localQuery: string; companyQuery: string; why: string }

/** Which sources suit this brand's buyers, and who to look for in each. */
export async function pickSources(b: BrandContext, s: LeadSettings): Promise<SourcePick> {
  const raw = await withAIContext({ brandId: b.id, moduleType: 'lead-agent', websiteUrl: b.websiteUrl }, () => callAI({
    feature: 'lead-agent',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 500,
    system: 'You decide where a small business should look for customers. Return only a raw JSON object.',
    prompt: `${leadBrandBlock(b, s.useBrand !== false)}
${customerBlock(b, s)}
Country: ${s.country === 'ANY' ? 'anywhere (no one country)' : s.country}

Sources:
- local: businesses on Google Maps (shops, salons, cafés, clinics). Right when the buyers are local businesses with a street address.
- companies: online businesses found by what they sell (online stores, brands, agencies), and software products their founders just launched (Hacker News "Show HN"). Right when the buyers are companies or founders that live online.
- reddit: Reddit and Hacker News posts where people ask for a tool like this. Right when buyers are individuals, creators, founders or developers who ask online.

Turn on the 1-2 sources that fit the buyers best (at least one). Return
{"local":bool,"companies":bool,"reddit":bool,"localQuery":"...","companyQuery":"...","why":"..."}
- localQuery: a Google Maps search like "cafés in Pune" (a kind of business + a city${s.country === 'ANY' ? '' : ` in ${s.country}`}), or "" if local is off
- companyQuery: who to look for, in plain words, like "small fashion and beauty online stores, 1-50 people", or "" if companies is off
- why: one short sentence for the user, e.g. "Your buyers are small online brands, so we look for online stores and Reddit posts." No brand name at the start.`,
  }))
  const j = parseJsonLoose<Partial<SourcePick>>(raw, 'object') ?? {}
  const pick: SourcePick = {
    local: j.local === true, companies: j.companies === true, reddit: j.reddit === true,
    localQuery: typeof j.localQuery === 'string' ? j.localQuery.trim().slice(0, 120) : '',
    companyQuery: typeof j.companyQuery === 'string' ? j.companyQuery.trim().slice(0, 200) : '',
    why: typeof j.why === 'string' ? j.why.trim().slice(0, 240) : '',
  }
  // Nothing sensible came back: keep what's set
  if (!pick.local && !pick.companies && !pick.reddit) return { ...pick, local: s.sources.local, companies: s.sources.companies, reddit: s.sources.reddit, why: '' }
  if (pick.local && !pick.localQuery) pick.localQuery = s.localQuery
  return pick
}

async function findLocal(query: string, country: string, meter: UsageMeter): Promise<Candidate[]> {
  if (!searchDataReady() || !query.trim()) return []
  const list = await mapsBusinesses(query, country, meter, Math.max(10, PER_SOURCE * 4))
  return list
    .filter(x => !x.domain || (x.rating !== null && x.rating < 4.2) || (x.reviews !== null && x.reviews < 30))
    .slice(0, 20)
    .map(x => ({
      source: 'local' as const,
      url: x.mapsUrl ?? x.url ?? `https://www.google.com/maps/search/${encodeURIComponent(x.title)}`,
      title: x.title,
      snippet: [
        x.rating !== null ? `Rated ${x.rating}${x.reviews !== null ? ` from ${x.reviews} reviews` : ''}` : 'No rating yet',
        x.domain ? `website ${x.domain}` : 'no website',
        x.category, x.address,
      ].filter(Boolean).join(' · '),
      website: x.domain ?? undefined,
      phone: x.phone ?? undefined,
      rating: x.rating,
    }))
}

// ── Scoring and drafting ──────────────────────────────────────────────────────

interface Scored { i: number; score: number; why: string; company?: string; website?: string }

async function scoreCandidates(b: BrandContext, s: LeadSettings, list: Candidate[]): Promise<Scored[]> {
  if (!list.length) return []
  const lines = list.map((c, i) => `[${i}] (${c.source}) ${c.title}\n${c.snippet.slice(0, 350)}`).join('\n\n')
  const raw = await callAI({
    feature: 'lead-agent',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 2500,
    system: 'You qualify sales leads. Be strict: most posts are not buyers. Return only a raw JSON array.',
    prompt: `${leadBrandBlock(b, s.useBrand !== false)}
${customerBlock(b, s)}${s.sources.companies && s.companyQuery.trim() ? `
Companies we look for: ${s.companyQuery.trim()}` : ''}

Score each item 1-10 for how likely this person or business would want ${b.name} now:
- anyone selling or promoting a product or service like ${b.name} (a competitor, a similar tool, its maker or reseller) is 1, whatever the source
- reddit / forum: 8-10 only if they are asking for a tool or help that ${b.name} gives; 1-4 for news, rants, promotions, or other products' launches
- review: an unhappy customer of a competitor; high only if their complaint is something ${b.name} solves
- local: a business that matches the ideal customer and shows a need (no website, low rating, few reviews)
- profile: a seller's own page on a marketplace or social network (Etsy shop, Instagram, Facebook page, TikTok, eBay or Amazon store…), described only by Google's title and text. 7-10 when it is clearly one small seller of what the ideal customer sells; 4-6 when it's likely but unclear; 1-3 for big brands, resellers, fan, news or meme accounts, and personal accounts that don't sell
- company: a business, described by its own home page and the social networks it links to. Anything matching "NOT a fit" above is 1-3. First check its trade against "Companies we look for": a different trade (e.g. real estate when we look for Etsy sellers) is 1-3, however active it is on social media. Then 8-10: a small business (a shop, an online store, a brand, a small agency) that matches the ideal customer and clearly posts or should post on social media, e.g. it links to Instagram or Facebook. 4-6: small but unclear need. 1-3: big or B2B firms, PR, consulting, software companies, directories, marketplaces, or no description at all

${lines}

Return [{"i":0,"score":8,"why":"one plain sentence a non-technical founder understands","company":"company name if the text names one, else omit","website":"their website domain if the text shows it, else omit"}]`,
  })
  return (parseJsonLoose<Scored[]>(raw, 'array') ?? []).filter(x => typeof x.i === 'number' && x.i >= 0 && x.i < list.length)
}

/** A mailto: address on the site's home, contact or about page (no lookup service needed). */
export async function emailFromWebsite(domain: string): Promise<string | null> {
  for (const path of ['', '/contact', '/about']) {
    const html = await fetchHtml(`https://${domain}${path}`)
    const m = html?.match(/mailto:([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)
    if (m) return m[1].toLowerCase()
  }
  return null
}

async function draftMessages(b: BrandContext, s: LeadSettings, leads: Lead[]): Promise<Map<string, { subject?: string; body?: string; reply?: string }>> {
  const out = new Map<string, { subject?: string; body?: string; reply?: string }>()
  if (!leads.length) return out
  const lines = leads.map((l, i) => {
    const kind = l.source === 'reddit' || l.source === 'forum' ? 'FORUM REPLY' : l.source === 'profile' ? `DIRECT MESSAGE (on ${profileOf(l.url)?.platform ?? 'their page'})` : 'EMAIL'
    return `[${i}] ${kind} · ${l.source} · ${l.title}${l.name ? ` · contact: ${l.name}` : ''}\nWhat we know: ${l.snippet.slice(0, 350)}\nWhy a fit: ${l.why}`
  }).join('\n\n')
  const raw = await callAI({
    feature: 'lead-agent',
    model: 'claude-sonnet-4-6',
    maxTokens: 4000,
    system: 'You write short, personal outreach that gets replies. Plain words, no hype, no buzzwords, no emojis. Return only a raw JSON array.',
    prompt: `${leadBrandBlock(b, s.useBrand !== false)}
${customerBlock(b, s)}

For each item write:
- EMAIL: "subject" (3-6 words, lower-key, mentions their situation, never clickbait) and "body" (under 90 words). Start with "Hi <first name>," if a person's name is known, else "Hi,". First line: the specific thing you noticed (their review, post or business detail). Then one sentence on how ${b.name} helps with exactly that. End with ONE small ask (e.g. "Want me to make 3 free examples for you?"). Sign off with "${b.name}". No em dashes. No links, no opt-out line (added automatically).
- DIRECT MESSAGE: "reply" (under 70 words), a message to send them on that platform (an Etsy message, an Instagram or Facebook DM). Start with "Hi," or their shop name. One specific thing you noticed about their shop or page, one sentence on how ${b.name} helps, one small ask. Friendly, no links, no sales tone, sign off with "${b.name}".
- FORUM REPLY: "reply" (under 120 words). Answer their question helpfully first with practical advice that works without any product. Then mention ${b.name} honestly as one option and say you work on it. No links, no sales tone.

${lines}

Return [{"i":0,"subject":"...","body":"..."}] or [{"i":1,"reply":"..."}] (FORUM REPLY and DIRECT MESSAGE both use "reply")`,
  })
  for (const x of parseJsonLoose<{ i: number; subject?: string; body?: string; reply?: string }[]>(raw, 'array') ?? []) {
    if (typeof x.i === 'number' && leads[x.i]) out.set(leads[x.i].id, x)
  }
  return out
}

/**
 * The user added an email to a good lead that had none, or opened a lead whose email isn't written
 * yet ("Review email"): save the address and write the first email.
 */
export async function addLeadEmail(brandId: string, leadId: string, email: string): Promise<{ ok: boolean; message: string }> {
  const b = await loadBrandContext(brandId)
  if (!b) return { ok: false, message: 'Brand not found.' }
  const fallback = leadFallback(b)
  const d = (await readLeadData(brandId)) ?? fallback()
  const lead = d.leads.find(l => l.id === leadId)
  if (!lead) return { ok: false, message: 'Lead not found.' }
  if (lead.status !== 'needs_contact' && lead.status !== 'ready') return { ok: false, message: 'Already handled.' }
  const draft = lead.draft ?? await withAIContext({ brandId, moduleType: 'lead-agent', websiteUrl: b.websiteUrl }, async () => {
    const x = (await draftMessages(b, d.settings, [{ ...lead, email }])).get(lead.id)
    return x?.subject && x.body ? { subject: stripEmDashes(x.subject), body: stripEmDashes(x.body) } : undefined
  })
  if (!draft) return { ok: false, message: 'Couldn’t write the email. Try again.' }
  await updateLeadData(brandId, fallback, x => {
    const l = x.leads.find(y => y.id === leadId)
    if (l) Object.assign(l, { email, emailVerified: email === l.email ? l.emailVerified : false, draft, status: 'ready' })
  })
  return { ok: true, message: 'Email written.' }
}

/** Writes the reply to a forum post, or the message for a seller page, when the user opens it. */
export async function addLeadReply(brandId: string, leadId: string): Promise<{ ok: boolean; message: string }> {
  const b = await loadBrandContext(brandId)
  if (!b) return { ok: false, message: 'Brand not found.' }
  const fallback = leadFallback(b)
  const d = (await readLeadData(brandId)) ?? fallback()
  const lead = d.leads.find(l => l.id === leadId)
  if (!lead) return { ok: false, message: 'Lead not found.' }
  if (lead.reply) return { ok: true, message: 'Already written.' }
  if (lead.status !== 'ready' && lead.status !== 'needs_contact') return { ok: false, message: 'Already handled.' }
  const x = await withAIContext({ brandId, moduleType: 'lead-agent', websiteUrl: b.websiteUrl }, async () =>
    (await draftMessages(b, d.settings, [lead]).catch(() => new Map<string, { reply?: string }>())).get(lead.id))
  if (!x?.reply) return { ok: false, message: 'Couldn’t write the reply. Try again.' }
  await updateLeadData(brandId, fallback, y => {
    const l = y.leads.find(z => z.id === leadId)
    if (l && !l.reply) Object.assign(l, { reply: x.reply, status: 'ready' })
  })
  return { ok: true, message: 'Reply written.' }
}

/**
 * "Use anyway" on a find the checks didn't keep: it becomes a lead. A forum post gets its reply
 * drafted; a business gets an email from its own pages (free) or Hunter, then its email drafted.
 */
export async function useMaybe(brandId: string, id: string): Promise<{ ok: boolean; message: string }> {
  const b = await loadBrandContext(brandId)
  if (!b) return { ok: false, message: 'Brand not found.' }
  const fallback = leadFallback(b)
  const d = (await readLeadData(brandId)) ?? fallback()
  const m = d.maybe?.find(x => x.id === id)
  if (!m) return { ok: false, message: 'That one is gone. Refresh the page.' }
  const lead: Lead = {
    id: m.id, source: m.source, foundAt: new Date().toISOString(), title: m.title, url: m.url, snippet: m.snippet,
    name: m.name, website: m.website, score: m.score, why: m.why, status: 'needs_contact', followupsSent: 0,
    ...(m.email ? { email: m.email, emailVerified: false } : {}),
  }
  const forum = m.source === 'reddit' || m.source === 'forum' || m.source === 'profile'
  return withAIContext({ brandId, moduleType: 'lead-agent', websiteUrl: b.websiteUrl }, async () => {
    // A post or seller page: its reply is written when the user opens it
    if (forum) lead.status = 'ready'
    await updateLeadData(brandId, fallback, y => {
      y.maybe = (y.maybe ?? []).filter(z => z.id !== id)
      if (!y.leads.some(l => l.id === id)) y.leads = [lead, ...y.leads]
    })
    if (forum) return { ok: true, message: 'Added. Open it to see the reply.' }
    // A business: its own pages first, then one Hunter lookup
    let email = lead.email ?? (lead.website ? await contactEmail(lead.website).catch(() => null) : null)
    if (!email && lead.website && hunterConfigured()) {
      const meter = newMeter()
      email = (await findEmail(lead.website, undefined, meter).catch(() => null))?.email ?? null
      await addUsage(brandId, meter, 'Lead Agent').catch(() => {})
    }
    if (!email) return { ok: true, message: 'Added. No email found: paste one if you know it.' }
    const r = await addLeadEmail(brandId, id, email)
    return { ok: true, message: r.ok ? 'Added, with an email to check.' : r.message }
  })
}

// ── The run ───────────────────────────────────────────────────────────────────

export interface RunResult { ok: boolean; summary: string; error?: string }

// more: "Show 10 more" for one tab: no reply check or sending, just the next finds (waiting ones
// first, then a new search) through the same checks, scoring and drafting
export async function runLeadAgent(brandId: string, opts: { manual?: boolean; findOnly?: boolean; deadline?: number; more?: 'email' | 'community' } = {}): Promise<RunResult> {
  const b = await loadBrandContext(brandId)
  if (!b) return { ok: false, summary: '', error: 'Brand not found.' }
  const fallback = leadFallback(b)
  const demo = agentsDemo()
  setDemoContext({ brand: b.name, domain: b.domain, competitors: b.competitors, seeds: (b.keywords ?? '').split(',').map(x => x.trim()).filter(Boolean), round: undefined })
  // Switching between demo and real data: start the lead list afresh (settings are kept)
  const saved = await readLeadData(brandId)
  if (saved && !!saved.demo !== demo) {
    await updateLeadData(brandId, fallback, x => { x.leads = []; x.lists = []; x.sentLog = []; x.approvedCount = 0; x.rejected = []; x.waiting = undefined; x.maybe = []; x.lastError = null; x.demo = demo })
  }
  const d = (await readLeadData(brandId)) ?? fallback()
  d.demo = demo
  // Daily search off: the daily run still checks replies, sends follow-ups and sends what you
  // approved (your own lists go out over several days), but doesn't look for new leads
  const find = d.settings.enabled || !!opts.manual || !!opts.more
  const more = opts.more
  // "Find leads" and "Show 10 more" only search: replies, follow-ups and queued emails are the daily run's job
  const mailOff = !!more || !!opts.findOnly
  // Which sources this run searches: all that are on, or just one tab's for "Show 10 more"
  const use = {
    reddit: d.settings.sources.reddit && more !== 'email',
    local: d.settings.sources.local && !more,
    companies: d.settings.sources.companies && more !== 'community',
  }
  // Searches done so far: each one starts where the last stopped
  const turn = { sites: d.cursor?.sites ?? 0, phrase: d.cursor?.phrase ?? 0 }
  let searchedSites = false, searchedPosts = false
  let leftSites: WaitingSite[] = d.waiting?.sites ?? []
  let leftPosts: WaitingPost[] = d.waiting?.posts ?? []
  if (!find && !d.leads.some(l => l.status === 'queued' || l.status === 'sent')) return { ok: true, summary: 'Agent is off.' }
  const deadline = opts.deadline ?? Date.now() + 240_000
  const s = d.settings
  // Demo mode with no Google Maps search set: use a made-up one, or the Email tab stays empty
  const localQuery = s.localQuery.trim() || (demo ? demoLocalQuery(s.country) : '')
  const meter = newMeter()
  const notes: string[] = []
  const errors: string[] = []

  const n = (x: number, one: string, many = `${one}s`) => `${x} ${x === 1 ? one : many}`
  const pr = new Progress(brandId, 'lead', more ? 'Finding more leads' : 'Lead Agent run', [
    ...(mailOff ? [] : [
      { key: 'replies', label: 'Checking replies', hint: 'Replies to emails you sent, and follow-ups that are due' },
      { key: 'queued', label: 'Sending queued emails', hint: 'Approved emails that waited for today\'s limit' },
    ]),
    ...(find && use.reddit ? [
      { key: 'queries', label: 'Picking search phrases', hint: 'How your buyers ask for help online' },
      { key: 'reddit', label: 'Searching Reddit & HN', hint: 'People asking for a tool like yours' },
    ] : []),
    ...(find && use.local ? [{ key: 'local', label: 'Searching Google Maps', hint: `“${localQuery}”: businesses with no website or low ratings` }] : []),
    ...(find && use.companies ? [{ key: 'companies', label: 'Finding companies like your customers', hint: s.icp?.kind === 'saas' ? 'New launches on Hacker News and websites that match your customer' : s.companyQuery ? `Online stores and small businesses: ${s.companyQuery}` : 'Online stores and small businesses that match your customer' }] : []),
    ...(find ? [
      { key: 'score', label: 'Scoring leads', hint: 'How well each one fits your product' },
      { key: 'emails', label: 'Finding emails', hint: 'Looked up with Hunter' },
      ...(s.mode === 'auto' && d.approvedCount >= 20 ? [{ key: 'drafts', label: 'Writing emails', hint: 'Auto mode: emails for the strongest leads, sent without asking' }] : []),
    ] : []),
  ])

  return withAIContext({ brandId, moduleType: 'lead-agent', websiteUrl: b.websiteUrl }, async () => {
    // 1. Replies and follow-ups ("Find leads" and "Show 10 more" skip this and the sending below)
    if (!mailOff) pr.set('replies', 'running')
    const sentBefore = d.leads.filter(l => l.status === 'sent').length
    const { patches, replies, error: gmailError } = mailOff ? { patches: new Map<string, Partial<Lead>>(), replies: [] as Lead[], error: undefined } : await processSentLeads(brandId, b, d, deadline)
    if (gmailError && d.leads.some(l => l.status === 'sent')) errors.push(`Gmail: ${gmailError}`)
    if (replies.length) notes.push(`${replies.length} new repl${replies.length === 1 ? 'y' : 'ies'}`)
    const followups = [...patches.values()].filter(x => x.followupsSent !== undefined && !x.status).length
    if (!mailOff) pr.set('replies', gmailError && sentBefore ? 'error' : 'done', sentBefore
      ? { detail: `${n(replies.length, 'new reply', 'new replies')}${followups ? ` · ${n(followups, 'follow-up')}` : ''}`, note: `${n(sentBefore, 'sent email')} checked.` }
      : 'Nothing sent yet')

    // 2. Approved emails that waited for today's limit
    let sentNow = sentToday(d)
    const queued = d.leads.filter(x => x.status === 'queued').length
    const sentAtStart = sentNow
    if (!mailOff) pr.set('queued', queued ? 'running' : 'skipped', queued ? undefined : 'None waiting')
    for (const l of mailOff ? [] : d.leads.filter(x => x.status === 'queued')) {
      if (sentNow >= s.dailyLimit || Date.now() > deadline) break
      const p = await sendFirstEmail(brandId, l, s.followUpDays)
      patches.set(l.id, p)
      if (p.status === 'sent') { sentNow += 1; d.sentLog.push(p.sentAt!) }
    }

    if (queued && !mailOff) pr.set('queued', 'done', { detail: `${sentNow - sentAtStart} sent`, note: queued > sentNow - sentAtStart ? `${queued - (sentNow - sentAtStart)} wait for tomorrow's limit.` : undefined })

    // 3. Find new leads
    const known = new Set([...d.leads.map(l => l.id), ...(d.rejected ?? [])])
    let candidates: Candidate[] = []
    if (find) try {
      const queries = use.reddit ? await pr.step('queries', () => searchQueries(b, s, d), q => ({ detail: n(q.length, 'phrase'), items: q.slice(0, 4) })) : []
      // How many of each to check: a normal run checks PER_SOURCE posts and COMPANY_CHECK sites;
      // "Show 10 more" checks 10 of its tab
      const postLimit = more === 'community' ? 10 : PER_SOURCE
      const siteLimit = more === 'email' ? 10 : COMPANY_CHECK
      // Posts: waiting ones first ("Show 10 more"), then a new search on the next phrase
      const posts = async (): Promise<Candidate[]> => {
        const queuedPosts = more ? leftPosts.filter(x => !known.has(idOf(x.url))).map(x => ({ ...x } as Candidate)) : []
        if (queuedPosts.length >= postLimit) return queuedPosts
        searchedPosts = true
        return [...queuedPosts, ...await findReddit(queries, s.country, meter, turn.phrase, s.icp?.kind), ...await findHackerNews(queries, turn.phrase)]
      }
      // One failing source (e.g. a search error) shouldn't stop the others; it's reported on the page
      // DataForSEO's own hiccups ("Internal SE Server Error") get plain words: nothing for the user to fix
      const why = (e: unknown) => e instanceof DfsBusyError ? 'Google didn’t answer (a hiccup on DataForSEO’s side, nothing to fix). It tries again on the next search.' : e instanceof Error ? e.message : 'failed'
      const source = <T>(label: string, p: Promise<T[]>) => p.catch(e => { errors.push(`${label}: ${why(e)}`); return [] as T[] })
      const fresh = (x: Candidate) => !known.has(idOf(x.url))
      const found = await Promise.all([
        use.reddit ? source('Reddit search', pr.step('reddit', posts, r => ({ detail: `${r.filter(fresh).length} new posts`, items: r.filter(fresh).slice(0, 3).map(x => x.title) }))) : [],
        use.local ? source('Google Maps search', pr.step('local', () => findLocal(localQuery, s.country, meter), r => ({ detail: n(r.length, 'business', 'businesses'), items: r.slice(0, 3).map(x => x.title) }))) : [],
        use.companies ? source('Company search', pr.step('companies', () => findCompanies(b, s, d, known, meter, m => errors.push(m), {
          turn: turn.sites, limit: siteLimit, queue: more ? leftSites : [],
          searched: () => { searchedSites = true }, rest: r => { leftSites = r },
        }), r => ({ detail: n(r.length, 'company', 'companies'), items: r.slice(0, 3).map(x => x.title) }))) : [],
      ])
      // Up to 10 new finds from each source, so a busy one (often Reddit) can't crowd out the rest
      const seen = new Set<string>()
      const newOnes = found.map(list => list.filter(c => {
        if (known.has(idOf(c.url)) || seen.has(c.url)) return false
        seen.add(c.url)
        return true
      }))
      candidates = newOnes.flatMap(list => list.slice(0, list.some(c => c.source === 'company' || c.source === 'profile') ? siteLimit : postLimit))
      // Posts found but not checked this time wait for "Show 10 more"
      if (use.reddit) leftPosts = newOnes[0].slice(postLimit).map(c => ({ source: c.source, url: c.url, title: c.title, snippet: c.snippet, name: c.name }))
    } catch (e) {
      errors.push(e instanceof Error ? e.message : 'Search failed')
    }

    const fresh: Lead[] = []
    const rejected: string[] = []
    const newMaybe: MaybeLead[] = []
    if (candidates.length && Date.now() < deadline) {
      // Companies get the AI's separate yes/no checks; everything else the usual 1-10 score
      const idxCompany = candidates.map((c, i) => (c.source === 'company' ? i : -1)).filter(i => i >= 0)
      const idxOther = candidates.map((c, i) => (c.source !== 'company' ? i : -1)).filter(i => i >= 0)
      const [otherScores, companyChecks] = await pr.step('score', () => Promise.all([
        scoreCandidates(b, s, idxOther.map(i => candidates[i])).catch(() => [] as Scored[]),
        judgeCompanies(b, s, idxCompany.map(i => candidates[i]), ownerExamples(d)).catch(() => [] as CompanyCheck[]),
      ]))
      const companyBack = companyChecks.map(x => ({ ...x, i: idxCompany[x.i] }))
      const scored: Scored[] = [
        ...otherScores.map(x => ({ ...x, i: idxOther[x.i] })),
        // A company that fails any check can't be kept, whatever its score
        ...companyBack.map(x => (failed(x) ? { ...x, score: Math.min(x.score, 3) } : x)),
      ]
      const fails = { rival: 0, trade: 0, small: 0, active: 0, need: 0, diy: 0, reach: 0 }
      for (const x of companyBack) { const f = failed(x); if (f) fails[f] += 1 }
      const good = scored.filter(x => x.score >= (candidates[x.i].launch ? MIN_LAUNCH_SCORE : candidates[x.i].source === 'company' || candidates[x.i].source === 'profile' ? MIN_COMPANY_SCORE : MIN_SCORE)).sort((x, y) => y.score - x.score).slice(0, MAX_NEW_PER_RUN)
      // Demo mode: always keep a few made-up businesses with a website, so there are emails to approve
      // (Claude scores them strictly, and forum posts can fill the run)
      if (demo) {
        const emailable = (x: Scored) => (candidates[x.i].source === 'local' || candidates[x.i].source === 'company') && !!candidates[x.i].website
        const missing = DEMO_EMAIL_LEADS - good.filter(emailable).length
        if (missing > 0) good.push(...scored.filter(x => emailable(x) && x.score >= 4 && !good.includes(x)).sort((x, y) => y.score - x.score).slice(0, missing))
      }
      pr.set('score', 'done', { detail: `${good.length} of ${candidates.length} fit`, note: 'A good fit scores 7 or more out of 10.', items: good.slice(0, 3).map(g => candidates[g.i].title) })
      // Remember the ones that didn't make it so tomorrow's run doesn't pay to score them again
      const keptIdx = new Set(good.map(g => g.i))
      rejected.push(...scored.filter(x => !keptIdx.has(x.i)).map(x => idOf(candidates[x.i].url)))
      const now = new Date().toISOString()
      // The ones that came close go on the "maybe" list (companies the checks dropped, posts and
      // businesses scoring 4-6), so the user can still use one
      const REASON = { rival: 'Sells something like yours (a competitor)', trade: 'Sells something else', small: 'Looks too big', active: 'Doesn’t look active', need: 'Not a clear fit', diy: 'Has a marketing team or creators', reach: 'Their buyers aren’t reached this way' }
      for (const x of scored) {
        if (keptIdx.has(x.i)) continue
        const c = candidates[x.i]
        const f = c.source === 'company' ? failed(x as CompanyCheck) : null
        if (!f && x.score < 4) continue
        newMaybe.push({
          id: idOf(c.url), source: c.source, title: c.title, url: c.url, snippet: c.snippet, website: c.website, name: c.name, email: c.email,
          why: x.why, reason: f ? REASON[f] : `Scored ${x.score}/10`, score: x.score, at: now,
        })
      }
      // How each DataForSEO question did, for the next plan: sites checked and kept
      if (d.plan) {
        const byId = new Map(d.plan.queries.map(q => [q.id, q]))
        for (const x of companyBack) { const q = byId.get(candidates[x.i].queryId ?? ''); if (q) q.checked += 1 }
        for (const g of good) { const q = byId.get(candidates[g.i].queryId ?? ''); if (q) q.kept += 1 }
      }
      for (const g of good) {
        const c = candidates[g.i]
        const website = c.website || (g.website ? domainOf(g.website) : undefined)
        fresh.push({
          id: idOf(c.url), source: c.source, foundAt: now, title: c.title, url: c.url, snippet: c.snippet,
          name: c.name, company: g.company, website, phone: c.phone, rating: c.rating ?? null,
          score: g.score, why: g.why, status: 'needs_contact', followupsSent: 0, ...(c.queryId ? { queryId: c.queryId } : {}),
          ...(c.email ? { email: c.email, emailVerified: false } : {}),
        })
      }
      // Contact details for businesses (forum posters are answered on the post)
      const euBlocked = s.skipEU && EU.has(s.country)
      let lookups = 0
      pr.set('emails', 'running')
      // Free first: an email the business lists on its own home, contact or about page (read side by side)
      const needEmail = fresh.filter(l => l.source !== 'reddit' && l.source !== 'forum' && l.website && !l.email && !euBlocked)
      const listed = await inBatches(needEmail, 6, l => contactEmail(l.website!).catch(() => null))
      needEmail.forEach((l, i) => { if (listed[i]) { l.email = listed[i]!; l.emailVerified = false } })
      for (const l of fresh) {
        if (Date.now() > deadline) break
        if (l.source === 'reddit' || l.source === 'forum' || l.source === 'profile' || !l.website || euBlocked || l.email) continue
        const person = l.source === 'review' ? l.name : undefined
        // No email on their own pages: Hunter (1 credit per email found), for the best few only
        const found = lookups < PER_SOURCE && hunterConfigured() ? await findEmail(l.website, person, meter).catch(() => null) : null
        if (found) { lookups += 1; l.email = found.email; l.emailVerified = found.verified; if (found.name && l.source !== 'review') l.name = found.name }
      }
      const businesses = fresh.filter(l => l.source === 'review' || l.source === 'local' || l.source === 'company')
      if (!fresh.length) pr.set('emails', 'skipped', 'No good fits')
      else pr.set('emails', 'done', businesses.length
        ? { detail: `${businesses.filter(l => l.email).length} of ${businesses.length} found`, note: meter.hunterOut ? 'Hunter’s email credits are used up, so the rest have no email yet.' : euBlocked ? 'EU leads are not emailed (your setting).' : undefined }
        : { detail: 'Not needed', note: 'Only forum posts this time: you reply on the post.' })
      // Nothing is written during the search: replies, messages and emails are written when the user
      // opens the lead, except in auto mode, where the strong emails are sent without opening
      const autoDraft = s.mode === 'auto' && d.approvedCount >= 20
      const toDraft = fresh.filter(l => autoDraft && l.email && l.score >= 8 && l.source !== 'reddit' && l.source !== 'forum' && l.source !== 'profile')
      for (const l of fresh) if ((l.email && l.source !== 'reddit' && l.source !== 'forum') || l.source === 'reddit' || l.source === 'forum' || l.source === 'profile') l.status = 'ready'
      if (autoDraft && !toDraft.length) pr.set('drafts', 'skipped', 'None strong enough to send on their own')
      const drafts = Date.now() < deadline && toDraft.length ? await pr.step('drafts', () => draftMessages(b, s, toDraft), r => `${n(r.size, 'draft')} ready`).catch(() => new Map()) : new Map()
      for (const l of fresh) {
        const x = drafts.get(l.id)
        if (x?.reply) { l.reply = x.reply; l.status = 'ready' }
        else if (x?.subject && x.body && l.email) { l.draft = { subject: stripEmDashes(x.subject), body: stripEmDashes(x.body) }; l.status = 'ready' }
      }
      notes.push(`${fresh.length} new lead${fresh.length === 1 ? '' : 's'}`)
      // Say what the company search gave, so an empty Email tab isn't a mystery
      const checked = candidates.filter(c => c.source === 'company').length
      if (checked) {
        const fits = fresh.filter(l => l.source === 'company')
        const why = [fails.rival && `${fails.rival} competitor${fails.rival === 1 ? '' : 's'}`, fails.trade && `${fails.trade} wrong trade`, fails.small && `${fails.small} too big`, fails.active && `${fails.active} not active`, fails.need && `${fails.need} no clear need`, fails.diy && `${fails.diy} with a marketing team`, fails.reach && `${fails.reach} whose buyers aren’t reached this way`].filter(Boolean).join(', ')
        notes.push(`Companies: ${checked} checked${why ? ` (${why})` : ''}, ${fits.length} good fit${fits.length === 1 ? '' : 's'}${fits.length ? `, ${fits.filter(l => l.email).length} with an email` : ''}`)
      }
    } else if (find && !errors.length) {
      notes.push('no new leads')
      pr.set('score', 'skipped', 'Nothing new')
    }

    // 4. Auto mode: send strong email leads without asking once the user has approved 20
    const autoSend = s.mode === 'auto' && d.approvedCount >= 20
    if (autoSend) {
      for (const l of fresh.filter(x => x.status === 'ready' && x.email && x.draft && x.score >= 8)) {
        if (sentNow >= s.dailyLimit || Date.now() > deadline) break
        const p = await sendFirstEmail(brandId, l, s.followUpDays)
        Object.assign(l, p, { approvedBy: 'auto' })
        if (p.status === 'sent') { sentNow += 1; d.sentLog.push(p.sentAt!) }
      }
    }

    // Company leads still waiting in To do that don't match today's "Who to look for" (it may have
    // changed since they were found): moved to Skipped, where they can be brought back
    const tradeWords = d.companyFilters?.keywords ?? []
    const offTrade = new Set(find && s.sources.companies && tradeWords.length
      ? d.leads.filter(l => l.source === 'company' && !l.queryId && (l.status === 'ready' || l.status === 'needs_contact')
          // What the company says about itself, without the "matched …" words Hunter claimed
          && !tradeMatch(tradeWords, `${l.title} ${l.snippet.split(' · ').filter(part => !/^matched /.test(part)).join(' ')}`)).map(l => l.id)
      : [])
    if (offTrade.size) notes.push(`${offTrade.size} older compan${offTrade.size === 1 ? 'y' : 'ies'} moved to Skipped: not what you look for`)

    // 5. Save (re-read so approvals made meanwhile are kept)
    const saved = await updateLeadData(brandId, fallback, x => {
      for (const l of x.leads) if (offTrade.has(l.id) && (l.status === 'ready' || l.status === 'needs_contact')) { l.status = 'skipped'; l.skippedBy = 'auto' }
      for (const [id, p] of patches) {
        const l = x.leads.find(y => y.id === id)
        if (l && (l.status === 'sent' || l.status === 'queued')) Object.assign(l, p)
      }
      const have = new Set(x.leads.map(l => l.id))
      x.leads = [...fresh.filter(l => !have.has(l.id)), ...x.leads]
      x.sentLog = [...new Set([...x.sentLog, ...d.sentLog])].sort()
      if (d.queries) x.queries = d.queries
      if (d.companyFilters) x.companyFilters = d.companyFilters
      if (d.plan) x.plan = d.plan
      x.demo = demo
      if (rejected.length) x.rejected = [...(x.rejected ?? []), ...rejected]
      // Newest "maybe" first; what's waiting for "Show 10 more"; where the next search starts
      if (newMaybe.length) {
        const ids = new Set(newMaybe.map(m => m.id))
        x.maybe = [...newMaybe, ...(x.maybe ?? []).filter(m => !ids.has(m.id))].slice(0, 60)
      }
      if (find) x.waiting = { sites: leftSites.slice(0, 120), posts: leftPosts.slice(0, 60) }
      if (searchedSites || searchedPosts) x.cursor = { sites: turn.sites + (searchedSites ? 1 : 0), phrase: turn.phrase + (searchedPosts ? 1 : 0) }
      // "Last search" on the page: only runs that searched
      if (find && !more) { x.lastRunAt = new Date().toISOString(); x.lastRunSummary = notes.join(' · ') }
      x.lastError = errors.length ? errors.join(' · ') : null
    })
    await addUsage(brandId, meter, 'Lead Agent').catch(() => {})
    const cost = costNote(meter)
    if (cost) notes.push(cost)

    // 6. Today cards
    const waiting = saved.leads.filter(l => l.status === 'ready').length
    try {
      if (waiting) {
        await openSignal(brandId, {
          source: 'lead-agent', signalKey: 'approvals', priority: 2, cooldownDays: 0,
          title: `${waiting} lead${waiting === 1 ? '' : 's'} ready for your OK`,
          detail: 'Your Lead Agent found people to email and drafted forum replies. Nothing is sent until you approve it.',
          action: 'Open the Lead Agent and approve, edit or skip each one.',
        })
      } else {
        await clearSignals(brandId, 'lead-agent', ['approvals'])
      }
      for (const r of replies) {
        await openSignal(brandId, {
          source: 'lead-agent', signalKey: `reply:${r.id}`, priority: 3,
          title: `${r.name || r.company || r.email} replied to your email`,
          detail: r.replyNote ?? '', action: 'Reply from Gmail while it\'s warm.',
        })
      }
    } catch { /* Today cards are optional */ }

    await pr.finish([notes.join(' · '), errors.join(' · ')].filter(Boolean).join(' · '))
    return { ok: !errors.length, summary: notes.join(' · '), error: errors.join(' · ') || undefined }
  }).catch(async e => {
    await pr.finish(`Stopped: ${e instanceof Error ? e.message : 'failed'}`, true)
    throw e
  })
}

/** Demo mode only: pretend `days` have passed (sent dates move back), then run, so follow-ups and replies show. */
export async function demoSkipDays(brandId: string, days: number): Promise<RunResult> {
  if (!agentsDemo()) return { ok: false, summary: '', error: 'Only available in demo mode.' }
  const b = await loadBrandContext(brandId)
  if (!b) return { ok: false, summary: '', error: 'Brand not found.' }
  const back = (iso?: string) => iso ? new Date(Date.parse(iso) - days * 86_400_000).toISOString() : iso
  await updateLeadData(brandId, leadFallback(b), x => {
    for (const l of x.leads) { l.sentAt = back(l.sentAt); l.nextFollowUpAt = back(l.nextFollowUpAt); l.foundAt = back(l.foundAt)! }
    x.sentLog = x.sentLog.map(t => back(t)!)
  })
  const r = await runLeadAgent(brandId, { manual: true })
  return { ...r, summary: `Skipped ahead ${days} days · ${r.summary}` }
}
