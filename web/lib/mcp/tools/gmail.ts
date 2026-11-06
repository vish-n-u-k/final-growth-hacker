import { and, eq, gte } from 'drizzle-orm'
import { db } from '@/lib/db'
import { brandIntegrations, outreachEmails } from '@/lib/db/schema'
import { getValidGmailToken } from '@/lib/gmail/token'
import { sendGmailMessage, createFollowupReminder, parseRecipientName, GmailSendError } from '@/lib/gmail/send'
import { markOutreachDrafts } from '@/lib/tool-suggestions'
import { daysFrom, loadBrandContext, textToHtml } from '@/lib/agents/context'
import { readLeadData, updateLeadData } from '@/lib/agents/store'
import { leadFallback, OPT_OUT } from '@/lib/agents/lead-agent'
import { readMcpSendPermission } from '@/lib/mcp/gmail-permission'

// MCP tools gmail_status and send_email: send from the brand's connected Gmail, only once the user has
// switched on "Let Claude send email" in Settings → Connect Claude. Sent emails are saved to
// outreach_emails (source 'claude'), so they show in Email Outreach and count as contacted.

const SOURCE = 'claude'
const MAX_BATCH = 20
const SEND_SCOPES = ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.compose', 'https://www.googleapis.com/auth/gmail.modify', 'https://mail.google.com/']
const SETTINGS_URL = '/settings?tab=claude-code'

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const validEmail = (e: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(e)
const addressOf = (to: string) => (to.match(/<([^>]+)>/)?.[1] ?? to).trim().toLowerCase()
const startOfDay = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d }

async function gmailRow(brandId: string) {
  const [row] = await db
    .select({ status: brandIntegrations.status, scopes: brandIntegrations.scopes, metadata: brandIntegrations.metadata, accessToken: brandIntegrations.accessToken })
    .from(brandIntegrations)
    .where(and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.provider, 'gmail')))
    .limit(1)
  return row ?? null
}

async function sentByClaudeToday(brandId: string): Promise<number> {
  const rows = await db.select({ id: outreachEmails.id }).from(outreachEmails)
    .where(and(eq(outreachEmails.brandId, brandId), eq(outreachEmails.source, SOURCE), gte(outreachEmails.sentAt, startOfDay())))
    .catch(() => [])
  return rows.length
}

interface Status {
  connected: boolean
  address: string | null
  can_send: boolean
  sending_allowed: boolean
  daily_limit: number
  sent_today: number
  left_today: number
  problem: string | null
}

async function status(brandId: string): Promise<Status> {
  const [row, perm, sent] = await Promise.all([gmailRow(brandId), readMcpSendPermission(brandId), sentByClaudeToday(brandId)])
  const address = (row?.metadata as { gmail_address?: string } | null)?.gmail_address ?? null
  let problem: string | null = null
  let connected = !!row?.accessToken && row.status === 'connected'
  if (connected) {
    try { await getValidGmailToken(brandId) } catch (e) {
      connected = false
      problem = `Gmail needs reconnecting (${e instanceof Error ? e.message : 'token expired'}). Reconnect it in GrowJin → Email Outreach.`
    }
  } else problem = 'Gmail is not connected. Connect it in GrowJin → Email Outreach.'
  const scopes = row?.scopes ?? []
  const canSend = connected && (!scopes.length || scopes.some(s => SEND_SCOPES.includes(s)))
  if (connected && !canSend) problem = 'Gmail is connected without permission to send. Reconnect it in GrowJin → Email Outreach and allow sending.'
  if (canSend && !perm.on) problem = `The user hasn't allowed Claude to send email yet. They can switch on "Let Claude send email" in GrowJin → Settings → Connect Claude (${SETTINGS_URL}).`
  return {
    connected, address, can_send: canSend, sending_allowed: perm.on,
    daily_limit: perm.dailyLimit, sent_today: sent, left_today: Math.max(0, perm.dailyLimit - sent),
    problem,
  }
}

export async function gmailStatus(brandId: string) {
  const s = await status(brandId)
  return {
    ...s,
    ready_to_send: s.can_send && s.sending_allowed && s.left_today > 0,
    ...(s.can_send && s.sending_allowed && s.left_today === 0 ? { problem: `Today's limit of ${s.daily_limit} emails sent by Claude is reached. More can go out tomorrow (UTC).` } : {}),
  }
}

interface Mail { to: string; subject: string; body: string; thread_id?: string; in_reply_to?: string; follow_up_days?: number }

export async function sendEmail(brandId: string, args: Record<string, unknown>) {
  const raw: unknown[] = Array.isArray(args.emails) ? args.emails : [args]
  if (!raw.length) return { error: 'Give to, subject and body (or emails: a list of them).' }
  if (raw.length > MAX_BATCH) return { error: `At most ${MAX_BATCH} emails per call.` }

  const s = await status(brandId)
  if (!s.can_send || !s.sending_allowed) return { sent: 0, error: s.problem, connected: s.connected, sending_allowed: s.sending_allowed }

  const mails: (Mail & { problem?: string })[] = raw.map(r => {
    const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
    const m: Mail = {
      to: str(o.to), subject: str(o.subject), body: typeof o.body === 'string' ? o.body.trim() : '',
      thread_id: str(o.thread_id) || undefined, in_reply_to: str(o.in_reply_to) || undefined,
      follow_up_days: typeof o.follow_up_days === 'number' && o.follow_up_days > 0 ? Math.min(60, Math.round(o.follow_up_days)) : undefined,
    }
    const problem = !validEmail(addressOf(m.to)) ? 'Not a valid email address' : !m.subject && !m.thread_id ? 'No subject' : !m.body ? 'No body' : undefined
    return { ...m, problem }
  })
  const dupes = new Set<string>()
  for (const m of mails) {
    const a = addressOf(m.to)
    if (!m.problem && !m.thread_id && dupes.has(a)) m.problem = 'Same address twice in this call'
    dupes.add(a)
  }

  const b = await loadBrandContext(brandId)
  const leadData = await readLeadData(brandId).catch(() => null)
  let left = s.left_today
  const results: { to: string; status: 'sent' | 'not_sent'; reason?: string; thread_id?: string; message_id?: string; lead?: string }[] = []

  for (const m of mails) {
    if (m.problem) { results.push({ to: m.to, status: 'not_sent', reason: m.problem }); continue }
    if (left <= 0) { results.push({ to: m.to, status: 'not_sent', reason: `Today's limit of ${s.daily_limit} reached` }); continue }
    const addr = addressOf(m.to)
    // A first email to someone on the Lead Finder board: sent as that lead, so its follow-ups and reply check carry on
    const lead = !m.thread_id ? leadData?.leads.find(l => l.email?.toLowerCase() === addr && ['ready', 'needs_contact', 'queued'].includes(l.status)) : undefined
    const plain = !/<(p|br|div|a|ul|ol|li|strong|em|b|i|table)\b/i.test(m.body)
    const text = lead && plain && !m.body.includes(OPT_OUT) ? `${m.body}\n\n${OPT_OUT}` : m.body
    const html = plain ? textToHtml(text) : text
    const subject = m.subject || '(no subject)'
    try {
      const sent = await sendGmailMessage(brandId, { to: m.to, subject, body: html, threadId: m.thread_id, inReplyTo: m.in_reply_to })
      left -= 1
      await db.insert(outreachEmails).values({
        brandId, toEmail: addr, toName: parseRecipientName(m.to) ?? lead?.name ?? null, subject, body: html, status: 'sent', sentAt: new Date(),
        gmailMessageId: sent.id, gmailThreadId: sent.threadId, source: SOURCE,
      }).catch(e => console.error('[mcp send_email] could not save the sent email:', e instanceof Error ? e.message : e))
      await markOutreachDrafts(brandId, addr, 'sent').catch(() => {})
      if (lead && b) {
        const now = new Date().toISOString()
        await updateLeadData(brandId, leadFallback(b), d => {
          const l = d.leads.find(x => x.id === lead.id)
          if (!l) return
          Object.assign(l, {
            status: 'sent', sentAt: now, threadId: sent.threadId, followupsSent: 0, approvedBy: 'user', error: undefined,
            draft: { subject, body: m.body }, nextFollowUpAt: d.settings.followUpDays[0] ? daysFrom(now, d.settings.followUpDays[0]) : undefined,
          })
          d.sentLog.push(now)
        }).catch(() => {})
      } else if (m.follow_up_days) {
        await createFollowupReminder(brandId, { to: addr, subject, threadId: sent.threadId, days: m.follow_up_days }).catch(() => {})
      }
      results.push({ to: m.to, status: 'sent', thread_id: sent.threadId, message_id: sent.id, ...(lead ? { lead: `${lead.company ?? lead.title}: marked sent on Lead Finder; its follow-ups go out by themselves and stop when they reply` } : {}) })
    } catch (e) {
      const reason = e instanceof GmailSendError
        ? (e.code === 'suppressed' ? e.message : e.code === 'missing_send_scope' ? 'Gmail send permission missing: reconnect Gmail' : e.message)
        : e instanceof Error ? e.message : 'Send failed'
      results.push({ to: m.to, status: 'not_sent', reason })
      if (e instanceof GmailSendError && (e.code === 'not_connected' || e.code === 'missing_send_scope')) {
        for (const rest of mails.slice(mails.indexOf(m) + 1)) results.push({ to: rest.to, status: 'not_sent', reason: 'Gmail stopped working: not tried' })
        break
      }
    }
  }
  const sentCount = results.filter(r => r.status === 'sent').length
  return { sent: sentCount, not_sent: results.length - sentCount, from: s.address, left_today: left, results }
}
