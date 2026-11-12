'use client'

import { useEffect, useState } from 'react'
import type { Memory, MemItem } from '@/lib/ask/memory'
import { Top } from './AskPanel'

// "What Ask remembers" (lib/ask/memory.ts): the owner's rules (edit, delete, add, paste in from another
// Claude chat) and the patterns Ask noticed from what they do (make one a rule, or remove it).

async function op(body: Record<string, unknown>): Promise<{ memory?: Memory; added?: number; error?: string; queued?: boolean }> {
  const r = await fetch('/api/ask/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return r.json().catch(() => ({ error: 'Something went wrong. Try again.' }))
}
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const BY: Record<MemItem['by'], string> = { you: 'you added it', ask: 'Ask saved it', import: 'pasted in' }

export function MemoryPanel({ onClose }: { onClose: () => void }) {
  const [m, setM] = useState<Memory | null>(null)
  const [text, setText] = useState('')
  const [paste, setPaste] = useState('')
  const [pasting, setPasting] = useState(false)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { fetch('/api/ask/memory').then(r => r.json()).then(j => setM(j.memory ?? { rules: [], noticed: [] })).catch(() => setError('Couldn’t open your memory.')) }, [])

  async function run(body: Record<string, unknown>, ok?: string) {
    setBusy(true); setError('')
    const j = await op(body)
    setBusy(false)
    if (j.error) return setError(j.error)
    if (j.memory) setM(j.memory)
    if (j.queued) setSaid('Sent to the GrowJin team. New patterns will show here once they’ve run it.')
    else if (ok) setSaid(ok)
  }

  if (!m) return <div className="ask-sheet-in"><Top label="What Ask remembers" onClose={onClose} /><p className="ask-sheet-lede">{error || 'Opening…'}</p></div>
  return (
    <div className="ask-sheet-in">
      <Top label="What Ask remembers" onClose={onClose} />
      <h2 className="ask-sheet-h">How you like things</h2>
      <p className="ask-sheet-lede">Ask reads this before every answer, lead search and email it writes. Your rules always win.</p>

      <div className="ask-ix-g">
        <div className="ask-ix-h"><span className="ask-k">Your rules · {m.rules.length}</span><small>Things you told Ask, or pasted in. Say “always…” or “never…” in Ask to add one.</small></div>
        {!m.rules.length && <p className="ask-faint" style={{ marginTop: 10 }}>None yet.</p>}
        <ul className="ask-mem-list">
          {m.rules.map(r => (
            <li key={r.id}>
              {editing?.id === r.id
                ? <span className="ask-mem-edit">
                    <input className="ask-input" value={editing.text} onChange={e => setEditing({ id: r.id, text: e.target.value })} aria-label="Rule" />
                    <button type="button" className="ask-tl" disabled={busy} onClick={async () => { await run({ op: 'edit', id: r.id, text: editing.text }); setEditing(null) }}>Save</button>
                  </span>
                : <span><b>{r.text}</b><small>{BY[r.by]} · {day(r.at)}</small></span>}
              {editing?.id !== r.id && <span className="ask-mem-acts">
                <button type="button" className="ask-tl" onClick={() => setEditing({ id: r.id, text: r.text })}>Edit</button>
                <button type="button" className="ask-tl" disabled={busy} onClick={() => run({ op: 'delete', id: r.id })}>Delete</button>
              </span>}
            </li>
          ))}
        </ul>
        <form className="ask-mem-add" onSubmit={async e => { e.preventDefault(); if (!text.trim()) return; await run({ op: 'add', text }, 'Saved.'); setText('') }}>
          <input className="ask-input" value={text} onChange={e => setText(e.target.value)} placeholder="Add a rule, e.g. Never suggest agencies as leads" aria-label="New rule" />
          <button type="submit" className="ask-btn" disabled={busy || !text.trim()}>Add</button>
        </form>
        {!pasting
          ? <button type="button" className="ask-tl" style={{ marginTop: 10 }} onClick={() => setPasting(true)}>Paste from your Claude chat’s memory</button>
          : (
            <div className="ask-field">
              <span>In Claude: Settings → Memory, copy what it remembers about your work, and paste it here. One rule per line.</span>
              <textarea rows={6} value={paste} onChange={e => setPaste(e.target.value)} />
              <div className="ask-acts">
                <button type="button" className="ask-btn" disabled={busy || !paste.trim()} onClick={async () => {
                  setBusy(true); const j = await op({ op: 'import', text: paste }); setBusy(false)
                  if (j.error) return setError(j.error)
                  if (j.memory) setM(j.memory)
                  setSaid(`Added ${j.added ?? 0} rule${j.added === 1 ? '' : 's'}.`); setPaste(''); setPasting(false)
                }}>Add these</button>
                <button type="button" className="ask-tl" onClick={() => setPasting(false)}>Cancel</button>
              </div>
            </div>
          )}
      </div>

      <div className="ask-ix-g">
        <div className="ask-ix-h">
          <span className="ask-k">What I’ve noticed · {m.noticed.length}</span>
          <small>From the leads you add or skip and the emails you send{m.noticedAt ? `, last looked ${day(m.noticedAt)}` : ''}. Used unless a rule says otherwise.</small>
        </div>
        {!m.noticed.length && <p className="ask-faint" style={{ marginTop: 10 }}>Nothing yet. Ask looks every few days, once you’ve added, skipped or sent a few.</p>}
        <ul className="ask-mem-list">
          {m.noticed.map(n => (
            <li key={n.id}>
              <span><b>{n.text}</b></span>
              <span className="ask-mem-acts">
                <button type="button" className="ask-tl" disabled={busy} onClick={() => run({ op: 'offer', id: n.id, yes: true }, 'Made it a rule.')}>Make it a rule</button>
                <button type="button" className="ask-tl" disabled={busy} onClick={() => run({ op: 'delete', id: n.id })}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
        <button type="button" className="ask-tl" style={{ marginTop: 10 }} disabled={busy} onClick={() => run({ op: 'notice' }, 'Looked again.')}>{busy ? 'Looking…' : 'Look again now'}</button>
      </div>

      {error && <p className="ask-err" role="alert">{error}</p>}
      {said && !error && <p className="ask-said" role="status">{said}</p>}
    </div>
  )
}
