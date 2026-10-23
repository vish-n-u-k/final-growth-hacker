'use client'

import { useCallback, useRef, useState } from 'react'

// Pieces shared by Email Outreach's tabs (components/GmailHub): the email editor, the step bar
// (same look as Competitor Leads' reach-out page) and the toast with an optional Undo.

export interface Mail { to: string; subject: string; body: string; editingHtml?: boolean }

/** To, subject and an HTML body shown as it will look, with a Source toggle to edit the HTML. */
export function EmailEditor({ mail, onChange }: { mail: Mail; onChange: (patch: Partial<Mail>) => void }) {
  return (
    <div className="eo-mail">
      <label className="eo-mail-row"><span>To</span>
        <input type="email" value={mail.to} onChange={e => onChange({ to: e.target.value })} placeholder="recipient@email.com" />
      </label>
      <label className="eo-mail-row"><span>Subject</span>
        <input value={mail.subject} onChange={e => onChange({ subject: e.target.value })} />
      </label>
      <div className="eo-mail-body">
        <button type="button" className="eo-mail-src" onClick={() => onChange({ editingHtml: !mail.editingHtml })}>
          {mail.editingHtml ? 'Preview' : 'Edit HTML'}
        </button>
        {mail.editingHtml
          ? <textarea aria-label="Message HTML" rows={12} value={mail.body} onChange={e => onChange({ body: e.target.value })} />
          : <div className="gh-ee-preview" dangerouslySetInnerHTML={{ __html: mail.body }} />}
      </div>
    </div>
  )
}

export function Steps({ labels, at }: { labels: string[]; at: number }) {
  return (
    <ol className="ro-steps eo-steps" aria-label="Steps">
      {labels.map((label, i) => {
        const n = i + 1
        const state = n < at ? 'past' : n === at ? 'on' : 'next'
        return (
          <li key={label} className={`ro-step ro-step--${state}`} aria-current={state === 'on' ? 'step' : undefined}>
            <span className="ro-step-n">{state === 'past' ? '✓' : n}</span><span className="ro-step-l">{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

export type Notify = (msg: string, undo?: () => void) => void

/** A toast at the bottom of the screen; `notify(msg, undo)` adds an Undo button. */
export function useToast(): [React.ReactNode, Notify] {
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notify = useCallback<Notify>((msg, undo) => {
    if (timer.current) clearTimeout(timer.current)
    setToast({ msg, undo })
    timer.current = setTimeout(() => setToast(null), undo ? 6000 : 4000)
  }, [])
  const node = toast && (
    <div className="eo-toast" role="status">
      <span>{toast.msg}</span>
      {toast.undo && <button type="button" onClick={() => { toast.undo!(); setToast(null) }}>Undo</button>}
      <button type="button" className="eo-toast-x" aria-label="Dismiss" onClick={() => setToast(null)}>✕</button>
    </div>
  )
  return [node, notify]
}

export const initials = (s: string) => {
  const name = s.replace(/<.*>/, '').replace(/@.*/, '').replace(/[^\p{L}\s]/gu, ' ').trim()
  return name.split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase() || '?'
}
export const fmtDate = (d: string | Date) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
export const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  return m < 2 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : fmtDate(iso)
}
export const plainText = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim()
