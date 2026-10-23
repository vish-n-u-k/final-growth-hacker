import { db } from '@/lib/db'
import { outreachEmails, reminders } from '@/lib/db/schema'
import { and, desc, eq, isNotNull, like } from 'drizzle-orm'
import { readLeadData, readSearchData } from '@/lib/agents/store'
import { threadIdOf, type ReplyIntent } from '@/lib/gmail/reply-check'
import { parseRecipientName } from '@/lib/gmail/send'

// The Inbox tab lists only threads GrowJin sent: campaign / outreach emails, Gmail follow-up
// reminders, and the Lead Agent's and link-building emails. Built from our own records, so the
// user's mailbox is never listed. Message bodies are fetched from Gmail when a thread is opened
// (app/api/gmail/conversations/[threadId]) and never stored.

export type ConversationStatus =
  | 'replied'      // a person replied
  | 'due'          // no reply and the follow-up is due
  | 'waiting'      // no reply yet, follow-up not due
  | 'auto_reply'   // out-of-office, follow-up pushed back
  | 'sent'         // sent without a follow-up, so replies aren't checked
  | 'closed'       // follow-up marked done by hand
  | 'opted_out' | 'bounced'

export type ConversationSource = 'campaign' | 'outreach' | 'followup' | 'lead-agent' | 'link-agent'

export interface Conversation {
  threadId: string
  toEmail: string | null
  toName: string | null
  subject: string
  source: ConversationSource
  sentAt: string | null
  status: ConversationStatus
  intent: ReplyIntent | null
  note: string | null          // reply snippet / reason, as saved by the reply check
  followUpDueAt: string | null
}

const LIMIT = 100

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

export async function listConversations(brandId: string): Promise<Conversation[]> {
  const [emails, rems, leadData, searchData] = await Promise.all([
    db.select({
      toEmail: outreachEmails.toEmail, toName: outreachEmails.toName, subject: outreachEmails.subject,
      source: outreachEmails.source, sentAt: outreachEmails.sentAt, threadId: outreachEmails.gmailThreadId,
    }).from(outreachEmails)
      .where(and(eq(outreachEmails.brandId, brandId), eq(outreachEmails.status, 'sent'), isNotNull(outreachEmails.gmailThreadId)))
      .orderBy(desc(outreachEmails.sentAt))
      .limit(LIMIT),
    db.select().from(reminders)
      .where(and(eq(reminders.brandId, brandId), eq(reminders.category, 'outreach'), like(reminders.description, '%gmailThreadId:%')))
      .orderBy(desc(reminders.createdAt))
      .limit(LIMIT),
    readLeadData(brandId),
    readSearchData(brandId),
  ])

  const byThread = new Map<string, Conversation>()
  const now = Date.now()

  // Lowest priority first: later sources overwrite the status of earlier ones
  for (const e of emails) {
    if (!e.threadId || byThread.has(e.threadId)) continue
    byThread.set(e.threadId, {
      threadId: e.threadId, toEmail: e.toEmail, toName: e.toName ?? parseRecipientName(e.toEmail),
      subject: e.subject, source: e.source === 'campaign' ? 'campaign' : 'outreach',
      sentAt: iso(e.sentAt), status: 'sent', intent: null, note: null, followUpDueAt: null,
    })
  }

  for (const l of leadData?.leads ?? []) {
    if (!l.threadId || !['sent', 'replied', 'opted_out', 'bounced'].includes(l.status)) continue
    byThread.set(l.threadId, {
      threadId: l.threadId, toEmail: l.email ?? null, toName: l.name ?? l.company ?? l.title,
      subject: l.draft?.subject ?? l.title, source: 'lead-agent', sentAt: l.sentAt ?? null,
      // The agent sends its own follow-ups, so an unanswered lead is just waiting
      status: l.status === 'sent' ? 'waiting' : l.status as ConversationStatus,
      intent: l.replyIntent ?? null, note: l.replyNote ?? null, followUpDueAt: l.nextFollowUpAt ?? null,
    })
  }

  for (const l of searchData?.links ?? []) {
    if (!l.threadId || !['sent', 'replied', 'opted_out', 'bounced', 'won'].includes(l.status)) continue
    byThread.set(l.threadId, {
      threadId: l.threadId, toEmail: l.email ?? null, toName: l.contactName ?? l.domain,
      subject: l.pitch?.subject ?? l.title, source: 'link-agent', sentAt: l.sentAt ?? null,
      status: l.status === 'won' ? 'replied' : l.status === 'sent' ? 'waiting' : l.status as ConversationStatus,
      intent: l.replyIntent ?? null, note: l.replyNote ?? null, followUpDueAt: l.nextFollowUpAt ?? null,
    })
  }

  for (const r of rems) {
    const threadId = threadIdOf(r)
    if (!threadId || r.followupStatus === 'untracked') continue
    const prev = byThread.get(threadId)
    const due = r.snoozedUntil && r.snoozedUntil > r.nextDueAt ? r.snoozedUntil : r.nextDueAt
    const open = r.enabled && !r.lastDoneAt
    const status: ConversationStatus =
      r.followupStatus === 'replied' || r.followupStatus === 'opted_out' || r.followupStatus === 'bounced' ? r.followupStatus
      : !open ? 'closed'
      : r.followupStatus === 'auto_reply' ? 'auto_reply'
      : due.getTime() <= now ? 'due' : 'waiting'
    byThread.set(threadId, {
      threadId,
      toEmail: prev?.toEmail ?? null,
      toName: prev?.toName ?? r.title.replace(/^Follow up:\s*/, ''),
      subject: prev?.subject ?? r.description?.match(/^Re:\s*(.+)$/m)?.[1] ?? r.title,
      source: prev?.source ?? 'followup',
      sentAt: prev?.sentAt ?? iso(r.createdAt),
      status,
      intent: (r.followupIntent as ReplyIntent | null) ?? null,
      note: r.followupNote,
      followUpDueAt: open ? iso(due) : null,
    })
  }

  return [...byThread.values()]
    .sort((a, b) => Date.parse(b.sentAt ?? '0') - Date.parse(a.sentAt ?? '0'))
    .slice(0, LIMIT)
}

/** True when GrowJin sent this thread for the brand — the only threads the Inbox may open. */
export async function isOwnThread(brandId: string, threadId: string): Promise<boolean> {
  const list = await listConversations(brandId)
  return list.some(c => c.threadId === threadId)
}
