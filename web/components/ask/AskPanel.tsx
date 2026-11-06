'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Lead } from '@/lib/agents/store'
import type { Conversation } from '@/lib/gmail/conversations'
import type { IndexRow, Panel } from '@/lib/ask/types'
import { norm } from '@/lib/ask/urls'

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
      </aside>
    </>
  )
}

function Top({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <div className="ask-sheet-top">
      <span className="ask-k">{label}</span>
      <button type="button" className="ask-x" onClick={onClose} aria-label="Close">✕</button>
    </div>
  )
}

function Done({ text, onClose }: { text: string; onClose: () => void }) {
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

async function copy(text: string): Promise<boolean> {
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

// ── A lead: an email to approve, or a reply / message to post by hand ─────────

// "Next: Is Buffer still worth it?" without a full stop after the question mark
const nextLine = (name: string) => ` Next: ${name}${/[?!.…]$/.test(name) ? '' : '.'}`

const isPost = (l: Lead) => l.source === 'reddit' || l.source === 'forum'
const isMessage = (l: Lead) => isPost(l) || l.source === 'profile' || (!l.email && !!l.dm)
const nameOf = (l: Lead) => (isPost(l) || l.source === 'profile' ? l.title : l.name || l.company || l.title)
const pageOf = (l: Lead) => (l.source !== 'profile' && l.dm ? l.dm.url : l.url)
const placeOf = (l: Lead) => {
  if (l.source === 'forum') return 'Hacker News'
  if (l.source === 'reddit') return /reddit\.com\/(r\/[^/]+)/i.exec(l.url)?.[1] ?? 'Reddit'
  return l.dm?.platform ?? (l.source === 'profile' ? 'their page' : '')
}

async function leadOp(op: string, payload: Record<string, unknown>): Promise<{ data?: { leads: Lead[] }; error?: string; message?: string; ok?: boolean }> {
  const r = await fetch('/api/agents/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, ...payload }) })
  return r.json().catch(() => ({ error: 'Something went wrong. Try again.' }))
}

function LeadPanel({ start, lane, onChange, onClose }: { start: string; lane: 'email' | 'talk'; onChange: () => void; onClose: () => void }) {
  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [cur, setCur] = useState(start)
  const [doneIds, setDoneIds] = useState<string[]>([])
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [said, setSaid] = useState('')
  const [error, setError] = useState('')
  const [count, setCount] = useState(0)

  useEffect(() => {
    fetch('/api/agents/lead').then(r => r.json()).then(j => setLeads(j?.data?.leads ?? [])).catch(() => setError('Couldn’t load your leads.'))
  }, [])

  const queue = (leads ?? []).filter(l => l.status === 'ready' && !doneIds.includes(l.id) && (lane === 'talk' ? isPost(l) : !isPost(l)))
    .sort((a, b) => b.score - a.score)
  const lead = queue.find(l => l.id === cur) ?? queue[0] ?? null
  const position = lead ? queue.indexOf(lead) + 1 : 0

  // Nothing is written until a lead is opened: write its email or message now
  const opened = useRef<string | null>(null)
  useEffect(() => {
    if (!lead || opened.current === lead.id) return
    opened.current = lead.id
    setError('')   // the "Sent. Next: …" line stays until the next action
    setSubject(lead.draft?.subject ?? ''); setBody(lead.draft?.body ?? ''); setReply(lead.reply ?? '')
    const fill = (j: Awaited<ReturnType<typeof leadOp>>) => {
      if (j.error) setError(j.error)
      const x = j.data?.leads.find(y => y.id === lead.id)
      if (x?.draft) { setSubject(x.draft.subject); setBody(x.draft.body) }
      if (x?.reply) setReply(x.reply)
    }
    if (isMessage(lead) && !lead.reply) { setBusy('write'); leadOp('reply', { id: lead.id }).then(fill).finally(() => setBusy(null)) }
    else if (!isMessage(lead) && lead.email && !lead.draft) { setBusy('write'); leadOp('email', { id: lead.id, email: lead.email }).then(fill).finally(() => setBusy(null)) }
  }, [lead])

  function next(l: Lead, msg: string) {
    onChange()
    setDoneIds(d => [...d, l.id]); setCount(c => c + 1)
    const after = queue.filter(x => x.id !== l.id)
    if (after[0]) setCur(after[0].id)
    setSaid(`${msg}${after[0] ? nextLine(nameOf(after[0])) : ''}`)
  }

  async function approve(l: Lead) {
    setBusy('send'); setError('')
    const j = await leadOp('approve', { id: l.id, subject, body })
    setBusy(null)
    if (j.error || j.ok === false) return setError(j.error ?? j.message ?? 'Couldn’t send it.')
    next(l, j.message ?? 'Sent.')
  }
  async function skip(l: Lead) {
    setBusy('skip'); await leadOp('skip', { id: l.id }); setBusy(null)
    next(l, 'Skipped.')
  }
  async function posted(l: Lead) {
    setBusy('send')
    if (reply !== (l.reply ?? '')) await leadOp('save', { id: l.id, reply })
    const j = await leadOp('posted', { id: l.id })
    setBusy(null)
    if (j.error) return setError(j.error)
    next(l, isPost(l) ? 'Marked as posted.' : 'Marked as sent.')
  }

  const label = lane === 'talk' ? 'Lead Finder · Join conversations' : 'Lead Finder'
  if (!leads) return <div className="ask-sheet-in"><Top label={label} onClose={onClose} /><p className="ask-sheet-lede">{error || 'Opening…'}</p></div>
  if (!lead) return <div className="ask-sheet-in"><Top label={label} onClose={onClose} /><Done text={count ? `${count} done. ${lane === 'talk' ? 'New posts are found every morning.' : 'Approved emails go out within your daily limit, with follow-ups.'}` : 'Nothing is waiting here any more.'} onClose={onClose} /></div>

  const facts = (lead.facts ?? []).slice(0, 4)
  return (
    <div className="ask-sheet-in">
      <Top label={`${label} · ${position} of ${queue.length}`} onClose={onClose} />
      <h2 className="ask-sheet-h">{nameOf(lead)}</h2>
      <p className="ask-sheet-lede">{[lead.fitLabel, placeOf(lead) && `on ${placeOf(lead)}`].filter(Boolean).join(' · ') || lead.why}</p>
      {lead.why && (lead.fitLabel || placeOf(lead)) && <p className="ask-why">{lead.why}</p>}
      {facts.length > 0 && <div className="ask-facts">{facts.map(f => <div key={f.k} className="ask-fact"><span>{f.k}</span>{f.v}</div>)}</div>}

      {isMessage(lead) ? (
        <>
          <div className="ask-mail">
            <div className="ask-mail-to">{isPost(lead) ? 'Your reply' : `Your message on ${placeOf(lead)}`}</div>
            <textarea aria-label="Your reply" value={busy === 'write' ? 'Writing…' : reply} onChange={e => setReply(e.target.value)} disabled={busy === 'write'} rows={8} />
          </div>
          <div className="ask-acts">
            <button type="button" className="ask-btn" disabled={!!busy || !reply} onClick={async () => setSaid((await copy(reply)) ? 'Copied. Post it from your own account.' : 'Couldn’t copy here. Select the text instead.')}>Copy</button>
            <a className="ask-tl" href={pageOf(lead)} target="_blank" rel="noreferrer">Open {isPost(lead) ? 'the post' : 'their page'}</a>
            <button type="button" className="ask-tl" disabled={!!busy || !reply} onClick={() => posted(lead)}>{isPost(lead) ? 'I posted it' : 'I sent it'}</button>
            <button type="button" className="ask-tl ask-push" disabled={!!busy} onClick={() => skip(lead)}>Skip</button>
          </div>
        </>
      ) : (
        <>
          <div className="ask-mail">
            <div className="ask-mail-to">To {lead.email}</div>
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

interface Msg { id: string; from: string; at: string | null; body: string; isSelf: boolean }
const REPLY_DAYS = 14

function ReplyPanel({ start, onChange, onClose }: { start: string; onChange: () => void; onClose: () => void }) {
  const [convs, setConvs] = useState<Conversation[] | null>(null)
  const [cur, setCur] = useState(start)
  const [doneIds, setDoneIds] = useState<string[]>([])
  const [msgs, setMsgs] = useState<Msg[] | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [said, setSaid] = useState('')
  const [count, setCount] = useState(0)

  useEffect(() => {
    fetch('/api/gmail/conversations').then(r => r.json()).then(j => setConvs(j?.conversations ?? [])).catch(() => setError('Couldn’t load your replies.'))
  }, [])

  const since = Date.now() - REPLY_DAYS * 86_400_000
  const queue = (convs ?? []).filter(c => c.status === 'replied' && !doneIds.includes(c.threadId) && (!c.repliedAt || Date.parse(c.repliedAt) >= since))
  const conv = queue.find(c => c.threadId === cur) ?? queue[0] ?? null

  useEffect(() => {
    if (!conv) return
    setMsgs(null); setText(''); setError('')
    fetch(`/api/gmail/conversations/${conv.threadId}`).then(async r => {
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error ?? 'Couldn’t load the thread from Gmail.')
      setMsgs(j.messages ?? [])
    }).catch(e => { setMsgs([]); setError(e instanceof Error ? e.message : 'Couldn’t load the thread.') })
  }, [conv?.threadId]) // eslint-disable-line react-hooks/exhaustive-deps

  // A Lead Finder reply is marked as answered there too, so it leaves its "replied" list
  async function handled(c: Conversation) {
    if (c.source !== 'lead-agent') return
    const j = await fetch('/api/agents/lead').then(r => r.json()).catch(() => null) as { data?: { leads: Lead[] } } | null
    const l = j?.data?.leads.find(x => x.threadId === c.threadId)
    if (l) await leadOp('handled', { id: l.id })
  }
  function next(c: Conversation, msg: string) {
    onChange()
    setDoneIds(d => [...d, c.threadId]); setCount(n => n + 1)
    const after = queue.filter(x => x.threadId !== c.threadId)
    if (after[0]) setCur(after[0].threadId)
    setSaid(`${msg}${after[0] ? nextLine(after[0].toName ?? after[0].toEmail ?? 'the next one') : ''}`)
  }
  async function send(c: Conversation) {
    if (!c.toEmail) return setError('There’s no address to reply to. Answer it in Gmail instead.')
    setBusy(true); setError('')
    try {
      const r = await fetch('/api/gmail/send-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: c.toEmail, subject: /^re:/i.test(c.subject) ? c.subject : `Re: ${c.subject}`, body: text, threadId: c.threadId, source: 'outreach' }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.message ?? j?.error ?? 'Couldn’t send it.')
      await handled(c)
      next(c, 'Sent from your Gmail.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t send it.')
    } finally {
      setBusy(false)
    }
  }

  if (!convs) return <div className="ask-sheet-in"><Top label="Email · replies" onClose={onClose} /><p className="ask-sheet-lede">{error || 'Opening…'}</p></div>
  if (!conv) return <div className="ask-sheet-in"><Top label="Email · replies" onClose={onClose} /><Done text={count ? `${count} answered.` : 'No replies are waiting any more.'} onClose={onClose} /></div>

  const gmail = `https://mail.google.com/mail/u/0/#all/${conv.threadId}`
  return (
    <div className="ask-sheet-in">
      <Top label={`Email · replies · ${queue.indexOf(conv) + 1} of ${queue.length}`} onClose={onClose} />
      <h2 className="ask-sheet-h">{conv.toName ?? conv.toEmail}</h2>
      <p className="ask-sheet-lede">{conv.subject}</p>
      <div className="ask-thread">
        {msgs === null ? <p className="ask-faint">Loading the thread…</p>
          : msgs.slice(-3).map(m => (
            <div key={m.id} className={`ask-msg${m.isSelf ? '' : ' is-them'}`}>
              <small>{m.from}{m.at ? ` · ${new Date(m.at).toLocaleDateString([], { day: 'numeric', month: 'short' })}` : ''}</small>
              <p>{m.body.length > 700 ? `${m.body.slice(0, 700)}…` : m.body}</p>
            </div>
          ))}
      </div>
      <div className="ask-mail">
        <div className="ask-mail-to">Your reply</div>
        <textarea aria-label="Your reply" value={text} onChange={e => setText(e.target.value)} rows={7} placeholder="Write your answer…" />
      </div>
      <div className="ask-acts">
        <button type="button" className="ask-btn" disabled={busy || !text.trim()} onClick={() => send(conv)}>{busy ? 'Sending…' : 'Send reply'}</button>
        <button type="button" className="ask-tl" disabled={busy} onClick={async () => { await handled(conv); next(conv, 'Marked as done.') }}>No reply needed</button>
        <a className="ask-tl ask-push" href={gmail} target="_blank" rel="noreferrer">Open in Gmail</a>
      </div>
      {error && <p className="ask-err" role="alert">{error}{/gmail|connect/i.test(error) && <> <a href="/api/gmail/connect">Connect Gmail</a></>}</p>}
      {said && !error && <p className="ask-said" role="status">{said}</p>}
    </div>
  )
}
