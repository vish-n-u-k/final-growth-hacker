import { withDemo } from '@/lib/agents/demo'
import { readDemoSwitch, readLeadData, type Lead } from '@/lib/agents/store'
import { listConversations, type Conversation } from '@/lib/gmail/conversations'
import { getValidGmailToken } from '@/lib/gmail/token'
import { extractText, stripQuoted, type GmailPart } from '@/lib/gmail/message-text'

// MCP tools list_leads and list_replies: read what's on Lead Finder's board and who replied to
// emails GrowJin sent, so Claude (and Ask) can work through them. Read-only. Replies only cover
// threads GrowJin sent (listConversations); the rest of the mailbox is never read.

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const num = (v: unknown, d: number, max: number) => Math.min(Math.max(parseInt(String(v ?? d), 10) || d, 1), max)
const cut = (t: string | undefined, n: number) => { const x = (t ?? '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x }
const inDemo = async <T>(brandId: string, fn: () => Promise<T>) => withDemo(await readDemoSwitch(brandId), fn)

// ── list_leads ────────────────────────────────────────────────────────────────

/** Where a lead is, in the words the tool uses. */
const STATUS: Record<string, string[]> = {
  to_do: ['ready', 'needs_contact'],
  queued: ['queued'],
  sent: ['sent'],
  replied: ['replied'],
  posted: ['posted'],
  skipped: ['skipped'],
  closed: ['opted_out', 'bounced'],
}
const statusWord = (l: Lead) => Object.entries(STATUS).find(([, v]) => v.includes(l.status))?.[0] ?? l.status
const isTalk = (l: Lead) => l.source === 'reddit' || l.source === 'forum'
const placeOf = (l: Lead) => (l.source === 'forum' ? 'Hacker News' : l.source === 'reddit' ? (/reddit\.com\/(r\/[^/]+)/i.exec(l.url)?.[1] ?? 'Reddit') : l.source === 'profile' ? 'seller page' : l.foundVia ?? l.source)

function leadOut(l: Lead, full: boolean) {
  const talk = isTalk(l)
  return {
    id: l.id,
    status: statusWord(l),
    needs_email: l.status === 'needs_contact' || undefined,   // a good fit with no email found yet
    lane: talk ? 'talk' : 'email',
    name: talk || l.source === 'profile' ? l.title : l.company || l.name || l.title,
    contact: l.name && l.company ? l.name : undefined,
    role: l.role || undefined,
    email: l.email || undefined,
    email_note: l.emailVia || undefined,
    message_on: !l.email && l.dm ? l.dm : undefined,     // no email: a message on this page instead
    website: l.website || undefined,
    url: l.url || undefined,
    from: placeOf(l),
    rating: l.fitLabel || undefined,
    score: l.score,
    why: cut(l.why, 160),
    facts: l.facts?.length ? Object.fromEntries(l.facts.slice(0, 6).map(f => [f.k, f.v])) : undefined,
    found_at: l.foundAt,
    // What's written for them (GrowJin writes it when the lead is opened; empty until then)
    email_draft: l.draft ? (full ? l.draft : { subject: l.draft.subject }) : undefined,
    reply_draft: l.reply ? (full ? l.reply : cut(l.reply, 80)) : undefined,
    post: talk ? cut(l.snippet, full ? 600 : 160) : undefined,
    sent_at: l.sentAt || undefined,
    thread_id: l.threadId || undefined,
    follow_ups_sent: l.sentAt ? l.followupsSent : undefined,
    next_follow_up: l.nextFollowUpAt || undefined,
    replied_at: l.repliedAt || undefined,
    reply_says: l.replyNote ? cut(l.replyNote, 200) : undefined,
    reply_intent: l.replyIntent || undefined,
    answered: l.status === 'replied' ? !!l.handledAt : undefined,
    skipped_by: l.status === 'skipped' ? (l.skippedBy === 'auto' ? 'GrowJin' : 'you') : undefined,
  }
}

export type ToolLead = ReturnType<typeof leadOut>
export type ToolThread = ReturnType<typeof threadOut>
export interface LeadList { total: number; counts: Record<string, number>; leads: ToolLead[]; last_search: { at: string; status?: string; added?: number } | null; error?: string }
export interface ThreadList { total: number; counts: Record<string, number>; threads: ToolThread[]; error?: string }

export async function listLeads(brandId: string, args: Record<string, unknown>) {
  return inDemo(brandId, async () => {
    const data = await readLeadData(brandId)
    const all = data?.leads ?? []
    const id = str(args.lead_id)
    if (id) {
      const l = all.find(x => x.id === id)
      return l ? { lead: leadOut(l, true) } : { error: `No lead with id ${id}.` }
    }
    const status = str(args.status) || 'to_do'
    const lane = str(args.lane) || 'all'
    const statuses = status === 'all' ? null : STATUS[status]
    if (status !== 'all' && !statuses) return { error: `status must be one of: all, ${Object.keys(STATUS).join(', ')}.` }
    if (!['all', 'email', 'talk'].includes(lane)) return { error: 'lane must be all, email or talk.' }
    const q = str(args.search).toLowerCase()
    const picked = all
      .filter(l => !statuses || statuses.includes(l.status))
      .filter(l => lane === 'all' || (lane === 'talk') === isTalk(l))
      .filter(l => !q || [l.title, l.name, l.company, l.website, l.email, l.why].some(x => x?.toLowerCase().includes(q)))
      // To do: best first; everything else: newest activity first
      .sort((a, b) => status === 'to_do'
        ? b.score - a.score || Date.parse(b.foundAt) - Date.parse(a.foundAt)
        : Date.parse(b.repliedAt ?? b.sentAt ?? b.foundAt) - Date.parse(a.repliedAt ?? a.sentAt ?? a.foundAt))
    const limit = num(args.limit, 20, 100)
    const counts: Record<string, number> = {}
    for (const l of all) counts[statusWord(l)] = (counts[statusWord(l)] ?? 0) + 1
    return {
      total: picked.length,
      counts,
      sending: { daily_limit: data?.settings.dailyLimit ?? 15, mode: data?.settings.mode ?? 'approve' },
      last_search: data?.engineRun ? { at: data.engineRun.at, status: data.engineRun.status, added: data.engineRun.added } : data?.lastRunAt ? { at: data.lastRunAt } : null,
      leads: picked.slice(0, limit).map(l => leadOut(l, args.include_text === true)),
      note: !all.length ? 'No leads on the board yet. Find some with get_lead_settings, the search tools and save_leads.' : undefined,
    }
  })
}

// ── list_replies ──────────────────────────────────────────────────────────────

interface GmailMessage { id: string; labelIds?: string[]; internalDate?: string; payload?: GmailPart & { headers?: { name: string; value: string }[] } }
const header = (m: GmailMessage, name: string) => m.payload?.headers?.find(h => h.name.toLowerCase() === name)?.value ?? ''
const senderName = (from: string) => (from.match(/^"?([^"<]+?)"?\s*<([^>]+)>$/)?.[1] ?? from).trim()

function threadOut(c: Conversation) {
  return {
    thread_id: c.threadId,
    to: c.toName || c.toEmail || '',
    email: c.toEmail || undefined,
    subject: c.subject,
    status: c.status,                     // replied, due (follow-up due), waiting, auto_reply, sent, closed, opted_out, bounced
    from: c.source,                       // lead-agent, campaign, outreach, followup, link-agent, competitor-leads
    sent_at: c.sentAt,
    replied_at: c.repliedAt || undefined,
    intent: c.intent || undefined,        // meeting, interested, question, objection, later, other
    says: c.note ? cut(c.note, 240) : undefined,
    follow_up_due: c.followUpDueAt || undefined,
  }
}

export async function listReplies(brandId: string, args: Record<string, unknown>) {
  return inDemo(brandId, async () => {
    const convs = await listConversations(brandId)
    const threadId = str(args.thread_id)

    // One thread: its messages, with the Message-ID send_email needs to answer in it
    if (threadId) {
      const c = convs.find(x => x.threadId === threadId)
      if (!c || !/^[0-9a-f]+$/i.test(threadId)) return { error: 'Not a thread GrowJin sent. Only those can be read.' }
      let token: string
      try { token = await getValidGmailToken(brandId) } catch (e) { return { error: e instanceof Error ? e.message : 'Gmail is not connected.', thread: threadOut(c) } }
      const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) })
      if (res.status === 404) return { error: 'This thread is no longer in Gmail.', thread: threadOut(c) }
      if (!res.ok) return { error: `Gmail answered ${res.status}.`, thread: threadOut(c) }
      const msgs = ((await res.json()) as { messages?: GmailMessage[] }).messages?.filter(m => !m.labelIds?.includes('DRAFT')) ?? []
      const last = num(args.messages, 4, 20)
      return {
        thread: threadOut(c),
        messages: msgs.slice(-last).map((m, i, a) => {
          const text = m.payload ? extractText(m.payload) : ''
          const mine = !!m.labelIds?.includes('SENT')
          return {
            from: mine ? 'you' : senderName(header(m, 'from')),
            at: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
            text: cut((i === 0 && a.length === msgs.length ? text : stripQuoted(text) || text), 3000),
            message_id: header(m, 'message-id') || undefined,
            mine,
          }
        }),
        to_answer: 'To answer, call send_email with thread_id, in_reply_to = the last message_id that isn\'t yours, and the same subject with "Re: ".',
      }
    }

    // The list: replies (newest first), or follow-ups due, or everything
    const show = str(args.show) || 'replies'
    const days = num(args.days, 14, 90)
    const since = Date.now() - days * 86_400_000
    const pick = show === 'replies'
      // A reply marked answered in GrowJin is 'closed'; left out unless include_answered
      ? convs.filter(c => (c.status === 'replied' || (args.include_answered === true && c.status === 'closed' && !!c.repliedAt)) && Date.parse(c.repliedAt ?? c.sentAt ?? '0') >= since)
        .sort((a, b) => Date.parse(b.repliedAt ?? b.sentAt ?? '0') - Date.parse(a.repliedAt ?? a.sentAt ?? '0'))
      : show === 'due'
        ? convs.filter(c => c.status === 'due').sort((a, b) => Date.parse(a.followUpDueAt ?? '0') - Date.parse(b.followUpDueAt ?? '0'))
        : show === 'all' ? convs : null
    if (!pick) return { error: 'show must be replies, due or all.' }
    const counts: Record<string, number> = {}
    for (const c of convs) counts[c.status] = (counts[c.status] ?? 0) + 1
    return {
      show, days: show === 'replies' ? days : undefined,
      total: pick.length,
      counts,
      threads: pick.slice(0, num(args.limit, 20, 100)).map(threadOut),
      note: !convs.length ? 'GrowJin hasn\'t sent any emails yet, so there are no replies to show.' : undefined,
    }
  })
}
