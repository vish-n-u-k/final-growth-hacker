'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { Answer, AskCards, CardId } from '@/lib/ask/types'
import AskPicture from './AskPicture'

// Ask, phase 1 (md_files/ASK_PLAN.md): a home page with one ask box and the ready answers, and one
// answer at a time. Every answer has the same shape: a sentence, a picture, findings, one blue next step.

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

// Typed questions go to the closest card for now; questions of your own come in phase 2
const MATCH: [CardId, RegExp][] = [
  ['replies', /repl|answer(ed)?|respond|inbox|heard back/i],
  ['email', /email|lead|contact|reach out|who should|prospect|outreach/i],
  ['google', /google|search|seo|index|rank|sitemap|pages?/i],
]

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
  const [open, setOpen] = useState<CardId | null>(initialOpen)
  const [typed, setTyped] = useState('')
  const [miss, setMiss] = useState('')

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

  // The open answer lives in the address (?q=email), so back and forward work
  const show = useCallback((id: CardId | null) => {
    setOpen(id); setMiss('')
    const url = id ? `/ask?q=${id}` : '/ask'
    window.history.pushState({ q: id }, '', url)
    window.scrollTo({ top: 0 })
  }, [])
  useEffect(() => {
    const onPop = () => setOpen((new URLSearchParams(window.location.search).get('q') as CardId | null) ?? null)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  function ask(e: React.FormEvent) {
    e.preventDefault()
    const t = typed.trim()
    if (!t) return
    const hit = MATCH.find(([, re]) => re.test(t))?.[0]
    if (hit) { setTyped(''); show(hit) } else setMiss(t)
  }

  const cards = data?.cards ?? []
  const answer = open ? cards.find(c => c.id === open) ?? null : null

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
        {open ? (
          answer ? <AnswerView a={answer} others={cards.filter(c => c.id !== open)} onBack={() => show(null)} onOpen={show} />
            : <Waiting busy={busy} error={error} onBack={() => show(null)} />
        ) : (
          <>
            <section className="ask-hello">
              <h1>What do you want to know?</h1>
              <p className="ask-lede">About {brandName}{data?.at ? <>, checked {dayOf(data.at)}</> : null}.</p>
              <form className="ask-box" onSubmit={ask}>
                <input aria-label="Ask a question" placeholder="Ask anything about your business…" value={typed}
                  onChange={e => { setTyped(e.target.value); setMiss('') }} autoComplete="off" />
                <button type="submit" className="ask-send" aria-label="Ask">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </button>
              </form>
              {miss && <p className="ask-miss">Ask can only answer the questions below for now. Questions of your own are coming next.</p>}
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
                    <button key={c.id} type="button" className={`ask-card${c.id === 'replies' && c.state === 'ok' ? ' is-reply' : ''}${c.state !== 'ok' ? ' is-quiet' : ''}`} onClick={() => show(c.id)}>
                      <span className="ask-card-t">{c.question}</span>
                      <span className="ask-card-n">{c.number}<small>{c.numberLabel}</small></span>
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

function Waiting({ busy, error, onBack }: { busy: boolean; error: string; onBack: () => void }) {
  return (
    <div className="ask-ans">
      <button type="button" className="ask-tl" onClick={onBack}>← Home</button>
      <p className="ask-say ask-dim">{error || (busy ? 'Checking your data…' : 'This answer isn’t ready.')}</p>
    </div>
  )
}

function AnswerView({ a, others, onBack, onOpen }: { a: Answer; others: Answer[]; onBack: () => void; onOpen: (id: CardId) => void }) {
  return (
    <article className="ask-ans">
      <button type="button" className="ask-tl" onClick={onBack}>← Home</button>
      <span className="ask-k ask-ready">Ready since {timeOf(a.at)}</span>
      <h1>{a.question}</h1>
      <p className="ask-say"><Rich text={a.say} /></p>

      {a.picture && (
        <div className="ask-pic">
          <div className="ask-pic-h"><b>{a.pictureTitle}</b></div>
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

      <p className="ask-src">Data: {a.source}</p>

      {others.length > 0 && (
        <div className="ask-more">
          <span className="ask-k">Ask next</span>
          <div className="ask-chips">{others.map(o => <button key={o.id} type="button" className="ask-chip" onClick={() => onOpen(o.id)}>{o.question}</button>)}</div>
        </div>
      )}
    </article>
  )
}
