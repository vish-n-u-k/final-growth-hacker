// The Lead Agent's DataForSEO playbook: which questions to ask DataForSEO to find companies like the
// brand's customers, and a memory of how each question did. Claude plans 3 questions from the
// playbook; each search reports how many sites it found, how many the AI kept and which the owner
// approved or skipped; weak questions are dropped and Claude replaces them with different ones.

import { callAI } from '@/lib/ai/client'
import { getPosthogProUsers } from '@/lib/mcp/tools/get_posthog_pro_users'
import { leadBrandBlock, domainOf, parseJsonLoose, type BrandContext } from './context'
import type { LeadAgentData, LeadPlan, LeadQuery, LeadSettings } from './store'

export const PLAYBOOK = `# Finding small businesses with DataForSEO

You pick the questions the Lead Agent asks DataForSEO to find companies that would buy the product.
Every question costs money, so pick ones that bring back small, real, active businesses of the right
trade, not lists, blogs or big brands. A seller's own page on a marketplace or social network
(an Etsy shop, an Instagram account) counts as a business; marketplace search and listing pages don't.

## The three kinds of question

### google: a Google search with operators (the best kind for most brands)
Google only shows live sites, and operators pin down what kind of site comes back.
- Shopify stores: "powered by shopify" <product>, or inurl:collections <product>
- WooCommerce stores: inurl:product-category <product>
- Stores that also sell on Etsy: <product> "shop" "also on etsy"
- Businesses that take bookings (salons, studios, coaches, clinics): <trade> "book now", or <trade> "book a consultation"
- Small teams: <trade> "family run" or <trade> "small team" or <trade> "founded by"
- Sellers without a website of their own: many small sellers only have an Etsy shop or an Instagram,
  Facebook or TikTok page. Their pages are kept as leads (messaged by hand), so search them directly:
  site:etsy.com/shop <product>, site:instagram.com <product> "shop" (or "DM to order"),
  site:facebook.com <product> "small business", site:tiktok.com <product> "handmade".
  When the ideal customers sell on a marketplace or mostly on social media, make at least one question
  of this kind. Don't add -site:etsy.com or -site:instagram.com: those pages are wanted.
- Never use "best", "top", "review", "vs", "ideas" or "how to": they bring lists and blogs, not businesses.
- One product or trade per search, the narrower the better ("soy candles", not "home decor").
- At most 8 words and 2 quoted phrases. Don't add the country: the search already runs in it.

### stores: DataForSEO's technology index
Sites running a platform (Shopify, WooCommerce, Wix, Squarespace) with trade words in their title or
description. A large pool but loosely matched: good when Google searches run dry.
- q: 2-4 single trade words, comma separated ("candles, soap, skincare"). Single words only.
- platforms: 1-2 of Shopify, WooCommerce, Wix, Squarespace.

### lookalike: sites like a customer
Sites that show up on Google for the same searches as a site that already bought, or a lead the owner
approved. Usually the closest matches of all. q is one domain, and only from the "Customer sites" list.

## Rules
- Return exactly the number of new questions asked for. Mix kinds when you can, e.g. 2 google + 1 lookalike.
- Questions marked "working" stay; you only write the missing ones.
- A replacement must try something different from the dropped questions, not a rewording of them:
  a narrower product, another operator, another platform, another customer site.
- Buyers that aren't online stores (agencies, salons, coaches, software firms): use google with their
  trade and words their sites carry ("book a consultation", "our studio"), not stores.
`

const PLATFORMS = ['Shopify', 'WooCommerce', 'Wix', 'Squarespace']
const ACTIVE = 3
const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'yandex.com', 'zoho.com', 'rediffmail.com'])
const APPROVED = new Set(['sent', 'queued', 'replied', 'opted_out', 'bounced'])

/** Leads per question the owner approved (sent or queued) or skipped themselves. */
export function queryOutcomes(d: LeadAgentData): Map<string, { approved: number; skipped: number }> {
  const out = new Map<string, { approved: number; skipped: number }>()
  for (const l of d.leads) {
    if (!l.queryId) continue
    const o = out.get(l.queryId) ?? { approved: 0, skipped: 0 }
    if (APPROVED.has(l.status) && l.approvedBy === 'user') o.approved += 1
    if (l.status === 'skipped' && !l.skippedBy) o.skipped += 1
    out.set(l.queryId, o)
  }
  return out
}

/** Why a question should be dropped, or null while it's still worth asking. */
function weak(q: LeadQuery, o: { approved: number; skipped: number } | undefined): string | null {
  if (q.empty >= 2) return 'nothing new came back twice in a row'
  if (q.checked >= 12 && q.kept / q.checked < 0.1) return `few good fits (${q.kept} of ${q.checked})`
  if (o && o.skipped >= 3 && o.skipped > 2 * o.approved) return `the owner skipped most of its leads (${o.skipped} skipped, ${o.approved} approved)`
  if (q.kind === 'google' && q.page >= 5) return 'used up its pages'
  return null
}

/**
 * Sites to find lookalikes of: the ideal customers named on the card, companies the owner approved, then customers' business email domains
 * from PostHog (when it's connected). Read again once a week.
 */
async function customerSites(brandId: string, d: LeadAgentData, plan: LeadPlan | undefined, examples: string[]): Promise<{ at: string; domains: string[] }> {
  const approved = d.leads.filter(l => l.source === 'company' && l.website && APPROVED.has(l.status) && l.approvedBy === 'user').map(l => domainOf(l.website!))
  const cached = plan?.seeds && Date.now() - Date.parse(plan.seeds.at) < 7 * 86_400_000 ? plan.seeds : null
  let paying = cached?.domains ?? []
  if (!cached) {
    const r = await getPosthogProUsers(brandId).catch(() => null)
    const users = r && 'users' in r ? (r.users as { email: string }[]) : []
    paying = [...new Set(users.map(u => u.email.split('@')[1]?.toLowerCase() ?? '').filter(x => x && !FREE_MAIL.has(x)))]
  }
  return { at: cached?.at ?? new Date().toISOString(), domains: [...new Set([...examples.map(x => domainOf(x)).filter(Boolean), ...approved, ...paying])].slice(0, 12) }
}

/**
 * The questions for this search: the saved plan, with weak questions dropped and the gaps filled by
 * Claude from the playbook. A new plan is made when "who to look for" changes.
 */
export async function planLeadQueries(b: BrandContext, s: LeadSettings, d: LeadAgentData,
  hints: { keywords: string[]; platforms: string[]; customer: string; examples: string[]; card: string }): Promise<LeadPlan> {
  // A new plan when who we look for changes (the line, or the ideal-customer card)
  const want = `${s.companyQuery.trim() || s.customer}|${hints.card}`
  const old = d.plan?.for === want ? d.plan : undefined
  const outcomes = queryOutcomes(d)
  const seeds = await customerSites(b.id, d, d.plan, hints.examples)
  const queries: LeadQuery[] = []
  const retired: LeadQuery[] = [...(old?.retired ?? [])]
  for (const q of old?.queries ?? []) {
    const why = weak(q, outcomes.get(q.id))
    if (why) retired.unshift({ ...q, retired: why })
    else queries.push(q)
  }
  const plan: LeadPlan = { for: want, at: old?.at ?? new Date().toISOString(), queries, retired: retired.slice(0, 15), seeds }
  if (queries.length >= ACTIVE) return plan

  const line = (q: LeadQuery) => {
    const o = outcomes.get(q.id)
    return `- ${q.kind}: ${q.q}${q.platforms?.length ? ` [${q.platforms.join(', ')}]` : ''} · searched ${q.page}×, ${q.checked} checked, ${q.kept} kept${o ? `, owner approved ${o.approved}, skipped ${o.skipped}` : ''}${q.retired ? ` · dropped: ${q.retired}` : ''}`
  }
  const need = ACTIVE - queries.length
  const raw = await callAI({
    feature: 'lead-agent',
    model: 'claude-sonnet-4-6',
    maxTokens: 800,
    system: `${PLAYBOOK}\nReturn only a raw JSON array.`,
    prompt: `${leadBrandBlock(b, s.useBrand !== false)}
${hints.customer}
Companies we look for: ${s.companyQuery.trim() || s.customer || 'companies that would buy this product'}
Trade words: ${hints.keywords.join(', ') || 'none yet'}
Store platforms that fit: ${hints.platforms.join(', ') || 'none: the buyers are not online stores, so never use stores'}
Customer sites: ${seeds.domains.join(', ') || 'none yet (don\'t use lookalike)'}

Working (they stay):
${queries.map(line).join('\n') || '- none'}

Dropped before (don't repeat these ideas):
${retired.slice(0, 10).map(line).join('\n') || '- none'}

Write ${need} new question${need === 1 ? '' : 's'}. Return [{"kind":"google","q":"...","why":"..."}, {"kind":"stores","q":"candles, soap","platforms":["Shopify"],"why":"..."}, {"kind":"lookalike","q":"example.com","why":"..."}]
why: one plain sentence for the owner, e.g. "Shopify shops selling soy candles".`,
  }).catch(e => { console.error(`[lead-agent] planning failed: ${e instanceof Error ? e.message : e}`); return '' })
  const taken = new Set([...queries, ...retired].map(q => `${q.kind}:${q.q.toLowerCase()}`))
  const fresh = (parseJsonLoose<Partial<LeadQuery>[]>(raw, 'array') ?? [])
    .map(x => ({
      kind: x.kind,
      q: typeof x.q === 'string' ? x.q.trim().slice(0, 150) : '',
      platforms: Array.isArray(x.platforms) ? x.platforms.filter(p => PLATFORMS.includes(p)).slice(0, 2) : [],
      why: typeof x.why === 'string' ? x.why.trim().slice(0, 160) : '',
    }))
    .filter(x => x.q && (x.kind === 'google' || (x.kind === 'stores' && hints.platforms.length > 0) || (x.kind === 'lookalike' && seeds.domains.includes(domainOf(x.q)))))
    .filter(x => !taken.has(`${x.kind}:${x.q.toLowerCase()}`))
    .slice(0, need)
    .map((x, i): LeadQuery => ({
      id: `${Date.now().toString(36)}${i}`,
      kind: x.kind as LeadQuery['kind'],
      q: x.kind === 'lookalike' ? domainOf(x.q) : x.q,
      ...(x.kind === 'stores' ? { platforms: x.platforms.length ? x.platforms : hints.platforms.slice(0, 2) } : {}),
      why: x.why,
      page: 0, checked: 0, kept: 0, empty: 0,
    }))
  plan.queries = [...queries, ...fresh]
  plan.at = new Date().toISOString()
  // Claude gave nothing usable and nothing is left: fall back to the old store search
  if (!plan.queries.length && hints.platforms.length) {
    plan.queries = [{ id: `${Date.now().toString(36)}s`, kind: 'stores', q: hints.keywords.join(', '), platforms: hints.platforms, why: 'Online stores whose title has your trade words', page: 0, checked: 0, kept: 0, empty: 0 }]
  } else if (!plan.queries.length && hints.keywords.length) {
    plan.queries = [{ id: `${Date.now().toString(36)}g`, kind: 'google', q: `${hints.keywords[0]} "founded by"`, why: `Small ${hints.keywords[0]} businesses`, page: 0, checked: 0, kept: 0, empty: 0 }]
  }
  console.log(`[lead-agent] plan: ${plan.queries.map(q => `${q.kind} “${q.q}”`).join(' · ')}${retired.length > (old?.retired.length ?? 0) ? ` (dropped ${retired.length - (old?.retired.length ?? 0)})` : ''}`)
  return plan
}

/** The owner's own choices among companies, newest first, for the AI check to learn from. */
export function ownerExamples(d: LeadAgentData): { kept: string[]; skipped: string[] } {
  const line = (l: LeadAgentData['leads'][number]) => `${l.title}${l.website ? ` (${l.website})` : ''}: ${l.why || l.snippet.slice(0, 120)}`
  const companies = d.leads.filter(l => l.source === 'company')
  return {
    kept: companies.filter(l => APPROVED.has(l.status) && l.approvedBy === 'user').slice(0, 8).map(line),
    skipped: companies.filter(l => l.status === 'skipped' && !l.skippedBy).slice(0, 8).map(line),
  }
}
