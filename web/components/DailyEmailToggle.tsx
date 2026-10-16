'use client'

// The daily email on/off switch, used on Today, Analytics and Settings → Account.
// The email goes out once a day at 00:30 UTC (vercel.json → /api/cron/daily-email); times are
// shown in the viewer's own timezone.

import { useEffect, useState } from 'react'
import { Mail } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'

const SEND_UTC = { h: 0, m: 30 }

/** "6:00 AM" for the send time, and whether the next one is today or tomorrow (viewer's clock). */
function nextSend(now = new Date()) {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), SEND_UTC.h, SEND_UTC.m))
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
  const time = next.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const sameDay = next.toDateString() === now.toDateString()
  return { time, when: sameDay ? 'today' : 'tomorrow' }
}

export default function DailyEmailToggle({ initialEnabled, email: initialEmail = null, variant = 'compact' }: {
  initialEnabled: boolean
  email?: string | null
  variant?: 'compact' | 'full'
}) {
  const [on, setOn] = useState(initialEnabled)
  const [email, setEmail] = useState(initialEmail)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  // Local time only after mount, so server and browser render the same HTML
  const [send, setSend] = useState<{ time: string; when: string } | null>(null)
  useEffect(() => { setSend(nextSend()) }, [])

  useEffect(() => {
    if (!note || note.kind === 'error') return
    const t = setTimeout(() => setNote(null), 5000)
    return () => clearTimeout(t)
  }, [note])

  async function toggle() {
    const next = !on
    setOn(next) // move the switch right away; put it back if saving fails
    setSaving(true)
    setNote(null)
    try {
      const res = await fetch('/api/analytics/daily-email-pref', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: next }),
      })
      if (!res.ok) throw new Error()
      const d = await res.json() as { dailyEmailEnabled: boolean; email: string | null }
      setOn(d.dailyEmailEnabled)
      if (d.email) setEmail(d.email)
      const s = nextSend()
      setNote(d.dailyEmailEnabled
        ? { kind: 'ok', text: `On. The first one arrives ${s.when} at ${s.time}${d.email ? ` (${d.email})` : ''}.` }
        : { kind: 'ok', text: 'Off. No more daily emails.' })
    } catch {
      setOn(!next)
      setNote({ kind: 'error', text: 'Couldn’t save that. Check your connection and try again.' })
    } finally {
      setSaving(false)
    }
  }

  const sw = (
    <button
      type="button" role="switch" aria-checked={on} aria-label="Daily email" disabled={saving}
      className={`de-switch${on ? ' is-on' : ''}`} onClick={toggle}
    >
      <span className="de-knob">{saving && <Spinner size={10} style={{ margin: 0, color: 'var(--green)' }} />}</span>
    </button>
  )

  const summary = on
    ? `Every morning${send ? ` at ${send.time}` : ''}${email ? ` to ${email}` : ''}`
    : 'Yesterday’s numbers and today’s top tasks in your inbox each morning'

  if (variant === 'full') {
    return (
      <div className="de-full">
        <div className="de-full-row">
          <span className={`de-icon${on ? ' is-on' : ''}`} aria-hidden="true"><Mail size={16} /></span>
          <div className="de-full-text">
            <div className="de-title">Daily email</div>
            <div className="de-sub">{summary}</div>
          </div>
          {sw}
        </div>
        <ul className="de-list">
          <li>What happened yesterday: visitors, signups and where they came from</li>
          <li>Your top tasks for today, each with a one-click “Do it with Claude”</li>
          <li>Recurring checks due in the next two days, with a Mark done link</li>
        </ul>
        {on && send && <p className="de-next">Next email: {send.when} at {send.time}. It’s skipped on days with nothing to report.</p>}
        {/* "Next email" already confirms turning it on; say so only for off and errors */}
        {note && (note.kind === 'error' || !on) && <p className={`de-note de-note--${note.kind}`} role="status">{note.text}</p>}
        <style>{CSS}</style>
      </div>
    )
  }

  return (
    <div className="de-compact-wrap">
      <div className={`de-compact${on ? ' is-on' : ''}`} title={summary}>
        <Mail size={13} aria-hidden="true" />
        <span className="de-compact-label">Daily email</span>
        {sw}
      </div>
      {note && <p className={`de-pop de-note--${note.kind}`} role="status">{note.text}</p>}
      <style>{CSS}</style>
    </div>
  )
}

const CSS = `
.de-switch { position: relative; flex: none; width: 36px; height: 20px; border-radius: 99px; border: none; padding: 0; cursor: pointer; background: var(--line); transition: background .2s; }
.de-switch.is-on { background: var(--green); }
.de-switch:disabled { cursor: default; }
.de-switch:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
.de-knob { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: left .2s; display: flex; align-items: center; justify-content: center; }
.de-switch.is-on .de-knob { left: 18px; }

.de-compact-wrap { position: relative; }
.de-compact { display: inline-flex; align-items: center; gap: 8px; padding: 5px 6px 5px 12px; border-radius: 99px; border: 1px solid var(--line); background: var(--card); color: var(--text-dim); font-size: 12px; font-weight: 600; white-space: nowrap; transition: border-color .15s, color .15s; }
.de-compact.is-on { border-color: color-mix(in srgb, var(--green) 45%, var(--line)); color: var(--text); }
.de-pop { position: absolute; right: 0; top: calc(100% + 6px); z-index: 30; width: max-content; max-width: min(300px, 80vw); margin: 0; padding: 8px 12px; border-radius: 10px; font-size: 12px; line-height: 1.45; background: var(--card); border: 1px solid var(--line); box-shadow: 0 8px 24px rgba(0,0,0,.12); white-space: normal; }

.de-full { display: flex; flex-direction: column; gap: 10px; }
.de-full-row { display: flex; align-items: center; gap: 12px; }
.de-icon { flex: none; width: 32px; height: 32px; border-radius: 9px; display: flex; align-items: center; justify-content: center; background: var(--bg-soft); color: var(--text-faint); transition: background .2s, color .2s; }
.de-icon.is-on { background: color-mix(in srgb, var(--green) 14%, transparent); color: var(--green); }
.de-full-text { flex: 1; min-width: 0; }
.de-title { font-size: 13.5px; font-weight: 600; color: var(--text); }
.de-sub { font-size: 12px; color: var(--text-faint); margin-top: 2px; overflow-wrap: anywhere; }
.de-list { margin: 0 0 0 44px; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.de-list li { font-size: 12px; color: var(--text-dim); padding-left: 14px; position: relative; }
.de-list li::before { content: ''; position: absolute; left: 0; top: 7px; width: 5px; height: 5px; border-radius: 50%; background: var(--green); opacity: .7; }
.de-next, .de-note { margin: 0 0 0 44px; font-size: 12px; }
.de-next { color: var(--text-faint); }
.de-note--ok { color: var(--green); }
.de-note--error { color: #dc2626; }
@media (max-width: 480px) { .de-list, .de-next, .de-note { margin-left: 0; } }
@media (max-width: 640px) { .de-pop { position: static; margin-top: 6px; box-shadow: none; } }
`
