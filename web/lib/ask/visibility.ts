// Ask's visibility score (md_files/ASK_PLAN.md; the checks come from the SEO playbook the owner
// shared): how findable the business is on Google and in AI answers, as one number out of 100 and a
// checklist. Each check has the brand's number, a state (good / needs work / fix this / unknown) and
// one plain line on why it matters. Worked out in code from data we already have, plus a free read
// of the homepage and a DataForSEO count of linking sites (at most weekly).

import * as cheerio from 'cheerio'
import { getSnapshot, saveSnapshot } from '@/lib/signals'
import { addUsage, type Lead, type SearchAgentData, type UsageMeter } from '@/lib/agents/store'
import { referringDomains } from '@/lib/agents/dataforseo'
import { brandedQueryMatcher } from '@/lib/modules/seo/keyword-fetchers'
import { fetchPage } from '@/lib/modules/brand-audit/fetcher'
import type { GoogleData } from './cards'
import { norm, section } from './urls'
import type { Answer, NextStep, Picture } from './types'

type State = 'good' | 'warn' | 'bad' | 'unknown'
type CheckId = 'pages' | 'waste' | 'leaks' | 'sitemap' | 'homepage' | 'strangers' | 'links' | 'ai' | 'community'
interface Check { id: CheckId; group: 'Google' | 'AI answers'; label: string; value: string; state: State; why: string; weight: number }

export interface HomepageCheck { title: string; h1s: number; description: string }
export interface VisibilityInput {
  at: string
  brandName: string
  google: GoogleData
  googleAnswer: Answer | null     // the Google card: its next step is the fix for pages / thin pages / sitemap
  homepage: HomepageCheck | null
  mainWords: string[]             // what buyers search (the Search Agent's starting keywords)
  search: SearchAgentData | null
  leads: Lead[]
  links: number | null            // sites linking to the site (DataForSEO, weekly); null = unknown
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)
const POINTS: Record<State, number> = { good: 1, warn: 0.5, bad: 0, unknown: 0 }
const LEAK = /\/(login|log-in|signin|sign-in|signup|sign-up|register|auth|oauth|callback|dashboard|account|app)(\/|$|\?)/i
const LEAK_HOST = /^(app|auth|login|accounts?|dashboard|my)\./i

/** The checklist, worked out from the data (no fetching). */
export function visibilityChecks(v: VisibilityInput): Check[] {
  const g = v.google
  const gscOn = g.state === 'ok'
  const checks: Check[] = []
  const shown = new Set(g.rows.filter(r => r.impressions > 0).map(r => norm(r.page)))
  const listed = [...new Set(g.listed.map(norm))]
  const listedShown = listed.filter(u => shown.has(u)).length
  const share = pct(listedShown, listed.length)

  checks.push({
    id: 'pages', group: 'Google', label: 'Pages on Google', weight: 3,
    value: !gscOn ? 'Connect Search Console' : listed.length ? `${listedShown} of ${plural(listed.length, 'page')} showed up in a search` : `${plural(shown.size, 'page')} showed up in a search`,
    state: !gscOn ? 'unknown' : !listed.length ? (shown.size ? 'warn' : 'bad') : share >= 60 ? 'good' : share >= 25 ? 'warn' : 'bad',
    why: 'Google has to keep a page before anyone can find it. A page it skips can never show up in a search.',
  })

  const missing = new Map<string, number>()
  for (const u of listed) if (!shown.has(u)) missing.set(section(u), (missing.get(section(u)) ?? 0) + 1)
  const [big] = [...missing.entries()].sort((a, b) => b[1] - a[1])
  const notShown = listed.length - listedShown
  const thin = !!big && big[0] !== 'Main pages' && big[1] >= 20 && big[1] / Math.max(1, notShown) >= 0.5
  checks.push({
    id: 'waste', group: 'Google', label: 'Thin, auto-made pages', weight: 2,
    value: !gscOn || !listed.length ? 'Needs Search Console and a sitemap' : thin ? `${plural(big[1], 'page')} under ${big[0]} never show up` : 'None stand out',
    state: !gscOn || !listed.length ? 'unknown' : thin ? 'bad' : 'good',
    why: 'Hundreds of near-empty pages (one per post, user or item) use up Google’s visits and make the whole site look thin.',
  })

  const leaks = g.rows.filter(r => r.impressions > 0 && (LEAK.test(new URL(r.page, 'https://x').pathname + '/') || (() => { try { return LEAK_HOST.test(new URL(r.page).hostname) } catch { return false } })()))
  checks.push({
    id: 'leaks', group: 'Google', label: 'Login and app pages in Google', weight: 1,
    value: !gscOn ? 'Connect Search Console' : leaks.length ? `${plural(leaks.length, 'page')} showed up, e.g. ${leaks[0].page.replace(/^https?:\/\//, '').slice(0, 48)}` : 'None showed up',
    state: !gscOn ? 'unknown' : leaks.length ? 'bad' : 'good',
    why: 'They compete with your homepage when people search your name, and look broken to anyone who clicks.',
  })

  checks.push({
    id: 'sitemap', group: 'Google', label: 'A sitemap', weight: 1,
    value: !gscOn ? 'Connect Search Console' : listed.length ? `Found, ${plural(listed.length, 'page')}` : 'Not found',
    state: !gscOn ? 'unknown' : listed.length ? 'good' : 'bad',
    why: 'It’s the list of your pages you hand to Google, so new ones get found quickly.',
  })

  const h = v.homepage
  const words = v.mainWords.flatMap(k => k.toLowerCase().split(/\s+/)).filter(w => w.length >= 4 && !v.brandName.toLowerCase().includes(w))
  const hp = h ? [
    { ok: !!h.title && (!words.length || words.some(w => h.title.toLowerCase().includes(w))), what: words.length ? 'title with your main words' : 'a title' },
    { ok: h.h1s === 1, what: h.h1s === 0 ? 'a main heading' : h.h1s > 1 ? `one main heading (it has ${h.h1s})` : 'one main heading' },
    { ok: h.description.length >= 50, what: 'a description' },
  ] : []
  const hpOk = hp.filter(x => x.ok).length
  checks.push({
    id: 'homepage', group: 'Google', label: 'Homepage aimed at your main words', weight: 2,
    value: !h ? 'Couldn’t read your homepage' : hpOk === 3 ? 'Title, one main heading and a description: all set' : `Missing: ${hp.filter(x => !x.ok).map(x => x.what).join(', ')}`,
    state: !h ? 'unknown' : hpOk === 3 ? 'good' : hpOk === 2 ? 'warn' : 'bad',
    why: 'Your title, main heading and description tell Google what you are. One heading, with the words buyers search.',
  })

  const isBrand = brandedQueryMatcher(v.brandName, g.websiteUrl)
  const q = g.queries ?? []
  const clicks = q.reduce((n, r) => n + r.clicks, 0)
  const strangers = q.filter(r => !isBrand(r.query)).reduce((n, r) => n + r.clicks, 0)
  const sp = pct(strangers, clicks)
  checks.push({
    id: 'strangers', group: 'Google', label: 'Found by people who don’t know your name', weight: 2,
    value: !gscOn || !g.queries ? 'Connect Search Console' : !clicks ? 'No clicks from Google yet' : `${sp}% of clicks from Google`,
    state: !gscOn || !g.queries ? 'unknown' : !clicks ? 'bad' : sp >= 30 ? 'good' : sp >= 10 ? 'warn' : 'bad',
    why: 'Clicks from people typing your name only show you’re known. New customers come from other searches.',
  })

  checks.push({
    id: 'links', group: 'Google', label: 'Sites linking to you', weight: 2,
    value: v.links == null ? 'Not checked yet' : `${v.links >= 100 ? '100+' : v.links}${v.links < 15 ? ' (aim for 10–15 in your first weeks)' : ''}`,
    state: v.links == null ? 'unknown' : v.links >= 30 ? 'good' : v.links >= 10 ? 'warn' : 'bad',
    why: 'Links from trusted sites are the biggest reason Google and AI tools trust a new site.',
  })

  const items = v.search?.answers?.items?.filter(i => !i.error) ?? []
  const named = items.filter(i => i.mentioned || (i.samples ? (i.hits ?? 0) / i.samples >= 0.5 : false)).length
  checks.push({
    id: 'ai', group: 'AI answers', label: 'Named when people ask AI tools', weight: 3,
    value: !items.length ? 'Not checked yet: the Search Agent asks every week' : `Named in ${named} of ${plural(items.length, 'answer')}`,
    state: !items.length ? 'unknown' : pct(named, items.length) >= 50 ? 'good' : named > 0 ? 'warn' : 'bad',
    why: 'ChatGPT and others recommend what trusted lists, reviews and Reddit name. Being on those gets you recommended.',
  })

  const posted = v.leads.filter(l => (l.source === 'reddit' || l.source === 'forum') && l.status === 'posted').length
  checks.push({
    id: 'community', group: 'AI answers', label: 'Helpful replies on Reddit and Hacker News', weight: 1,
    value: posted ? `${plural(posted, 'reply', 'replies')} posted` : 'None yet',
    state: posted >= 5 ? 'good' : posted ? 'warn' : 'bad',
    why: 'AI tools quote real people on Reddit and forums. Genuinely helpful replies get you mentioned there.',
  })
  return checks
}

const score = (cs: Check[]) => {
  const known = cs.filter(c => c.state !== 'unknown')
  const w = known.reduce((n, c) => n + c.weight, 0)
  return w ? Math.round((known.reduce((n, c) => n + c.weight * POINTS[c.state], 0) / w) * 100) : null
}

// The fix for each check, worst first
const ORDER: CheckId[] = ['waste', 'pages', 'leaks', 'homepage', 'links', 'ai', 'strangers', 'community', 'sitemap']

function fixFor(c: Check, v: VisibilityInput): NextStep | null {
  const gsc = 'https://search.google.com/search-console'
  if ((c.id === 'waste' || c.id === 'pages' || c.id === 'sitemap') && v.googleAnswer?.next) return v.googleAnswer.next
  if (c.id === 'leaks') return {
    title: 'Keep login and app pages out of Google', why: 'So your homepage is what people find when they search your name.', label: 'Get the fix', href: gsc, external: true,
    panel: {
      kind: 'brief', title: 'Keep login and app pages out of Google', intro: 'Give this to whoever runs your app. It only touches the app, never your main website.',
      steps: [
        'On the app’s address only (for example app.yoursite.com), send the header below with every page. Don’t add it to your main website: that would hide everything.',
        'For a sign-in address run by another company that you can’t change, use Search Console → Removals → “Remove all URLs with this prefix”. It hides them for about six months.',
        'If a page in the app is genuinely useful to the public (like help pages), move it to the main website or leave it out of the rule.',
        'Afterwards, check your homepage still has no noindex (for example with `curl -sI https://yoursite.com`).',
      ],
      code: 'X-Robots-Tag: noindex', link: { label: 'Open Search Console', href: gsc },
    },
  }
  if (c.id === 'homepage') {
    const main = v.mainWords[0] ?? 'what buyers search for'
    return {
      title: 'Point your homepage at your main words', why: c.value, label: 'Get the fix', href: '/ask', external: false,
      panel: {
        kind: 'brief', title: 'Point your homepage at your main words',
        intro: `Change only the parts Google reads first; keep the rest of your message. Your main words: “${main}”.`,
        steps: [
          `Put “${main}” in the page title, with your name.`,
          'Have exactly one main heading (H1), with the same words. Don’t swap headlines with a script: Google may see several.',
          'Write a description of one or two sentences saying what you do and for whom. Leave out anything that isn’t true.',
          'Use the words once in the first paragraph, and a close variation in one sub-heading.',
        ],
        code: `<title>${v.brandName} · ${main.charAt(0).toUpperCase() + main.slice(1)}</title>`,
      },
    }
  }
  if (c.id === 'links') return {
    title: 'Get your first links from free listings', why: 'About five a week is a safe pace for a new site.', label: 'Get the list', href: '/agents/search', external: false,
    panel: {
      kind: 'brief', title: 'Get your first links from free listings', intro: 'Start with free directories this week. Use the same name and one-line description everywhere.',
      steps: [
        'Tool directories: SaaSHub and AlternativeTo. On both, add yourself as an alternative to the big competitors: that’s where buyers compare.',
        'AI tool lists: There’s An AI For That and Futurepedia.',
        'Review and launch sites: G2, Capterra, SaaSworthy, BetaList, Crunchbase, Indie Hackers. Ask a few happy customers for a review.',
        'From week three: find small “best tools for …” articles and offer the author a free account and a ready description.',
        'Skip paid link packages and link swaps: a penalty on a new site is hard to undo.',
      ],
    },
  }
  if (c.id === 'ai') return { title: 'Get onto the lists AI tools read', why: 'The Search Agent shows which sites AI cites when it leaves you out.', label: 'See AI answers', href: '/agents/search?tab=ai' }
  if (c.id === 'strangers') return { title: 'Write for searches you can win', why: 'Easy buyer searches bring people who don’t know you yet.', label: 'See the words', href: '/ask?q=keys' }
  if (c.id === 'community') return { title: 'Reply to a few threads this week', why: 'Help first; mention your product only where it truly fits.', label: 'See the threads', href: '/ask?q=talk' }
  return null
}

export function visibilityAnswer(v: VisibilityInput): Answer {
  const checks = visibilityChecks(v)
  const known = (id: CheckId) => checks.find(c => c.id === id)?.state !== 'unknown'
  // Only scored once there's something real to score: Google's pages or the AI answers (not replies alone)
  const enough = known('pages') || known('ai')
  const all = enough ? score(checks) : null
  const google = known('pages') ? score(checks.filter(c => c.group === 'Google')) : null
  const ai = known('ai') ? score(checks.filter(c => c.group === 'AI answers')) : null
  const problems = ORDER.map(id => checks.find(c => c.id === id)!).filter(c => c.state === 'bad')
    .concat(ORDER.map(id => checks.find(c => c.id === id)!).filter(c => c.state === 'warn'))
  const top = problems[0]
  const next = !(known('pages') || known('ai'))
    ? { title: 'Connect Search Console', why: 'Then this scores how Google sees your site.', label: 'Connect', href: '/analytics' }
    : top ? fixFor(top, v) : null
  const picture: Picture = { kind: 'checks', rows: checks.map(c => ({ group: c.group, label: c.label, value: c.value, state: c.state, why: c.why })) }
  const parts = [google != null ? `Google **${google}**` : '', ai != null ? `AI answers **${ai}**` : ''].filter(Boolean).join(', ')
  return {
    id: 'seen', question: 'What’s my Google and AI visibility score?', at: v.at,
    number: all == null ? '—' : String(all), numberLabel: all == null ? 'not enough data yet' : 'out of 100',
    state: all == null ? 'connect' : 'ok',
    say: all == null
      ? 'There isn’t enough to score yet. Connect Search Console and let the Search Agent run once, and this fills in.'
      : `Your visibility score is **${all} out of 100**${parts ? ` (${parts})` : ''}.${top ? ` Fix first: **${top.label}**.` : ' Nothing big is holding you back.'}`,
    picture, pictureTitle: 'What the score is made of',
    finds: all == null ? [] : ['Google works in steps: it finds a page, keeps it, ranks it for a search, and only then do people click. The checks follow those steps, then AI answers. Open a line to see why it matters.'],
    next,
    then: all == null ? [] : problems.slice(1, 3).map(c => ({ title: c.label, why: c.value })),
    source: 'Search Console (last 28 days, searches 90 days), your sitemap and homepage, DataForSEO links (weekly), the Search Agent’s AI answers, Lead Finder',
    suggested: ['Why am I not on Google?', 'Which search words can I win?', 'Am I on track?'],
  }
}

// ── Fetching the two extra bits ───────────────────────────────────────────────

/** The homepage's title, number of main headings and description (a free read). */
export async function readHomepageCheck(origin: string): Promise<HomepageCheck | null> {
  if (!origin) return null
  try {
    const { html } = await fetchPage(origin)
    if (!html) return null
    const $ = cheerio.load(html)
    return {
      title: $('title').first().text().trim(),
      h1s: $('h1').length,
      description: ($('meta[name="description"]').attr('content') ?? '').trim(),
    }
  } catch { return null }
}

const LINKS_KEY = 'ask:links'
const WEEK = 7 * 86_400_000

/** How many sites link to the domain: DataForSEO, at most once a week (saved), logged in Usage as Ask. */
export async function linkingSites(brandId: string, domain: string): Promise<number | null> {
  if (!domain) return null
  const saved = await getSnapshot<{ at: string; domain: string; count: number }>(brandId, LINKS_KEY)
  if (saved && saved.domain === domain && Date.now() - Date.parse(saved.at) < WEEK) return saved.count
  const meter: UsageMeter = { dataforseo: 0, hunter: 0, apis: {} }
  try {
    const count = (await referringDomains(domain, meter, 100)).length
    await saveSnapshot(brandId, LINKS_KEY, { at: new Date().toISOString(), domain, count })
    return count
  } catch (e) {
    console.error('[ask] linking sites', e)
    return saved?.count ?? null
  } finally {
    await addUsage(brandId, meter, 'Ask').catch(() => {})
  }
}
