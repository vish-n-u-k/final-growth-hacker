'use client'

import { useCallback, useEffect, useState } from 'react'
import { Spinner } from '@/components/ui/spinner'
import {
  CLOSED_WINDOW_DAYS, OUTCOME_LABEL, closedFollowUps, gmailLink, loadReminders, reopenReminder, type Closed,
} from '@/lib/email-outreach/followups'
import { fmtDate, initials, type Notify } from './shared'
import { Pager, usePages } from '@/components/tool-ui'

// Email Outreach → Done: follow-ups closed in the last two weeks (a reply, opt-out or bounce
// found in Gmail, or skipped by the user, which can be restored) and every email sent or
// scheduled from GrowJin, tagged with the tool it came from.

export interface SentEmail {
  id: string; toEmail: string; toName: string | null; subject: string; status: string; source: string | null
  scheduledAt: string | null; sentAt: string | null; lastError: string | null; createdAt: string
}

// Which tool an email came from (outreach_emails.source)
const SOURCE_LABEL: Record<string, string> = {
  'lead-agent': 'Lead Agent', 'search-agent': 'Search Agent', 'competitor-leads': 'Competitor Leads',
  campaign: 'Campaign', followup: 'Follow-up',
}
const STATUS_LABEL: Record<string, string> = { sent: 'Sent', sending: 'Sending', scheduled: 'Scheduled', failed: 'Failed', draft: 'Draft', cancelled: 'Cancelled' }

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

export default function Done({ reloadKey, sent, notify, onChanged, onCancel }: {
  reloadKey: number
  sent: SentEmail[]
  notify: Notify
  onChanged: () => void
  onCancel: (emailId: string) => void
}) {
  const [closed, setClosed]   = useState<Closed[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setClosed(closedFollowUps(await loadReminders())) } catch { /* the sent list still shows */ }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load, reloadKey])
  const closedPg = usePages(closed, null)
  const sentPg = usePages(sent, null)

  async function restore(c: Closed) {
    setBusy(c.id)
    const ok = await reopenReminder(c.id)
    setBusy(null)
    notify(ok ? `${c.recipient} is back in Follow-ups` : 'Could not restore it')
    if (ok) { await load(); onChanged() }
  }

  return (
    <div className="eo-done">
      <h2 className="eo-h">Follow-ups closed <span className="eo-count">{closed.length}</span></h2>
      {loading ? <div className="ro-working eo-loading"><Spinner /><span>Loading…</span><i /></div>
        : closed.length === 0 ? <p className="eo-empty">Nothing in the last {CLOSED_WINDOW_DAYS} days. When someone replies, opts out or bounces, the follow-up closes by itself and shows up here.</p>
        : (
          <div className="eo-list">
            {closedPg.items.map(c => (
              <div key={c.id} className="eo-row">
                <span className="cl-av eo-av-sm" aria-hidden="true">{initials(c.recipient)}</span>
                <span className="eo-row-main">
                  <b>{c.recipient}</b>
                  <span className="eo-ellip" title={c.note ?? c.subject}>{c.note ? `“${c.note}”` : c.subject}</span>
                </span>
                <span className={`eo-outcome eo-outcome--${c.outcome}`}>{OUTCOME_LABEL[c.outcome]}</span>
                <span className="eo-row-date">{fmtDate(c.at)}</span>
                <span className="eo-row-acts">
                  {c.outcome === 'closed'
                    ? <button type="button" className="btn btn-link" disabled={busy === c.id} onClick={() => restore(c)}>{busy === c.id ? <Spinner /> : 'Restore'}</button>
                    : c.threadId && <a className="btn btn-link" href={gmailLink(c.threadId)} target="_blank" rel="noreferrer">Open in Gmail</a>}
                </span>
              </div>
            ))}
          </div>
        )}
      <Pager p={closedPg} />

      <h2 className="eo-h">Emails sent <span className="eo-count">{sent.length}</span></h2>
      {sent.length === 0 ? <p className="eo-empty">Emails you send from any GrowJin tool show up here.</p> : (
        <div className="eo-list">
          {sentPg.items.map(e => (
            <div key={e.id} className="eo-row">
              <span className="cl-av eo-av-sm" aria-hidden="true">{initials(e.toName || e.toEmail)}</span>
              <span className="eo-row-main">
                <b title={e.toEmail}>{e.toName || e.toEmail}</b>
                <span className="eo-ellip" title={e.subject}>{e.subject}</span>
              </span>
              {e.source && SOURCE_LABEL[e.source] && <span className="eo-src">{SOURCE_LABEL[e.source]}</span>}
              <span className={`eo-outcome eo-outcome--${e.status}`} title={e.lastError ?? undefined}>{STATUS_LABEL[e.status] ?? e.status}</span>
              <span className="eo-row-date">
                {e.status === 'scheduled' && e.scheduledAt ? when(e.scheduledAt) : fmtDate(e.sentAt ?? e.createdAt)}
              </span>
              <span className="eo-row-acts">
                {(e.status === 'scheduled' || e.status === 'failed') && (
                  <button type="button" className="btn btn-link" onClick={() => onCancel(e.id)}>Cancel</button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      <Pager p={sentPg} />
    </div>
  )
}
