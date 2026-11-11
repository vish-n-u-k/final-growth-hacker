import { getSnapshot, saveSnapshot } from '@/lib/signals'
import { callAI } from '@/lib/ai/client'
import { parseJsonLoose } from '@/lib/agents/context'
import { readLeadData } from '@/lib/agents/store'
import { listConversations } from '@/lib/gmail/conversations'

// What Ask remembers about how the owner likes things (one per brand, signal_snapshots 'ask:memory'):
//   rules   : what they told Ask ("never agencies", "emails under 50 words"), saved when they say it,
//             or pasted in from another Claude chat. Always followed.
//   noticed : patterns Ask worked out from what they do (leads added or skipped, emails sent), every few
//             days. Followed unless a rule says otherwise; a strong one is offered once as a rule.
// Every question, lead search and email Ask writes gets memoryBlock() in its prompt.

const KEY = 'ask:memory'
const MAX_RULES = 30
const MAX_NOTICED = 10
const NOTICE_EVERY_MS = 3 * 86_400_000
const MODEL = 'claude-sonnet-5-5'

export type MemArea = 'leads' | 'emails' | 'answers' | 'general'
export interface MemItem { id: string; text: string; at: string; by: 'you' | 'ask' | 'import'; area?: MemArea; strong?: boolean }
export interface Memory { rules: MemItem[]; noticed: MemItem[]; noticedAt?: string; declined?: string[] }

const empty = (): Memory => ({ rules: [], noticed: [] })
const clean = (t: unknown) => String(t ?? '').replace(/\s+/g, ' ').replace(/^[-•*\d.)\s]+/, '').trim().slice(0, 200)
const same = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]/g, '') === b.toLowerCase().replace(/[^a-z0-9]/g, '')
const newId = () => Math.random().toString(36).slice(2, 10)
const AREAS: MemArea[] = ['leads', 'emails', 'answers', 'general']

export async function readMemory(brandId: string): Promise<Memory> {
  const m = await getSnapshot<Memory>(brandId, KEY)
  return { ...empty(), ...(m ?? {}) }
}
const save = (brandId: string, m: Memory) => saveSnapshot(brandId, KEY, m)

/** Adds a rule (or replaces one saying the same thing). The oldest ones Ask saved go first past the cap. */
export async function addRule(brandId: string, text: string, by: MemItem['by'] = 'you', area?: string): Promise<MemItem | null> {
  const t = clean(text)
  if (t.length < 3) return null
  const m = await readMemory(brandId)
  const item: MemItem = { id: newId(), text: t, at: new Date().toISOString(), by, ...(AREAS.includes(area as MemArea) ? { area: area as MemArea } : {}) }
  m.rules = [...m.rules.filter(r => !same(r.text, t)), item]
  while (m.rules.length > MAX_RULES) {
    const i = m.rules.findIndex(r => r.by !== 'you')
    m.rules.splice(i >= 0 ? i : 0, 1)
  }
  await save(brandId, m)
  return item
}

export async function editItem(brandId: string, id: string, text: string): Promise<Memory> {
  const m = await readMemory(brandId)
  const t = clean(text)
  for (const list of [m.rules, m.noticed]) {
    const it = list.find(x => x.id === id)
    if (it && t) { it.text = t; it.at = new Date().toISOString() }
  }
  await save(brandId, m)
  return m
}

export async function removeItem(brandId: string, id: string): Promise<Memory> {
  const m = await readMemory(brandId)
  m.rules = m.rules.filter(x => x.id !== id)
  m.noticed = m.noticed.filter(x => x.id !== id)
  await save(brandId, m)
  return m
}

/** A noticed pattern becomes a rule (yes), or isn't offered again (no). */
export async function answerOffer(brandId: string, id: string, yes: boolean): Promise<Memory> {
  const m = await readMemory(brandId)
  const it = m.noticed.find(x => x.id === id)
  if (it) {
    if (yes) {
      m.noticed = m.noticed.filter(x => x.id !== id)
      m.rules = [...m.rules.filter(r => !same(r.text, it.text)), { ...it, id: newId(), by: 'ask' as const, at: new Date().toISOString(), strong: undefined }].slice(-MAX_RULES)
    } else {
      m.declined = [...(m.declined ?? []), it.text].slice(-50)
      it.strong = false
    }
  }
  await save(brandId, m)
  return m
}

/** Pasted text (e.g. another Claude chat's memory): one rule per line or sentence-list item. */
export async function importRules(brandId: string, text: string): Promise<{ added: number; memory: Memory }> {
  const lines = String(text ?? '').split(/\r?\n|(?<=\.)\s+(?=[A-Z•\-*])/).map(clean).filter(l => l.length >= 6).slice(0, MAX_RULES)
  const m = await readMemory(brandId)
  let added = 0
  for (const l of lines) {
    if (m.rules.some(r => same(r.text, l))) continue
    m.rules.push({ id: newId(), text: l, at: new Date().toISOString(), by: 'import' })
    added++
  }
  while (m.rules.length > MAX_RULES) m.rules.shift()
  await save(brandId, m)
  return { added, memory: m }
}

/** The next noticed pattern to offer as a rule (strong, not declined), if any. */
export function offerOf(m: Memory): MemItem | null {
  return m.noticed.find(n => n.strong && !(m.declined ?? []).some(d => same(d, n.text)) && !m.rules.some(r => same(r.text, n.text))) ?? null
}

/** What goes into every prompt. Empty when there's nothing remembered. */
export function memoryText(m: Memory, only?: MemArea[]): string {
  const pick = (l: MemItem[]) => (only ? l.filter(x => !x.area || x.area === 'general' || only.includes(x.area)) : l)
  const rules = pick(m.rules), noticed = pick(m.noticed)
  if (!rules.length && !noticed.length) return ''
  return [
    rules.length ? `The owner's standing rules (always follow them; they win over anything else here):\n${rules.map(r => `- ${r.text}`).join('\n')}` : '',
    noticed.length ? `Patterns noticed from what the owner does (follow them unless a rule says otherwise):\n${noticed.map(r => `- ${r.text}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
}
export async function memoryBlock(brandId: string, only?: MemArea[]): Promise<{ text: string; items: string[] }> {
  const m = await readMemory(brandId).catch(empty)
  const text = memoryText(m, only)
  const pick = (l: MemItem[]) => (only ? l.filter(x => !x.area || x.area === 'general' || only.includes(x.area)) : l)
  return { text, items: [...pick(m.rules), ...pick(m.noticed)].map(x => x.text) }
}

// ── What Ask notices ──────────────────────────────────────────────────────────

/** Every few days: patterns from leads added / skipped and emails sent. Needs a few actions to say anything. */
export async function refreshNoticed(brandId: string, force = false): Promise<Memory> {
  const m = await readMemory(brandId)
  if (!force && m.noticedAt && Date.now() - Date.parse(m.noticedAt) < NOTICE_EVERY_MS) return m
  const since = Date.now() - 45 * 86_400_000
  const [lead, convs] = await Promise.all([readLeadData(brandId).catch(() => null), listConversations(brandId).catch(() => [])])
  const recent = (lead?.leads ?? []).filter(l => Date.parse(l.sentAt ?? l.foundAt) >= since)
  const facts = (l: (typeof recent)[number]) => [l.fitLabel, l.foundVia ?? l.source, l.website ? 'has website' : 'no website', l.email ? 'has email' : 'no email', ...(l.facts ?? []).slice(0, 4).map(f => `${f.k}: ${f.v}`)].filter(Boolean).join('; ')
  const skipped = recent.filter(l => l.status === 'skipped' && l.skippedBy !== 'auto').slice(0, 25)
  const kept = recent.filter(l => ['sent', 'replied', 'queued', 'posted'].includes(l.status)).slice(0, 25)
  const sent = recent.filter(l => l.sentAt && l.draft?.body).slice(0, 12)
  const replied = convs.filter(c => c.status === 'replied').slice(0, 10)
  m.noticedAt = new Date().toISOString()
  if (skipped.length + kept.length + sent.length < 5) { await save(brandId, m); return m }

  const raw = await callAI({
    feature: 'ask-memory', model: MODEL, maxTokens: 1500,
    system: 'You find clear, useful patterns in how a small-business owner works, so an assistant can do things their way. Only patterns the data clearly shows. Plain short lines. Return only a raw JSON array.',
    prompt: `${m.rules.length ? `Their rules already (don't repeat these):\n${m.rules.map(r => `- ${r.text}`).join('\n')}\n\n` : ''}${(m.declined ?? []).length ? `They said no to these before (don't suggest them again):\n${m.declined!.map(d => `- ${d}`).join('\n')}\n\n` : ''}Leads they SKIPPED (${skipped.length}):\n${skipped.map(l => `- ${l.company ?? l.title}: ${facts(l)}`).join('\n') || '(none)'}

Leads they KEPT / contacted (${kept.length}):\n${kept.map(l => `- ${l.company ?? l.title}: ${facts(l)}`).join('\n') || '(none)'}

Emails they sent (after any edits):\n${sent.map(l => `- ${(l.draft!.body.match(/\S+/g) ?? []).length} words, subject "${l.draft!.subject}": ${l.draft!.body.replace(/\s+/g, ' ').slice(0, 220)}`).join('\n') || '(none)'}

People who replied: ${replied.map(c => `${c.toName ?? c.toEmail} (${c.intent ?? 'replied'})`).join(', ') || '(none)'}

Write up to ${MAX_NOTICED} patterns, each one short line in plain words starting with "You…" (e.g. "You skip leads with no website.", "Your emails are about 40 words and open with what you noticed."). For each: area (leads, emails, answers or general) and strong: true only when the data shows it clearly (5+ examples, few exceptions).
Return [{"text":"...","area":"leads","strong":true}]`,
  }).catch(() => '')
  const got = parseJsonLoose<{ text?: string; area?: string; strong?: boolean }[]>(raw, 'array') ?? []
  if (got.length) {
    m.noticed = got.map(g => ({ id: newId(), text: clean(g.text), at: m.noticedAt!, by: 'ask' as const, area: AREAS.includes(g.area as MemArea) ? g.area as MemArea : 'general', strong: g.strong === true }))
      .filter(n => n.text.length >= 6 && !m.rules.some(r => same(r.text, n.text))).slice(0, MAX_NOTICED)
  }
  await save(brandId, m)
  return m
}
