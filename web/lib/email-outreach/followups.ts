// Gmail follow-up reminders as Email Outreach shows them (components/email-outreach/*).
// A follow-up is a one-off `reminders` row (category 'outreach') created when an email is sent
// with "Follow up in N days" (lib/gmail/send.ts); closing it sets lastDoneAt.

export interface Reminder {
  id: string
  title: string
  description: string | null
  category: string
  nextDueAt: string
  snoozedUntil: string | null
  lastDoneAt: string | null
  enabled: boolean
  createdAt: string
  followupStatus: string | null
  followupNote: string | null
}

export interface FollowUp {
  id: string
  recipient: string
  subject: string
  createdAt: string
  dueAt: Date
  snoozed: boolean
  status: string | null
  note: string | null
  threadId: string | null
}

export interface Closed {
  id: string
  recipient: string
  subject: string
  outcome: 'replied' | 'opted_out' | 'bounced' | 'closed'
  note: string | null
  at: string
  threadId: string | null
}

export const DAY = 86_400_000
export const CLOSED_WINDOW_DAYS = 14

export const OUTCOME_LABEL: Record<Closed['outcome'], string> = {
  replied: 'Replied', opted_out: 'Opted out', bounced: 'Bounced', closed: 'Closed',
}

const threadIdOf = (desc: string | null) => desc?.match(/gmailThreadId:(\S+)/)?.[1] ?? null
const recipientOf = (r: Reminder) => r.title.replace(/^Follow up:\s*/i, '').trim()
const subjectOf = (r: Reminder) => (r.description ?? '').split('\n')[0].replace(/^Re:\s*/i, '').trim()
export const gmailLink = (threadId: string) => `https://mail.google.com/mail/u/0/#all/${threadId}`

/** Open follow-ups, soonest first. */
export function openFollowUps(rows: Reminder[]): FollowUp[] {
  return rows
    .filter(r => r.category === 'outreach' && r.enabled && !r.lastDoneAt && r.description?.includes('gmailThreadId:'))
    .map(r => {
      const snoozeUntil = r.snoozedUntil ? new Date(r.snoozedUntil) : null
      const snoozed = !!snoozeUntil && snoozeUntil.getTime() > Date.now()
      return {
        id: r.id, recipient: recipientOf(r), subject: subjectOf(r), createdAt: r.createdAt,
        dueAt: snoozed ? snoozeUntil! : new Date(r.nextDueAt), snoozed,
        status: r.followupStatus, note: r.followupNote, threadId: threadIdOf(r.description),
      }
    })
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
}

/** Follow-ups closed in the last two weeks: by a reply, opt-out or bounce, or by the user. */
export function closedFollowUps(rows: Reminder[]): Closed[] {
  const cutoff = Date.now() - CLOSED_WINDOW_DAYS * DAY
  return rows
    .filter(r => r.category === 'outreach' && r.lastDoneAt && new Date(r.lastDoneAt).getTime() > cutoff && r.description?.includes('gmailThreadId:'))
    .map(r => ({
      id: r.id, recipient: recipientOf(r), subject: subjectOf(r),
      outcome: (['replied', 'opted_out', 'bounced'].includes(r.followupStatus ?? '') ? r.followupStatus : 'closed') as Closed['outcome'],
      note: r.followupNote, at: r.lastDoneAt!, threadId: threadIdOf(r.description),
    }))
    .sort((a, b) => b.at.localeCompare(a.at))
}

export function isDue(f: FollowUp): boolean {
  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999)
  return !f.snoozed && f.dueAt.getTime() <= endOfToday.getTime()
}

export function dueLabel(f: FollowUp): { text: string; tone: 'overdue' | 'today' | 'upcoming' | 'snoozed' } {
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
  const dayDiff = Math.floor((f.dueAt.getTime() - startOfToday.getTime()) / DAY)
  if (f.snoozed) return { text: `Snoozed · ${dayDiff <= 1 ? 'tomorrow' : `in ${dayDiff} days`}`, tone: 'snoozed' }
  if (dayDiff < 0) return { text: `Overdue ${-dayDiff} day${dayDiff === -1 ? '' : 's'}`, tone: 'overdue' }
  if (dayDiff === 0) return { text: 'Due today', tone: 'today' }
  if (dayDiff === 1) return { text: 'Tomorrow', tone: 'upcoming' }
  return { text: `In ${dayDiff} days`, tone: 'upcoming' }
}

export async function loadReminders(): Promise<Reminder[]> {
  const res = await fetch('/api/reminders')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json() as { reminders?: Reminder[] }
  return data.reminders ?? []
}

export const closeReminder = (id: string) =>
  fetch(`/api/reminders/${id}/done`, { method: 'POST' }).then(r => r.ok).catch(() => false)

export const reopenReminder = (id: string) =>
  fetch(`/api/reminders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reopen: true }) })
    .then(r => r.ok).catch(() => false)
