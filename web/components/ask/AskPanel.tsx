'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LeadList, ThreadList, ToolLead, ToolThread } from '@/lib/mcp/tools/inbox'
import type { IndexRow, Panel } from '@/lib/ask/types'
import { norm } from '@/lib/ask/urls'
import { EmailWorkspace, LeadsWorkspace, WriteWorkspace } from './Workspaces'
import { MemoryPanel } from './MemoryPanel'

// Ask, phase 3 (md_files/ASK_PLAN.md): the work an answer points to, done in a panel on the Ask
// page. Each panel uses the same API as the tool's own page (Lead Finder: /api/agents/lead; the
// Inbox: /api/gmail/conversations + /api/gmail/send-email), so what happens here is exactly what
// would happen there. Finishing one item opens the next; none left is "All caught up".

export default function AskPanel({ panel, onClose }: { panel: Panel; onClose: (changed: boolean) => void }) {
  const changed = useRef(false)
  const close = useCallback(() => onClose(changed.current), [onClose])
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    ref.current?.focus()
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [close])

  return (
    <>
      <div className="ask-veil" onClick={close} aria-hidden="true" />
      <aside className="ask-sheet" role="dialog" aria-modal="true" aria-label="Do it here" tabIndex={-1} ref={ref}>
        {panel.kind === 'brief' && <BriefPanel p={panel} onClose={close} />}
        {panel.kind === 'index' && <IndexPanel p={panel} onClose={close} />}
        {panel.kind === 'lead' && <LeadPanel start={panel.id} lane={panel.lane} onChange={() => { changed.current = true }} onClose={close} />}
        {panel.kind === 'reply' && <ReplyPanel start={panel.threadId} onChange={() => { changed.current = true }} onClose={close} />}
        {panel.kind === 'leads' && <LeadsWorkspace lane={panel.lane} find={panel.find} onChange={() => { changed.current = true }} onClose={close} />}
        {panel.kind === 'email' && <EmailWorkspace tab={panel.tab} onChange={() => { changed.current = true }} onClose={close} />}
        {panel.kind === 'write' && <WriteWorkspace topic={panel.topic} onClose={close} />}
        {panel.kind === 'memory' && <MemoryPanel onClose={close} />}
      </aside>
    </>
  )
}

export function Top({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <div className="ask-sheet-top">
      <span className="ask-k">{label}</span>
      <button type="button" className="ask-x" onClick={onClose} aria-label="Close">✕</button>
    </div>
  )
}

export function Done({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className="ask-done">
      <span className="ask-done-ok" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg>
      </span>
      <h2>All caught up</h2>
      <p>{text}</p>
      <button type="button" className="ask-btn ask-btn-quiet" onClick={onClose}>Back to the answer</button>
    </div>
  )
}

export async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}

// ── A written fix ─────────────────────────────────────────────────────────────

function BriefPanel({ p, onClose }: { p: Extract<Panel, { kind: 'brief' }>; onClose: () => void }) {
  const [said, setSaid] = useState('')
  const text = [p.title, '', p.intro, '', ...p.steps.map((s, i) => `${i + 1}. ${s}`), ...(p.code ? ['', p.code] : [])].join('\n')
  return (
    <div className="ask-sheet-in">
      <Top label="A fix for your site" onClose={onClose} />
      <h2 className="ask-sheet-h">{p.title}</h2>
      <p className="ask-sheet-lede">{p.intro}</p>
      <ol className="ask-brief">{p.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
      {p.code && <pre className="ask-code">{p.code}</pre>}
      <div className="ask-acts">
        <button type="button" className="ask-btn" onClick={async () => setSaid((await copy(text)) ? 'Copied. Paste it to whoever runs your site.' : 'Couldn’t copy here. Select the text instead.')}>Copy the fix</button>
        {p.link && <a className="ask-tl" href={p.link.href} target="_blank" rel="noreferrer">{p.link.label}</a>}
      </div>
      {said && <p className="ask-said" role="status">{said}</p>}
    </div>
  )
}

// ── Pages not on Google yet: ask Google, one by one, and keep track ───────────

const GROUPS: { id: IndexRow['group']; title: string; sub: string }[] = [
  { id: 'todo', title: 'Ask Google', sub: 'Open it, click Request indexing, then press Done.' },
  { id: 'improve', title: 'Improve first, then ask', sub: 'Asking again won’t help until the page changes.' },
  { id: 'blocked', title: 'Blocked', sub: 'Something tells Google to skip these.' },
  { id: 'wait', title: 'Give it time', sub: 'New, or you already asked. Nothing to do yet.' },
  { id: 'indexed', title: 'On Google, not searched for yet', sub: 'Google has these. Link to them and make the titles say what people search.' },
]
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString()
const SHOW = 10

function IndexPanel({ p, onClose }: { p: Extract<Panel, { kind: 'index' }>; onClose: () => void }) {
  // What the owner asked Google, read fresh (the card is from this morning)
  const [asks, setAsks] = useState<Record<string, { at: string }> | null>(null)
  const [busy, setBusy] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [err, setErr] = useState('')
  useEffect(() => {
    fetch('/api/ask/indexing').then(r => r.json()).then(d => setAsks(d.asks ?? {})).catch(() => setAsks({}))
  }, [])
  const askedAt = (r: IndexRow) => (asks ? asks[norm(r.url)]?.at : r.askedAt)
  async function mark(r: IndexRow, asked: boolean) {
    setBusy(r.url); setErr('')
    try {
      const res = await fetch('/api/ask/indexing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: r.url, asked }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setAsks(d.asks ?? {})
    } catch { setErr('Couldn’t save that. Try again.') } finally { setBusy('') }
  }
  const today = Object.values(asks ?? {}).filter(a => isToday(a.at)).length
  // One blue button on the screen: the first page still to ask about
  const first = p.rows.find(r => (r.group === 'todo' || r.group === 'improve') && !askedAt(r))

  return (
    <div className="ask-sheet-in">
      <Top label="Get your pages on Google" onClose={onClose} />
      <h2 className="ask-sheet-h">Your pages, one by one</h2>
      <p className="ask-sheet-lede">{p.lede}</p>
      {today > 0 && <p className="ask-ix-today" role="status">{today} asked today · Google allows about 10 a day</p>}
      {GROUPS.map(g => {
        const rows = p.rows.filter(r => r.group === g.id)
        if (!rows.length) return null
        const shown = open[g.id] ? rows : rows.slice(0, SHOW)
        const body = (
          <>
            <ul className="ask-ix">
              {shown.map(r => {
                const at = askedAt(r)
                const canAsk = g.id === 'todo' || g.id === 'improve' || (g.id === 'wait' && !!at)
                return (
                  <li key={r.url} className={`ask-ix-row${at && canAsk ? ' is-asked' : ''}`}>
                    <div className="ask-ix-what">
                      <b title={r.url}>{r.path}</b>
                      <span>{at && g.id !== 'wait' && g.id !== 'indexed' && isToday(at) ? 'Asked today. We check every morning and move it when it’s in.' : r.note}</span>
                    </div>
                    <div className="ask-ix-acts">
                      <a className="ask-tl" href={inspectHref(p.property, r.url)} target="_blank" rel="noreferrer">Open in Search Console</a>
                      {canAsk && (at
                        ? <span className="ask-ix-done">✓ Asked {isToday(at) ? 'today' : dayOf(at)} · <button type="button" onClick={() => mark(r, false)} disabled={busy === r.url}>Undo</button></span>
                        : <button type="button" className={`ask-btn${r === first ? '' : ' ask-btn-quiet'}`} onClick={() => mark(r, true)} disabled={busy === r.url}>Done, I asked Google</button>)}
                    </div>
                  </li>
                )
              })}
            </ul>
            {rows.length > shown.length && <button type="button" className="ask-ix-more" onClick={() => setOpen(o => ({ ...o, [g.id]: true }))}>Show {rows.length - shown.length} more</button>}
          </>
        )
        return g.id === 'indexed' || (g.id === 'wait' && p.rows.some(r => r.group !== 'wait' && r.group !== 'indexed'))
          ? <details key={g.id} className="ask-ix-g"><summary><span className="ask-k">{g.title} · {rows.length}</span><small>{g.sub}</small></summary>{body}</details>
          : <section key={g.id} className="ask-ix-g"><div className="ask-ix-h"><span className="ask-k">{g.title} · {rows.length}</span><small>{g.sub}</small></div>{body}</section>
      })}
      {err && <p className="ask-said" role="alert">{err}</p>}
    </div>
  )
}

const inspectHref = (property: string, url: string) =>
  `https://search.google.com/search-console/inspect?resource_id=${encodeURIComponent(property)}&id=${encodeURIComponent(url)}`

// ── Tools: everything here reads, writes and sends through the MCP tools (POST /api/ask/tool) ─

export async function tool<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T & { error?: string }> {
  const r = await fetch('/api/ask/tool', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, args }) })
  return r.json().catch(() => ({ error: 'Something went wrong. Try again.' }))
}
/** Claude writes the email, message or answer (POST /api/ask/write); nothing is sent or saved. */
async function write<T>(body: Record<string, unknown>): Promise<T & { error?: string }> {
  const r = await fetch('/api/ask/write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return r.json().catch(() => ({ error: 'Couldn’t write it this time. Try again.' }))
}
interface SendResult { sent?: number; error?: string; results?: { status: string; reason?: string }[] }
const sendProblem = (r: SendResult) => (r.sent ? '' : r.results?.[0]?.reason ?? r.error ?? 'Couldn’t send it.')

// Skip, "I posted it" and "answered" change the board, which no MCP tool does yet: Lead Finder's own API
async function leadOp(op: string, payload: Record<string, unknown>): Promise<{ error?: string; message?: string; ok?: boolean }> {
  const r = await fetch('/api/agents/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, ...payload }) })
  return r.json().catch(() => ({ error: 'Something went wrong. Try again.' }))
}

// "Next: Is Buffer still worth it?" without a full stop after the question mark
const nextLine = (name: string) => ` Next: ${name}${/[?!.…]$/.test(name) ? '' : '.'}`

// ── A lead: an email to approve, or a reply / message to post by hand ─────────

const isMessage = (l: ToolLead) => l.lane === 'talk' || !l.email
const canWork = (l: ToolLead) => l.lane === 'talk' || !!l.email || !!l.message_on || l.from === 'seller page'
const pageOf = (l: ToolLead) => l.message_on?.url ?? l.url ?? l.website ?? '#'
const placeOf = (l: ToolLead) => (l.lane === 'talk' ? l.from : l.message_on?.platform ?? (l.from === 'seller page' ? 'their page' : ''))

export function LeadPanel({ start, lane, onChange, onClose }: { start: string; lane: 'email' | 'talk'; onChange: () => void; onClose: () => void }) {
  const [leads, setLeads] = useState<ToolLead[] | null>(null)
  const [cur, setCur] = useState(start)
  const [doneIds, setDoneIds] = useState<string[]>([])
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [to, setTo] = useState('')
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [said, setSaid] = useState('')
  const [error, setError] = useState('')
  const [count, setCount] = useState(0)

  useEffect(() => {
    tool<LeadList>('list_leads', { status: 'to_do', lane, limit: 100, include_text: true })
      .then(j => (j.error ? setError(j.error) : setLeads(j.leads ?? [])))
  }, [lane])

  const queue = (leads ?? []).filter(l => canWork(l) && !doneIds.includes(l.id))
  const lead = queue.find(l => l.id === cur) ?? queue[0] ?? null
  const position = lead ? queue.indexOf(lead) + 1 : 0

  // Use what GrowJin already wrote, else Claude writes it now
  const opened = useRef<string | null>(null)
  useEffect(() => {
    if (!lead || opened.current === lead.id) return
    opened.current = lead.id
    setError('')   // the "Sent. Next: …" line stays until the next action
    const d = lead.email_draft as { subject: string; body?: string } | undefined
    setSubject(d?.subject ?? ''); setBody(d?.body ?? ''); setReply(typeof lead.reply_draft === 'string' ? lead.reply_draft : '')
    setTo(lead.contact && lead.email ? `${lead.contact} <${lead.email}>` : lead.email ?? '')
    const have = isMessage(lead) ? !!lead.reply_draft : !!d?.body
    if (have) return
    setBusy('write')
    write<{ kind?: string; subject?: string; body?: string; text?: string; to?: string }>({ lead_id: lead.id }).then(x => {
      if (opened.current !== lead.id) return
      if (x.error) return setError(x.error)
      if (x.kind === 'email') { setSubject(x.subject ?? ''); setBody(x.body ?? ''); if (x.to) setTo(x.to) } else setReply(x.text ?? '')
    }).finally(() => setBusy(null))
  }, [lead])

  function next(l: ToolLead, msg: string) {
    onChange()
    setDoneIds(d => [...d, l.id]); setCount(c => c + 1)
    const after = queue.filter(x => x.id !== l.id)
    if (after[0]) setCur(after[0].id)
    setSaid(`${msg}${after[0] ? nextLine(after[0].name) : ''}`)
  }

  async function approve(l: ToolLead) {
    setBusy('send'); setError('')
    const r = await tool<SendResult>('send_email', { to, subject, body })
    setBusy(null)
    const problem = sendProblem(r)
    if (problem) return setError(problem)
    next(l, 'Sent from your Gmail. Follow-ups go out by themselves.')
  }
  async function skip(l: ToolLead) {
    setBusy('skip'); await leadOp('skip', { id: l.id }); setBusy(null)
    next(l, 'Skipped.')
  }
  async function posted(l: ToolLead) {
    setBusy('send')
    await leadOp('save', { id: l.id, reply })
    const j = await leadOp('posted', { id: l.id })
    setBusy(null)
    if (j.error) return setError(j.error)
    next(l, l.lane === 'talk' ? 'Marked as posted.' : 'Marked as sent.')
  }

  const label = lane === 'talk' ? 'Leads · Join conversations' : 'Leads'
  if (!leads) return <div className="ask-sheet-in"><Top label={label} onClose={onClose} /><p className="ask-sheet-lede">{error || 'Opening…'}</p></div>
  if (!lead) return <div className="ask-sheet-in"><Top label={label} onClose={onClose} /><Done text={count ? `${count} done. ${lane === 'talk' ? 'New posts are found every morning.' : 'Emails go out within your daily limit, with follow-ups.'}` : 'Nothing is waiting here any more.'} onClose={onClose} /></div>

  const facts = Object.entries(lead.facts ?? {}).slice(0, 4)
  const where = placeOf(lead)
  return (
    <div className="ask-sheet-in">
      <Top label={`${label} · ${position} of ${queue.length}`} onClose={onClose} />
      <h2 className="ask-sheet-h">{lead.name}</h2>
      <p className="ask-sheet-lede">{[lead.rating, where ? `on ${where}` : lead.from && `from ${lead.from}`].filter(Boolean).join(' · ') || lead.why}</p>
      {lead.why && <p className="ask-why">{lead.why}</p>}
      {facts.length > 0 && <div className="ask-facts">{facts.map(([k, v]) => <div key={k} className="ask-fact"><span>{k}</span>{v}</div>)}</div>}

      {isMessage(lead) ? (
        <>
          <div className="ask-mail">
            <div className="ask-mail-to">{lead.lane === 'talk' ? 'Your reply' : `Your message on ${where || 'their page'}`}</div>
            <textarea aria-label="Your reply" value={busy === 'write' ? 'Writing…' : reply} onChange={e => setReply(e.target.value)} disabled={busy === 'write'} rows={8} />
          </div>
          <div className="ask-acts">
            <button type="button" className="ask-btn" disabled={!!busy || !reply} onClick={async () => setSaid((await copy(reply)) ? 'Copied. Post it from your own account.' : 'Couldn’t copy here. Select the text instead.')}>Copy</button>
            <a className="ask-tl" href={pageOf(lead)} target="_blank" rel="noreferrer">Open {lead.lane === 'talk' ? 'the post' : 'their page'}</a>
            <button type="button" className="ask-tl" disabled={!!busy || !reply} onClick={() => posted(lead)}>{lead.lane === 'talk' ? 'I posted it' : 'I sent it'}</button>
            <button type="button" className="ask-tl ask-push" disabled={!!busy} onClick={() => skip(lead)}>Skip</button>
          </div>
        </>
      ) : (
        <>
          <div className="ask-mail">
            <div className="ask-mail-to">To {to}{lead.email_note ? <span className="ask-faint"> · {lead.email_note}</span> : null}</div>
            <input aria-label="Subject" className="ask-subj" value={busy === 'write' ? 'Writing…' : subject} onChange={e => setSubject(e.target.value)} disabled={busy === 'write'} />
            <textarea aria-label="Email" value={busy === 'write' ? '' : body} onChange={e => setBody(e.target.value)} disabled={busy === 'write'} rows={10} />
          </div>
          <div className="ask-acts">
            <button type="button" className="ask-btn" disabled={!!busy || !subject || !body} onClick={() => approve(lead)}>{busy === 'send' ? 'Sending…' : 'Approve and send'}</button>
            <button type="button" className="ask-tl" disabled={!!busy} onClick={() => skip(lead)}>Skip</button>
            <span className="ask-push ask-faint">Follow-ups go out by themselves</span>
          </div>
        </>
      )}
      {error && <p className="ask-err" role="alert">{error}</p>}
      {said && !error && <p className="ask-said" role="status">{said}</p>}
    </div>
  )
}

// ── Someone replied: read it, answer it ───────────────────────────────────────

interface Msg { from: string; at: string | null; text: string; mine: boolean }
interface Draft { to?: string; subject?: string; body?: string; thread_id?: string; in_reply_to?: string; messages?: Msg[]; error?: string }

export function ReplyPanel({ start, show = 'replies', onChange, onClose }: { start: string; show?: 'replies' | 'due'; onChange: () => void; onClose: () => void }) {
  const [threads, setThreads] = useState<ToolThread[] | null>(null)
  const [cur, setCur] = useState(start)
  const [doneIds, setDoneIds] = useState<string[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [said, setSaid] = useState('')
  const [count, setCount] = useState(0)

  useEffect(() => {
    tool<ThreadList>('list_replies', show === 'due' ? { show: 'due', limit: 50 } : { show: 'replies', days: 14, limit: 50 })
      .then(j => (j.error ? setError(j.error) : setThreads(j.threads ?? [])))
  }, [])

  const queue = (threads ?? []).filter(c => !doneIds.includes(c.thread_id))
  const conv = queue.find(c => c.thread_id === cur) ?? queue[0] ?? null

  // The thread's last messages and an answer Claude wrote, to edit before sending
  useEffect(() => {
    if (!conv) return
    let live = true
    setDraft(null); setText(''); setError('')
    write<Draft>({ thread_id: conv.thread_id }).then(d => {
      if (!live) return
      setDraft(d); setText(d.body ?? '')
      if (d.error) setError(d.error)
    })
    return () => { live = false }
  }, [conv?.thread_id]) // eslint-disable-line react-hooks/exhaustive-deps

  // A Lead Finder reply is marked as answered there too, so it leaves its "replied" list;
  // a due follow-up's reminder is closed (Email Outreach's reminders API: no tool does this yet)
  async function handled(c: ToolThread) {
    if (show === 'due') { if (c.reminder_id) await fetch(`/api/reminders/${c.reminder_id}/done`, { method: 'POST' }).catch(() => {}); return }
    if (c.from !== 'lead-agent') return
    const j = await tool<LeadList>('list_leads', { status: 'replied', limit: 100 })
    const l = j.leads?.find(x => x.thread_id === c.thread_id)
    if (l) await leadOp('handled', { id: l.id })
  }
  function next(c: ToolThread, msg: string) {
    onChange()
    setDoneIds(d => [...d, c.thread_id]); setCount(n => n + 1)
    const after = queue.filter(x => x.thread_id !== c.thread_id)
    if (after[0]) setCur(after[0].thread_id)
    setSaid(`${msg}${after[0] ? nextLine(after[0].to || 'the next one') : ''}`)
  }
  async function send(c: ToolThread) {
    const to = draft?.to || c.email
    if (!to) return setError('There’s no address to reply to. Answer it in Gmail instead.')
    setBusy(true); setError('')
    const r = await tool<SendResult>('send_email', {
      to, subject: draft?.subject ?? (/^re:/i.test(c.subject) ? c.subject : `Re: ${c.subject}`), body: text,
      thread_id: c.thread_id, ...(draft?.in_reply_to ? { in_reply_to: draft.in_reply_to } : {}),
      ...(show === 'due' ? { follow_up_days: 5 } : {}),
    })
    setBusy(false)
    const problem = sendProblem(r)
    if (problem) return setError(problem)
    await handled(c)
    next(c, show === 'due' ? 'Follow-up sent. If they don’t reply, it’s back in 5 days.' : 'Sent from your Gmail.')
  }

  const label = show === 'due' ? 'Email · follow-ups' : 'Email · replies'
  if (!threads) return <div className="ask-sheet-in"><Top label={label} onClose={onClose} /><p className="ask-sheet-lede">{error || 'Opening…'}</p></div>
  if (!conv) return <div className="ask-sheet-in"><Top label={label} onClose={onClose} /><Done text={count ? `${count} done.` : show === 'due' ? 'No follow-ups are due.' : 'No replies are waiting any more.'} onClose={onClose} /></div>

  const gmail = `https://mail.google.com/mail/u/0/#all/${conv.thread_id}`
  const msgs = draft?.messages
  return (
    <div className="ask-sheet-in">
      <Top label={`${label} · ${queue.indexOf(conv) + 1} of ${queue.length}`} onClose={onClose} />
      <h2 className="ask-sheet-h">{conv.to || conv.email}</h2>
      <p className="ask-sheet-lede">{conv.subject}</p>
      <div className="ask-thread">
        {!msgs ? <p className="ask-faint">Reading the thread…</p>
          : msgs.slice(-3).map((m, i) => (
            <div key={i} className={`ask-msg${m.mine ? '' : ' is-them'}`}>
              <small>{m.mine ? 'You' : m.from}{m.at ? ` · ${new Date(m.at).toLocaleDateString([], { day: 'numeric', month: 'short' })}` : ''}</small>
              <p>{m.text.length > 700 ? `${m.text.slice(0, 700)}…` : m.text}</p>
            </div>
          ))}
      </div>
      <div className="ask-mail">
        <div className="ask-mail-to">{show === 'due' ? 'Your follow-up' : 'Your reply'}</div>
        <textarea aria-label="Your reply" value={!draft ? 'Writing…' : text} onChange={e => setText(e.target.value)} disabled={!draft} rows={7} placeholder="Write your answer…" />
      </div>
      <div className="ask-acts">
        <button type="button" className="ask-btn" disabled={busy || !draft || !text.trim()} onClick={() => send(conv)}>{busy ? 'Sending…' : show === 'due' ? 'Send follow-up' : 'Send reply'}</button>
        <button type="button" className="ask-tl" disabled={busy} onClick={async () => { await handled(conv); next(conv, show === 'due' ? 'Skipped.' : 'Marked as done.') }}>{show === 'due' ? 'Skip this one' : 'No reply needed'}</button>
        <a className="ask-tl ask-push" href={gmail} target="_blank" rel="noreferrer">Open in Gmail</a>
      </div>
      {error && <p className="ask-err" role="alert">{error}{/gmail|connect/i.test(error) && <> <a href="/api/gmail/connect">Connect Gmail</a></>}</p>}
      {said && !error && <p className="ask-said" role="status">{said}</p>}
    </div>
  )
}
