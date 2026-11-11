// Ask's ready answers (md_files/ASK_PLAN.md): questions worked out every morning, saved per brand in
// signal_snapshots, so opening the page costs nothing. The data comes through the MCP tools
// (lib/ask/tools.ts): list_replies, list_leads, get_search_agent, get_daily_numbers. The Google and
// visibility cards also read Search Console's page check and the sitemap, which have no tool yet.
// The sentences are written here from the numbers, not by AI: free, the same every day, and a
// number can't come out wrong.

import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { getSnapshot, saveSnapshot } from '@/lib/signals'
import { agentsDemo, withDemo } from '@/lib/agents/demo'
import { readDemoSwitch, type IdeaRow } from '@/lib/agents/store'
import { fetchGscPageTraffic, fetchGscTopQueries } from '@/lib/modules/seo/keyword-fetchers'
import type { LeadList, ThreadList, ToolLead, ToolThread } from '@/lib/mcp/tools/inbox'
import { askTool } from './tools'
import { getSitemap } from '@/lib/modules/content-audit/fetcher'
import { CARD_IDS, type Answer, type AskCards, type CardId } from './types'
import { norm, section } from './urls'
import { indexInfo, readAsks, sortPages, type Asks, type IndexInfo } from './indexing'
import { linkingSites, readHomepageCheck, visibilityAnswer } from './visibility'

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
const who = (c: ToolThread) => c.to || c.email || 'Someone'

export function repliesCard(threads: ToolThread[], at: string): Answer {
  const since = Date.now() - REPLY_DAYS * 86_400_000
  const replied = threads
    .filter(c => c.status === 'replied' && (!c.replied_at || Date.parse(c.replied_at) >= since))
    .sort((a, b) => INTENT_ORDER.indexOf(a.intent ?? 'other') - INTENT_ORDER.indexOf(b.intent ?? 'other')
      || Date.parse(b.replied_at ?? '0') - Date.parse(a.replied_at ?? '0'))
  const base = { id: 'replies' as const, question: 'Did anyone reply?', source: 'Emails GrowJin sent, checked for replies every morning', at }
  if (!replied.length) {
    return {
      ...base, number: '0', numberLabel: 'new replies', state: 'empty',
      say: `No new replies in the last ${REPLY_DAYS} days. Follow-ups keep going out by themselves.`,
      picture: null, pictureTitle: '', finds: [], next: null, then: [],
    }
  }
  const [a, b] = replied
  const line = (c: ToolThread) => `**${who(c)}** ${INTENT[c.intent ?? 'other'] ?? 'replied'}`
  const say = replied.length === 1 ? `${line(a)}.`
    : replied.length === 2 ? `${line(a)}, and ${line(b)}.`
    : `${line(a)}, ${line(b)}, and ${plural(replied.length - 2, 'more person', 'more people')} replied.`
  return {
    ...base, number: String(replied.length), numberLabel: replied.length === 1 ? 'reply' : 'replies', state: 'ok', say,
    picture: { kind: 'list', rows: replied.slice(0, 5).map(c => ({ name: who(c), note: c.says ? `“${cut(c.says, 70)}”` : INTENT[c.intent ?? 'other'] ?? 'replied' })) },
    pictureTitle: `Replies, last ${REPLY_DAYS} days`,
    finds: [],
    next: {
      title: `Answer ${who(a)}`,
      why: a.says ? `They wrote: “${cut(a.says, 90)}”` : `Re: ${a.subject}`,
      label: 'Open the reply', href: '/gmail-hub?tab=inbox', panel: { kind: 'reply', threadId: a.thread_id },
    },
    then: replied.length > 1 ? [{ title: replied.length === 2 ? who(b) : `${who(b)} and ${replied.length - 2} more`, why: 'In the Inbox, replies first' }] : [],
  }
}

// ── Who should I email today? ────────────────────────────────────────────────

const nameOf = (l: ToolLead) => l.name
const everLeads = (r: LeadList) => Object.values(r.counts ?? {}).reduce((a, b) => a + b, 0)

/** list: list_leads { status: to_do, lane: email } (best first). */
export function emailCard(list: LeadList, at: string): Answer {
  const ready = (list.leads ?? []).filter(l => !l.needs_email)
  const noEmail = (list.leads ?? []).filter(l => l.needs_email).length
  const lastRunAt = list.last_search?.at
  const base = { id: 'email' as const, question: 'Who should I email today?', at, numberLabel: 'ready for your OK',
    source: lastRunAt ? `Lead Finder · last search ${ago(lastRunAt)}` : 'Lead Finder' }
  if (!ready.length) {
    const never = !everLeads(list) && !lastRunAt
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
    picture: { kind: 'list', rows: ready.slice(0, 5).map(l => ({ name: nameOf(l), note: l.rating ? `${l.rating} · ${cut(l.why, 50)}` : cut(l.why, 60) })) },
    pictureTitle: 'Ready for your OK',
    finds: [],
    next: {
      title: `Review ${nameOf(top)}’s email`,
      why: top.email_draft ? 'Written and ready. Approve, change or skip.' : 'It’s written when you open it. Approve, change or skip.',
      label: 'Review the email', href: `/leads?lead=${encodeURIComponent(top.id)}`, panel: { kind: 'lead', id: top.id, lane: 'email' },
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


/** The brand's Search Console key, or null when it isn't connected. */
async function gscKey(brandId: string): Promise<{ client_email: string; private_key: string } | null> {
  const [integ] = await db.select({ metadata: brandIntegrations.metadata }).from(brandIntegrations)
    .where(and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.provider, 'gsc_api'), eq(brandIntegrations.status, 'connected'))).limit(1)
  const meta = (integ?.metadata as Record<string, string> | null) ?? {}
  return meta.client_email && meta.private_key ? { client_email: meta.client_email, private_key: meta.private_key } : null
}

/** What Google knows about the site: Search Console's pages (and searches) and the sitemap. Fetched once, used by two cards. */
export interface GoogleData {
  state: 'connect' | 'failed' | 'ok'
  origin: string
  websiteUrl: string
  listed: string[]
  rows: { page: string; clicks: number; impressions: number }[]
  queries: { query: string; clicks: number; impressions: number }[] | null   // last 90 days, null when unread
  lastmod: Record<string, string | null>   // the sitemap's dates, by the sitemap's own address
  index: IndexInfo | null                  // what Google says about the pages not showing (URL Inspection), the site's first day on Google
  asks: Asks                               // pages the owner asked Google to index ("Done, I asked Google")
}

export async function googleData(brandId: string, websiteUrl: string): Promise<GoogleData> {
  const origin = (() => { try { return new URL(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`).origin } catch { return '' } })()
  const base = { origin, websiteUrl, listed: [], rows: [], queries: null, lastmod: {}, index: null, asks: {} }
  const meta = await gscKey(brandId)
  if (!meta) return { ...base, state: 'connect' }
  let failed = false
  const [rows, sitemap, queries] = await Promise.all([
    // Throws when Search Console refuses the key; null when it has no data for the site
    fetchGscPageTraffic(meta.client_email, meta.private_key, websiteUrl, GOOGLE_DAYS).catch(e => { failed = true; console.error('[ask] search console', e); return null }),
    origin ? getSitemap(origin).catch(() => new Map<string, string | null>()) : Promise.resolve(new Map<string, string | null>()),
    fetchGscTopQueries(meta.client_email, meta.private_key, websiteUrl, 250).catch(() => null),
  ])
  if (failed) return { ...base, state: 'failed' }
  const listed = [...sitemap.keys()]
  const lastmod = Object.fromEntries(sitemap)
  const shown = new Set((rows ?? []).filter(r => r.impressions > 0).map(r => norm(r.page)))
  const asks = await readAsks(brandId).catch(() => ({}))
  const index = await indexInfo(brandId, meta, websiteUrl, listed.filter(u => !shown.has(norm(u))), lastmod, asks)
    .catch(e => { console.error('[ask] url inspection', e); return null })
  return { ...base, state: 'ok', listed, rows: rows ?? [], queries, lastmod, index, asks }
}

function googleFromData(d: GoogleData, at: string): Answer {
  const base = { id: 'google' as const, question: 'Why am I not on Google?', at }
  if (d.state === 'connect') {
    return {
      ...base, number: '—', numberLabel: 'connect Search Console', state: 'connect',
      say: 'Connect Google Search Console and this shows how many of your pages turn up on Google, and which ones don’t.',
      picture: null, pictureTitle: '', finds: [],
      next: { title: 'Connect Search Console', why: 'Takes about 5 minutes. Free.', label: 'Connect', href: '/analytics' },
      then: [], source: 'Google Search Console',
    }
  }
  if (d.state === 'failed') {
    return {
      ...base, number: '—', numberLabel: 'Search Console didn’t answer', state: 'connect',
      say: 'Search Console didn’t let us read your data this time. The connection may need checking.',
      picture: null, pictureTitle: '', finds: [],
      next: { title: 'Check the Search Console connection', why: 'On the Analytics page, Website tab.', label: 'Check', href: '/analytics' },
      then: [], source: 'Google Search Console',
    }
  }
  return googleAnswer({ at, origin: d.origin, websiteUrl: d.websiteUrl, listed: d.listed, rows: d.rows, lastmod: d.lastmod, index: d.index, asks: d.asks })
}

/** The Google answer from the sitemap's pages and Search Console's rows (no fetching here). */
export function googleAnswer({ at, origin, websiteUrl, listed: listedRaw, rows, lastmod = {}, index = null, asks = {}, now = Date.now() }: {
  at: string; origin: string; websiteUrl: string; listed: string[]; rows: { page: string; clicks: number; impressions: number }[]
  lastmod?: Record<string, string | null>; index?: IndexInfo | null; asks?: Asks; now?: number
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
      next: {
        title: 'Add a sitemap', why: 'A list of your pages for Google, usually one setting in your site builder.', label: 'Get the fix', ...gscLink,
        panel: {
          kind: 'brief', title: 'Add a sitemap', intro: 'Give this to whoever runs your website. It takes about 15 minutes.',
          steps: [
            `Make a sitemap at ${origin}/sitemap.xml listing every page you want on Google. Most site builders have a setting for it (WordPress, Webflow, Shopify and Wix make one for you).`,
            'Leave out login, account and thank-you pages.',
            `Add the line “Sitemap: ${origin}/sitemap.xml” to ${origin}/robots.txt.`,
            'In Search Console, open Sitemaps and submit it.',
          ],
          link: { label: 'Open Search Console', href: gscLink.href },
        },
      },
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
  const bigNoted = !!big && big[0] !== 'Main pages' && big[1] >= 20 && bigShare >= 0.5
  const extra = shown.size - listedShown

  // Each page that hasn't shown up, sorted by what Google says about it, its age, the site's age and
  // whether the owner already asked Google (lib/ask/indexing.ts)
  const rawOf = new Map(listedRaw.map(u => [norm(u), u]))
  const sorted = sortPages({ notShown: listed.filter(u => !shown.has(u)).map(u => rawOf.get(u) ?? u), shown: new Set(shown.keys()), lastmod, info: index, asks, now })
  const c = sorted.counts
  const checked = !!index && Object.keys(index.pages).length > 0
  const nudge = c.todo + c.improve
  const sitemapMissing = index?.sitemaps != null && !index.sitemaps.length
  const firstDay = index?.firstSeen ? new Date(index.firstSeen).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
  const siteLine = !sorted.newSite ? ''
    : sorted.siteDays != null
      ? `**New sites usually take 1–3 months** to be picked up fully. Yours first showed up in a search on ${firstDay}. Asking Google about your main pages speeds it up.`
      : '**Nothing has shown up in a search yet.** That’s normal in the first few weeks of a new site; asking Google about your main pages speeds it up.'

  const finds: string[] = []
  if (siteLine) finds.push(siteLine)
  if (bigNoted) finds.push(`**${plural(big[1], 'page')} under ${big[0]}** haven’t shown up at all. If they’re made automatically with little text, they can slow Google down on the rest of your site.`)
  if (sorted.askedIn) finds.push(`**${plural(sorted.askedIn, 'page')} you asked Google for** ${sorted.askedIn === 1 ? 'is' : 'are'} on Google now.`)
  if (sitemapMissing) finds.push('Your sitemap isn’t submitted in Search Console, so Google may not know all your pages.')
  if (c.improve) finds.push(`**${plural(c.improve, 'page')}** Google read and left out, or still out weeks after you asked. Usually too little text.`)
  if (c.blocked) finds.push(`**${plural(c.blocked, 'page')}** ${c.blocked === 1 ? 'is' : 'are'} blocked from Google (a noindex tag, a redirect or a missing page).`)
  if (clicked) finds.push(`**${plural(clicked, 'page')}** got at least one click from Google.`)
  if (extra > 0) finds.push(`${plural(extra, 'page')} showed up that ${extra === 1 ? 'isn’t' : 'aren’t'} in your sitemap.`)

  const share = listed.length ? listedShown / listed.length : 0
  const rest = checked && notShown
    ? ` Of the other ${notShown.toLocaleString('en')}: ${[
      nudge && `**${nudge.toLocaleString('en')} need${nudge === 1 ? 's' : ''} a nudge**`,
      c.wait && `${c.wait.toLocaleString('en')} ${c.wait === 1 ? 'is' : 'are'} new or waiting on your request`,
      c.indexed && `${c.indexed.toLocaleString('en')} ${c.indexed === 1 ? 'is' : 'are'} on Google but not searched for yet`,
      c.blocked && `${c.blocked.toLocaleString('en')} ${c.blocked === 1 ? 'is' : 'are'} blocked`,
    ].filter(Boolean).join(', ')}.`
    : share < 0.5 && big ? ` Most of the rest are ${big[0] === 'Main pages' ? 'main pages' : `under **${big[0]}**`}.` : ''
  const newLead = !sorted.newSite ? ''
    : sorted.siteDays != null ? `**Your site is new to Google** (first in a search ${plural(sorted.siteDays, 'day')} ago), so part of this is just time. ` : '**Your site is new to Google**, so part of this is just time. '
  const say = newLead + (!listedShown
    ? `**None of your ${plural(listed.length, 'page')}** showed up in a Google search in the last ${GOOGLE_DAYS} days.`
    : `**${listedShown} of your ${plural(listed.length, 'page')}** showed up in a Google search in the last ${GOOGLE_DAYS} days.`) + rest

  const property = index?.property ?? (origin ? `${origin}/` : websiteUrl)
  const indexPanel = (lede: string) => ({
    kind: 'index' as const, property, lede: `${sorted.newSite ? 'Your site is new to Google, so some pages just need time. ' : ''}${lede}`,
    rows: sorted.rows.slice(0, 80),
  })
  const askLede = 'Google allows about 10 requests a day, so start at the top. For each page: open it in Search Console, click Request indexing, then press Done here. We check every morning and tell you when it’s in.'

  const hideNext = bigNoted ? {
    title: `Hide the ${plural(big[1], 'page')} under ${big[0]} from Google`, why: 'If they’re made automatically with little text, they slow Google down on the rest of your site.', label: 'Get the fix', ...gscLink,
    panel: {
      kind: 'brief' as const, title: `Hide the pages under ${big[0]} from Google`,
      intro: `Only do this if the pages under ${big[0]} are made automatically with little text (one per post, user or item). They stay live for visitors; Google just stops listing them, and spends its visits on your real pages. Give this to whoever runs your website.`,
      steps: [
        `Add a noindex tag to every page under ${big[0]} (in the page’s <head>, see below).`,
        `Take those pages out of your sitemap. If one page lists the best of them, keep that one in.`,
        `Don’t block ${big[0]} in robots.txt yet: Google has to read each page once to see the noindex.`,
        'Check one of the pages afterwards: its source should show the noindex tag, and your homepage’s should not.',
        'In Search Console, resubmit your sitemap. Google drops the pages over the next few weeks.',
      ],
      code: '<meta name="robots" content="noindex, follow">',
      link: { label: 'Open Search Console', href: gscLink.href },
    },
  } : null

  const next: Answer['next'] = !notShown ? null
    : hideNext ? hideNext
      : !checked ? {
        // URL Inspection didn't answer: the general fix
        title: 'Help Google find your other pages', why: `${plural(notShown, 'page')} in your sitemap haven’t shown up in a search yet.`, label: 'Get the fix', ...gscLink,
        panel: {
          kind: 'brief', title: 'Help Google find your other pages',
          intro: 'Google finds pages through links. Pages nothing links to look unimportant, so they wait longest.',
          steps: [
            'Link to these pages from your homepage or from related pages that do show up, with words that describe them (not “read more”).',
            'Give every blog post at least two links from other posts.',
            'In Search Console, use URL Inspection and “Request indexing” on the five that matter most (about ten a day are allowed).',
            'If a page has little text, add to it first: thin pages are often read and then left out.',
          ],
          code: listed.filter(u => !shown.has(u)).slice(0, 12).map(u => rawOf.get(u) ?? u).join('\n'),
          link: { label: 'Open Search Console', href: gscLink.href },
        },
      }
        : c.todo ? { title: `Ask Google to look at ${plural(c.todo, 'page')}`, why: 'Open each in Search Console, click Request indexing, then mark it done here. We keep track.', label: 'Start', ...gscLink, panel: indexPanel(askLede) }
          : c.improve ? { title: `Improve ${plural(c.improve, 'page')} Google left out`, why: 'Add more of your own words and link to them, then ask Google again.', label: 'See the pages', ...gscLink, panel: indexPanel('Asking again won’t help until the page changes. Add more of your own text, link to it from a page that shows up, then ask Google and press Done here.') }
            : c.blocked ? { title: `Unblock ${plural(c.blocked, 'page')}`, why: 'Something on the page tells Google to skip it.', label: 'See the pages', ...gscLink, panel: indexPanel('Each page says what’s stopping Google. Some may be on purpose (like a thank-you page): then take them out of your sitemap.') }
              : c.wait ? { title: 'Give it time', why: `${plural(c.wait, 'page')} ${c.wait === 1 ? 'is' : 'are'} new or waiting on your request. Nothing to do; we check every morning.`, label: 'See each page', ...gscLink, panel: indexPanel('Nothing to do for these yet. New pages and pages you asked about usually get in within 2 weeks.') }
                : { title: 'Help people find pages Google already has', why: `${plural(c.indexed, 'page')} ${c.indexed === 1 ? 'is' : 'are'} on Google, but nobody searched words ${c.indexed === 1 ? 'it answers' : 'they answer'} yet.`, label: 'See the pages', ...gscLink, panel: indexPanel('Google has these. To get them seen: make each title say what people search, and link to them from pages that do show up.') }

  const then: Answer['then'] = checked
    ? [
      ...(sitemapMissing ? [{ title: 'Submit your sitemap in Search Console', why: `Sitemaps → add ${origin}/sitemap.xml` }] : []),
      ...(hideNext && nudge ? [{ title: `Ask Google to look at ${plural(nudge, 'page')}`, why: 'After hiding the thin pages' }] : []),
      ...(c.wait ? [{ title: `${plural(c.wait, 'page')}: give it time`, why: 'New, or you already asked Google' }] : []),
      { title: 'Link to new pages from pages that show up', why: 'Google visits linked pages sooner' },
    ].slice(0, 2)
    // The other sections with pages not showing (the biggest is already a finding when it stood out)
    : gaps.filter(([s]) => !(bigNoted && s === big[0])).slice(0, 2).map(([s, n]) => ({ title: `${s}: ${plural(n, 'page')} not showing yet`, why: 'Link to them from pages that do show up' }))

  return {
    ...base, number: String(listedShown), numberLabel: `of ${listed.length.toLocaleString('en')} ${listed.length === 1 ? 'page' : 'pages'} on Google`, state: 'ok', say,
    picture: { kind: 'bars', rows: checked
      ? [
        { label: 'In your sitemap', value: listed.length },
        { label: 'Showed up in a search', value: listedShown },
        ...(c.indexed ? [{ label: 'On Google, not searched for yet', value: c.indexed }] : []),
        ...(c.wait ? [{ label: 'New, or waiting on your request', value: c.wait }] : []),
        { label: 'Need a nudge', value: nudge, strong: true },
        ...(c.blocked ? [{ label: 'Blocked', value: c.blocked }] : []),
      ]
      : [
        { label: 'In your sitemap', value: listed.length },
        { label: 'Showed up in a search', value: listedShown },
        { label: 'Got a click', value: clicked, strong: true },
      ] },
    pictureTitle: `Your pages on Google, last ${GOOGLE_DAYS} days`,
    finds: finds.slice(0, 3),
    next,
    then,
    source: checked ? `${source} · Google’s own check of ${plural(Object.keys(index!.pages).length, 'page')}` : source,
  }
}


// ── What should I write this week? ───────────────────────────────────────────
// The Search Agent's posts to write: drafted ones first (only a check is left), then the rest.

const TOPIC_OPEN = ['drafted', 'writing', 'picked']
const level = (d: number | null) => (d == null || d === 0 ? 'difficulty unknown' : d < 15 ? 'easy' : d < 30 ? 'fairly easy' : d < 50 ? 'medium' : 'hard')
const perMonth = (n: number) => `${n.toLocaleString('en')} a month`

/** What get_search_agent { section: topics } answers. */
export interface TopicsResult { set_up?: boolean; last_research_at?: string | null; starting_keywords?: string[]; topics?: { keyword: string; kind: string; status: string; volume: number; difficulty: number | null; why: string; blog_id?: string; page_to_rewrite?: string }[]; error?: string }

export function postCard(search: TopicsResult, at: string): Answer {
  const base = { id: 'post' as const, question: 'What should I write this week?', at, source: search.last_research_at ? `Search Agent · research ${ago(search.last_research_at)}` : 'Search Agent' }
  const open = (search.topics ?? []).filter(t => TOPIC_OPEN.includes(t.status))
    .sort((a, b) => TOPIC_OPEN.indexOf(a.status) - TOPIC_OPEN.indexOf(b.status) || b.volume - a.volume)
  if (!open.length) {
    const never = !search.last_research_at
    return {
      ...base, number: '0', numberLabel: 'posts to write', state: 'empty',
      say: never ? 'The Search Agent hasn’t researched your market yet. It finds what your buyers search for and drafts posts for you.'
        : 'Nothing to write right now. The Search Agent picks new posts with its weekly research.',
      picture: null, pictureTitle: '', finds: [],
      next: never ? { title: 'Start the Search Agent', why: 'The first research takes a few minutes.', label: 'Open the Search Agent', href: '/agents/search' } : null,
      then: [],
    }
  }
  const top = open[0]
  const drafted = open.filter(t => t.status === 'drafted').length
  return {
    ...base, number: String(open.length), numberLabel: open.length === 1 ? 'post to write' : 'posts to write', state: 'ok',
    say: `${drafted ? `**${plural(drafted, 'draft')}** ${drafted === 1 ? 'is' : 'are'} ready to check` : `**${plural(open.length, 'post')}** to write`}. Start with **“${top.keyword}”**${top.kind === 'improve' ? ' (a rewrite of a page you have)' : ''}: searched ${top.volume.toLocaleString('en')} times a month, ${level(top.difficulty)}.`,
    picture: { kind: 'list', rows: open.slice(0, 5).map(t => ({ name: t.keyword, note: `${perMonth(t.volume)} · ${level(t.difficulty)}${t.status === 'drafted' ? ' · drafted' : t.kind === 'improve' ? ' · rewrite' : ''}` })) },
    pictureTitle: 'Posts to write',
    finds: top.why ? [cut(top.why, 160)] : [],
    next: {
      title: top.status === 'drafted' ? `Check the draft for “${top.keyword}”` : `Write about “${top.keyword}”`,
      why: top.status === 'drafted' ? 'It’s written. Read it, add what only you know, then publish.' : 'The Search Agent drafts it for you after three short questions.',
      label: top.status === 'drafted' ? 'Check the draft' : 'Write it', href: '/agents/search',
    },
    then: open.length > 1 ? [{ title: `${open.length - 1} more after this one`, why: open.slice(1, 3).map(t => `“${t.keyword}”`).join(', ') }] : [],
  }
}

// ── Where should I talk about {brand}? ───────────────────────────────────────
// Reddit and Hacker News posts Lead Finder found asking for a tool like yours, waiting for a reply.

const where = (l: ToolLead) => l.from

/** list: list_leads { status: to_do, lane: talk } (best first). */
export function talkCard(list: LeadList, brandName: string, at: string): Answer {
  const ready = list.leads ?? []
  const posted = list.counts?.posted ?? 0
  const posts = { length: ready.length + posted }
  const base = { id: 'talk' as const, question: `Where should I talk about ${brandName}?`, at, source: 'Lead Finder · Reddit and Hacker News' }
  if (!ready.length) {
    return {
      ...base, number: '0', numberLabel: 'threads to reply to', state: 'empty',
      say: posts.length ? `No new threads waiting.${posted ? ` You’ve replied to ${plural(posted, 'thread')} so far.` : ''}`
        : 'No threads yet. Lead Finder looks for Reddit and Hacker News posts asking for a tool like yours.',
      picture: null, pictureTitle: '', finds: [],
      next: posts.length ? null : { title: 'Turn on Reddit in Lead Finder', why: 'In Lead Finder’s Settings.', label: 'Open Lead Finder', href: '/leads' },
      then: [],
    }
  }
  const top = ready[0]
  return {
    ...base, number: String(ready.length), numberLabel: ready.length === 1 ? 'thread to reply to' : 'threads to reply to', state: 'ok',
    say: `**${plural(ready.length, 'thread')}** ${ready.length === 1 ? 'asks' : 'ask'} for a tool like yours. Start with **${where(top)}**: “${cut(top.name, 80)}”${/[?!…]$/.test(cut(top.name, 80)) ? '' : '.'}`,
    picture: { kind: 'list', rows: ready.slice(0, 5).map(l => ({ name: cut(l.name, 70), note: where(l) })) },
    pictureTitle: 'Worth a reply',
    finds: [
      'Answer the question fully first; mention your product only where it really helps, and say you built it.',
      ...(posted ? [`You’ve replied to **${plural(posted, 'thread')}** so far.`] : []),
    ],
    next: { title: 'Read the reply for this thread', why: 'It’s written when you open it. You post it yourself, from your own account.', label: 'Open the thread', href: `/leads?lead=${encodeURIComponent(top.id)}`, panel: { kind: 'lead', id: top.id, lane: 'talk' } },
    then: ready.length > 1 ? [{ title: `${ready.length - 1} more after this one`, why: 'In Lead Finder, Join conversations' }] : [],
  }
}

// ── Which search words can I win? ────────────────────────────────────────────
// Keyword ideas from the Search Agent's last research that fit your buyers and are easy (< 30).

/** What get_search_agent { section: ai_answers } answers (the parts the visibility score uses). */
export interface AiResult { answers?: AiRow[]; error?: string }
export interface AiRow { named: boolean; asked_times?: number; named_times?: number; error?: string }

/** What get_search_agent { section: keywords } answers. */
export interface KeywordsResult { ideas_at?: string | null; ideas?: IdeaRow[]; error?: string }

export function keysCard(search: KeywordsResult, at: string): Answer {
  const rows = search.ideas ?? []
  const base = { id: 'keys' as const, question: 'Which search words can I win?', at, source: search.ideas_at ? `Search Agent keyword research · ${ago(search.ideas_at)}` : 'Search Agent keyword research' }
  const win = rows.filter(r => (r.verdict === 'picked' || r.verdict === 'fit') && r.difficulty != null && r.difficulty > 0 && r.difficulty < 30 && r.volume > 0)
    .sort((a, b) => b.volume - a.volume)
  if (!win.length) {
    return {
      ...base, number: '0', numberLabel: 'easy buyer searches', state: 'empty',
      say: rows.length ? 'None of the search words found so far are both right for your buyers and easy to win. The next research looks again.'
        : 'The Search Agent hasn’t looked at search words yet. Its first research finds what your buyers type into Google.',
      picture: null, pictureTitle: '', finds: [],
      next: { title: rows.length ? 'See every search word checked' : 'Start the Search Agent', why: rows.length ? 'And why each one was or wasn’t picked.' : 'The first research takes a few minutes.', label: 'Open Keywords', href: '/agents/search?tab=rank' },
      then: [],
    }
  }
  const total = win.reduce((n, r) => n + r.volume, 0)
  const hard = rows.filter(r => r.verdict === 'hard').length
  const top = win[0]
  return {
    ...base, number: String(win.length), numberLabel: 'easy buyer searches', state: 'ok',
    say: `**${plural(win.length, 'buyer search', 'buyer searches')}** ${win.length === 1 ? 'is' : 'are'} easy enough to win now, about **${perMonth(total)}** together. The biggest is **“${top.keyword}”**.`,
    picture: { kind: 'bars', rows: win.slice(0, 6).map((r, i) => ({ label: `${r.keyword} · ${level(r.difficulty)}`, value: r.volume, strong: i === 0 })) },
    pictureTitle: 'Searches a month',
    finds: [
      ...(top.cpc ? [`Advertisers pay about **$${top.cpc.toFixed(2)} a click** for “${top.keyword}”, a sign of real buyers.`] : []),
      ...(hard ? [`${plural(hard, 'bigger search word')} ${hard === 1 ? 'is' : 'are'} too hard for a new site for now.`] : []),
    ],
    next: { title: `Write about “${top.keyword}”`, why: 'One page per search word. The Search Agent drafts it.', label: 'Open Keywords', href: '/agents/search?tab=rank' },
    then: win.length > 1 ? [{ title: `Then “${win[1].keyword}”`, why: perMonth(win[1].volume) }] : [],
  }
}

// ── Am I on track? ───────────────────────────────────────────────────────────
// This week against last week: how often Google showed the site, clicks, emails sent and replies.
// Search Console runs ~2 days behind, so both weeks end 2 days ago.

export interface Week { impressions: number; clicks: number }
const pct = (now: number, before: number) => (before ? Math.round(((now - before) / before) * 100) : null)
const signed = (n: number | null) => (n == null ? '' : n > 0 ? `+${n}%` : `${n}%`)

export function trackCard(gsc: { now: Week; before: Week } | 'connect' | 'failed', threads: ToolThread[], at: string): Answer {
  const weekAgo = Date.now() - 7 * 86_400_000
  const sent = threads.filter(c => c.sent_at && Date.parse(c.sent_at) >= weekAgo).length
  const replied = threads.filter(c => c.status === 'replied' && c.replied_at && Date.parse(c.replied_at) >= weekAgo).length
  const base = { id: 'track' as const, question: 'Am I on track?', at }
  const mail = [{ value: String(sent), label: 'emails sent' }, { value: String(replied), label: replied === 1 ? 'reply' : 'replies' }]
  if (gsc === 'connect' || gsc === 'failed') {
    return {
      ...base, number: String(sent), numberLabel: 'emails sent this week', state: 'ok',
      say: `This week: **${plural(sent, 'email')}** sent and **${plural(replied, 'reply', 'replies')}**. ${gsc === 'connect' ? 'Connect Search Console to see how you’re doing on Google too.' : 'Search Console didn’t answer, so Google isn’t included.'}`,
      picture: { kind: 'tiles', items: [...mail, { value: '?', label: 'seen on Google · needs Search Console', missing: true }] },
      pictureTitle: 'Last 7 days', finds: [],
      next: { title: gsc === 'connect' ? 'Connect Search Console' : 'Check the Search Console connection', why: 'On the Analytics page, Website tab.', label: gsc === 'connect' ? 'Connect' : 'Check', href: '/analytics' },
      then: [], source: 'Emails GrowJin sent · last 7 days',
    }
  }
  const { now, before } = gsc
  const ch = pct(now.impressions, before.impressions)
  const up = ch == null ? now.impressions > 0 : ch >= 0
  const say = ch == null
    ? `Google showed you **${plural(now.impressions, 'time')}** this week, the first week with data. ${plural(sent, 'email')} went out.`
    : up
      ? `**Yes.** Google showed you **${plural(now.impressions, 'time')}** this week, ${ch === 0 ? 'the same as' : `up ${ch}% on`} last week. ${plural(sent, 'email')} went out and ${plural(replied, 'person', 'people')} replied.`
      : `**Not yet.** Google showed you **${plural(now.impressions, 'time')}** this week, down ${Math.abs(ch)}% on last week. ${plural(sent, 'email')} went out and ${plural(replied, 'person', 'people')} replied.`
  const cch = pct(now.clicks, before.clicks)
  return {
    ...base, number: ch == null ? now.impressions.toLocaleString('en') : signed(ch), numberLabel: ch == null ? 'times seen on Google' : 'seen on Google vs last week', state: 'ok', say,
    picture: { kind: 'tiles', items: [
      { value: now.impressions.toLocaleString('en'), label: `seen on Google${ch == null ? '' : ` · ${signed(ch)}`}` },
      { value: now.clicks.toLocaleString('en'), label: `clicks from Google${cch == null ? '' : ` · ${signed(cch)}`}` },
      { value: String(sent), label: `emails sent · ${replied} ${replied === 1 ? 'reply' : 'replies'}` },
    ] },
    pictureTitle: 'Last 7 days',
    finds: [
      ...(now.clicks < before.clicks ? [`Clicks went from ${before.clicks} to ${now.clicks}; they often lag behind being seen.`] : []),
      ...(!sent ? ['No emails went out this week.'] : []),
    ],
    next: up
      ? (sent ? null : { title: 'Send a few emails', why: 'Leads are waiting for your OK in Lead Finder.', label: 'Open Lead Finder', href: '/leads' })
      : { title: 'See which pages Google left out', why: 'The “Why am I not on Google?” answer shows where.', label: 'Open the answer', href: '/ask?q=google' },
    then: [], source: 'Google Search Console (ends 2 days ago, it runs behind) · emails GrowJin sent',
  }
}

/** This week and last from get_daily_numbers (Search Console, both weeks ending on its latest day). */
async function trackFetch(brandId: string): Promise<{ now: Week; before: Week } | 'connect' | 'failed'> {
  const d = await askTool<{ google_search?: { clicks_last_7d?: number; clicks_previous_7d?: number; impressions_last_7d?: number; impressions_previous_7d?: number }; not_available?: Record<string, string> }>(brandId, 'get_daily_numbers')
  const g = d.google_search
  if (g?.impressions_last_7d != null) {
    return { now: { impressions: g.impressions_last_7d, clicks: g.clicks_last_7d ?? 0 }, before: { impressions: g.impressions_previous_7d ?? 0, clicks: g.clicks_previous_7d ?? 0 } }
  }
  if (g) return { now: { impressions: 0, clicks: 0 }, before: { impressions: 0, clicks: 0 } }   // connected, no searches yet
  const why = d.not_available?.google_search ?? d.error ?? ''
  return /isn.t connected|not connected|no property|can.t see/i.test(why) ? 'connect' : 'failed'
}

// ── Fill, save, read ─────────────────────────────────────────────────────────

const ORDER: readonly CardId[] = CARD_IDS

/** Progress while the cards are worked out: a step starts ('on') and ends ('done' / 'failed'). */
export type OnStep = (e: { id: string; text: string; state: 'on' | 'done' | 'failed'; result?: string }) => void

// What each card does, in plain words, for the progress list
const STEP_TEXT: Record<CardId, string> = {
  replies: 'Checking which of your emails got replies',
  seen: 'Scoring how visible you are on Google and in AI answers',
  email: 'Looking at the leads Lead Finder found',
  google: 'Asking Search Console which pages showed up, and reading your sitemap',
  post: 'Reading the Search Agent’s posts to write',
  talk: 'Looking for Reddit and Hacker News threads to join',
  keys: 'Reading the Search Agent’s keyword research',
  track: 'Comparing this week with last week on Google',
}

/** Questions to ask next from a card: about its own answer, or another card's question (which opens that card). */
function related(a: Answer, brandName: string): string[] {
  const talk = `Where should I talk about ${brandName}?`
  const r: Record<CardId, string[]> = {
    seen: a.suggested ?? [],
    replies: a.state === 'ok'
      ? ['What do the people who replied have in common?', 'How many emails went out this week?', 'Who should I email today?']
      : ['How are my emails doing?', 'Who should I email today?'],
    email: a.state === 'ok'
      ? ['Which kinds of business reply most?', 'How many leads did I skip, and why?', 'Did anyone reply?']
      : ['How are my emails doing?', talk],
    google: ['Which pages bring the most visitors?', 'Which search words can I win?', 'Am I on track?'],
    post: ['Which of my posts bring the most visitors?', 'Which search words can I win?'],
    talk: ['Where do my visitors come from?', 'Who should I email today?'],
    keys: ['Which search words do I already show up for?', 'What should I write this week?'],
    track: /^-/.test(a.number) || /Not yet/.test(a.say)
      ? ['Which pages lost visitors this week?', 'Why am I not on Google?', 'Where do my visitors come from?']
      : ['Which pages bring the most visitors?', 'Where do my visitors come from?', 'Why am I not on Google?'],
  }
  return r[a.id as CardId] ?? []
}

/** Works every card out again and saves them. Runs with the brand's demo switch. */
export async function fillCards(brandId: string, onStep: OnStep = () => {}): Promise<AskCards> {
  return withDemo(await readDemoSwitch(brandId), async () => {
    const at = new Date().toISOString()
    const [brand] = await db.select({ name: brands.name, websiteUrl: brands.websiteUrl, keywords: brands.keywords }).from(brands).where(eq(brands.id, brandId)).limit(1)
    onStep({ id: 'read', text: 'Reading your emails, leads and research', state: 'on' })
    // Everything through the MCP tools. The Search Agent calls go one after another (each tidies its data first)
    const [threads, emailLeads, talkLeads, search] = await Promise.all([
      askTool<ThreadList>(brandId, 'list_replies', { show: 'all', limit: 100 }),
      askTool<LeadList>(brandId, 'list_leads', { status: 'to_do', lane: 'email', limit: 100 }),
      askTool<LeadList>(brandId, 'list_leads', { status: 'to_do', lane: 'talk', limit: 100 }),
      (async () => {
        const topics = await askTool<TopicsResult>(brandId, 'get_search_agent', { section: 'topics', limit: '50' })
        const keywords = await askTool<KeywordsResult>(brandId, 'get_search_agent', { section: 'keywords', limit: '100' })
        const ai = await askTool<AiResult>(brandId, 'get_search_agent', { section: 'ai_answers', limit: '100' })
        return { topics, keywords, ai }
      })(),
    ])
    const leadCount = Object.values(emailLeads.counts ?? {}).reduce((a, b) => a + b, 0)
    onStep({ id: 'read', text: 'Reading your emails, leads and research', state: 'done', result: `${threads.threads?.length ?? 0} email threads · ${leadCount} leads` })
    const site = brand?.websiteUrl ?? ''
    const name = brand?.name ?? 'your business'
    const google = googleData(brandId, site)   // shared by the Google and visibility cards
    // Each card is its own step, worked out side by side
    const step = async (id: CardId, work: () => Answer | Promise<Answer>): Promise<Answer> => {
      onStep({ id, text: STEP_TEXT[id], state: 'on' })
      try {
        const a = await work()
        onStep({ id, text: STEP_TEXT[id], state: 'done', result: a.number && a.number !== '—' ? `${a.number} ${a.numberLabel}` : a.numberLabel })
        return { ...a, suggested: related(a, name) }
      } catch (e) {
        onStep({ id, text: STEP_TEXT[id], state: 'failed', result: 'Couldn’t check this one' })
        throw e
      }
    }
    const settled = await Promise.allSettled([
      step('replies', () => repliesCard(threads.threads ?? [], at)),
      step('email', () => emailCard(emailLeads, at)),
      step('google', async () => googleFromData(await google, at)),
      step('seen', async () => {
        const gd = await google
        const domain = (() => { try { return new URL(gd.origin || 'https://x').hostname.replace(/^www\./, '') } catch { return '' } })()
        const [homepage, links] = await Promise.all([readHomepageCheck(gd.origin), linkingSites(brandId, domain)])
        return visibilityAnswer({
          at, brandName: name, google: gd, googleAnswer: gd.state === 'ok' ? googleFromData(gd, at) : null, homepage,
          mainWords: search.topics.starting_keywords?.length ? search.topics.starting_keywords : (brand?.keywords ?? '').split(',').map(k => k.trim()).filter(Boolean),
          ai: search.ai.answers ?? [], posted: talkLeads.counts?.posted ?? 0, links,
        })
      }),
      step('post', () => postCard(search.topics, at)),
      step('talk', () => talkCard(talkLeads, name, at)),
      step('keys', () => keysCard(search.keywords, at)),
      step('track', () => trackFetch(brandId).then(g => trackCard(g, threads.threads ?? [], at))),
    ])
    const cards = settled.flatMap(r => (r.status === 'fulfilled' ? [r.value] : (console.error('[ask] card failed', r.reason), [])))
    const out: AskCards = { at, cards: cards.sort((a, b) => ORDER.indexOf(a.id as CardId) - ORDER.indexOf(b.id as CardId)) }
    await saveSnapshot(brandId, key(), out)
    return out
  })
}

/** The saved cards, worked out again when missing or older than STALE_MS. */
export async function readCards(brandId: string, opts: { refresh?: boolean; onStep?: OnStep } = {}): Promise<AskCards> {
  const saved = await withDemo(await readDemoSwitch(brandId), () => getSnapshot<AskCards>(brandId, key()))
  if (!opts.refresh && saved?.at && Date.now() - Date.parse(saved.at) < STALE_MS) return saved
  return fillCards(brandId, opts.onStep)
}

/** The saved cards as they are, without working anything out (null when there are none yet). */
export async function savedCards(brandId: string): Promise<AskCards | null> {
  return withDemo(await readDemoSwitch(brandId), () => getSnapshot<AskCards>(brandId, key()))
}
