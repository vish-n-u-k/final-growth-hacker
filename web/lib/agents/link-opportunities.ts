// Link opportunities for the Search Agent: sites that should link to (or list) the brand.
// Two sources, both DataForSEO:
//   gap:  sites that link to the brand's competitors but not to the brand (Backlinks API)
//   list: "best X" / "X alternatives" articles on Google that name competitors but leave the brand
//         out (Google results, then the page itself is read to check)
// Each one gets a contact (Hunter, else the site's own pages) and a short pitch that the user
// reads, edits and sends from Gmail. One follow-up goes out 5 days later unless they reply.
// Runs weekly from the Search Agent's schedule (lib/agents/search-agent.ts) or on "Find now".

import { callAI, withAIContext } from '@/lib/ai/client'
import { sendGmailMessage, GmailSendError } from '@/lib/gmail/send'
import { getValidGmailToken } from '@/lib/gmail/token'
import { checkThreadReply } from '@/lib/gmail/reply-check'
import { openSignal, clearSignals } from '@/lib/signals'
import { fetchHtml } from '@/lib/lead-finder/reviews'
import { googleResults, linkingSites, referringDomains, searchDataReady, type LinkingSite } from './dataforseo'
import { agentsDemo, demoReply, demoSend, setDemoContext } from './demo'
import { Progress } from './progress'
import { hunterConfigured, findEmail } from './hunter'
import { emailFromWebsite } from './lead-agent'
import {
  addUsage, defaultSearchData, newMeter, readSearchData, updateSearchData,
  type LinkOpportunity, type SearchAgentData,
} from './store'
import { brandBlock, daysFrom, domainOf, firstName, idOf, loadBrandContext, parseJsonLoose, textToHtml, type BrandContext } from './context'

const MAX_NEW = 10
const MAX_LOOKUPS = 8
const FOLLOW_UP_DAYS = 5
const OPT_OUT = 'If this isn\'t a fit, just reply "no" and I won\'t email again.'
// Platforms nobody "pitches": social networks, search engines, hosting and link shorteners
const PLATFORM = /(^|\.)(google|youtube|facebook|instagram|linkedin|twitter|x|tiktok|pinterest|reddit|wikipedia|medium|github|apple|microsoft|amazon|quora|wordpress|blogspot|yahoo|bing|t|bit)\.[a-z.]+$/
// A Google result that is a list or comparison of options
const LIST_TITLE = /\b(best|top|alternatives?|vs\.?|compared|comparison|reviews?)\b/i

type Result = { ok: boolean; summary: string; error?: string }

interface Candidate {
  domain: string
  source: LinkOpportunity['source']
  url: string
  title: string
  rank: number | null
  names: Set<string>
}

const fallbackFor = (b: BrandContext) => () => defaultSearchData(b)

// ── Finding ───────────────────────────────────────────────────────────────────

/** Sites linking to competitors and not to the brand. */
async function findGap(b: BrandContext, skip: (domain: string) => boolean, meter: ReturnType<typeof newMeter>, out: Map<string, Candidate>) {
  const rivals = b.competitors.slice(0, 3)
  if (!rivals.length) return
  const [own, ...lists] = await Promise.all([
    referringDomains(b.domain, meter).catch(() => [] as string[]),
    ...rivals.map(c => linkingSites(c.domain, meter)),
  ])
  const ownSet = new Set(own)
  lists.forEach((sites: LinkingSite[], i) => {
    for (const site of sites) {
      if (ownSet.has(site.domain) || skip(site.domain) || (site.spam ?? 0) > 40) continue
      const cur = out.get(site.domain) ?? { domain: site.domain, source: 'gap' as const, url: site.url, title: site.title, rank: site.rank, names: new Set<string>() }
      cur.names.add(rivals[i].name)
      out.set(site.domain, cur)
    }
  })
}

/** "Best X" / "X alternatives" articles that name competitors and not the brand. */
async function findLists(b: BrandContext, d: SearchAgentData, skip: (domain: string) => boolean, meter: ReturnType<typeof newMeter>, out: Map<string, Candidate>, errors: string[]) {
  const rivals = b.competitors.slice(0, 3)
  const queries = [
    ...d.settings.seeds.slice(0, 2).map(s => `best ${s}`),
    ...rivals.slice(0, 2).map(c => `${c.name} alternatives`),
  ]
  if (!queries.length) return
  const serps = await Promise.all(queries.map(q => googleResults(q, d.settings.country, meter).catch(e => {
    errors.push(`Google results: ${e instanceof Error ? e.message : 'failed'}`)
    return []
  })))
  const pages = new Map<string, { url: string; title: string }>()
  for (const r of serps.flat()) {
    const dom = domainOf(r.url)
    if (!dom || skip(dom) || pages.has(dom) || !LIST_TITLE.test(r.title)) continue
    pages.set(dom, { url: r.url, title: r.title })
  }
  // Read each page: drop the ones that already mention the brand, note which rivals they name
  const brandName = b.name.toLowerCase()
  const checked = await Promise.all([...pages.entries()].slice(0, 12).map(async ([dom, p]) => {
    if (agentsDemo()) return { dom, p, names: rivals.map(c => c.name), listed: false }
    const html = (await fetchHtml(p.url).catch(() => null))?.toLowerCase() ?? ''
    if (!html) return { dom, p, names: [] as string[], listed: false }
    const listed = html.includes(b.domain) || (brandName.length > 3 && html.includes(brandName))
    return { dom, p, names: rivals.filter(c => html.includes(c.domain) || html.includes(c.name.toLowerCase())).map(c => c.name), listed }
  }))
  for (const c of checked) {
    if (c.listed) continue
    const cur = out.get(c.dom)
    // The exact list page is the better thing to pitch than an older link elsewhere on the site
    out.set(c.dom, { domain: c.dom, source: 'list', url: c.p.url, title: c.p.title, rank: cur?.rank ?? null, names: new Set([...(cur?.names ?? []), ...c.names]) })
  }
}

// ── Drafting ──────────────────────────────────────────────────────────────────

interface Drafted { i: number; keep: boolean; why?: string; subject?: string; body?: string }

async function draftPitches(b: BrandContext, list: Candidate[]): Promise<Map<number, Drafted>> {
  const raw = await callAI({
    feature: 'search-agent',
    model: 'claude-sonnet-4-6',
    maxTokens: 4000,
    system: 'You help a small business get mentioned and linked by relevant websites. You write short, honest, specific outreach emails. Return only a raw JSON array.',
    prompt: `${brandBlock(b)}

Websites that link to or list this brand's competitors but not the brand:
${list.map((c, i) => `${i}. ${c.domain} (${c.source === 'list' ? 'a list/comparison article' : 'links to competitors'})
   Page: "${c.title || c.url}" ${c.url}
   Names: ${[...c.names].join(', ') || 'competitors in this space'}`).join('\n')}

For each website return {"i": number, "keep": boolean, "why": "...", "subject": "...", "body": "..."}.
- keep: false if a small business can't realistically get a link or mention there (major news outlets, government, universities, a competitor's own site, spammy or unrelated sites).
- why: one plain sentence a non-technical founder understands, e.g. "Their 'best scheduling tools' article lists RivalOne and RivalTwo but not you."
- subject: under 60 characters, specific, no clickbait.
- body: 80-130 words, plain text, no greeting line with a name (we add it). Mention the page by its title, say in one or two sentences why ${b.name} is useful for their readers, make one clear ask (add ${b.name} to the list, or mention it), offer to send anything that helps. No flattery, no invented facts, numbers or customer names. Sign off with "${b.name}".`,
  })
  const arr = parseJsonLoose<Drafted[]>(raw, 'array') ?? []
  return new Map(arr.filter(x => typeof x?.i === 'number').map(x => [x.i, x]))
}

const greet = (name: string | undefined) => (firstName(name) ? `Hi ${firstName(name)},` : 'Hi,')

// ── Follow-ups and replies ────────────────────────────────────────────────────

async function checkSent(brandId: string, b: BrandContext, links: LinkOpportunity[]): Promise<{ patches: Map<string, Partial<LinkOpportunity>>; replies: LinkOpportunity[]; error?: string }> {
  const patches = new Map<string, Partial<LinkOpportunity>>()
  const replies: LinkOpportunity[] = []
  const sent = links.filter(l => l.status === 'sent' && l.threadId && l.email)
  if (!sent.length) return { patches, replies }
  const demo = agentsDemo()
  let token = ''
  if (!demo) {
    try { token = await getValidGmailToken(brandId) } catch (e) { return { patches, replies, error: e instanceof Error ? e.message : 'Gmail not connected' } }
  }
  for (const l of sent) {
    try {
      const r = demo ? demoReply(l.id, l.sentAt!) : await checkThreadReply(brandId, token, l.threadId!, l.email!, Date.parse(l.sentAt!) - 60_000)
      if (r.outcome === 'replied' || r.outcome === 'opted_out' || r.outcome === 'bounced') {
        patches.set(l.id, { status: r.outcome, replyNote: r.note, nextFollowUpAt: undefined })
        if (r.outcome === 'replied') replies.push({ ...l, replyNote: r.note })
        continue
      }
      if (!l.followupSent && l.nextFollowUpAt && Date.parse(l.nextFollowUpAt) <= Date.now() && l.pitch) {
        const subject = /^re:/i.test(l.pitch.subject) ? l.pitch.subject : `Re: ${l.pitch.subject}`
        const body = `${greet(l.contactName)}\n\nJust bringing this back up in case it got buried. Happy to send anything that makes it easier to add ${b.name}.\n\n${b.name}\n\n${OPT_OUT}`
        if (!demo) await sendGmailMessage(brandId, { to: l.email!, subject, body: textToHtml(body), threadId: l.threadId })
        patches.set(l.id, { followupSent: true, nextFollowUpAt: undefined })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Follow-up failed'
      patches.set(l.id, e instanceof GmailSendError && e.code === 'suppressed' ? { status: 'opted_out', error: msg, nextFollowUpAt: undefined } : { error: msg })
    }
  }
  return { patches, replies }
}

async function replyCards(brandId: string, replies: LinkOpportunity[]) {
  for (const r of replies) {
    await openSignal(brandId, {
      source: 'search-agent', signalKey: `link-reply:${r.id}`, priority: 3,
      title: `${r.domain} replied to your link pitch`,
      detail: r.replyNote ?? '', action: 'Reply from Gmail while it\'s warm.',
    }).catch(() => {})
  }
}

/** Daily: replies and the one follow-up for pitches already sent. Cheap; nothing to do most days. */
export async function runLinkFollowUps(brandId: string): Promise<void> {
  const d = await readSearchData(brandId)
  if (!d?.links?.some(l => l.status === 'sent')) return
  const b = await loadBrandContext(brandId)
  if (!b) return
  const { patches, replies } = await checkSent(brandId, b, d.links)
  if (!patches.size) return
  await updateSearchData(brandId, fallbackFor(b), x => {
    for (const l of x.links ?? []) { const p = patches.get(l.id); if (p && l.status === 'sent') Object.assign(l, p) }
  })
  await replyCards(brandId, replies)
}

// ── The run ───────────────────────────────────────────────────────────────────

export async function runLinkOpportunities(brandId: string): Promise<Result> {
  const b = await loadBrandContext(brandId)
  if (!b) return { ok: false, summary: '', error: 'Brand not found.' }
  if (!searchDataReady()) return { ok: false, summary: '', error: 'DataForSEO is not set up yet (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD).' }
  const fallback = fallbackFor(b)
  const demo = agentsDemo()
  // Switching between demo and real data: start the list afresh
  const saved = await readSearchData(brandId)
  if (saved && !!saved.demo !== demo && saved.links?.length) await updateSearchData(brandId, fallback, x => { x.links = [] })
  const d = (await readSearchData(brandId)) ?? fallback()
  setDemoContext({ brand: b.name, domain: b.domain, competitors: b.competitors, seeds: d.settings.seeds })
  const meter = newMeter()
  const errors: string[] = []
  const notes: string[] = []
  const n = (x: number, one: string, many = `${one}s`) => `${x} ${x === 1 ? one : many}`
  const rivals = b.competitors.map(c => c.domain).slice(0, 3).join(', ')
  const p = new Progress(brandId, 'search', 'Finding sites that could link to you', [
    { key: 'replies', label: 'Checking pitches you sent for replies' },
    { key: 'gap', label: rivals ? `Finding sites that link to ${rivals} but not to you` : 'Finding sites that link to your competitors' },
    { key: 'lists', label: 'Finding “best of” list articles that leave you out' },
    { key: 'pick', label: 'Picking the strongest sites and drafting a short pitch for each' },
    { key: 'contacts', label: 'Finding who to email (Hunter, then their websites)' },
  ])

  return withAIContext({ brandId, moduleType: 'search-agent', websiteUrl: b.websiteUrl }, async () => {
    const sent = (d.links ?? []).filter(l => l.status === 'sent').length
    const { patches, replies, error: gmailError } = await p.step('replies', () => checkSent(brandId, b, d.links ?? []),
      r => sent ? `${n(sent, 'pitch', 'pitches')} checked · ${n(r.replies.length, 'reply', 'replies')}` : 'No pitches sent yet')
    if (gmailError) errors.push(`Gmail: ${gmailError}`)

    // Never suggest the brand, its competitors, big platforms or sites already on the list
    const skip = new Set<string>([b.domain, ...b.competitors.map(c => c.domain), ...(d.links ?? []).map(l => l.domain)])
    const isSkipped = (dom: string) => skip.has(dom) || PLATFORM.test(dom)
    const found = new Map<string, Candidate>()

    const sites = (source: Candidate['source']) => [...found.values()].filter(c => c.source === source)
    const sample = (list: Candidate[]) => list.slice(0, 4).map(c => c.domain)
    if (!b.competitors.length) {
      notes.push('add competitors in Settings to find sites that link to them')
      p.set('gap', 'skipped', 'Add competitors in Settings first')
    } else {
      await p.step('gap', () => findGap(b, isSkipped, meter, found), () => {
        const g = sites('gap')
        return g.length ? { detail: `${n(g.length, 'site')} link to them, not to you`, items: sample(g) } : 'None found this time'
      }).catch(e => {
        const msg = e instanceof Error ? e.message : 'failed'
        errors.push(`Competitor links: ${msg}${/access|subscri|40[0-9]{3}/i.test(msg) ? ' (this needs DataForSEO\'s Backlinks subscription; list articles still work)' : ''}`)
      })
    }
    await p.step('lists', () => findLists(b, d, isSkipped, meter, found, errors), () => {
      const l = sites('list')
      return l.length ? { detail: `${n(l.length, 'article')} list options like yours`, items: sample(l) } : 'None found this time'
    }).catch(e => errors.push(`List articles: ${e instanceof Error ? e.message : 'failed'}`))

    // Strongest first: sites naming more competitors, list articles, then authority
    const ranked = [...found.values()]
      .sort((x, y) => (y.names.size * 3 + (y.source === 'list' ? 2 : 0) + (y.rank ?? 0) / 200) - (x.names.size * 3 + (x.source === 'list' ? 2 : 0) + (x.rank ?? 0) / 200))
      .slice(0, MAX_NEW + 4)

    const fresh: LinkOpportunity[] = []
    if (ranked.length) {
      const drafts = await p.step('pick', () => draftPitches(b, ranked)).catch(e => { errors.push(`Drafting: ${e instanceof Error ? e.message : 'failed'}`); return new Map<number, Drafted>() })
      const now = new Date().toISOString()
      ranked.forEach((c, i) => {
        const x = drafts.get(i)
        if (!x?.keep || fresh.length >= MAX_NEW) return
        fresh.push({
          id: idOf(c.domain), domain: c.domain, source: c.source, url: c.url, title: c.title,
          authority: c.rank !== null ? Math.round(c.rank / 10) : null, names: [...c.names],
          why: x.why || (c.source === 'list' ? 'This article compares options like yours and leaves you out.' : `Links to ${[...c.names].join(' and ')}, not to you.`),
          pitch: x.subject && x.body ? { subject: x.subject, body: x.body } : undefined,
          status: 'new', foundAt: now,
        })
      })
      p.set('pick', 'done', { detail: `${n(fresh.length, 'site')} worth pitching`, items: fresh.slice(0, 4).map(l => l.domain) })
      // Contacts: Hunter for a named person, else a mailto: on their own pages
      p.set('contacts', fresh.length ? 'running' : 'skipped')
      let lookups = 0
      for (const l of fresh) {
        const viaHunter = lookups < MAX_LOOKUPS && hunterConfigured() ? await findEmail(l.domain, undefined, meter).catch(() => null) : null
        if (viaHunter) { lookups += 1; l.email = viaHunter.email; l.emailVerified = viaHunter.verified; l.contactName = viaHunter.name }
        else {
          const site = await emailFromWebsite(l.domain).catch(() => null)
          if (site) { l.email = site; l.emailVerified = false }
        }
        if (l.email && l.pitch) l.status = 'ready'
      }
      if (fresh.length) p.set('contacts', 'done', `Email found for ${fresh.filter(l => l.email).length} of ${n(fresh.length, 'site')}`)
    }
    notes.unshift(`${fresh.length} new link opportunit${fresh.length === 1 ? 'y' : 'ies'}`)

    const result = await updateSearchData(brandId, fallback, x => {
      for (const l of x.links ?? []) { const p = patches.get(l.id); if (p && l.status === 'sent') Object.assign(l, p) }
      const have = new Set((x.links ?? []).map(l => l.domain))
      x.links = [...fresh.filter(l => !have.has(l.domain)), ...(x.links ?? [])]
      x.lastLinksAt = new Date().toISOString()
      x.linksError = errors.length ? errors.join(' · ') : null
      x.demo = demo
    })
    await addUsage(brandId, meter).catch(() => {})

    // Today card while pitches are waiting
    try {
      const waiting = (result.links ?? []).filter(l => l.status === 'ready').length
      if (waiting) {
        await openSignal(brandId, {
          source: 'search-agent', signalKey: 'links', priority: 2, cooldownDays: 0,
          title: `${waiting} site${waiting === 1 ? '' : 's'} could link to you`,
          detail: 'They link to or list your competitors, not you. A short pitch is drafted for each; nothing is sent until you send it.',
          action: 'Open the Search Agent → Link opportunities.',
        })
      } else {
        await clearSignals(brandId, 'search-agent', ['links'])
      }
    } catch { /* Today cards are optional */ }
    await replyCards(brandId, replies)

    await p.finish([notes.join(' · '), errors.join(' · ')].filter(Boolean).join(' · '))
    return { ok: !errors.length, summary: notes.join(' · '), error: errors.join(' · ') || undefined }
  }).catch(async e => {
    await p.finish(`Stopped: ${e instanceof Error ? e.message : 'failed'}`, true)
    throw e
  })
}

// ── User actions ──────────────────────────────────────────────────────────────

/** Sends a link pitch (optionally edited) from the user's Gmail, with one follow-up in 5 days. */
export async function sendLinkPitch(brandId: string, id: string, edits?: { subject?: string; body?: string; email?: string }): Promise<{ ok: boolean; message: string }> {
  const b = await loadBrandContext(brandId)
  if (!b) return { ok: false, message: 'Brand not found.' }
  const d = await readSearchData(brandId)
  const l = d?.links?.find(x => x.id === id)
  if (!l) return { ok: false, message: 'That opportunity is gone. Refresh the page.' }
  const email = (edits?.email ?? l.email ?? '').trim()
  const subject = (edits?.subject ?? l.pitch?.subject ?? '').trim()
  const body = (edits?.body ?? l.pitch?.body ?? '').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: 'Add a valid email address first.' }
  if (!subject || !body) return { ok: false, message: 'The email needs a subject and a message.' }
  const text = `${greet(l.contactName)}\n\n${body}\n\n${OPT_OUT}`

  let patch: Partial<LinkOpportunity>
  try {
    // Demo mode: recorded as sent, nothing leaves GrowJin
    const sent = agentsDemo() ? demoSend() : await sendGmailMessage(brandId, { to: email, subject, body: textToHtml(text) })
    const now = new Date().toISOString()
    patch = { status: 'sent', email, pitch: { subject, body }, sentAt: now, threadId: sent.threadId, followupSent: false, nextFollowUpAt: daysFrom(now, FOLLOW_UP_DAYS), error: undefined }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Send failed'
    patch = e instanceof GmailSendError && e.code === 'suppressed' ? { status: 'opted_out', error: msg } : { error: msg }
    await updateSearchData(brandId, fallbackFor(b), x => { const t = x.links?.find(y => y.id === id); if (t) Object.assign(t, patch) })
    return { ok: false, message: msg }
  }
  const saved = await updateSearchData(brandId, fallbackFor(b), x => { const t = x.links?.find(y => y.id === id); if (t) Object.assign(t, patch) })
  if (!(saved.links ?? []).some(x => x.status === 'ready')) await clearSignals(brandId, 'search-agent', ['links']).catch(() => {})
  return { ok: true, message: agentsDemo() ? `Recorded as sent to ${email} (demo: nothing was sent).` : `Sent to ${email}. A follow-up goes out in ${FOLLOW_UP_DAYS} days unless they reply.` }
}

/** Marks an opportunity won, skipped or back to the list, or sets its contact email by hand. */
export async function updateLink(brandId: string, id: string, change: { status?: 'won' | 'skipped' | 'new'; email?: string }): Promise<boolean> {
  const b = await loadBrandContext(brandId)
  if (!b) return false
  let ok = false
  const saved = await updateSearchData(brandId, fallbackFor(b), x => {
    const l = x.links?.find(y => y.id === id)
    if (!l) return
    ok = true
    if (change.email !== undefined) {
      const e = change.email.trim()
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { l.email = e; l.emailVerified = false; if (l.status === 'new' && l.pitch) l.status = 'ready' }
    }
    if (change.status === 'new') l.status = l.email && l.pitch ? 'ready' : 'new'
    else if (change.status) { l.status = change.status; l.nextFollowUpAt = undefined }
  })
  if (!(saved.links ?? []).some(x => x.status === 'ready')) await clearSignals(brandId, 'search-agent', ['links']).catch(() => {})
  return ok
}
