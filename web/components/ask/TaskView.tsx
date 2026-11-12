'use client'

import { useEffect, useRef, useState } from 'react'
import type { Proposal } from '@/lib/ask/types'
import type { EngineLead, EngineStatus } from '@/lib/leads/engine'
import { tool } from './AskPanel'

// What Ask shows when Claude started a job or proposed something (design-previews/seo-ask/ask-agent.html):
// a lead search running in the background (polled from /api/ask/task), its leads to pick, add, download
// or email; and emails Claude wrote, sent only when approved (send_email). One blue button per step.

interface SendResult { sent?: number; error?: string; left_today?: number; results?: { to: string; status: string; reason?: string }[] }
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const reach = (l: EngineLead) => (l.email ? 'email' : l.socials?.[0]?.platform ? `${l.socials[0].platform} message` : 'website')

function csvOf(leads: EngineLead[]): string {
  const head = ['company', 'website', 'contact_name', 'contact_title', 'email', 'email_status', 'location', 'socials', 'rating', 'why']
  const rows = leads.map(l => [
    l.company, l.website, l.contact_name, l.contact_title, l.email, l.email_status, l.location,
    (l.socials ?? []).map(s => s.url || s.platform).filter(Boolean).join(' '), l.rating, l.why,
  ])
  return [head, ...rows].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
}
function download(name: string, text: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  a.download = name
  a.click()
}

interface Draft { leadId: string; name: string; to: string; subject: string; body: string; error?: string }

export function TaskView({ brief, error: startError }: { brief: string; error?: string }) {
  const [task, setTask] = useState<EngineStatus | null>(null)
  const [picked, setPicked] = useState<boolean[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [drafts, setDrafts] = useState<Draft[] | null>(null)
  const [done, setDone] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (startError) return
    let live = true
    const poll = async () => {
      const j = await fetch('/api/ask/task').then(r => r.json()).catch(() => null) as { task?: EngineStatus | null } | null
      if (!live) return
      if (j?.task) {
        setTask(j.task)
        if (j.task.found && j.task.status !== 'running') setPicked(p => (p.length ? p : j.task!.found!.map((_, i) => !(j.task!.foundAdded ?? []).includes(i))))
      }
      if (!j?.task || j.task.status === 'running') timer.current = setTimeout(poll, 3000)
    }
    poll()
    return () => { live = false; if (timer.current) clearTimeout(timer.current) }
  }, [startError])

  if (startError) return <div className="ask-err-box"><p>{startError}</p></div>
  if (!task) return <p className="ask-faint">Starting the search…</p>

  const running = task.status === 'running'
  const found = task.found ?? []
  const added = new Set(task.foundAdded ?? [])
  const picks = found.map((_, i) => i).filter(i => picked[i] && !added.has(i))

  async function stop() {
    await fetch('/api/ask/task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'stop' }) })
  }
  async function add(write: boolean) {
    setBusy(write ? 'write' : 'add'); setError('')
    const r = await fetch('/api/ask/task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'add', picks }) })
    const j = await r.json().catch(() => ({})) as { added?: { id: string; company: string }[]; skipped?: { company: string; reason: string }[]; task?: EngineStatus; error?: string }
    if (!r.ok || !j.added) { setBusy(''); return setError(j.error ?? 'Couldn’t add them. Try again.') }
    if (j.task) setTask(j.task)
    const skippedNote = j.skipped?.length ? ` ${plural(j.skipped.length, 'was', 'were')} already on your list or contacted.` : ''
    if (!write) { setBusy(''); return setDone(`Added ${plural(j.added.length, 'lead')} to your list.${skippedNote}`) }
    // Claude writes the first email for each one with an address (3 at a time)
    const withEmail = j.added.filter(a => found.find(f => (f.company ?? '') === a.company)?.email).slice(0, 20)
    const out: Draft[] = []
    for (let i = 0; i < withEmail.length; i += 3) {
      out.push(...await Promise.all(withEmail.slice(i, i + 3).map(async a => {
        const w = await fetch('/api/ask/write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lead_id: a.id }) })
          .then(x => x.json()).catch(() => ({ error: 'Couldn’t write it.' })) as { kind?: string; to?: string; subject?: string; body?: string; error?: string }
        return { leadId: a.id, name: a.company, to: w.to ?? '', subject: w.subject ?? '', body: w.body ?? '', ...(w.error || w.kind !== 'email' ? { error: w.error ?? 'No email to write.' } : {}) }
      })))
    }
    setBusy('')
    setDone(`Added ${plural(j.added.length, 'lead')} to your list.${skippedNote}${j.added.length > withEmail.length ? ` ${j.added.length - withEmail.length} without an email ${j.added.length - withEmail.length === 1 ? 'is' : 'are'} in Leads, to message on their page.` : ''}`)
    setDrafts(out.filter(d => !d.error))
  }

  return (
    <div className="ask-task">
      {(running || !found.length) && (
        <div className="ask-task-box">
          <div className="ask-task-h">
            <b>{running ? 'Working on it…' : task.status === 'failed' ? 'The search didn’t finish' : 'No good leads this time'}</b>
            <small>${task.costUsd.toFixed(2)} so far</small>
          </div>
          <ul className="ask-fill-list">
            {task.log.map((l, i) => <li key={i} className={`ask-fs ${running && i === task.log.length - 1 ? 'is-on' : 'is-done'}`}><i aria-hidden="true" />{l.text}</li>)}
          </ul>
          {running && <div className="ask-acts"><button type="button" className="ask-btn ask-btn-quiet" onClick={stop}>Stop and keep what’s found</button><span className="ask-faint">You can leave this page; it carries on while Ask is open.</span></div>}
          {!running && (task.error || task.summary) && <p className="ask-faint">{task.error || task.summary}</p>}
        </div>
      )}

      {!running && found.length > 0 && !drafts && (
        <>
          <p className="ask-say"><b>{plural(found.length, 'lead')}</b> found. <b>{found.filter(f => f.email).length} have an email</b>{found.length - found.filter(f => f.email).length ? `; the other ${found.length - found.filter(f => f.email).length} you can message on their page` : ''}.</p>
          {task.summary && <p className="ask-faint">{task.summary}</p>}
          <div className="ask-leads">
            {found.map((l, i) => (
              <label key={i} className={`ask-lead${added.has(i) ? ' is-added' : ''}`}>
                <input type="checkbox" checked={added.has(i) || !!picked[i]} disabled={added.has(i)} onChange={e => setPicked(p => { const n = [...p]; n[i] = e.target.checked; return n })} />
                <span><b>{l.company || l.website}</b><small>{l.why}</small></span>
                <em>{added.has(i) ? 'added' : reach(l)}</em>
              </label>
            ))}
          </div>
          {!done && (
            <div className="ask-approve">
              <b>Add {plural(picks.length, 'lead')} to your list?</b>
              <p>Nothing is saved until you say so.</p>
              <div className="ask-acts">
                <button type="button" className="ask-btn" disabled={!!busy || !picks.length} onClick={() => add(true)}>{busy === 'write' ? 'Adding and writing…' : `Add ${picks.length} and write the emails`}</button>
                <button type="button" className="ask-btn ask-btn-quiet" disabled={!!busy || !picks.length} onClick={() => add(false)}>{busy === 'add' ? 'Adding…' : 'Just add them'}</button>
                <button type="button" className="ask-btn ask-btn-quiet" disabled={!picks.length} onClick={() => download(`leads-${new Date().toISOString().slice(0, 10)}.csv`, csvOf(picks.map(i => found[i])))}>Download (CSV)</button>
              </div>
            </div>
          )}
          <p className="ask-faint">Search cost ${task.costUsd.toFixed(2)}</p>
        </>
      )}

      {error && <p className="ask-err" role="alert">{error}</p>}
      {done && <p className="ask-done-line">✓ {done}</p>}
      {drafts && (drafts.length
        ? <ProposalView proposal={{ kind: 'send_emails', title: `${plural(drafts.length, 'email')} ready for your OK`, why: 'Written from what each one does. Edit any of them.', emails: drafts.map(d => ({ to: d.to, subject: d.subject, body: d.body })) }} />
        : <p className="ask-faint">None of them have an email to write to. They’re in Leads, to message on their page.</p>)}
    </div>
  )
}

/** Emails to approve: edit any, then send all from Gmail (send_email), or not now. */
export function ProposalView({ proposal }: { proposal: Proposal }) {
  const [emails, setEmails] = useState(proposal.emails)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SendResult | null>(null)
  const [skipped, setSkipped] = useState(false)
  const edit = (i: number, k: 'subject' | 'body', v: string) => setEmails(es => es.map((e, j) => (j === i ? { ...e, [k]: v } : e)))

  async function send() {
    setBusy(true)
    const r = await tool<SendResult>('send_email', { emails })
    setBusy(false)
    setResult(r)
  }
  if (skipped) return <p className="ask-faint">Not sent.</p>
  const failed = (result?.results ?? []).filter(x => x.status !== 'sent')
  return (
    <div className="ask-proposal">
      <p className="ask-say"><b>{proposal.title}</b></p>
      {proposal.why && <p className="ask-faint">{proposal.why}</p>}
      {emails.map((e, i) => (
        <div key={i} className="ask-mail">
          <div className="ask-mail-to">To {e.to}</div>
          <input aria-label="Subject" className="ask-subj" value={e.subject} onChange={x => edit(i, 'subject', x.target.value)} disabled={!!result} />
          <textarea aria-label="Email" rows={6} value={e.body} onChange={x => edit(i, 'body', x.target.value)} disabled={!!result} />
        </div>
      ))}
      {!result
        ? (
          <div className="ask-approve">
            <b>Send {plural(emails.length, 'email')} from your Gmail?</b>
            <p>Follow-ups for new leads go out by themselves and stop when they reply.</p>
            <div className="ask-acts">
              <button type="button" className="ask-btn" disabled={busy || !emails.length} onClick={send}>{busy ? 'Sending…' : `Send ${plural(emails.length, 'email')}`}</button>
              <button type="button" className="ask-tl" disabled={busy} onClick={() => setSkipped(true)}>Not now</button>
            </div>
          </div>
        )
        : (
          <>
            {!!result.sent && <p className="ask-done-line">✓ {plural(result.sent, 'email')} sent{result.left_today != null ? ` · ${result.left_today} left today` : ''}</p>}
            {(result.error || failed.length > 0) && <p className="ask-err" role="alert">{result.error ?? failed.slice(0, 3).map(f => `${f.to}: ${f.reason}`).join(' · ')}</p>}
          </>
        )}
    </div>
  )
}
