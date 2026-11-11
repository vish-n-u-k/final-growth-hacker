// Ask, phase 2 (md_files/ASK_PLAN.md): a question that isn't one of the ready answers. Claude
// (Sonnet) answers it with the MCP tools we already have (read-only ones), in one request, and
// sends progress to the page as it goes: Understand → Look → Check → Answer.
//
// Claude doesn't write a page: it fills the same answer form as a ready answer (give_answer), so
// the page draws both the same way. Every number in the sentence and findings has to be in the data
// it fetched; if not, it's asked once to fix them, and anything still unmatched is listed.
// Caps per question (turns, time, AI and DataForSEO dollars) and per brand per day are in code.

import Anthropic from '@anthropic-ai/sdk'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
import { TOOLS } from '@/lib/mcp/tool-registry'
import { dispatch } from '@/lib/mcp/dispatch'
import { anthropicCostUsd } from '@/lib/ai/pricing'
import { logAnthropicUsage, withAIContext } from '@/lib/ai/client'
import { loadBrandContext } from '@/lib/agents/context'
import { readDemoSwitch } from '@/lib/agents/store'
import { agentsDemo, withDemo } from '@/lib/agents/demo'
import { startEngine } from '@/lib/leads/engine'
import { addRule, memoryBlock } from './memory'
import { reviewBrief } from './review'
import { getSnapshot, saveSnapshot } from '@/lib/signals'
import { savedCards } from './cards'
import { CARD_IDS, type Answer, type AskEvent, type CardId, type NextStep, type Picture } from './types'

const MODEL = 'claude-sonnet-5-5'
export const DAILY_LIMIT = Number(process.env.ASK_DAILY_LIMIT) || 20
const MAX_TURNS = 8
const MAX_MS = 60_000                 // then it's told to answer with what it has
const AI_CAP_USD = 0.25
const TOOL_CAP_USD = 0.10             // DataForSEO, per question
const RESULT_CHARS = 8000
const USAGE_KEY = 'ask:usage'

// MCP tools Ask may use: only ones that read. Writing tools (toggle, skip, analyse, post) are left out.
const READ_TOOLS = [
  'get_brand_info', 'get_competitors', 'get_growth_overview', 'get_module_detail', 'get_growth_history',
  'get_pending_items', 'get_today_tasks', 'get_ga_analytics', 'get_ga_conversions', 'get_gsc_data',
  'get_keyword_trends', 'get_posthog_analytics', 'get_posthog_segments', 'get_posthog_users',
  'get_posthog_power_users', 'get_posthog_churned_users', 'get_posthog_pro_users', 'get_blog_post', 'dataforseo',
  // Leads, email and the Search Agent: the same tools the Ask page uses
  'list_leads', 'list_replies', 'get_lead_settings', 'check_contacts', 'gmail_status', 'get_search_agent',
  'get_daily_numbers', 'get_goal_progress', 'get_weekly_review', 'list_work',
]

// Where a next step can send the person: the model picks one of these ids, never a URL
// Leads, email and writing open as workspaces on the Ask page itself (no other page)
const ACTIONS: Record<string, { label: string; href: string; external?: boolean; panel?: NextStep['panel'] }> = {
  leads: { label: 'Open Leads', href: '/leads', panel: { kind: 'leads' } },
  inbox: { label: 'Open replies', href: '/gmail-hub?tab=inbox', panel: { kind: 'email', tab: 'replies' } },
  campaigns: { label: 'Send to a list', href: '/gmail-hub?tab=campaigns', panel: { kind: 'email', tab: 'list' } },
  search_agent: { label: 'Open posts to write', href: '/agents/search', panel: { kind: 'write' } },
  analytics: { label: 'Open Analytics', href: '/analytics' },
  social: { label: 'Open Social Studio', href: '/social' },
  reminders: { label: 'Open Reminders', href: '/reminders' },
  settings: { label: 'Open Settings', href: '/settings' },
  website_review: { label: 'Open the website review', href: '/ask', panel: { kind: 'review' } },
  search_console: { label: 'Open Search Console', href: 'https://search.google.com/search-console', external: true },
}

const SYSTEM = `You answer questions a small-business owner asks about their own business in GrowJin, a growth app, and start the jobs they ask for. You have tools that read their data. Answer only from what the tools return.

How to work:
1. In your first turn, call \`understood\` with one short line saying what you take the question to mean (with dates and names filled in), together with the data tools you need. Call tools in parallel when you can.
2. If the question is the same as one of the ready answers (did anyone reply / what's my visibility score / who should I email today / why am I not on Google / what should I write / where should I talk about it / which search words can I win / am I on track), call \`open_ready_answer\` instead and nothing else.
3. If a missing detail would change the answer a lot (for example "my emails" could mean two different things), call \`ask_back\` with one short question and 2–4 short options. Otherwise make a sensible assumption and say it in \`understood\`.
4. Use as few lookups as you need. Saved data (ready_answers, list_leads, list_replies, get_* tools) is free; dataforseo costs money, so use it only when the question needs data about other sites or Google results.
5. Finish by calling \`give_answer\`. That is the only way to answer: don't write the answer as text.
6. When they ask you to DO something rather than answer:
   - Find new leads, customers or prospects (from anywhere: X / Twitter, Etsy, LinkedIn, a city, a kind of business, a competitor's reviews): call \`start_lead_search\` with a clear brief and nothing else. It runs in the background with the search tools; the page shows its progress and they pick which leads to keep.
   - Send emails (answer replies, follow up, email people they name or paste, email leads on their list): look up what you need, write each email, then call \`propose_emails\`. Never say emails were sent: they approve them on the page.
   - Analyse, review or audit their website or app as a whole: answer in one sentence (from the latest website review in the intro if there is one) and set the next step's action to website_review, which opens the full review and lets them run a fresh one.
   - Anything else your tools can't do: say so in \`give_answer\` and point to the right place.
7. When they state a lasting preference ("always…", "never…", "I prefer…", "only…") or correct how you did something in a way that should apply next time, call \`remember\` with one short rule in their words (alongside your other tools), then carry on. Don't save one-off details of this question. Follow the owner's standing rules in the intro: they win over everything else.

Rules for the answer:
- One or two short sentences in \`say\`, plain words, no jargon. Wrap the 1–3 most important words or numbers in **double stars**.
- Every number you write must come from a tool result (you may round, or work out a simple difference or percentage from numbers you fetched). Never guess a number.
- If a source isn't connected or returned nothing, say so plainly and show what you can see instead. Don't pretend.
- One picture that makes the answer obvious: a list (names + short notes), bars (labels + numbers), tiles (2–3 big numbers; mark a missing one), a line (values over time, oldest first), or none.
- Up to 3 findings, each one short sentence with its number.
- One next step the person can do now, pointing at one of the app's places (action ids in the tool), or none if nothing fits. Up to 2 smaller steps after it.
- \`source\`: where the data came from and the period, in a few words.
- \`follow_ups\`: 2–3 natural next questions about this answer, so the owner can dig in with one click.
- Never name tools, APIs or field names in what the person reads.`

const ROW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'value', 'text', 'strong', 'missing'],
  properties: {
    label: { type: 'string', description: 'Name, label or date.' },
    value: { type: ['number', 'null'], description: 'The number (bars, line, tiles).' },
    text: { type: ['string', 'null'], description: 'A short note (list) or the shown value (tiles, e.g. "4%").' },
    strong: { type: 'boolean', description: 'Highlight this one (the one that matters).' },
    missing: { type: 'boolean', description: 'Tiles only: a value we can’t see because a source isn’t connected.' },
  },
}

const ASK_TOOLS: Anthropic.Tool[] = [
  {
    name: 'understood',
    description: 'Say in one short line what you take the question to mean, with dates and names filled in. Call it in your first turn, alongside your first data tools.',
    input_schema: { type: 'object', additionalProperties: false, required: ['line'], properties: { line: { type: 'string' } } },
    strict: true,
  },
  {
    name: 'open_ready_answer',
    description: 'The question is the same as one of the ready answers: replies (did anyone reply), seen (visibility score: how visible am I on Google and in AI answers), email (who should I email today), google (why am I not on Google / pages on Google), post (what should I write this week), talk (where should I talk about the product / Reddit threads), keys (which search words can I win), track (am I on track this week). Opens that answer instead.',
    input_schema: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', enum: [...CARD_IDS] } } },
    strict: true,
  },
  {
    name: 'ask_back',
    description: 'Ask the person one short question when a missing detail would change the answer a lot. Give 2–4 short options.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['question', 'options'],
      properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } },
    },
    strict: true,
  },
  {
    name: 'remember',
    description: 'Save one short lasting rule about how the owner wants things done, when they state a preference or correct you (e.g. "Never suggest agencies as leads", "Emails under 50 words, signed Vishnu"). It is used in every future answer, search and email.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['rule', 'area'],
      properties: {
        rule: { type: 'string', description: 'The rule, one short line, in their words.' },
        area: { type: 'string', enum: ['leads', 'emails', 'answers', 'general'] },
      },
    },
    strict: true,
  },
  {
    name: 'start_lead_search',
    description: 'Start a search for new leads in the background, when they ask you to find leads, customers or prospects. Write a clear brief: who to find (kind of business, size, place), where to look as they said it (e.g. "on X (Twitter)", "Etsy shops", "in Leeds", "people unhappy with <competitor>"), what makes one a good fit for this brand, and how to reach them. Call it alone, in your first turn after understood.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['brief', 'how_many'],
      properties: {
        brief: { type: 'string', description: 'The brief for this search, 2–5 sentences, in plain words.' },
        how_many: { type: 'integer', description: 'How many leads to look for, 5–30. Default 10 unless they said.' },
      },
    },
    strict: true,
  },
  {
    name: 'propose_emails',
    description: 'Show emails you wrote for them to approve and send from their Gmail (nothing is sent until they approve). Use after looking up who to write to. For an answer in an existing thread give thread_id and in_reply_to (from list_replies) and the subject with "Re: "; otherwise empty strings. Up to 20 emails, each under 90 words, plain and personal, signed with the brand name.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['title', 'why', 'emails'],
      properties: {
        title: { type: 'string', description: 'What these are, e.g. "Answers to 2 replies".' },
        why: { type: 'string', description: 'One short line on why.' },
        emails: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false, required: ['to', 'subject', 'body', 'thread_id', 'in_reply_to'],
            properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, thread_id: { type: 'string' }, in_reply_to: { type: 'string' } },
          },
        },
      },
    },
    strict: true,
  },
  {
    name: 'ready_answers',
    description: 'This morning’s ready answers: replies to emails sent from GrowJin (last 14 days), Lead Finder emails waiting for an OK, sitemap pages that showed up in Google searches (last 28 days), posts to write, Reddit / Hacker News threads to reply to, easy search words, and this week vs last on Google. Free.',
    input_schema: { type: 'object', additionalProperties: false, required: [], properties: {} },
    strict: true,
  },
  {
    name: 'give_answer',
    description: 'Your answer, in the fixed answer form the page draws. Call it once, at the end.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['understood', 'number', 'number_label', 'say', 'picture', 'finds', 'next', 'then', 'source', 'follow_ups'],
      properties: {
        understood: { type: 'string', description: 'What you took the question to mean, one short line.' },
        number: { type: 'string', description: 'The one number that answers it, as shown on a card, e.g. "412", "+18%", "6 of 22". Empty string if there is no single number.' },
        number_label: { type: 'string', description: 'A few words after that number, e.g. "visits last week". Empty string if no number.' },
        say: { type: 'string', description: 'One or two short sentences. **double stars** around the 1–3 key words or numbers.' },
        picture: {
          type: 'object', additionalProperties: false, required: ['kind', 'title', 'rows'],
          properties: {
            kind: { type: 'string', enum: ['list', 'bars', 'tiles', 'line', 'none'] },
            title: { type: 'string', description: 'A few words, e.g. "Visits a day, last 14 days".' },
            rows: { type: 'array', items: ROW_SCHEMA, description: 'list: up to 6; bars: up to 8; tiles: 2–3; line: up to 31 points, oldest first.' },
          },
        },
        finds: { type: 'array', items: { type: 'string' }, description: 'Up to 3 short findings, each with its number. **double stars** allowed.' },
        next: {
          type: 'object', additionalProperties: false, required: ['action', 'title', 'why'],
          properties: {
            action: { type: 'string', enum: [...Object.keys(ACTIONS), 'none'], description: 'Where the button goes, or none.' },
            title: { type: 'string', description: 'The one thing to do now, e.g. "Post again on Sunday".' },
            why: { type: 'string', description: 'One short line on why.' },
          },
        },
        then: {
          type: 'array', description: 'Up to 2 smaller steps after the main one.',
          items: { type: 'object', additionalProperties: false, required: ['title', 'why'], properties: { title: { type: 'string' }, why: { type: 'string' } } },
        },
        source: { type: 'string', description: 'Where the data came from and the period, e.g. "Google Analytics, last 7 days".' },
        follow_ups: { type: 'array', items: { type: 'string' }, description: '2–3 short questions the owner would likely ask next about THIS answer (under 70 characters each, in their words, e.g. "Which pages lost the most visits?"). Not ones this answer already covers.' },
      },
    },
    strict: true,
  },
]

// Always the same list, so the cache holds; near a cap, lookups are turned away instead
function tools(): Anthropic.Tool[] {
  const mcp = TOOLS.filter(t => READ_TOOLS.includes(t.name)).map(t => ({
    name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
  }))
  const list = [...ASK_TOOLS, ...mcp]
  // One cache breakpoint after the tools: they and the system prompt are the same on every question
  return list.map((t, i) => (i === list.length - 1 ? { ...t, cache_control: { type: 'ephemeral' as const } } : t))
}

// ── Lookups ───────────────────────────────────────────────────────────────────

const LOOK: Record<string, string> = {
  ready_answers: 'This morning’s ready answers', outreach: 'Your leads and emails',
  list_leads: 'Your leads', list_replies: 'Replies to your emails', get_lead_settings: 'Who you’re looking for',
  check_contacts: 'Who you’ve contacted', gmail_status: 'Your Gmail', get_search_agent: 'The Search Agent’s research',
  get_daily_numbers: 'Your numbers by day', get_goal_progress: 'Your goal', get_weekly_review: 'Your week', list_work: 'Your work log',
  get_brand_info: 'Your brand profile', get_competitors: 'Your competitors', get_growth_overview: 'Your roadmap',
  get_module_detail: 'A roadmap module', get_growth_history: 'Your roadmap’s history', get_pending_items: 'Things waiting on you',
  get_today_tasks: 'Today’s tasks', get_ga_analytics: 'Google Analytics', get_ga_conversions: 'Google Analytics conversions',
  get_gsc_data: 'Google Search Console', get_keyword_trends: 'Your keywords', get_posthog_analytics: 'PostHog',
  get_posthog_segments: 'PostHog segments', get_posthog_users: 'PostHog users', get_posthog_power_users: 'PostHog: most active users',
  get_posthog_churned_users: 'PostHog: users who stopped', get_posthog_pro_users: 'PostHog: paying users', get_blog_post: 'Your blog posts',
}
/** "last 7 days", "2026-10-01 to 2026-10-31"… from a lookup's input, when it has a period. */
function periodOf(input: Record<string, unknown>): string {
  const d = Number(input.days ?? input.period_days ?? input.lookback_days)
  if (Number.isFinite(d) && d > 0) return ` · last ${d} days`
  const from = input.start_date ?? input.date_from ?? input.from, to = input.end_date ?? input.date_to ?? input.to
  if (typeof from === 'string' && typeof to === 'string') return ` · ${from} to ${to}`
  return ''
}

function lookLine(name: string, input: Record<string, unknown>): string {
  return lookName(name, input) + periodOf(input)
}

function lookName(name: string, input: Record<string, unknown>): string {
  if (name === 'dataforseo') {
    const ep = String(input.endpoint ?? '')
    const task = (Array.isArray(input.payload) ? input.payload[0] : input.payload) as Record<string, unknown> | undefined
    const what = String(task?.keyword ?? task?.target ?? task?.url ?? '')
    if (/backlinks/.test(ep)) return `Links to ${what || 'a site'}`
    if (/ranked_keywords|keywords_for_site|competitors_domain/.test(ep)) return `Google searches for ${what || 'a site'}`
    if (/serp\//.test(ep)) return `Google results for “${what}”`
    if (/keyword/.test(ep)) return `Search volumes${what ? ` for “${what}”` : ''}`
    return 'Search data'
  }
  if (name === 'get_module_detail' && input.module_type) return `Your roadmap: ${String(input.module_type).replace(/-/g, ' ')}`
  return LOOK[name] ?? name
}


async function runTool(brandId: string, name: string, input: Record<string, unknown>): Promise<{ result: unknown; usd: number }> {
  if (name === 'ready_answers') {
    const c = await savedCards(brandId)
    return { result: c ? { checked_at: c.at, answers: c.cards.map(a => ({ question: a.question, number: `${a.number} ${a.numberLabel}`, say: a.say.replace(/\*\*/g, ''), picture: a.picture, finds: a.finds })) } : { note: 'No ready answers yet.' }, usd: 0 }
  }
  // Pins saved before the MCP tools existed may still repeat the old 'outreach' lookup
  if (name === 'outreach') {
    const [leads, replies] = await Promise.all([dispatch('list_leads', { status: 'all', limit: 60 }, brandId), dispatch('list_replies', { show: 'all', limit: 80 }, brandId)])
    return { result: { leads, replies }, usd: 0 }
  }
  const r = await dispatch(name, input, brandId) as { cost_usd?: number } | null
  return { result: r, usd: name === 'dataforseo' ? Number(r?.cost_usd) || 0 : 0 }
}

// Empty and layout-only fields dropped, then cut, as Claude sees a result
function compact(v: unknown): unknown {
  if (Array.isArray(v)) { const o = v.map(compact).filter(x => x !== undefined); return o.length ? o : undefined }
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) { const c = compact(x); if (c !== undefined) o[k] = c }
    return Object.keys(o).length ? o : undefined
  }
  return v === null || v === '' ? undefined : v
}
function asText(result: unknown): string {
  const t = JSON.stringify(compact(result) ?? {})
  return t.length <= RESULT_CHARS ? t : `${t.slice(0, RESULT_CHARS)}… [cut: ask for a shorter period or fewer rows if you need more]`
}

// ── The number check ──────────────────────────────────────────────────────────

const numbersIn = (t: string) => [...t.matchAll(/(\d[\d,]*(?:\.\d+)?)(\s*%)?/g)].map(m => ({ raw: m[0].trim(), n: Number(m[1].replace(/,/g, '')), pct: !!m[2] }))

/** Numbers in the answer that don't appear (within 1%) in any data fetched or in the question. */
export function uncheckedNumbers(texts: string[], data: string): string[] {
  const have = numbersIn(data).map(x => x.n)
  const out: string[] = []
  for (const t of texts) {
    for (const x of numbersIn(t)) {
      // Small counts, percentages (worked out), years and dates are left alone
      if (x.pct || x.n <= 10 || (x.n >= 1990 && x.n <= 2100 && Number.isInteger(x.n))) continue
      const ok = have.some(h => Math.abs(h - x.n) <= Math.max(1, x.n * 0.01))
      if (!ok && !out.includes(x.raw)) out.push(x.raw)
    }
  }
  return out
}

// ── The answer form → Answer ──────────────────────────────────────────────────

interface FormRow { label: string; value: number | null; text: string | null; strong: boolean; missing: boolean }
interface Form {
  understood: string; number?: string; number_label?: string; say: string
  picture: { kind: 'list' | 'bars' | 'tiles' | 'line' | 'none'; title: string; rows: FormRow[] }
  finds: string[]; next: { action: string; title: string; why: string }; then: { title: string; why: string }[]; source: string
  follow_ups?: string[]
}

const clip = (t: unknown, n: number) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

function toPicture(p: Form['picture'] | undefined): Picture | null {
  const rows = Array.isArray(p?.rows) ? p!.rows.filter(r => r && typeof r === 'object') : []
  if (!p || p.kind === 'none' || !rows.length) return null
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  if (p.kind === 'list') return { kind: 'list', rows: rows.slice(0, 6).map(r => ({ name: clip(r.label, 60), note: clip(r.text ?? (r.value ?? ''), 90) })) }
  if (p.kind === 'bars') return { kind: 'bars', rows: rows.slice(0, 8).map(r => ({ label: clip(r.label, 60), value: num(r.value), strong: !!r.strong })) }
  if (p.kind === 'tiles') return { kind: 'tiles', items: rows.slice(0, 3).map(r => ({ value: r.missing ? '?' : clip(r.text ?? (r.value ?? '—'), 14), label: clip(r.label, 40), missing: !!r.missing })) }
  return { kind: 'line', points: rows.slice(0, 31).map(r => ({ label: clip(r.label, 12), value: num(r.value) })) }
}

export function toAnswer(question: string, f: Form, how: Answer['how']): Answer {
  const act = ACTIONS[f.next?.action ?? '']
  const next: NextStep | null = act && f.next?.title ? { title: clip(f.next.title, 80), why: clip(f.next.why, 160), label: act.label, href: act.href, external: act.external, ...(act.panel ? { panel: act.panel } : {}) } : null
  const picture = toPicture(f.picture)
  return {
    id: 'live', question, number: clip(f.number, 14), numberLabel: clip(f.number_label, 40), state: 'ok',
    say: clip(f.say, 400) || 'I couldn’t find an answer in your data.',
    picture, pictureTitle: picture ? clip(f.picture.title, 70) : '',
    finds: (Array.isArray(f.finds) ? f.finds : []).map(x => clip(x, 220)).filter(Boolean).slice(0, 3),
    next, then: (Array.isArray(f.then) ? f.then : []).map(t => ({ title: clip(t?.title, 80), why: clip(t?.why, 120) })).filter(t => t.title).slice(0, 2),
    source: clip(f.source, 140), at: new Date().toISOString(), how,
    suggested: (Array.isArray(f.follow_ups) ? f.follow_ups : []).map(x => clip(x, 90)).filter(x => x.length > 5).slice(0, 3),
  }
}

// ── Daily limit ───────────────────────────────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10)
export async function questionsLeft(brandId: string): Promise<number> {
  const u = await getSnapshot<{ day: string; count: number }>(brandId, USAGE_KEY)
  return DAILY_LIMIT - (u?.day === today() ? u.count : 0)
}
async function addQuestion(brandId: string, n: 1 | -1) {
  const u = await getSnapshot<{ day: string; count: number }>(brandId, USAGE_KEY)
  const count = Math.max(0, (u?.day === today() ? u.count : 0) + n)
  await saveSnapshot(brandId, USAGE_KEY, { day: today(), count })
  return DAILY_LIMIT - count
}

// ── Running a question ────────────────────────────────────────────────────────

async function connections(brandId: string): Promise<string> {
  const rows = await db.select({ provider: brandIntegrations.provider }).from(brandIntegrations)
    .where(and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.status, 'connected')))
  const have = new Set(rows.map(r => r.provider))
  const names: [string, string][] = [['gsc_api', 'Google Search Console'], ['ga4_api', 'Google Analytics'], ['posthog', 'PostHog (sign-ups and users)'], ['gmail', 'Gmail']]
  return names.map(([k, n]) => `${n}: ${have.has(k) ? 'connected' : 'NOT connected'}`).join('\n') + '\nPayments (Stripe): NOT connected (not available yet)'
}

/** What Claude is told about the business before any question (also used to refresh pins). */
export async function brandIntro(brandId: string): Promise<string> {
  const [b, mem, rev] = await Promise.all([loadBrandContext(brandId), memoryBlock(brandId), reviewBrief(brandId).catch(() => '')])
  return [
    `Business: ${b?.name ?? 'unknown'} (${b?.websiteUrl ?? ''})`,
    b?.usp ? `What it does: ${b.usp}` : '', b?.targetAudience ? `Who it's for: ${b.targetAudience}` : '',
    b?.competitors?.length ? `Competitors: ${b.competitors.map(c => c.name || c.domain).join(', ')}` : '',
    `Today: ${today()}`, '', 'Data sources:', await connections(brandId),
    ...(mem.text ? ['', mem.text] : []),
    ...(rev ? ['', rev] : []),
  ].filter(x => x !== '').join('\n')
}

/** Runs saved lookups again (a pin's morning refresh). Returns the data as Claude would see it. */
export async function repeatLookups(brandId: string, lookups: Lookup[]): Promise<string> {
  const out = await Promise.all(lookups.slice(0, 8).map(async l => {
    try { return asText((await runTool(brandId, l.name, l.input)).result) } catch { return '' }
  }))
  return out.filter(Boolean).join('\n')
}

// ── Threads: follow-ups see the earlier questions, answers and data ────────────

const THREAD_KEY = 'ask:threads'
const threadKey = () => (agentsDemo() ? `${THREAD_KEY}:demo` : THREAD_KEY)
const MAX_THREADS = 5
const MAX_TURNS_KEPT = 6
const TURN_DATA_CHARS = 8000
const KNOWN_CHARS = 16000

export interface Turn { question: string; answer: Answer; lookups: Lookup[]; data: string; at: string }
export interface Thread { id: string; at: string; turns: Turn[] }

export async function readThread(brandId: string, id: string): Promise<Thread | null> {
  const all = (await getSnapshot<{ threads: Thread[] }>(brandId, threadKey()))?.threads ?? []
  return all.find(t => t.id === id) ?? null
}
async function saveTurn(brandId: string, id: string, turn: Turn) {
  const all = (await getSnapshot<{ threads: Thread[] }>(brandId, threadKey()))?.threads ?? []
  const t = all.find(x => x.id === id) ?? { id, at: turn.at, turns: [] }
  t.turns = [...t.turns, { ...turn, data: turn.data.slice(0, TURN_DATA_CHARS) }].slice(-MAX_TURNS_KEPT)
  t.at = turn.at
  await saveSnapshot(brandId, threadKey(), { threads: [t, ...all.filter(x => x.id !== id)].slice(0, MAX_THREADS) })
}
function history(t: Thread): { text: string; known: string } {
  const lines = t.turns.map(x => [
    `Q: ${x.question}`, x.answer.how?.understood ? `Understood as: ${x.answer.how.understood}` : '',
    `Answer: ${x.answer.say.replace(/\*\*/g, '')}`, ...x.answer.finds.map(f => `- ${f.replace(/\*\*/g, '')}`),
  ].filter(Boolean).join('\n'))
  let known = ''
  for (const x of [...t.turns].reverse()) { if (known.length + x.data.length > KNOWN_CHARS) break; known = `${x.data}\n${known}` }
  return { text: lines.join('\n\n'), known }
}

export interface AskInput { question: string; clarify?: { asked: string; chosen: string }; threadId?: string }

/** Answers one typed question, calling `emit` with progress. Counts toward the daily limit. */
export async function askQuestion(brandId: string, input: AskInput, emit: (e: AskEvent) => void): Promise<void> {
  const question = clip(input.question, 300)
  if (!question) return emit({ t: 'error', text: 'Type a question first.' })
  if ((await questionsLeft(brandId)) <= 0) return emit({ t: 'error', text: `That’s all ${DAILY_LIMIT} questions for today. Ready answers still work, and you can ask again tomorrow.` })
  emit({ t: 'left', left: await addQuestion(brandId, 1) })

  const demo = await readDemoSwitch(brandId)
  return withDemo(demo, () => withAIContext({ brandId, moduleType: 'ask' }, async () => {
    const prior = input.threadId ? await readThread(brandId, input.threadId) : null
    const threadId = prior?.id ?? crypto.randomUUID()
    emit({ t: 'thread', id: threadId })
    const used = await memoryBlock(brandId).catch(() => ({ items: [] as string[] }))
    if (used.items.length) emit({ t: 'memory', items: used.items })
    const h = prior?.turns.length ? history(prior) : null
    const intro = [
      await brandIntro(brandId), '',
      h ? `This is a follow-up. Earlier in this conversation:\n${h.text}\n\nThe data fetched for those answers is below: reuse it instead of looking it up again, and answer the new question in that context.\n${h.known}\n` : '',
      `Question: ${question}`,
      input.clarify ? `\nYou asked them: "${clip(input.clarify.asked, 200)}". They chose: "${clip(input.clarify.chosen, 120)}". Don't ask again.` : '',
    ].filter(x => x !== '').join('\n')

    const out = await answerLoop({
      question, intro, clarified: !!input.clarify, emit, brandId, known: h?.known,
      create: p => new Anthropic().messages.create(p),
      runTool: (name, inp) => runTool(brandId, name, inp),
      refund: async () => { emit({ t: 'left', left: await addQuestion(brandId, -1) }) },
    })
    if (out) await saveTurn(brandId, threadId, { question, answer: out.answer, lookups: out.lookups, data: out.data, at: new Date().toISOString() }).catch(e => console.error('[ask] save thread', e))
  }))
}

export interface LoopDeps {
  question: string
  intro: string
  clarified: boolean
  brandId: string
  emit: (e: AskEvent) => void
  create: (p: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>
  runTool: (name: string, input: Record<string, unknown>) => Promise<{ result: unknown; usd: number }>
  /** The question didn't count (opened a ready answer, asked back, or failed). */
  refund: () => Promise<void>
  /** Data fetched earlier (a follow-up's thread, a pin's fresh lookups): reusable, and its numbers pass the check. */
  known?: string
}

export interface Lookup { name: string; input: Record<string, unknown> }
/** An answer and what was looked up for it (saved with the thread, repeated for a pin). */
export interface LoopOut { answer: Answer; lookups: Lookup[]; data: string }

/** Claude's turns and tool calls for one question, until an answer, a question back or an error. */
export async function answerLoop({ question, intro, clarified, brandId, emit, create, runTool: run, refund, known }: LoopDeps): Promise<LoopOut | null> {
    const started = Date.now()
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: intro }]
    let aiUsd = 0, toolUsd = 0, turns = 0, retried = false, understood = ''
    const steps: string[] = []
    let data = known ? `${question}\n${known}` : question
    let fresh = ''
    const lookups: Lookup[] = []

    const finish = async (form: Form) => {
      if (!retried) emit({ t: 'check', text: 'Checking every number against the data' })
      const unchecked = uncheckedNumbers([form.say, ...(form.finds ?? [])], data)
      return { form, unchecked }
    }

    try {
      while (true) {
        const wrapUp = turns >= MAX_TURNS - 1 || Date.now() - started > MAX_MS || aiUsd >= AI_CAP_USD || toolUsd >= TOOL_CAP_USD
        if (wrapUp && turns >= MAX_TURNS + 1) throw new Error('no answer')
        emit({ t: 'think', text: turns === 0 ? 'Working out what you’re asking and what to look up' : wrapUp ? 'Writing the answer with what was found' : retried && !lookups.length ? 'Fixing numbers that didn’t match the data' : 'Reading what came back' })
        const res = await create({
          model: MODEL,
          max_tokens: 8000,
          output_config: { effort: 'medium' },
          system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
          tools: tools(),
          tool_choice: { type: 'auto' },
          messages,
        })
        turns += 1
        aiUsd += anthropicCostUsd(MODEL, res.usage)
        logAnthropicUsage('ask', res, brandId)
        messages.push({ role: 'assistant', content: res.content as unknown as Anthropic.ContentBlockParam[] })

        if (res.stop_reason === 'refusal') { emit({ t: 'error', text: 'Ask couldn’t answer this one. Try asking it another way.' }); await refund(); return null }
        if (res.stop_reason === 'pause_turn') continue
        const calls = res.content.filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use')

        // Answered in text instead of the form, or stopped: one nudge, then give up
        if (!calls.length) {
          if (turns >= MAX_TURNS) throw new Error('no answer')
          messages.push({ role: 'user', content: 'Answer by calling give_answer.' })
          continue
        }

        const card = calls.find(c => c.name === 'open_ready_answer')
        if (card) {
          const id = (card.input as { id?: string }).id as CardId
          emit({ t: 'card', id: CARD_IDS.includes(id) ? id : 'google' })
          await refund()   // free: nothing was looked up
          return null
        }
        const back = calls.find(c => c.name === 'ask_back')
        if (back) {
          const x = back.input as { question?: string; options?: string[] }
          const options = (Array.isArray(x.options) ? x.options : []).map(o => clip(o, 40)).filter(Boolean).slice(0, 4)
          if (options.length >= 2 && !clarified) {
            emit({ t: 'ask_back', question: clip(x.question, 160), options })
            await refund()   // the follow-up with their choice counts instead
            return null
          }
        }

        // A job: hand it to the background search, the page follows it
        const job = calls.find(c => c.name === 'start_lead_search')
        if (job) {
          const x = job.input as { brief?: string; how_many?: number }
          const brief = clip(x.brief, 1500)
          if (agentsDemo()) {
            emit({ t: 'task', kind: 'leads', brief, error: 'Lead searches use real data. Turn Demo mode off in Settings first.' })
            await refund(); return null
          }
          const r = await withDemo(false, () => startEngine(brandId, { brief, leadCount: Math.max(5, Math.min(30, Math.round(Number(x.how_many)) || 10)), hold: true, ask: question }))
          emit({ t: 'task', kind: 'leads', brief, ...(r.error ? { error: r.error } : {}) })
          if (r.error) await refund()
          return null
        }
        const prop = calls.find(c => c.name === 'propose_emails')
        if (prop) {
          const x = prop.input as { title?: string; why?: string; emails?: { to?: string; subject?: string; body?: string; thread_id?: string; in_reply_to?: string }[] }
          const emails = (Array.isArray(x.emails) ? x.emails : []).slice(0, 20).map(e => ({
            to: clip(e.to, 200), subject: clip(e.subject, 200), body: String(e.body ?? '').slice(0, 4000),
            ...(e.thread_id ? { thread_id: clip(e.thread_id, 64) } : {}), ...(e.in_reply_to ? { in_reply_to: clip(e.in_reply_to, 300) } : {}),
          })).filter(e => e.to && e.body)
          if (emails.length) {
            emit({ t: 'proposal', proposal: { kind: 'send_emails', title: clip(x.title, 120) || 'Emails to send', why: clip(x.why, 200), emails } })
            return null
          }
        }

        const given = calls.find(c => c.name === 'give_answer')
        if (given) {
          const { form, unchecked } = await finish(given.input as Form)
          // Numbers not in the data: ask once to fix them
          if (unchecked.length && !retried && !wrapUp) {
            retried = true
            messages.push({
              role: 'user',
              content: [
                ...calls.map(c => ({ type: 'tool_result' as const, tool_use_id: c.id, content: c.id === given.id ? 'Not accepted yet.' : 'Skipped.' })),
                { type: 'text' as const, text: `These numbers in your answer aren't in the data you fetched: ${unchecked.join(', ')}. Fetch what supports them, or take them out, then call give_answer again.` },
              ],
            })
            continue
          }
          understood = clip(form.understood, 200) || understood
          const how = { understood, steps: [...new Set(steps)], lookups: steps.length, seconds: Math.round((Date.now() - started) / 1000), usd: Math.round((aiUsd + toolUsd) * 1000) / 1000, unchecked }
          const answer = toAnswer(question, form, how)
          emit({ t: 'answer', answer })
          return { answer, lookups, data: fresh }
        }

        // Data tools (and the understood line), run in parallel
        const results = await Promise.all(calls.map(async c => {
          const inp = (c.input ?? {}) as Record<string, unknown>
          if (c.name === 'understood') {
            understood = clip(inp.line, 200)
            emit({ t: 'understand', text: understood })
            return { c, text: 'Noted.', error: false }
          }
          if (c.name === 'remember') {
            const item = await addRule(brandId, String(inp.rule ?? ''), 'ask', String(inp.area ?? 'general')).catch(() => null)
            if (item) emit({ t: 'remembered', id: item.id, text: item.text })
            return { c, text: item ? 'Saved.' : 'Not saved (too short).', error: false }
          }
          if (c.name === 'ask_back' || c.name === 'open_ready_answer' || c.name === 'start_lead_search' || c.name === 'propose_emails') return { c, text: 'Not available now: answer with what you can.', error: false }
          if (wrapUp) return { c, text: 'No more lookups: call give_answer now with what you have.', error: true }
          if (!READ_TOOLS.includes(c.name) && c.name !== 'ready_answers' && c.name !== 'outreach') return { c, text: `Unknown tool ${c.name}.`, error: true }
          if (c.name === 'dataforseo' && toolUsd >= TOOL_CAP_USD) return { c, text: 'The budget for paid lookups on this question is used. Answer with what you have.', error: true }
          const line = lookLine(c.name, inp)
          steps.push(line); emit({ t: 'look', text: line })
          try {
            const r = await run(c.name, inp)
            toolUsd += r.usd
            const text = asText(r.result)
            data += `\n${text}`
            fresh += `\n${text}`
            lookups.push({ name: c.name, input: inp })
            return { c, text, error: false }
          } catch (e) {
            return { c, text: `Failed: ${e instanceof Error ? e.message : 'error'}`, error: true }
          }
        }))
        const capNote = (Date.now() - started > MAX_MS - 10_000 || aiUsd >= AI_CAP_USD * 0.8 || toolUsd >= TOOL_CAP_USD || turns >= MAX_TURNS - 2)
          ? [{ type: 'text' as const, text: 'Time is nearly up: call give_answer next with what you have.' }] : []
        messages.push({ role: 'user', content: [...results.map(r => ({ type: 'tool_result' as const, tool_use_id: r.c.id, content: r.text, ...(r.error ? { is_error: true } : {}) })), ...capNote] })
      }
    } catch (e) {
      console.error('[ask] question failed', e)
      emit({ t: 'error', text: e instanceof Anthropic.APIError && e.status === 429 ? 'Ask is busy right now. Try again in a minute.' : 'Ask couldn’t finish this answer. Try again, or ask it another way.' })
      await refund()
      return null
    }
}
