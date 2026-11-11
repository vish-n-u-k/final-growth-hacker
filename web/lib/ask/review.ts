// "Re-analyse website" on Ask: Claude looks at the site the way it does in a chat when you say
// "analyse my app". It reads the pages a first-time visitor would (home, pricing, features, sign-up…),
// a competitor or two, and the data GrowJin has (brand profile, Search Console, Analytics, PostHog,
// the Search Agent), then writes one review: what it is, first impression, scores per area, what's
// working and the fixes, most important first. Saved per brand in signal_snapshots 'ask:review'.
//
// The admin switch (lib/modules/analysis-mode.ts, same one as Growth Path module runs) decides
// whether a user's click runs it straight away through the API or puts it in the admin queue.

import Anthropic from '@anthropic-ai/sdk'
import * as cheerio from 'cheerio'
import { TOOLS } from '@/lib/mcp/tool-registry'
import { dispatch } from '@/lib/mcp/dispatch'
import { anthropicCostUsd } from '@/lib/ai/pricing'
import { logAnthropicUsage, withAIContext } from '@/lib/ai/client'
import { loadBrandContext } from '@/lib/agents/context'
import { getSnapshot, saveSnapshot } from '@/lib/signals'
import { memoryBlock } from './memory'

const MODEL = 'claude-opus-5-5'
const KEY = 'ask:review'
const MAX_TURNS = 14
const MAX_MS = 240_000
const AI_CAP_USD = 1.5
const TOOL_CAP_USD = 0.15     // DataForSEO
const MAX_PAGES = 15
const RESULT_CHARS = 9000
export { REVIEW_REQUEST_NAME } from './types'

const DATA_TOOLS = ['get_brand_info', 'get_competitors', 'get_gsc_data', 'get_ga_analytics', 'get_posthog_analytics', 'get_search_agent', 'get_growth_overview', 'dataforseo']

export const REVIEW_AREAS = ['Message', 'Audience fit', 'Conversion', 'Trust', 'Pricing', 'Search & AI', 'Speed & mobile'] as const
export interface ReviewFix { title: string; why: string; how: string; page: string; area: string; impact: 'high' | 'medium' | 'low'; effort: 'quick' | 'medium' | 'big' }
export interface Review {
  headline: string
  whatItIs: string
  firstImpression: string
  scores: { area: string; score: number; note: string }[]
  working: string[]
  fixes: ReviewFix[]
  profileMismatch: string
  pages: string[]
  at: string
  seconds: number
  usd: number
}
export interface ReviewState { review?: Review; requestedAt?: string }
export type ReviewEvent =
  | { t: 'step'; text: string }
  | { t: 'queued'; at: string }
  | { t: 'done'; review: Review }
  | { t: 'error'; text: string }

export async function readReview(brandId: string): Promise<ReviewState> {
  return (await getSnapshot<ReviewState>(brandId, KEY)) ?? {}
}
export async function markRequested(brandId: string): Promise<string> {
  const s = await readReview(brandId)
  const at = new Date().toISOString()
  await saveSnapshot(brandId, KEY, { ...s, requestedAt: at })
  return at
}

/** Short version for Ask's prompt, so typed answers know the latest review. */
export async function reviewBrief(brandId: string): Promise<string> {
  const r = (await readReview(brandId)).review
  if (!r) return ''
  return [`Latest website review (${r.at.slice(0, 10)}): ${r.headline}`, ...r.fixes.slice(0, 3).map(f => `- Fix: ${f.title} (${f.impact} impact)`)].join('\n')
}

// ── Reading a page, as a visitor would ────────────────────────────────────────

const abs = (href: string, base: string) => { try { return new URL(href, base).toString() } catch { return '' } }
const tidy = (t: string) => t.replace(/\s+/g, ' ').trim()

export async function readPage(url: string): Promise<Record<string, unknown>> {
  const u = /^https?:\/\//.test(url) ? url : `https://${url}`
  const started = Date.now()
  let res: Response
  try {
    res = await fetch(u, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrowJinBot/1.0; +https://growjin.com)', Accept: 'text/html' }, signal: AbortSignal.timeout(12_000) })
  } catch (e) {
    return { url: u, error: `Couldn’t open the page: ${e instanceof Error ? e.message : 'error'}` }
  }
  const ms = Date.now() - started
  const html = await res.text().catch(() => '')
  const $ = cheerio.load(html)
  const host = (() => { try { return new URL(res.url || u).hostname } catch { return '' } })()
  const jsonLd = $('script[type="application/ld+json"]').map((_, el) => { try { const j = JSON.parse($(el).text()); return ([] as unknown[]).concat(j).map(x => (x as { '@type'?: string })['@type']).join(',') } catch { return '' } }).get().filter(Boolean)
  const imgs = $('img')
  const scripts = $('script[src]').length
  const links: { text: string; href: string }[] = []
  $('header a, nav a, footer a, a').each((_, el) => {
    const href = abs($(el).attr('href') ?? '', res.url || u)
    const text = tidy($(el).text()).slice(0, 60)
    if (!href || !text || links.some(l => l.href === href) || links.length >= 45) return
    try { if (new URL(href).hostname.replace(/^www\./, '') !== host.replace(/^www\./, '')) return } catch { return }
    links.push({ text, href })
  })
  const ctas = [...new Set($('button, a.button, a.btn, [role=button], a[class*="cta"], a[class*="btn"]').map((_, el) => tidy($(el).text())).get().filter(t => t.length > 1 && t.length < 50))].slice(0, 25)
  const heads = $('h1, h2, h3').map((_, el) => `${el.tagName.toUpperCase()}: ${tidy($(el).text()).slice(0, 140)}`).get().filter(t => t.length > 5).slice(0, 35)
  $('script, style, noscript, svg, iframe').remove()
  const text = tidy($('main').text() || $('body').text())
  return {
    url: res.url || u, status: res.status, load_ms: ms, html_kb: Math.round(html.length / 1024),
    title: tidy($('title').first().text()), meta_description: $('meta[name="description"]').attr('content') ?? '',
    og_image: !!$('meta[property="og:image"]').attr('content'), canonical: $('link[rel="canonical"]').attr('href') ?? '',
    robots: $('meta[name="robots"]').attr('content') ?? '', viewport: !!$('meta[name="viewport"]').length, lang: $('html').attr('lang') ?? '',
    structured_data: jsonLd, images: imgs.length, images_without_alt: imgs.filter((_, el) => !$(el).attr('alt')).length, external_scripts: scripts,
    headings: heads, buttons: ctas, links,
    text: text.slice(0, 6000) + (text.length > 6000 ? '…' : ''),
    ...(text.length < 300 ? { note: 'Very little text in the HTML: the page is probably drawn by JavaScript, so a visitor sees more than this (and so does Google, later).' } : {}),
  }
}

// ── Claude's tools and prompt ─────────────────────────────────────────────────

const SYSTEM = `You are reviewing a small business's website the way you would in a chat when the owner says "analyse my app". Be a sharp, honest growth advisor, not a checklist.

How to work:
1. Read the home page first with read_page, then the pages a first-time visitor would go to next: pricing, features / how it works, sign-up or start, about, a blog post, one or two more if they matter. Up to ${MAX_PAGES} pages in all, in parallel where you can.
2. Look at one or two competitors' home pages too (get_competitors gives them), to compare the message and the offer.
3. Pull the business data that helps: get_brand_info (what the owner says the business is), get_gsc_data, get_ga_analytics, get_posthog_analytics, get_search_agent (searches and AI answers). dataforseo costs money: use it at most once or twice, only if it changes a fix.
4. Then call give_review once.

What to judge (as a visitor, then as an advisor):
- Message: in 5 seconds, do I know what this is, who it's for and why it beats the alternative?
- Audience fit: does the page speak to the people the owner wants (their profile and memory below)?
- Conversion: is the next step obvious, low-friction, repeated? Anything in the way?
- Trust: proof, faces, reviews, logos, numbers, guarantees, contact.
- Pricing: clear, findable, anchored, a free way in?
- Search & AI: titles, descriptions, headings, structured data, content that answers buyers' questions, whether AI assistants name them.
- Speed & mobile: load time, page weight, viewport, images.

Rules:
- Every fix names the page, says why it matters for growth and exactly what to change (wording you'd use when it's copy). Most important first. 3 to 8 fixes. Don't pad.
- Only say what you saw or what the data showed. If a page couldn't be read, say so instead of guessing.
- Plain, short sentences. No jargon, no tool names.
- Scores are 1–10 per area, honest; 7+ only when it's genuinely good.
- profile_mismatch: one or two sentences when what the site says differs from the brand profile the owner gave GrowJin, else empty.`

const ASK_TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_page',
    description: 'Reads one web page as a visitor sees it: status, load time, title, description, headings, buttons, links on the same site, structured data, images and the text.',
    input_schema: { type: 'object', properties: { url: { type: 'string', description: 'Full URL or domain' } }, required: ['url'] },
  },
  {
    name: 'give_review',
    description: 'The finished review. Call once, at the end.',
    input_schema: {
      type: 'object',
      properties: {
        headline: { type: 'string', description: 'One-sentence verdict, the most important thing.' },
        what_it_is: { type: 'string', description: 'What a visitor understands the business sells, and to whom (one line).' },
        first_impression: { type: 'string', description: 'What a first-time visitor gets in 5 seconds (max 2 sentences).' },
        scores: { type: 'array', items: { type: 'object', properties: { area: { type: 'string', enum: [...REVIEW_AREAS] }, score: { type: 'integer', minimum: 1, maximum: 10 }, note: { type: 'string', description: 'Why, under 15 words.' } }, required: ['area', 'score', 'note'] } },
        working: { type: 'array', items: { type: 'string' }, description: 'Up to 4 things that work, one short line each.' },
        fixes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'The fix, as an instruction (under 12 words).' },
              why: { type: 'string', description: 'Why it matters for growth (one sentence).' },
              how: { type: 'string', description: 'Exactly what to change, with suggested wording when it is copy.' },
              page: { type: 'string', description: 'The page URL it applies to, or "whole site".' },
              area: { type: 'string', enum: [...REVIEW_AREAS] },
              impact: { type: 'string', enum: ['high', 'medium', 'low'] },
              effort: { type: 'string', enum: ['quick', 'medium', 'big'] },
            },
            required: ['title', 'why', 'how', 'page', 'area', 'impact', 'effort'],
          },
        },
        profile_mismatch: { type: 'string' },
      },
      required: ['headline', 'what_it_is', 'first_impression', 'scores', 'working', 'fixes', 'profile_mismatch'],
    },
  },
]

function tools(): Anthropic.Tool[] {
  const mcp = TOOLS.filter(t => DATA_TOOLS.includes(t.name)).map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool['input_schema'] }))
  const list = [...ASK_TOOLS, ...mcp]
  return list.map((t, i) => (i === list.length - 1 ? { ...t, cache_control: { type: 'ephemeral' as const } } : t))
}

const STEP: Record<string, string> = {
  get_brand_info: 'Reading your brand profile', get_competitors: 'Checking who your competitors are', get_gsc_data: 'Reading Google Search Console',
  get_ga_analytics: 'Reading Google Analytics', get_posthog_analytics: 'Reading PostHog', get_search_agent: 'Reading the Search Agent’s research',
  get_growth_overview: 'Reading your roadmap', dataforseo: 'Looking up search data',
}
const short = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') || url

function asText(v: unknown): string {
  const t = JSON.stringify(v ?? {})
  return t.length <= RESULT_CHARS ? t : `${t.slice(0, RESULT_CHARS)}… [cut]`
}
const clip = (t: unknown, n: number) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

interface Form {
  headline?: string; what_it_is?: string; first_impression?: string; profile_mismatch?: string
  scores?: { area?: string; score?: number; note?: string }[]; working?: string[]; fixes?: Partial<ReviewFix>[]
}
function toReview(f: Form, pages: string[], started: number, usd: number): Review {
  const one = <T extends string>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d)
  return {
    headline: clip(f.headline, 240), whatItIs: clip(f.what_it_is, 240), firstImpression: clip(f.first_impression, 360),
    scores: (Array.isArray(f.scores) ? f.scores : []).map(s => ({ area: clip(s?.area, 30), score: Math.max(1, Math.min(10, Math.round(Number(s?.score)) || 1)), note: clip(s?.note, 120) })).filter(s => s.area).slice(0, 7),
    working: (Array.isArray(f.working) ? f.working : []).map(w => clip(w, 200)).filter(Boolean).slice(0, 4),
    fixes: (Array.isArray(f.fixes) ? f.fixes : []).map(x => ({
      title: clip(x?.title, 120), why: clip(x?.why, 300), how: String(x?.how ?? '').trim().slice(0, 1200), page: clip(x?.page, 300), area: clip(x?.area, 30),
      impact: one(x?.impact, ['high', 'medium', 'low'] as const, 'medium'), effort: one(x?.effort, ['quick', 'medium', 'big'] as const, 'medium'),
    })).filter(x => x.title).slice(0, 8),
    profileMismatch: clip(f.profile_mismatch, 400), pages, at: new Date().toISOString(),
    seconds: Math.round((Date.now() - started) / 1000), usd: Math.round(usd * 100) / 100,
  }
}

/** Runs the review and saves it. Calls `emit` with progress. */
export async function runReview(brandId: string, emit: (e: ReviewEvent) => void, create: (p: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message> = p => new Anthropic().messages.create(p)): Promise<Review | null> {
  return withAIContext({ brandId, moduleType: 'ask-review' }, async () => {
    const started = Date.now()
    const [b, mem] = await Promise.all([loadBrandContext(brandId), memoryBlock(brandId).catch(() => ({ text: '' }))])
    if (!b?.websiteUrl) { emit({ t: 'error', text: 'Add your website in Settings first.' }); return null }
    const intro = [
      `Website to review: ${b.websiteUrl}`, `Business: ${b.name}`,
      b.usp ? `The owner says it does: ${b.usp}` : '', b.targetAudience ? `The owner says it's for: ${b.targetAudience}` : '',
      b.competitors?.length ? `Competitors: ${b.competitors.map(c => c.domain || c.name).join(', ')}` : '',
      `Today: ${new Date().toISOString().slice(0, 10)}`, mem.text ? `\n${mem.text}` : '',
    ].filter(Boolean).join('\n')
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: intro }]
    const pages: string[] = []
    let aiUsd = 0, toolUsd = 0, turns = 0
    emit({ t: 'step', text: `Opening ${short(b.websiteUrl)}` })

    try {
      while (true) {
        const wrapUp = turns >= MAX_TURNS - 1 || Date.now() - started > MAX_MS || aiUsd >= AI_CAP_USD
        if (turns >= MAX_TURNS + 1) throw new Error('no review')
        if (wrapUp) emit({ t: 'step', text: 'Writing the review' })
        const res = await create({
          model: MODEL, max_tokens: 16000,
          system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
          tools: tools(), tool_choice: wrapUp ? { type: 'tool', name: 'give_review' } : { type: 'auto' },
          messages,
        })
        turns += 1
        aiUsd += anthropicCostUsd(MODEL, res.usage)
        logAnthropicUsage('ask-review', res, brandId)
        messages.push({ role: 'assistant', content: res.content as unknown as Anthropic.ContentBlockParam[] })
        if (res.stop_reason === 'refusal') { emit({ t: 'error', text: 'The review couldn’t be written this time. Try again later.' }); return null }
        if (res.stop_reason === 'pause_turn') continue
        const calls = res.content.filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use')
        if (!calls.length) { messages.push({ role: 'user', content: 'Call give_review with the review now.' }); continue }

        const given = calls.find(c => c.name === 'give_review')
        if (given) {
          const review = toReview(given.input as Form, pages, started, aiUsd + toolUsd)
          if (!review.headline || !review.fixes.length) throw new Error('empty review')
          const s = await readReview(brandId)
          await saveSnapshot(brandId, KEY, { ...s, review, requestedAt: undefined })
          emit({ t: 'done', review })
          return review
        }

        const results = await Promise.all(calls.map(async c => {
          const inp = (c.input ?? {}) as Record<string, unknown>
          if (wrapUp) return { c, text: 'No more lookups: call give_review now.', error: true }
          if (c.name === 'read_page') {
            const url = String(inp.url ?? '')
            if (pages.length >= MAX_PAGES) return { c, text: `That's ${MAX_PAGES} pages: write the review with what you have.`, error: true }
            pages.push(url)
            emit({ t: 'step', text: `Reading ${short(url)}` })
            return { c, text: asText(await readPage(url)), error: false }
          }
          if (!DATA_TOOLS.includes(c.name)) return { c, text: `Unknown tool ${c.name}.`, error: true }
          if (c.name === 'dataforseo' && toolUsd >= TOOL_CAP_USD) return { c, text: 'Paid lookups are used up for this review.', error: true }
          emit({ t: 'step', text: STEP[c.name] ?? c.name })
          try {
            const r = await dispatch(c.name, inp, brandId) as { cost_usd?: number } | null
            if (c.name === 'dataforseo') toolUsd += Number(r?.cost_usd) || 0
            return { c, text: asText(r), error: false }
          } catch (e) {
            return { c, text: `Failed: ${e instanceof Error ? e.message : 'error'}`, error: true }
          }
        }))
        const nearly = Date.now() - started > MAX_MS - 30_000 || aiUsd >= AI_CAP_USD * 0.8 || turns >= MAX_TURNS - 2
        messages.push({ role: 'user', content: [...results.map(r => ({ type: 'tool_result' as const, tool_use_id: r.c.id, content: r.text, ...(r.error ? { is_error: true } : {}) })), ...(nearly ? [{ type: 'text' as const, text: 'Time is nearly up: call give_review next.' }] : [])] })
      }
    } catch (e) {
      console.error('[ask] review failed', e)
      emit({ t: 'error', text: e instanceof Anthropic.APIError && e.status === 429 ? 'Claude is busy right now. Try again in a minute.' : 'The review didn’t finish. Try again.' })
      return null
    }
  })
}
