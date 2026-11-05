// Ask's ready answers (md_files/ASK_PLAN.md, phase 1): three questions worked out from data we
// already have, saved per brand in signal_snapshots, so opening the page costs nothing.
// The sentences are written here from the numbers, not by AI: free, the same every day, and a
// number can't come out wrong.

import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { getSnapshot, saveSnapshot } from '@/lib/signals'
import { agentsDemo, withDemo } from '@/lib/agents/demo'
import { readDemoSwitch, readLeadData, type Lead } from '@/lib/agents/store'
import { listConversations, type Conversation } from '@/lib/gmail/conversations'
import { fetchGscPageTraffic } from '@/lib/modules/seo/keyword-fetchers'
import { getSitemap } from '@/lib/modules/content-audit/fetcher'
import type { Answer, AskCards, CardId } from './types'

const KEY = 'ask:cards'
const key = () => (agentsDemo() ? `${KEY}:demo` : KEY)
/** Saved cards older than this are worked out again when the page is opened. */
export const STALE_MS = 20 * 3_600_000
const REPLY_DAYS = 14
const GOOGLE_DAYS = 28

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`
const cut = (t: string | undefined, n: number) => {
  const x = (t ?? '').replace(/\s+/g, ' ').replace(/\s*\[[^\]]*\]\s*/g, ' ').trim()
  const first = x.split(/(?<=[.!?])\s/)[0] ?? x
  return first.length <= n ? first.replace(/\.$/, '') : `${first.slice(0, n - 1).replace(/\s\S*$/, '')}…`
}
const lowerFirst = (t: string) => (t ? t[0].toLowerCase() + t.slice(1) : t)
const ago = (iso: string | undefined | null) => {
  if (!iso) return ''
  const h = Math.round((Date.now() - Date.parse(iso)) / 3_600_000)
  if (h < 1) return 'less than an hour ago'
  if (h < 24) return `${plural(h, 'hour')} ago`
  return `${plural(Math.round(h / 24), 'day')} ago`
}

// ── Did anyone reply? ────────────────────────────────────────────────────────

const INTENT: Record<string, string> = {
  meeting: 'wants a call', interested: 'is interested', question: 'asked a question',
  objection: 'has a concern', later: 'said later', other: 'replied',
}
const INTENT_ORDER = ['meeting', 'interested', 'question', 'objection', 'other', 'later']
const who = (c: Conversation) => c.toName || c.toEmail || 'Someone'

export function repliesCard(convs: Conversation[], at: string): Answer {
  const since = Date.now() - REPLY_DAYS * 86_400_000
  const replied = convs
    .filter(c => c.status === 'replied' && (!c.repliedAt || Date.parse(c.repliedAt) >= since))
    .sort((a, b) => INTENT_ORDER.indexOf(a.intent ?? 'other') - INTENT_ORDER.indexOf(b.intent ?? 'other')
      || Date.parse(b.repliedAt ?? '0') - Date.parse(a.repliedAt ?? '0'))
  const base = { id: 'replies' as const, question: 'Did anyone reply?', source: 'Emails GrowJin sent, checked for replies every morning', at }
  if (!replied.length) {
    return {
      ...base, number: '0', numberLabel: 'new replies', state: 'empty',
      say: `No new replies in the last ${REPLY_DAYS} days. Follow-ups keep going out by themselves.`,
      picture: null, pictureTitle: '', finds: [], next: null, then: [],
    }
  }
  const [a, b] = replied
  const line = (c: Conversation) => `**${who(c)}** ${INTENT[c.intent ?? 'other'] ?? 'replied'}`
  const say = replied.length === 1 ? `${line(a)}.`
    : replied.length === 2 ? `${line(a)}, and ${line(b)}.`
    : `${line(a)}, ${line(b)}, and ${plural(replied.length - 2, 'more person', 'more people')} replied.`
  return {
    ...base, number: String(replied.length), numberLabel: replied.length === 1 ? 'reply' : 'replies', state: 'ok', say,
    picture: { kind: 'list', rows: replied.slice(0, 5).map(c => ({ name: who(c), note: c.note ? `“${cut(c.note, 70)}”` : INTENT[c.intent ?? 'other'] ?? 'replied' })) },
    pictureTitle: `Replies, last ${REPLY_DAYS} days`,
    finds: [],
    next: {
      title: `Answer ${who(a)}`,
      why: a.note ? `They wrote: “${cut(a.note, 90)}”` : `Re: ${a.subject}`,
      label: 'Open the reply', href: '/gmail-hub?tab=inbox',
    },
    then: replied.length > 1 ? [{ title: replied.length === 2 ? who(b) : `${who(b)} and ${replied.length - 2} more`, why: 'In the Inbox, replies first' }] : [],
  }
}

// ── Who should I email today? ────────────────────────────────────────────────

const isPost = (l: Lead) => l.source === 'reddit' || l.source === 'forum'
const nameOf = (l: Lead) => (l.source === 'profile' ? l.title : l.name || l.company || l.title)

export function emailCard(leads: Lead[], lastRunAt: string | undefined, at: string): Answer {
  const ready = leads.filter(l => !isPost(l) && l.status === 'ready').sort((a, b) => b.score - a.score)
  const noEmail = leads.filter(l => !isPost(l) && l.status === 'needs_contact').length
  const base = { id: 'email' as const, question: 'Who should I email today?', at, numberLabel: 'ready for your OK',
    source: lastRunAt ? `Lead Finder · last search ${ago(lastRunAt)}` : 'Lead Finder' }
  if (!ready.length) {
    const never = !leads.length && !lastRunAt
    return {
      ...base, number: '0', state: 'empty',
      say: never ? 'No leads yet. Lead Finder looks for businesses that fit what you sell and writes the first email for you.'
        : `Nothing waiting for your OK.${noEmail ? ` ${plural(noEmail, 'good fit')} still ${noEmail === 1 ? 'needs' : 'need'} an email.` : ''}`,
      picture: null, pictureTitle: '', finds: [],
      next: { title: never ? 'Find your first leads' : 'Find new leads', why: 'A search takes a few minutes.', label: never ? 'Start' : 'Find leads', href: '/leads' },
      then: [],
    }
  }
  const top = ready[0]
  const why = cut(top.why, 110)
  return {
    ...base, number: String(ready.length), state: 'ok',
    say: `**${plural(ready.length, 'email')}** ${ready.length === 1 ? 'is' : 'are'} ready for your OK. Start with **${nameOf(top)}**${why ? `: ${lowerFirst(why)}${/[!?…]$/.test(why) ? '' : '.'}` : '.'}`,
    picture: { kind: 'list', rows: ready.slice(0, 5).map(l => ({ name: nameOf(l), note: l.fitLabel ? `${l.fitLabel} · ${cut(l.why, 50)}` : cut(l.why, 60) })) },
    pictureTitle: 'Ready for your OK',
    finds: [],
    next: {
      title: `Review ${nameOf(top)}’s email`,
      why: top.draft ? 'Written and ready. Approve, change or skip.' : 'It’s written when you open it. Approve, change or skip.',
      label: 'Review the email', href: `/leads?lead=${encodeURIComponent(top.id)}`,
    },
    then: [
      ...(ready.length > 1 ? [{ title: `${ready.length - 1} more after ${nameOf(top)}`, why: 'Each one opens after the last' }] : []),
      ...(noEmail ? [{ title: `${plural(noEmail, 'good fit')} without an email`, why: 'In Lead Finder, under each one' }] : []),
    ].slice(0, 2),
  }
}

// ── Why am I not on Google? ──────────────────────────────────────────────────
// The Search Console API has no "pages indexed" count (that report is only on the website), so this
// compares the pages in the sitemap with the pages that showed up in a Google search.

const norm = (u: string) => {
  try { const x = new URL(u); x.hash = ''; x.search = ''; x.hostname = x.hostname.replace(/^www\./, ''); if (x.pathname !== '/' && x.pathname.endsWith('/')) x.pathname = x.pathname.slice(0, -1); return x.href } catch { return u }
}
const section = (u: string) => {
  try { const p = new URL(u).pathname.split('/').filter(Boolean); return p.length > 1 ? `/${p[0]}/` : 'Main pages' } catch { return 'Main pages' }
}

async function googleCard(brandId: string, websiteUrl: string, at: string): Promise<Answer> {
  const base = { id: 'google' as const, question: 'Why am I not on Google?', at }
  const [integ] = await db.select({ metadata: brandIntegrations.metadata }).from(brandIntegrations)
    .where(and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.provider, 'gsc_api'), eq(brandIntegrations.status, 'connected'))).limit(1)
  const meta = (integ?.metadata as Record<string, string> | null) ?? {}
  if (!meta.client_email || !meta.private_key) {
    return {
      ...base, number: '—', numberLabel: 'connect Search Console', state: 'connect',
      say: 'Connect Google Search Console and this shows how many of your pages turn up on Google, and which ones don’t.',
      picture: null, pictureTitle: '', finds: [],
      next: { title: 'Connect Search Console', why: 'Takes about 5 minutes. Free.', label: 'Connect', href: '/analytics' },
      then: [], source: 'Google Search Console',
    }
  }

  const origin = (() => { try { return new URL(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`).origin } catch { return '' } })()
  let failed = false
  const [rows, sitemap] = await Promise.all([
    // Throws when Search Console refuses the key; null when it has no data for the site
    fetchGscPageTraffic(meta.client_email, meta.private_key, websiteUrl, GOOGLE_DAYS).catch(e => { failed = true; console.error('[ask] search console', e); return null }),
    origin ? getSitemap(origin).catch(() => new Map<string, string | null>()) : Promise.resolve(new Map<string, string | null>()),
  ])
  if (failed) {
    return {
      ...base, number: '—', numberLabel: 'Search Console didn’t answer', state: 'connect',
      say: 'Search Console didn’t let us read your data this time. The connection may need checking.',
      picture: null, pictureTitle: '', finds: [],
      next: { title: 'Check the Search Console connection', why: 'On the Analytics page, Website tab.', label: 'Check', href: '/analytics' },
      then: [], source: 'Google Search Console',
    }
  }
  return googleAnswer({ at, origin, websiteUrl, listed: [...sitemap.keys()], rows: rows ?? [] })
}

/** The Google answer from the sitemap's pages and Search Console's rows (no fetching here). */
export function googleAnswer({ at, origin, websiteUrl, listed: listedRaw, rows }: {
  at: string; origin: string; websiteUrl: string; listed: string[]; rows: { page: string; clicks: number; impressions: number }[]
}): Answer {
  const base = { id: 'google' as const, question: 'Why am I not on Google?', at }
  const shown = new Map(rows.filter(r => r.impressions > 0).map(r => [norm(r.page), r]))
  const clicked = [...shown.values()].filter(r => r.clicks > 0).length
  const listed = [...new Set(listedRaw.map(norm))]
  const listedShown = listed.filter(u => shown.has(u)).length
  const source = `Google Search Console, last ${GOOGLE_DAYS} days · ${listed.length ? 'your sitemap, read today' : 'no sitemap found'}`
  const gscLink = { href: `https://search.google.com/search-console/index?resource_id=${encodeURIComponent(origin ? `${origin}/` : websiteUrl)}`, external: true }

  // No sitemap: only what Google showed
  if (!listed.length) {
    return {
      ...base, number: String(shown.size), numberLabel: 'pages in Google searches', state: 'ok',
      say: `**${plural(shown.size, 'page')}** showed up in a Google search in the last ${GOOGLE_DAYS} days. We couldn’t find a sitemap at ${origin}/sitemap.xml, so Google has to find your pages through links.`,
      picture: { kind: 'bars', rows: [{ label: 'Showed up in a search', value: shown.size }, { label: 'Got a click', value: clicked, strong: true }] },
      pictureTitle: `Your pages on Google, last ${GOOGLE_DAYS} days`, finds: [],
      next: { title: 'Add a sitemap', why: 'A list of your pages for Google, usually one setting in your site builder.', label: 'Open Search Console', ...gscLink },
      then: [], source,
    }
  }

  // Sections of the sitemap with pages Google hasn't shown, biggest first
  const missing = new Map<string, number>()
  for (const u of listed) if (!shown.has(u)) missing.set(section(u), (missing.get(section(u)) ?? 0) + 1)
  const gaps = [...missing.entries()].sort((a, b) => b[1] - a[1])
  const notShown = listed.length - listedShown
  const [big] = gaps
  const bigShare = big && notShown ? big[1] / notShown : 0
  const finds: string[] = []
  const bigNoted = !!big && big[0] !== 'Main pages' && big[1] >= 20 && bigShare >= 0.5
  if (bigNoted) {
    finds.push(`**${plural(big[1], 'page')} under ${big[0]}** haven’t shown up at all. If they’re made automatically with little text, they can slow Google down on the rest of your site.`)
  }
  if (clicked) finds.push(`**${plural(clicked, 'page')}** got at least one click from Google.`)
  const extra = shown.size - listedShown
  if (extra > 0) finds.push(`${plural(extra, 'page')} showed up that ${extra === 1 ? 'isn’t' : 'aren’t'} in your sitemap.`)

  const share = listed.length ? listedShown / listed.length : 0
  const say = !listedShown
    ? `**None of your ${plural(listed.length, 'page')}** showed up in a Google search in the last ${GOOGLE_DAYS} days.`
    : `**${listedShown} of your ${plural(listed.length, 'page')}** showed up in a Google search in the last ${GOOGLE_DAYS} days${share < 0.5 && big ? `. Most of the rest are ${big[0] === 'Main pages' ? 'main pages' : `under **${big[0]}**`}.` : '.'}`
  return {
    ...base, number: String(listedShown), numberLabel: `of ${listed.length.toLocaleString('en')} pages on Google`, state: 'ok', say,
    picture: { kind: 'bars', rows: [
      { label: 'In your sitemap', value: listed.length },
      { label: 'Showed up in a search', value: listedShown },
      { label: 'Got a click', value: clicked, strong: true },
    ] },
    pictureTitle: `Your pages on Google, last ${GOOGLE_DAYS} days`,
    finds: finds.slice(0, 3),
    next: notShown
      ? { title: 'See why Google left pages out', why: `Search Console’s Pages report gives the reason for each of the ${plural(notShown, 'page')}.`, label: 'Open Search Console', ...gscLink }
      : null,
    // The other sections with pages not showing (the biggest is already a finding when it stood out)
    then: gaps.filter(([s]) => !(bigNoted && s === big[0])).slice(0, 2)
      .map(([s, n]) => ({ title: `${s}: ${plural(n, 'page')} not showing yet`, why: 'Link to them from pages that do show up' })),
    source,
  }
}

// ── Fill, save, read ─────────────────────────────────────────────────────────

const ORDER: CardId[] = ['replies', 'email', 'google']

/** Works every card out again and saves them. Runs with the brand's demo switch. */
export async function fillCards(brandId: string): Promise<AskCards> {
  return withDemo(await readDemoSwitch(brandId), async () => {
    const at = new Date().toISOString()
    const [brand] = await db.select({ websiteUrl: brands.websiteUrl }).from(brands).where(eq(brands.id, brandId)).limit(1)
    const [convs, lead] = await Promise.all([listConversations(brandId).catch(() => []), readLeadData(brandId)])
    const settled = await Promise.allSettled([
      Promise.resolve(repliesCard(convs, at)),
      Promise.resolve(emailCard(lead?.leads ?? [], lead?.lastRunAt, at)),
      googleCard(brandId, brand?.websiteUrl ?? '', at),
    ])
    const cards = settled.flatMap(r => (r.status === 'fulfilled' ? [r.value] : (console.error('[ask] card failed', r.reason), [])))
    const out: AskCards = { at, cards: cards.sort((a, b) => ORDER.indexOf(a.id as CardId) - ORDER.indexOf(b.id as CardId)) }
    await saveSnapshot(brandId, key(), out)
    return out
  })
}

/** The saved cards, worked out again when missing or older than STALE_MS. */
export async function readCards(brandId: string, opts: { refresh?: boolean } = {}): Promise<AskCards> {
  const saved = await withDemo(await readDemoSwitch(brandId), () => getSnapshot<AskCards>(brandId, key()))
  if (!opts.refresh && saved?.at && Date.now() - Date.parse(saved.at) < STALE_MS) return saved
  return fillCards(brandId)
}

/** The saved cards as they are, without working anything out (null when there are none yet). */
export async function savedCards(brandId: string): Promise<AskCards | null> {
  return withDemo(await readDemoSwitch(brandId), () => getSnapshot<AskCards>(brandId, key()))
}
