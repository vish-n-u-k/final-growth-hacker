import { db } from '@/lib/db'
import { reminders } from '@/lib/db/schema'
import { eq, and, isNull, like } from 'drizzle-orm'
import { getValidGmailToken } from '@/lib/gmail/token'
import { callAI } from '@/lib/ai/client'

// Reads each open follow-up's Gmail thread and works out what happened since the
// email went out: a real reply, an opt-out, a bounce, an out-of-office, or the user
// replying themselves. Updates the reminder accordingly.

export type FollowupOutcome =
  | 'replied'       // a person replied — closed
  | 'opted_out'     // replied "not interested" / "unsubscribe" — closed
  | 'bounced'       // delivery failure — closed
  | 'auto_reply'    // out-of-office etc — pushed back
  | 'self_replied'  // the user replied in the thread themselves — due date reset
  | 'untracked'     // thread not found (e.g. old reminder with a bad id)
  | 'none'          // nothing new

export interface CheckResult { reminderId: string; outcome: FollowupOutcome; note?: string }

type Reminder = typeof reminders.$inferSelect

interface GmailHeader { name: string; value: string }
interface GmailMsg {
  id: string
  internalDate?: string
  labelIds?: string[]
  snippet?: string
  payload?: { mimeType?: string; headers?: GmailHeader[] }
}

const AUTO_REPLY_DELAY_DAYS = 3
const RECHECK_AFTER_MS = 10 * 60_000
const CONCURRENCY = 5

const header = (m: GmailMsg, name: string) =>
  m.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''

export const threadIdOf = (r: Pick<Reminder, 'description'>) =>
  r.description?.match(/gmailThreadId:(\S+)/)?.[1] ?? null

function isBounce(m: GmailMsg): boolean {
  const from = header(m, 'From')
  return /mailer-daemon|postmaster/i.test(from)
    || /multipart\/report/i.test(header(m, 'Content-Type'))
    || /delivery status notification|undeliverable|delivery has failed|returned mail/i.test(header(m, 'Subject'))
}

function isAutoReply(m: GmailMsg): boolean {
  const autoSubmitted = header(m, 'Auto-Submitted')
  if (autoSubmitted && autoSubmitted.toLowerCase() !== 'no') return true
  if (header(m, 'X-Autoreply') || header(m, 'X-Autorespond')) return true
  if (/auto_reply/i.test(header(m, 'Precedence'))) return true
  return /^(auto(matic)?[ -]?reply|out of (the )?office|away from (the )?office|on vacation|abwesenheit|absence)/i
    .test(header(m, 'Subject').replace(/^re:\s*/i, ''))
}

/** Asks the model whether a human reply is an opt-out. Defaults to 'replied' on any failure. */
async function classifyReply(text: string): Promise<'replied' | 'opted_out'> {
  try {
    const raw = await callAI({
      system: 'You classify replies to sales outreach emails. Answer with exactly one word.',
      prompt: `Reply text:\n"""${text.slice(0, 800)}"""\n\nIs the sender asking to stop contact or clearly not interested? Answer OPTOUT or REPLY.`,
      maxTokens: 5,
      model: 'claude-haiku-4-5-20251001',
    })
    return /OPTOUT/i.test(raw) ? 'opted_out' : 'replied'
  } catch {
    return 'replied'
  }
}

async function fetchThread(accessToken: string, threadId: string): Promise<GmailMsg[] | null> {
  const params = new URLSearchParams({ format: 'metadata' })
  for (const h of ['From', 'Subject', 'Auto-Submitted', 'X-Autoreply', 'X-Autorespond', 'Precedence', 'Content-Type']) {
    params.append('metadataHeaders', h)
  }
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (res.status === 404 || res.status === 400) return null
  if (!res.ok) throw new Error(`Gmail ${res.status}`)
  const data = await res.json() as { messages?: GmailMsg[] }
  return data.messages ?? []
}

/** Checks one follow-up and applies the outcome to the database. */
export async function checkFollowup(r: Reminder, accessToken: string): Promise<CheckResult> {
  const now = new Date()
  const threadId = threadIdOf(r)
  if (!threadId) return { reminderId: r.id, outcome: 'none' }

  const messages = await fetchThread(accessToken, threadId)
  if (messages === null) {
    await db.update(reminders)
      .set({ followupStatus: 'untracked', followupCheckedAt: now })
      .where(eq(reminders.id, r.id))
    return { reminderId: r.id, outcome: 'untracked' }
  }

  // Only messages newer than what we've already processed (or than the reminder itself)
  const since = (r.followupLastSeenAt ?? r.createdAt).getTime()
  const fresh = messages
    .map(m => ({ m, at: Number(m.internalDate ?? 0) }))
    .filter(x => x.at > since)
    .sort((a, b) => a.at - b.at)
  const lastSeen = fresh.length ? new Date(fresh[fresh.length - 1].at) : r.followupLastSeenAt

  const human = fresh.filter(x => !x.m.labelIds?.includes('SENT') && !isBounce(x.m) && !isAutoReply(x.m))
  const bounce = fresh.find(x => isBounce(x.m))
  const self = fresh.filter(x => x.m.labelIds?.includes('SENT'))
  const auto = fresh.filter(x => !x.m.labelIds?.includes('SENT') && isAutoReply(x.m))

  const close = async (status: 'replied' | 'opted_out' | 'bounced', note: string) => {
    await db.update(reminders).set({
      enabled: false, lastDoneAt: now, snoozedUntil: null,
      followupStatus: status, followupNote: note.slice(0, 280),
      followupCheckedAt: now, followupLastSeenAt: lastSeen,
    }).where(eq(reminders.id, r.id))
  }

  if (human.length) {
    const text = human.map(x => x.m.snippet ?? '').join('\n').trim()
    const outcome = await classifyReply(text)
    await close(outcome, human[human.length - 1].m.snippet ?? '')
    return { reminderId: r.id, outcome, note: text }
  }

  if (bounce) {
    await close('bounced', bounce.m.snippet ?? 'Delivery failed')
    return { reminderId: r.id, outcome: 'bounced' }
  }

  if (self.length) {
    // User followed up themselves in Gmail: restart the clock from their latest message
    const at = self[self.length - 1].at
    await db.update(reminders).set({
      nextDueAt: new Date(at + r.intervalDays * 86_400_000), snoozedUntil: null,
      followupStatus: null, followupNote: null,
      followupCheckedAt: now, followupLastSeenAt: lastSeen,
    }).where(eq(reminders.id, r.id))
    return { reminderId: r.id, outcome: 'self_replied' }
  }

  if (auto.length) {
    const pushTo = new Date(now.getTime() + AUTO_REPLY_DELAY_DAYS * 86_400_000)
    const current = r.snoozedUntil && r.snoozedUntil > pushTo ? r.snoozedUntil : pushTo
    await db.update(reminders).set({
      snoozedUntil: current,
      followupStatus: 'auto_reply', followupNote: (auto[auto.length - 1].m.snippet ?? '').slice(0, 280),
      followupCheckedAt: now, followupLastSeenAt: lastSeen,
    }).where(eq(reminders.id, r.id))
    return { reminderId: r.id, outcome: 'auto_reply' }
  }

  await db.update(reminders)
    .set({ followupCheckedAt: now, followupLastSeenAt: lastSeen, ...(r.followupStatus === 'untracked' ? { followupStatus: null } : {}) })
    .where(eq(reminders.id, r.id))
  return { reminderId: r.id, outcome: 'none' }
}

/** Checks every open Gmail follow-up for a brand. Skips ones checked in the last 10 minutes unless forced. */
export async function checkBrandFollowups(
  brandId: string,
  opts: { force?: boolean; deadline?: number } = {},
): Promise<{ results: CheckResult[]; error?: string }> {
  let accessToken: string
  try {
    accessToken = await getValidGmailToken(brandId)
  } catch (e) {
    return { results: [], error: e instanceof Error ? e.message : 'Gmail not connected' }
  }

  const open = await db.select().from(reminders).where(and(
    eq(reminders.brandId, brandId),
    eq(reminders.category, 'outreach'),
    eq(reminders.enabled, true),
    isNull(reminders.lastDoneAt),
    like(reminders.description, '%gmailThreadId:%'),
  )).limit(200)

  const due = opts.force
    ? open
    : open.filter(r => !r.followupCheckedAt || Date.now() - r.followupCheckedAt.getTime() > RECHECK_AFTER_MS)

  const results: CheckResult[] = []
  for (let i = 0; i < due.length; i += CONCURRENCY) {
    if (opts.deadline && Date.now() > opts.deadline) break
    const batch = await Promise.all(due.slice(i, i + CONCURRENCY).map(r =>
      checkFollowup(r, accessToken).catch(e => {
        console.error('[reply-check]', r.id, e instanceof Error ? e.message : e)
        return { reminderId: r.id, outcome: 'none' as const }
      }),
    ))
    results.push(...batch)
  }
  return { results }
}
