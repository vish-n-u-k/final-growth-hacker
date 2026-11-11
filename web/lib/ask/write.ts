import { callAI } from '@/lib/ai/client'
import { parseJsonLoose } from '@/lib/agents/context'
import type { ToolLead, ToolThread } from '@/lib/mcp/tools/inbox'
import { askTool } from './tools'

// Ask writes what you send: the first email to a lead, a reply to a Reddit / HN post or a page
// message, and an answer to someone who replied. Everything it knows comes from the MCP tools
// (list_leads, list_replies, get_lead_settings); Claude writes it. Nothing is saved until you send it.

const MODEL = 'claude-sonnet-5-5'

interface LeadSettings {
  brand?: { name?: string; website?: string; description?: string; offer?: string; competitors?: string[] }
  ideal_customer?: { who?: string; good_fit?: string[] } | null
  customer?: string
  error?: string
}

async function brandLines(brandId: string): Promise<{ name: string; text: string }> {
  const s = await askTool<LeadSettings>(brandId, 'get_lead_settings')
  const b = s.brand ?? {}
  const name = b.name || 'us'
  const text = [
    `Brand: ${name}${b.website ? ` (${b.website})` : ''}`,
    b.description && `What it does: ${b.description}`,
    b.offer && b.offer !== b.description && `Offer: ${b.offer}`,
    (s.ideal_customer?.who || s.customer) && `Who it's for: ${s.ideal_customer?.who || s.customer}`,
  ].filter(Boolean).join('\n')
  return { name, text }
}

export type Written =
  | { kind: 'email'; to: string; subject: string; body: string }
  | { kind: 'message'; text: string; where: string; url?: string }
  | { error: string }

/** The first email (or message) to one lead from the board. */
export async function writeForLead(brandId: string, leadId: string): Promise<Written> {
  const r = await askTool<{ lead?: ToolLead }>(brandId, 'list_leads', { lead_id: leadId })
  const l = r.lead
  if (!l) return { error: r.error ?? 'That lead isn’t on your list any more.' }
  const { name, text } = await brandLines(brandId)
  const post = l.lane === 'talk'
  const dm = !post && !l.email
  if (dm && !l.message_on && !l.url) return { error: 'There’s no email or page to message for this lead yet.' }
  const kind = post ? 'FORUM REPLY' : dm ? `DIRECT MESSAGE (on ${l.message_on?.platform ?? l.from})` : 'EMAIL'
  const facts = l.facts ? Object.entries(l.facts).map(([k, v]) => `${k}: ${v}`).join('; ') : ''
  const raw = await callAI({
    feature: 'ask-write', model: MODEL, maxTokens: 1200,
    system: 'You write short, personal outreach that gets replies. Plain words, no hype, no buzzwords, no emojis, no em dashes. Return only a raw JSON object.',
    prompt: `${text}

Write one ${kind} to:
${l.name}${l.contact ? ` · contact: ${l.contact}${l.role ? `, ${l.role}` : ''}` : ''} · found ${l.from}
${post ? `Their post: ${l.post ?? ''}` : ''}${facts ? `\nFacts: ${facts}` : ''}
Why they fit: ${l.why}

Rules:
- EMAIL: "subject" (3-6 words, low-key, about their situation, never clickbait) and "body" (under 60 words). Start "Hi <first name>," if a person's name is known, else "Hi <company> team,". First line: the specific thing you noticed. Then one sentence on how ${name} helps with exactly that. End with ONE small ask. Sign off "${name}". No links, no opt-out line (added automatically).
- DIRECT MESSAGE: "text" (under 50 words). Start "Hi," or their shop name. One specific thing you noticed, one sentence on how ${name} helps, one small ask. Friendly, no links, sign off "${name}".
- FORUM REPLY: "text" (under 120 words). Answer their question helpfully first with advice that works without any product. Then mention ${name} honestly as one option and say you work on it. No links, no sales tone.

Return {"subject":"...","body":"..."} for an EMAIL, else {"text":"..."}.`,
  })
  const x = parseJsonLoose<{ subject?: string; body?: string; text?: string }>(raw, 'object')
  if (!x) return { error: 'Couldn’t write it this time. Try again.' }
  if (kind === 'EMAIL') {
    if (!x.subject || !x.body) return { error: 'Couldn’t write it this time. Try again.' }
    return { kind: 'email', to: l.contact ? `${l.contact} <${l.email}>` : l.email!, subject: x.subject.trim(), body: x.body.trim() }
  }
  if (!x.text) return { error: 'Couldn’t write it this time. Try again.' }
  return { kind: 'message', text: x.text.trim(), where: post ? l.from : (l.message_on?.platform ?? l.from), url: post ? l.url : (l.message_on?.url ?? l.url) }
}

export type WrittenReply = { to: string; subject: string; body: string; thread_id: string; in_reply_to?: string; messages: { from: string; at: string | null; text: string; mine: boolean }[] } | { error: string; messages?: { from: string; at: string | null; text: string; mine: boolean }[] }

/** An answer to someone who replied, in the same thread. */
export async function writeAnswer(brandId: string, threadId: string): Promise<WrittenReply> {
  const r = await askTool<{ thread?: ToolThread; messages?: { from: string; at: string | null; text: string; message_id?: string; mine: boolean }[] }>(brandId, 'list_replies', { thread_id: threadId, messages: 4 })
  const msgs = r.messages ?? []
  if (!r.thread || !msgs.length) return { error: r.error ?? 'Couldn’t open this thread.', messages: msgs }
  const theirs = [...msgs].reverse().find(m => !m.mine)
  const { name, text } = await brandLines(brandId)
  const raw = await callAI({
    feature: 'ask-write', model: MODEL, maxTokens: 800,
    system: 'You help a small-business owner answer an email. Warm, short, plain words, no hype, no emojis, no em dashes. Return only a raw JSON object.',
    prompt: `${text}

The conversation so far (oldest first):
${msgs.map(m => `--- ${m.mine ? `You (${name})` : m.from}${m.at ? `, ${m.at.slice(0, 10)}` : ''}:\n${m.text.slice(0, 1500)}`).join('\n')}

Write the owner's answer to the last message from ${theirs?.from ?? 'them'} (under 80 words). Answer what they asked or said directly. If they want a call, offer two concrete times this week and ask which works. If they asked the price or how it works, answer plainly. If they said no or later, thank them and leave the door open in one line. Sign off "${name}".

Return {"body":"..."}`,
  })
  const x = parseJsonLoose<{ body?: string }>(raw, 'object')
  if (!x?.body) return { error: 'Couldn’t write it this time. Try again.', messages: msgs }
  const subject = /^re:/i.test(r.thread.subject) ? r.thread.subject : `Re: ${r.thread.subject}`
  return {
    to: r.thread.email ? (r.thread.to && r.thread.to !== r.thread.email ? `${r.thread.to} <${r.thread.email}>` : r.thread.email) : r.thread.to,
    subject, body: x.body.trim(), thread_id: threadId, in_reply_to: theirs?.message_id,
    messages: msgs.map(({ from, at, text: t, mine }) => ({ from, at, text: t, mine })),
  }
}
