'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { Answer, AskCards, AskEvent, CardId } from '@/lib/ask/types'
import AskPicture from './AskPicture'

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
}

type View = { kind: 'home' } | { kind: 'card'; id: CardId } | { kind: 'live' }

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
  const [live, setLive] = useState<Live | null>(null)
  const [left, setLeft] = useState<number | null>(null)
  const abort = useRef<AbortController | null>(null)

  const load = useCallback(async (refresh: boolean) => {
    setBusy(true); setError('')
    try {
      const r = await fetch('/api/ask/cards', { method: refresh ? 'POST' : 'GET' })
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? 'Something went wrong')
      setData(await r.json())
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
    window.history.pushState(null, '', v.kind === 'card' ? `/ask?q=${v.id}` : '/ask')
    window.scrollTo({ top: 0 })
  }, [])
  useEffect(() => {
    const onPop = () => {
      abort.current?.abort()
      const q = new URLSearchParams(window.location.search).get('q') as CardId | null
      setView(q ? { kind: 'card', id: q } : { kind: 'home' })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const cards = data?.cards ?? []

  async function run(question: string, clarify?: { asked: string; chosen: string }) {
    abort.current?.abort()
    const ctl = new AbortController(); abort.current = ctl
    setLive({ question, steps: [], running: true, chosen: clarify?.chosen })
    if (!clarify) go({ kind: 'live' })
    const apply = (e: AskEvent) => {
      if (e.t === 'left') return setLeft(e.left)
      if (e.t === 'card') { setLive(null); return go({ kind: 'card', id: e.id }) }
      setLive(l => {
        if (!l) return l
        if (e.t === 'understand' || e.t === 'look' || e.t === 'check') return { ...l, steps: [...l.steps, { kind: e.t, text: e.text }] }
        if (e.t === 'answer') return { ...l, running: false, answer: e.answer }
        if (e.t === 'ask_back') return { ...l, running: false, askBack: { question: e.question, options: e.options } }
        return { ...l, running: false, error: e.text }
      })
    }
    try {
      const r = await fetch('/api/ask/question', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, clarify }), signal: ctl.signal,
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

  function ask(e: React.FormEvent) {
    e.preventDefault()
    const t = typed.trim()
    if (!t) return
    setTyped('')
    // Exactly a ready answer's question: open it (free)
    const card = cards.find(c => c.question.toLowerCase().replace(/\W/g, '') === t.toLowerCase().replace(/\W/g, ''))
    if (card) go({ kind: 'card', id: card.id as CardId })
    else run(t)
  }

  const box = (placeholder: string) => (
    <form className="ask-box" onSubmit={ask}>
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

  return (
    <div className="ask">
      <header className="ask-bar">
        <span className="ask-mark"><i aria-hidden="true" />Ask</span>
        <span className="ask-who">
          <span className="ask-pill">{site}</span>
          <Link href="/dashboard" className="ask-out">GrowJin →</Link>
        </span>
      </header>

      <main className="ask-col">
        {view.kind === 'card' && (openCard
          ? <AnswerView a={openCard} eyebrow={`Ready since ${timeOf(openCard.at)}`} others={cards.filter(c => c.id !== openCard.id)} onBack={() => go({ kind: 'home' })} onOpen={id => go({ kind: 'card', id })} />
          : <Waiting busy={busy} error={error} onBack={() => go({ kind: 'home' })} />)}

        {view.kind === 'live' && live && (
          <div className="ask-ans">
            <button type="button" className="ask-tl" onClick={() => go({ kind: 'home' })}>← Home</button>
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
                <button type="button" className="ask-tl" onClick={() => run(live.question)}>Try again</button>
              </div>
            )}
            {live.answer && <AnswerBody a={live.answer} />}
            {!live.running && (
              <div className="ask-again">
                {box('Ask something else…')}
                {leftLine}
              </div>
            )}
          </div>
        )}

        {view.kind === 'home' && (
          <>
            <section className="ask-hello">
              <h1>What do you want to know?</h1>
              <p className="ask-lede">About {brandName}{data?.at ? <>, checked {dayOf(data.at)}</> : null}.</p>
              {box('Ask anything about your business…')}
              {leftLine}
            </section>

            <section className="ask-sec">
              <div className="ask-sec-h">
                <span className="ask-k">{busy ? 'Checking…' : data?.at ? `Ready since ${timeOf(data.at)}` : 'Ready answers'}</span>
                {!busy && data && <button type="button" className="ask-tl" onClick={() => load(true)}>Check again</button>}
              </div>
              {error && <p className="ask-err">{error}</p>}
              <div className="ask-cards">
                {busy && !cards.length
                  ? [0, 1, 2].map(i => <div key={i} className="ask-card ask-skel" aria-hidden="true" />)
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
    </div>
  )
}

const LABEL: Record<Step['kind'] | 'answer', string> = { understand: 'Understand', look: 'Look', check: 'Check', answer: 'Answer' }

/** What Ask is doing, one line per step; the last one is "on" while it works. */
function Work({ live }: { live: Live }) {
  const lines: { kind: Step['kind'] | 'answer'; text: string }[] = [...live.steps]
  if (live.running && !lines.length) lines.push({ kind: 'understand', text: 'Working out what you mean…' })
  if (live.answer) lines.push({ kind: 'answer', text: live.answer.picture ? 'Drawing the answer' : 'Writing the answer' })
  if (!lines.length) return null
  return (
    <div className="ask-work" aria-live="polite">
      {lines.map((l, i) => (
        <div key={i} className={`ask-ph${live.running && i === lines.length - 1 ? ' is-on' : ''}`}>
          <span className="ask-ph-l">{LABEL[l.kind]}</span><span>{l.text}</span>
        </div>
      ))}
    </div>
  )
}

function Waiting({ busy, error, onBack }: { busy: boolean; error: string; onBack: () => void }) {
  return (
    <div className="ask-ans">
      <button type="button" className="ask-tl" onClick={onBack}>← Home</button>
      <p className="ask-say ask-dim">{error || (busy ? 'Checking your data…' : 'This answer isn’t ready.')}</p>
    </div>
  )
}

function AnswerView({ a, eyebrow, others, onBack, onOpen }: { a: Answer; eyebrow: string; others: Answer[]; onBack: () => void; onOpen: (id: CardId) => void }) {
  return (
    <article className="ask-ans">
      <button type="button" className="ask-tl" onClick={onBack}>← Home</button>
      <span className="ask-k ask-ready">{eyebrow}</span>
      <h1>{a.question}</h1>
      <AnswerBody a={a} />
      {others.length > 0 && (
        <div className="ask-more">
          <span className="ask-k">Ask next</span>
          <div className="ask-chips">{others.map(o => <button key={o.id} type="button" className="ask-chip" onClick={() => onOpen(o.id as CardId)}>{o.question}</button>)}</div>
        </div>
      )}
    </article>
  )
}

/** The answer's shape, the same for ready and typed answers. */
function AnswerBody({ a }: { a: Answer }) {
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
          {a.next.external
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
    </div>
  )
}
