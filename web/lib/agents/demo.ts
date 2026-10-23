// Demo mode for the AI Agents: try the whole flow before paying for DataForSEO and Hunter.
// On when AGENTS_DEMO=true, or automatically while DataForSEO isn't set up. In demo mode:
//   - Google results, rankings, keyword data, Maps businesses, AI answers, backlinks (DataForSEO), email
//     lookups (Hunter) and Google Ads waste are made up, from the brand's own keywords and
//     competitors, and shift a little between runs so "what moved" has something to show
//   - no email is sent: sending, replies, opt-outs and bounces are simulated
//   - Claude, Trustpilot reviews and Hacker News are real (free or cheap), so scoring and
//     drafts show the real quality
// Everything an agent saves in demo mode is marked, and cleared once real data is switched on.

import type { AiAnswerRaw, KeywordIdea, LinkingSite, MapsBusiness, RankedKeyword, SerpResult } from './dataforseo'
import type { FoundEmail } from './hunter'
import type { WastedSpend } from './google-ads'
import type { ReplyIntent } from '@/lib/gmail/reply-check'

export function agentsDemo(): boolean {
  if (process.env.AGENTS_DEMO === 'true') return true
  if (process.env.AGENTS_DEMO === 'false') return false
  return !(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD)
}

// What the made-up data is built from (set by the agent before a run)
interface DemoContext { brand: string; domain: string; competitors: { name: string; domain: string }[]; seeds: string[]; round?: number }
let ctx: DemoContext = { brand: 'Your brand', domain: 'example.com', competitors: [], seeds: [] }
export function setDemoContext(c: Partial<DemoContext>) { ctx = { ...ctx, ...c } }

// Small seeded random numbers, so the same input gives the same output within a run
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
function rng(seed: string) {
  let a = hash(seed)
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = <T>(r: () => number, list: T[]) => list[Math.floor(r() * list.length)]
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
// Changes with each research run (round), else every 10 minutes, so a rerun shows movement
const epoch = () => String(ctx.round ?? Math.floor(Date.now() / 600_000))

const rivals = () => ctx.competitors.length
  ? ctx.competitors
  : [{ name: 'RivalOne', domain: 'rivalone.com' }, { name: 'RivalTwo', domain: 'rivaltwo.io' }, { name: 'RivalThree', domain: 'rivalthree.co' }]

// ── DataForSEO stand-ins ──────────────────────────────────────────────────────

export function demoKeywordIdeas(seeds: string[]): KeywordIdea[] {
  const patterns = ['{s}', 'best {s}', '{s} for small business', 'free {s}', '{s} app', '{s} alternatives', 'how to {s}', 'ai {s}', '{s} tips', '{s} for beginners']
  const out: KeywordIdea[] = []
  for (const s of seeds.slice(0, 6)) {
    for (const p of patterns) {
      const keyword = p.replace('{s}', s.toLowerCase())
      const r = rng(keyword)
      const head = p === '{s}' || p.startsWith('best') || p.startsWith('ai')
      out.push({
        keyword,
        volume: Math.round((head ? 1500 + r() * 9000 : 60 + r() * 1800) / 10) * 10,
        difficulty: Math.round(head ? 45 + r() * 45 : 8 + r() * 40),
        cpc: Math.round((0.3 + r() * 3.5) * 100) / 100,
        intent: /best|alternatives|app|free/.test(p) ? 'commercial' : 'informational',
      })
    }
  }
  return out.sort((a, b) => b.volume - a.volume)
}

export function demoRankedKeywords(domain: string): RankedKeyword[] {
  const ideas = demoKeywordIdeas(ctx.seeds.length ? ctx.seeds : ['your product'])
  const e = epoch()
  return ideas.filter((_, i) => i % 3 === 0).slice(0, 14).map(i => {
    const base = 3 + Math.floor(rng(`rank:${i.keyword}`)() * 40)
    const drift = Math.round((rng(`drift:${i.keyword}:${e}`)() - 0.5) * 10)
    return { keyword: i.keyword, volume: i.volume, rank: Math.max(1, base + drift), url: `https://${domain}/blog/${slug(i.keyword)}` }
  }).sort((a, b) => b.volume - a.volume)
}

const SUBREDDITS = ['smallbusiness', 'Entrepreneur', 'startups', 'marketing', 'socialmedia', 'SaaS', 'sidehustle']

export function demoGoogleResults(keyword: string): SerpResult[] {
  const r = rng(`${keyword}:${epoch()}`)
  if (keyword.startsWith('site:reddit.com')) {
    const phrase = keyword.replace('site:reddit.com', '').trim()
    const titles = [
      `${cap(phrase)}? Need recommendations`,
      `What do you all use when ${phrase.replace(/^(looking for|any|how do you)\s*/i, '')}?`,
      `Struggling with this: ${phrase}`,
      'Weekly promotion thread: share your product',
    ]
    return titles.map((t, i) => {
      const sub = pick(r, SUBREDDITS)
      const id = hash(`${t}:${epoch()}`).toString(36).slice(0, 6)
      return {
        rank: i + 1,
        url: `https://www.reddit.com/r/${sub}/comments/${id}/${slug(t)}/`,
        domain: 'reddit.com',
        title: `${t} : r/${sub}`,
        description: i === 3
          ? 'Drop your links below. No other self-promotion allowed this week.'
          : `I run a small business and spend way too long on this every week. ${cap(phrase)}: what actually works for you? Paid tools are fine if they save time.`,
      }
    })
  }
  // "best X" searches: don't print "Best best X"
  const topic = keyword.replace(/^best\s+/i, '')
  const sites = [
    ...rivals().map(c => ({ domain: c.domain, title: `${c.name}: ${keyword}` })),
    { domain: 'g2.com', title: `Best ${topic} software (reviews)` },
    { domain: 'zapier.com', title: `The best ${topic} tools this year` },
    { domain: 'capterra.com', title: `${cap(topic)} software comparison` },
    { domain: 'hubspot.com', title: `${cap(keyword)}: a beginner's guide` },
    { domain: 'forbes.com', title: `${cap(keyword)} for small businesses` },
  ]
  return sites.slice(0, 10).map((s, i) => ({
    rank: i + 1, domain: s.domain, title: s.title,
    url: `https://${s.domain}/${slug(keyword)}`,
    description: `A look at ${keyword}: features, prices and who each option is for.`,
  }))
}

// Sites that link to a domain: blogs, directories and "best tools" lists. Competitors share
// some of them (so a site can link to two rivals), and the brand already has a couple.
const LINK_SITES: [string, string][] = [
  ['startupstash.com', 'Startup Stash: tools for {s}'],
  ['saasworthy.com', '{S} software: compare top tools'],
  ['alternativeto.net', 'Alternatives to popular {s} tools'],
  ['betalist.com', 'New startups: {s}'],
  ['indiehackers.com', 'How we picked our {s} stack'],
  ['smallbizdaily.com', '{S}: 9 tools small businesses love'],
  ['growthtools.io', 'The growth toolbox: {s}'],
  ['toolfinder.co', 'Best {s} tools, tested'],
  ['founderweekly.com', 'Founder Weekly #212: {s} picks'],
  ['marketingbrew.com', 'What marketers use for {s}'],
  ['sidehustlestack.com', '{S} for side projects'],
  ['nocodelist.co', 'No-code {s} directory'],
  ['bootstrappers.blog', 'Our honest {s} review'],
  ['thesmallbusinesssite.com', 'Guide: getting started with {s}'],
]
const fillTitle = (t: string) => {
  const s = ctx.seeds[0] ?? 'growth'
  return t.replace('{s}', s).replace('{S}', cap(s))
}

export function demoLinkingSites(target: string): LinkingSite[] {
  const r = rng(`links:${target}`)
  return LINK_SITES.filter(() => r() < 0.55).map(([domain, title]) => ({
    domain,
    url: `https://${domain}/${slug(fillTitle(title))}`,
    title: fillTitle(title),
    rank: Math.floor(180 + r() * 500),
    spam: Math.floor(r() * 25),
  }))
}

export function demoReferringDomains(target: string): string[] {
  const r = rng(`own-links:${target}`)
  return LINK_SITES.map(([d]) => d).filter(() => r() < 0.15)
}

const BIZ_A = ['Brew', 'Bean', 'Urban', 'Corner', 'Green', 'Golden', 'Little', 'Blue Door', 'Daily', 'Sunny', 'Hidden', 'Old Town']
const BIZ_B = ['Lab', 'House', 'Studio', 'Co.', 'Room', 'Spot', 'Collective', 'Kitchen', 'Corner', 'Place']

export function demoMapsBusinesses(query: string): MapsBusiness[] {
  const r = rng(`maps:${query}`)
  const kind = cap((query.split(/\s+in\s+/i)[0] || 'business').replace(/s$/i, ''))
  const where = query.split(/\s+in\s+/i)[1] ?? ''
  return Array.from({ length: 12 }, (_, i) => {
    const title = `${pick(r, BIZ_A)} ${pick(r, BIZ_B)}`
    const hasSite = r() > 0.35
    const domain = hasSite ? `${slug(title).replace(/-/g, '')}.example` : null
    return {
      title,
      url: domain ? `https://${domain}` : null,
      domain,
      phone: `+91 9${Math.floor(r() * 1e9).toString().padStart(9, '0')}`,
      rating: Math.round((3.1 + r() * 1.8) * 10) / 10,
      reviews: Math.floor(4 + r() * 380),
      category: kind,
      address: where ? `${pick(r, ['Main Road', 'Market Street', 'Station Road', 'High Street'])}, ${where}` : null,
      mapsUrl: `https://maps.google.com/?cid=${hash(title + i)}`,
    }
  })
}

export function demoAiAnswer(engine: string, prompt: string): AiAnswerRaw {
  const r = rng(`${engine}:${prompt}:${epoch()}`)
  const list = rivals().map(c => c.name)
  if (prompt.toLowerCase().startsWith(`what is ${ctx.brand.toLowerCase()}`)) {
    const wrong = r() < 0.5
    return {
      text: wrong
        ? `${ctx.brand} is a design tool for making graphics and presentations.`
        : `${ctx.brand} (${ctx.domain}) is a tool that helps small businesses with ${ctx.seeds[0] ?? 'their marketing'}.`,
      citations: [{ url: `https://${ctx.domain}/`, title: ctx.brand }],
    }
  }
  // About a third of answers name the brand, at a random place in the list
  const named = [...list].sort(() => r() - 0.5).slice(0, Math.min(3, list.length))
  if (r() < 0.35) named.splice(Math.floor(r() * (named.length + 1)), 0, ctx.brand)
  const text = `Good options for this: ${named.map((n, i) => `${i + 1}. ${n}`).join(', ')}. The right pick depends on your budget and how much you post.`
  const pool = [
    { url: 'https://www.g2.com/categories/social-media-management', title: 'Best tools on G2' },
    { url: 'https://zapier.com/blog/best-tools', title: 'The best tools (Zapier)' },
    { url: 'https://www.reddit.com/r/smallbusiness/comments/abc123/what_tool_do_you_use/', title: 'What tool do you use? : r/smallbusiness' },
    { url: 'https://www.capterra.com/software-comparison', title: 'Software comparison (Capterra)' },
    ...rivals().map(c => ({ url: `https://${c.domain}/`, title: c.name })),
  ]
  return { text, citations: pool.sort(() => r() - 0.5).slice(0, 3) }
}

// ── Hunter and Google Ads stand-ins ───────────────────────────────────────────

const FIRST = ['Priya', 'Rahul', 'Sara', 'Arjun', 'Neha', 'Tom', 'Aisha', 'Kabir', 'Maya', 'Dev']
const LAST = ['Mehta', 'Khan', 'Shah', 'Iyer', 'Rao', 'Singh', 'Patel', 'Das']

export function demoFindEmail(domain: string, personName?: string): FoundEmail | null {
  const r = rng(`email:${domain}`)
  if (r() < 0.15) return null // some companies have no findable email
  const name = personName && /\s/.test(personName) ? personName : `${pick(r, FIRST)} ${pick(r, LAST)}`
  return { email: `${name.split(/\s+/)[0].toLowerCase()}@${domain.replace(/^www\./, '')}`, verified: r() > 0.2, name, position: 'Owner' }
}

export function demoWastedSpend(): WastedSpend {
  const s = ctx.seeds[0] ?? 'your product'
  return {
    currency: 'USD', total: 184,
    terms: [{ term: `free ${s}`, cost: 96, clicks: 41 }, { term: `${s} jobs`, cost: 52, clicks: 18 }, { term: `${s} template download`, cost: 36, clicks: 12 }],
  }
}

// ── Gmail stand-ins ───────────────────────────────────────────────────────────

/** A made-up send: nothing leaves GrowJin. */
export function demoSend(): { id: string; threadId: string } {
  const id = `demo-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
  return { id, threadId: id }
}

/** What happened to a demo email: some reply, a few opt out or bounce, most stay quiet. */
export function demoReply(leadId: string, sentAt: string, firstReply = false): { outcome: 'replied' | 'opted_out' | 'bounced' | 'none'; note?: string; intent?: ReplyIntent } {
  if (Date.now() - Date.parse(sentAt) < 20 * 3_600_000) return { outcome: 'none' } // give it a "day"
  // The first email to get a day old always gets a reply, so the demo shows what that looks like
  const x = firstReply ? 0 : rng(`reply:${leadId}`)()
  if (x < 0.3) {
    const [note, intent] = pick(rng(`note:${leadId}`), [
      ['Sounds interesting, can you show me how it works?', 'meeting'],
      ['Yes please, send the free examples.', 'interested'],
      ['What does it cost for a small team?', 'question'],
      ['Maybe next month, a bit busy right now.', 'later'],
    ] as [string, ReplyIntent][])
    return { outcome: 'replied', note, intent }
  }
  if (x < 0.38) return { outcome: 'opted_out', note: 'Not interested, thanks.' }
  if (x < 0.42) return { outcome: 'bounced', note: 'Address not found.' }
  return { outcome: 'none' }
}
