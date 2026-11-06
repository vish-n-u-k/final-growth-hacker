'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { Answer, AskCards, AskEvent, CardId, FillEvent, Panel } from '@/lib/ask/types'
import AskPicture from './AskPicture'
import AskPanel from './AskPanel'

// Ask (md_files/ASK_PLAN.md): a home page with one ask box and the ready answers. A card opens its
// saved answer; a typed question is answered live (phase 2) and drawn in the same shape: a
// sentence, a picture, findings, one blue next step.

/** "**words**" → bold. */
export function Rich({ text }: { text: string }) {
  return <>{text.split('**').map((part, i) => (i % 2 ? <b key={i}>{part}</b> : <span key={i}>{part}</span>))}</>
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const dayOf = (iso: string) => {
  const d = new Date(iso), now = new Date()
  if (d.toDateString() === now.toDateString()) return `today at ${timeOf(iso)}`
  if (new Date(now.getTime() - 86_400_000).toDateString() === d.toDateString()) return `yesterday at ${timeOf(iso)}`
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

// Questions of your own, as examples on the home page
const EXAMPLES = [
  'How many people visited my site last week?',
  'How are my emails doing?',
  'Which pages bring the most visitors?',
  'How do I compare with my competitors?',
]

type Step = { kind: 'understand' | 'look' | 'check'; text: string }
interface Live {
  question: string
  steps: Step[]
  running: boolean
  answer?: Answer
  askBack?: { question: string; options: string[] }
  chosen?: string
  error?: string
  thinking?: string    // what Claude is doing right now, between lookups
  started: number      // for the timer
}

type FillStep = { id: string; text: string; state: 'on' | 'done' | 'failed'; result?: string }
const norm = (q: string) => q.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Seconds since `start`, ticking while `on`. */
function useElapsed(start: number | null, on: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [on, start])
  return start ? Math.max(0, Math.round((now - start) / 1000)) : 0
}

type View = { kind: 'home' } | { kind: 'card'; id: CardId } | { kind: 'pin'; id: string } | { kind: 'live' }

export default function AskPage({ brandName, site, initial, stale, initialOpen }: {
  brandName: string
  site: string
  initial: AskCards | null
  stale: boolean
  initialOpen: CardId | null
}) {
  const [data, setData] = useState<AskCards | null>(initial)
  const [busy, setBusy] = useState(stale)
  const [error, setError] = useState('')
  const [view, setView] = useState<View>(initialOpen ? { kind: 'card', id: initialOpen } : { kind: 'home' })
  const [typed, setTyped] = useState('')
  // A conversation: each typed question and its answer; follow-ups add to it (phase 4)
  const [turns, setTurns] = useState<Live[]>([])
  const [threadId, setThreadId] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string[]>([])   // questions pinned from this conversation
  const [pinError, setPinError] = useState('')
  const live = turns.length ? turns[turns.length - 1] : null
  const setLive = (f: (l: Live | null) => Live | null) => setTurns(ts => {
    const last = f(ts.length ? ts[ts.length - 1] : null)
    return last ? [...ts.slice(0, -1), last] : ts.slice(0, -1)
  })
  const [left, setLeft] = useState<number | null>(null)
  const abort = useRef<AbortController | null>(null)
  const [panel, setPanel] = useState<Panel | null>(null)

  // What's being checked while the ready answers are worked out (streamed from /api/ask/cards?stream=1)
  const [fill, setFill] = useState<FillStep[]>([])
  const [fillStart, setFillStart] = useState<number | null>(null)
  const load = useCallback(async (refresh: boolean) => {
    setBusy(true); setError(''); setFill([]); setFillStart(Date.now())
    try {
      const r = await fetch('/api/ask/cards?stream=1', { method: refresh ? 'POST' : 'GET' })
      if (!r.ok || !r.body) throw new Error((await r.json().catch(() => ({})))?.error ?? 'Something went wrong')
      const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = ''; let got = false
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
          if (!line) continue
          let e: FillEvent
          try { e = JSON.parse(line) } catch { continue }
          if (e.t === 'step') { const st = e; setFill(f => (f.some(x => x.id === st.id) ? f.map(x => (x.id === st.id ? st : x)) : [...f, st])) }
          else if (e.t === 'done') { setData(e.data); got = true }
          else throw new Error(e.text)
        }
      }
      if (!got) throw new Error('Checking stopped before it finished. Try again.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }, [])

  // Missing or older than a day: work the answers out now
  useEffect(() => { if (stale) load(false) }, [stale, load])
  useEffect(() => {
    fetch('/api/ask/question').then(r => (r.ok ? r.json() : null)).then(j => { if (typeof j?.left === 'number') setLeft(j.left) }).catch(() => {})
  }, [])

  // A ready answer lives in the address (?q=email); a typed answer is one history step, so back goes home
  const go = useCallback((v: View) => {
    setView(v)
    if (v.kind !== 'live') abort.current?.abort()
    window.history.pushState(null, '', v.kind === 'card' ? `/ask?q=${v.id}` : v.kind === 'pin' ? `/ask?pin=${v.id}` : '/ask')
    window.scrollTo({ top: 0 })
  }, [])
  useEffect(() => {
    const onPop = () => {
      abort.current?.abort()
      const sp = new URLSearchParams(window.location.search)
      const q = sp.get('q') as CardId | null, pin = sp.get('pin')
      setView(q ? { kind: 'card', id: q } : pin ? { kind: 'pin', id: pin } : { kind: 'home' })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const cards = data?.cards ?? []

  /** Asks a question. `follow`: a follow-up in the same conversation; `clarify`: their answer to a question back. */
  async function run(question: string, clarify?: { asked: string; chosen: string }, follow = false) {
    abort.current?.abort()
    const ctl = new AbortController(); abort.current = ctl
    const turn: Live = { question, steps: [], running: true, chosen: clarify?.chosen, started: Date.now() }
    const thread = follow || clarify ? threadId : null
    if (follow) setTurns(ts => [...ts, turn])
    else if (clarify) setLive(() => turn)
    else { setTurns([turn]); setThreadId(null); setPinned([]); setPinError(''); go({ kind: 'live' }) }
    const apply = (e: AskEvent) => {
      if (e.t === 'left') return setLeft(e.left)
      if (e.t === 'thread') return setThreadId(e.id)
      if (e.t === 'card') { setLive(() => null); return go({ kind: 'card', id: e.id }) }
      setLive(l => {
        if (!l) return l
        if (e.t === 'think') return { ...l, thinking: e.text }
        if (e.t === 'understand' || e.t === 'look' || e.t === 'check') return { ...l, thinking: undefined, steps: [...l.steps, { kind: e.t, text: e.text }] }
        if (e.t === 'answer') return { ...l, running: false, answer: e.answer }
        if (e.t === 'ask_back') return { ...l, running: false, askBack: { question: e.question, options: e.options } }
        return { ...l, running: false, error: e.text }
      })
    }
    try {
      const r = await fetch('/api/ask/question', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, clarify, threadId: thread ?? undefined }), signal: ctl.signal,
      })
      if (!r.ok || !r.body) throw new Error((await r.json().catch(() => ({})))?.error ?? 'Ask couldn’t answer right now.')
      const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
          if (line) { try { apply(JSON.parse(line) as AskEvent) } catch { /* a broken line */ } }
        }
      }
      setLive(l => (l && l.running ? { ...l, running: false, error: l.answer || l.askBack ? undefined : 'Ask stopped before answering. Try again.' } : l))
    } catch (e) {
      if (ctl.signal.aborted) return
      setLive(l => (l ? { ...l, running: false, error: e instanceof Error ? e.message : 'Ask couldn’t answer right now.' } : l))
    }
  }

  /** A suggested question: a ready answer's opens that card; anything else is asked (as a follow-up from a typed answer). */
  function askNext(q: string, follow: boolean) {
    const card = cards.find(c => norm(c.question) === norm(q))
    if (card) return go({ kind: 'card', id: card.id as CardId })
    run(q, undefined, follow)
  }

  async function pin() {
    if (!threadId || !live?.answer) return
    setPinError('')
    const r = await fetch('/api/ask/pins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ threadId }) })
    const j = await r.json().catch(() => ({})) as { ok?: boolean; error?: string; pins?: Answer[] }
    if (j.pins) setData(d => (d ? { ...d, pins: j.pins } : d))
    if (!r.ok || !j.ok) return setPinError(j.error ?? 'Couldn’t pin it. Try again.')
    setPinned(p => [...p, live.question])
  }
  async function unpin(id: string) {
    const r = await fetch('/api/ask/pins', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    const j = await r.json().catch(() => ({})) as { pins?: Answer[] }
    if (j.pins) setData(d => (d ? { ...d, pins: j.pins } : d))
    go({ kind: 'home' })
  }

  function ask(e: React.FormEvent, follow = false) {
    e.preventDefault()
    const t = typed.trim()
    if (!t) return
    setTyped('')
    if (follow) return run(t, undefined, true)
    // Exactly a ready answer's question: open it (free)
    const card = cards.find(c => c.question.toLowerCase().replace(/\W/g, '') === t.toLowerCase().replace(/\W/g, ''))
    if (card) go({ kind: 'card', id: card.id as CardId })
    else run(t)
  }

  const box = (placeholder: string, follow = false) => (
    <form className="ask-box" onSubmit={e => ask(e, follow)}>
      <input aria-label="Ask a question" placeholder={placeholder} value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" maxLength={300} />
      <button type="submit" className="ask-send" aria-label="Ask" disabled={left === 0}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
      </button>
    </form>
  )
  const leftLine = left !== null && left <= 5
    ? <p className="ask-miss">{left === 0 ? 'No questions of your own left today. Ready answers still work.' : `${left} question${left === 1 ? '' : 's'} of your own left today.`}</p>
    : null

  const openCard = view.kind === 'card' ? cards.find(c => c.id === view.id) ?? null : null
  const pins = data?.pins ?? []
  const openPin = view.kind === 'pin' ? pins.find(p => p.id === `pin:${view.id}`) ?? null : null

  return (
    <div className="ask">
      <header className="ask-bar">
        <button type="button" className="ask-mark" onClick={() => go({ kind: 'home' })} aria-label="GrowJin: Ask home">
          <img src="/growjinlogo.svg" alt="" width={24} height={24} />GrowJin
        </button>
        <span className="ask-who">
          <span className="ask-pill">{site}</span>
          <Link href="/tools" className="ask-out">Tools →</Link>
        </span>
      </header>

      <main className="ask-col">
        {view.kind === 'card' && (openCard
          ? <AnswerView onPanel={setPanel} onAsk={q => askNext(q, false)} a={openCard} eyebrow={`Ready since ${timeOf(openCard.at)}`} others={[...cards.slice(cards.indexOf(openCard) + 1), ...cards.slice(0, cards.indexOf(openCard))].slice(0, 3)} onBack={() => go({ kind: 'home' })} onOpen={id => go({ kind: 'card', id })} />
          : <Waiting busy={busy} error={error} onBack={() => go({ kind: 'home' })} fill={fill} start={fillStart} />)}

        {view.kind === 'pin' && (openPin
          ? <AnswerView onPanel={setPanel} onAsk={q => askNext(q, false)} a={openPin} eyebrow={`Pinned by you · updated ${dayOf(openPin.at)}`} others={cards.slice(0, 3)} onBack={() => go({ kind: 'home' })} onOpen={id => go({ kind: 'card', id })}
              extra={<button type="button" className="ask-tl" onClick={() => unpin(view.id)}>Unpin</button>} />
          : <Waiting busy={busy} error={error || 'This pin was removed.'} onBack={() => go({ kind: 'home' })} />)}

        {view.kind === 'live' && live && (
          <div className="ask-ans">
            <button type="button" className="ask-tl" onClick={() => go({ kind: 'home' })}>← Home</button>
            {/* Earlier questions in this conversation, short */}
            {turns.slice(0, -1).map((t, i) => (
              <div key={i} className="ask-earlier">
                <span className="ask-k">{i === 0 ? 'You asked' : 'Then'}</span>
                <b>{t.question}</b>
                {t.answer ? <p><Rich text={t.answer.say} /></p> : t.error ? <p>{t.error}</p> : null}
              </div>
            ))}
            <h1 className="ask-q">{live.question}</h1>
            <Work live={live} />
            {live.askBack && (
              <div className="ask-back">
                <p>{live.askBack.question}</p>
                <div className="ask-opts">
                  {live.askBack.options.map(o => (
                    <button key={o} type="button" className="ask-opt" onClick={() => run(live.question, { asked: live.askBack!.question, chosen: o })}>{o}</button>
                  ))}
                </div>
              </div>
            )}
            {live.chosen && !live.askBack && <p className="ask-chosen">You chose: <b>{live.chosen}</b></p>}
            {live.error && (
              <div className="ask-failed">
                <p>{live.error}</p>
                <button type="button" className="ask-tl" onClick={() => { if (turns.length > 1) { setTurns(ts => ts.slice(0, -1)); run(live.question, undefined, true) } else run(live.question) }}>Try again</button>
              </div>
            )}
            {live.answer && <AnswerBody a={live.answer} onPanel={setPanel} onAsk={q => askNext(q, true)} disabled={left === 0} />}
            {live.answer && threadId && (
              <div className="ask-pinrow">
                {pinned.includes(live.question)
                  ? <span className="ask-chip is-pinned">Pinned to home · updates every morning</span>
                  : <button type="button" className="ask-chip is-pin" onClick={pin}>Pin to home</button>}
                {pinError && <span className="ask-err-inline">{pinError}</span>}
              </div>
            )}
            {!live.running && (
              <div className="ask-again">
                {box(live.answer ? 'Ask a follow-up…' : 'Ask something else…', !!live.answer)}
                <div className="ask-again-line">
                  {leftLine}
                  {live.answer && <button type="button" className="ask-tl" onClick={() => go({ kind: 'home' })}>New question</button>}
                </div>
              </div>
            )}
          </div>
        )}

        {view.kind === 'home' && (
          <>
            <section className="ask-hello">
              <h1>What do you want to know?</h1>
              <p className="ask-lede">{!data && busy ? <>Taking a first look at {site}. This takes about a minute.</> : <>About {brandName}{data?.at ? <>, checked {dayOf(data.at)}</> : null}.</>}</p>
              {box('Ask anything about your business…')}
              {leftLine}
            </section>

            <section className="ask-sec">
              <div className="ask-sec-h">
                <span className="ask-k">{!busy && data?.at ? `Ready since ${timeOf(data.at)}` : 'Ready answers'}</span>
                {!busy && data && <button type="button" className="ask-tl" onClick={() => load(true)}>Check again</button>}
              </div>
              {error && <p className="ask-err">{error}</p>}
              {busy && <FillProgress steps={fill} start={fillStart} first={!cards.length} />}
              <div className="ask-cards">
                {pins.map(p => (
                  <button key={p.id} type="button" className="ask-card is-pinned" onClick={() => go({ kind: 'pin', id: p.id.slice(4) })}>
                    <span className="ask-card-pin">Pinned</span>
                    <span className="ask-card-t">{p.question}</span>
                    {p.number
                      ? <span className="ask-card-n">{p.number}<small>{p.numberLabel}</small></span>
                      : <span className="ask-card-s"><Rich text={p.say} /></span>}
                  </button>
                ))}
                {busy && !cards.length
                  ? null
                  : cards.map(c => (
                    <button key={c.id} type="button" className={`ask-card${c.id === 'replies' && c.state === 'ok' ? ' is-reply' : ''}${c.state !== 'ok' ? ' is-quiet' : ''}`} onClick={() => go({ kind: 'card', id: c.id as CardId })}>
                      <span className="ask-card-t">{c.question}</span>
                      <span className="ask-card-n">{c.number}<small>{c.numberLabel}</small></span>
                    </button>
                  ))}
              </div>
            </section>

            <section className="ask-sec">
              <div className="ask-sec-h"><span className="ask-k">Or ask your own</span></div>
              <div className="ask-tries">
                {EXAMPLES.map(q => (
                  <button key={q} type="button" className="ask-try" disabled={left === 0} onClick={() => run(q)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></svg>
                    {q}
                  </button>
                ))}
              </div>
            </section>
          </>
        )}
      </main>

      {panel && <AskPanel panel={panel} onClose={changed => { setPanel(null); if (changed) load(true) }} />}
    </div>
  )
}

const LABEL: Record<Step['kind'] | 'answer' | 'think', string> = { understand: 'Understand', look: 'Look', check: 'Check', answer: 'Answer', think: 'Thinking' }

/** The ready answers being worked out: each check, as it starts and ends. */
function FillProgress({ steps, start, first }: { steps: FillStep[]; start: number | null; first: boolean }) {
  const secs = useElapsed(start, true)
  const done = steps.filter(s => s.state !== 'on').length
  return (
    <div className="ask-fill" aria-live="polite">
      <div className="ask-timer">{first ? 'Taking a first look' : 'Checking your data again'} · {secs} s{steps.length ? ` · ${done} of ${steps.length} done` : ''}</div>
      {!steps.length && <div className="ask-fs is-on"><i aria-hidden="true" /><span>Starting…</span></div>}
      {steps.map(s => (
        <div key={s.id} className={`ask-fs is-${s.state}`}>
          <i aria-hidden="true" /><span>{s.text}</span>{s.result && <small>{s.result}</small>}
        </div>
      ))}
    </div>
  )
}

/** What Ask is doing, one line per step; the last one is "on" while it works. */
function Work({ live }: { live: Live }) {
  const secs = useElapsed(live.started, live.running)
  const lines: { kind: Step['kind'] | 'answer' | 'think'; text: string }[] = [...live.steps]
  if (live.running) lines.push({ kind: 'think', text: live.thinking ?? 'Working out what you’re asking' })
  if (live.answer) lines.push({ kind: 'answer', text: live.answer.picture ? 'Drawing the answer' : 'Writing the answer' })
  if (!lines.length) return null
  return (
    <div className="ask-work" aria-live="polite">
      {live.running && <div className="ask-timer">Working on it · {secs} s{secs > 25 ? ' · bigger questions take up to a minute' : ''}</div>}
      {lines.map((l, i) => (
        <div key={i} className={`ask-ph${live.running && i === lines.length - 1 ? ' is-on' : ''}`}>
          <span className="ask-ph-l">{LABEL[l.kind]}</span><span>{l.text}</span>
        </div>
      ))}
    </div>
  )
}

function Waiting({ busy, error, onBack, fill = [], start = null }: { busy: boolean; error: string; onBack: () => void; fill?: FillStep[]; start?: number | null }) {
  return (
    <div className="ask-ans">
      <button type="button" className="ask-tl" onClick={onBack}>← Home</button>
      {busy && !error ? <FillProgress steps={fill} start={start} first /> : <p className="ask-say ask-dim">{error || 'This answer isn’t ready.'}</p>}
    </div>
  )
}

function AnswerView({ a, eyebrow, others, onBack, onOpen, onPanel, onAsk, extra }: { a: Answer; eyebrow: string; others: Answer[]; onBack: () => void; onOpen: (id: CardId) => void; onPanel: (p: Panel) => void; onAsk: (q: string) => void; extra?: React.ReactNode }) {
  return (
    <article className="ask-ans">
      <button type="button" className="ask-tl" onClick={onBack}>← Home</button>
      <span className="ask-k ask-ready">{eyebrow}</span>
      <h1>{a.question}</h1>
      <AnswerBody a={a} onPanel={onPanel} onAsk={onAsk} />
      {extra && <div className="ask-pinrow">{extra}</div>}
      {!a.suggested?.length && others.length > 0 && (
        <div className="ask-more">
          <span className="ask-k">Ask next</span>
          <div className="ask-chips">{others.map(o => <button key={o.id} type="button" className="ask-chip" onClick={() => onOpen(o.id as CardId)}>{o.question}</button>)}</div>
        </div>
      )}
    </article>
  )
}

/** The answer's shape, the same for ready and typed answers. */
function AnswerBody({ a, onPanel, onAsk, disabled }: { a: Answer; onPanel: (p: Panel) => void; onAsk?: (q: string) => void; disabled?: boolean }) {
  return (
    <div className="ask-body">
      <p className="ask-say"><Rich text={a.say} /></p>

      {a.picture && (
        <div className="ask-pic">
          {a.pictureTitle && <div className="ask-pic-h"><b>{a.pictureTitle}</b></div>}
          <AskPicture p={a.picture} />
        </div>
      )}

      {a.finds.length > 0 && (
        <ol className="ask-finds">{a.finds.map((f, i) => <li key={i}><span><Rich text={f} /></span></li>)}</ol>
      )}

      {a.next && (
        <div className="ask-todo">
          <div className="ask-todo-t">
            <b>{a.next.title}</b>
            <span>{a.next.why}</span>
          </div>
          {a.next.panel
            ? <button type="button" className="ask-btn" onClick={() => onPanel(a.next!.panel!)}>{a.next.label}</button>
            : a.next.external
              ? <a className="ask-btn" href={a.next.href} target="_blank" rel="noreferrer">{a.next.label}</a>
              : <Link className="ask-btn" href={a.next.href}>{a.next.label}</Link>}
        </div>
      )}

      {a.then.length > 0 && (
        <div className="ask-then">
          <p className="ask-then-h">Then</p>
          {a.then.map((t, i) => (
            <div key={i} className="ask-row"><span className="ask-row-n">{i + 2}</span><span><b>{t.title}</b><span>{t.why}</span></span></div>
          ))}
        </div>
      )}

      {a.source && <p className="ask-src">Data: {a.source}</p>}

      {a.how && (
        <details className="ask-how">
          <summary>How I got this</summary>
          <div className="ask-how-b">
            <p><span>Understood as</span>{a.how.understood || '—'}</p>
            {a.how.steps.length > 0 && <p><span>Looked at</span>{a.how.steps.join(' · ')}</p>}
            <p><span>Took</span>{a.how.lookups} lookup{a.how.lookups === 1 ? '' : 's'} · {a.how.seconds} s · ${a.how.usd.toFixed(3)}</p>
            {a.how.unchecked.length > 0 && <p className="is-warn"><span>Not checked</span>{a.how.unchecked.join(', ')} couldn’t be matched to the data</p>}
          </div>
        </details>
      )}

      {/* Questions about this answer: one click to dig in */}
      {onAsk && !!a.suggested?.length && (
        <div className="ask-more">
          <span className="ask-k">Ask next</span>
          <div className="ask-chips">
            {a.suggested.map(q => <button key={q} type="button" className="ask-chip" disabled={disabled} onClick={() => onAsk(q)}>{q}</button>)}
          </div>
        </div>
      )}
    </div>
  )
}
