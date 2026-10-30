'use client'

// Lead Finder (/leads), built from the approved preview design-previews/tools-cleanup/lead-finder-unified.html.
// Leads are found by Lead Finder's search (lib/leads/engine.ts, /api/leads/engine): Claude runs the Lead
// Engine prompt with DataForSEO, Hunter and Apify, from the brief and filters in Settings, and the leads it
// returns land in the Lead Agent's list, so this page reads and writes the Lead Agent's data
// (/api/agents/lead). Two tabs: "Contact directly" and "Join conversations" (Reddit / Hacker News posts,
// still found by the Lead Agent).
// A quiet top line, one "Start here" panel, then the leads as the Lead Agent's cards. An opened lead shows
// what we know on the left (the same facts for every source) and the email or message on the right;
// finishing one opens the next.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { EngineInputs, Lead, LeadAgentData } from '@/lib/agents/store'
import type { EngineStatus } from '@/lib/leads/engine'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/email-outreach/shared'
import { Card, DemoSwitch, LiveProgress, Pager, Tabs, Tag, usePages } from '@/components/tool-ui'
import { WaitPanel } from '@/components/ui/loading'
import { Day, fmtAgo, fmtDate, initials, useAgentApi } from '@/components/agents/shared'
import OwnListFlow from '@/components/agents/OwnListFlow'
import {
  FINDER_SOURCE, LeadFacts, avOf, firstOf, isForum, isPage, isPost, nameOf, pageName, pageUrl, tabOf, validEmail, where,
  type LeadAgentFlags,
} from '@/components/agents/LeadAgentPage'

type Lane = 'direct' | 'talk'
type View = 'list' | 'lead' | 'settings' | 'how' | 'maybe' | 'done' | 'own'

const laneOf = (l: Lead): Lane => (isPost(l) ? 'talk' : 'direct')
const people = (l: Lead) => isPost(l) || l.source === 'profile'

export default function LeadFinderPage({ initial, flags, competitors = [] }: { initial: LeadAgentData; flags: LeadAgentFlags; competitors?: string[] }) {
  const { data, setData, busy, call, toast: said } = useAgentApi<LeadAgentData>('/api/agents/lead', initial)
  const [toast, notify] = useToast()
  useEffect(() => { if (said) notify(said) }, [said, notify])
  const s = data.settings
  const leads = data.leads
  const [demo, setDemo] = useState(flags.demo)
  const gmail = flags.gmail || demo

  const [lane, setLane] = useState<Lane>(() => initial.leads.some(l => laneOf(l) === 'direct' && tabOf(l) === 'needs') || !initial.leads.some(l => tabOf(l) === 'needs') ? 'direct' : 'talk')
  const [view, setView] = useState<View>('list')
  const [openId, setOpenId] = useState<string | null>(null)
  // The open lead's drafts, as they're edited
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [reply, setReply] = useState('')
  // A lead with only a social page: the user has their email after all
  const [emailInstead, setEmailInstead] = useState(false)

  // Lead Finder's search: its status, polled while it runs (each poll also keeps it moving on the server)
  const [job, setJob] = useState<EngineStatus | null>(null)
  const searching = job?.status === 'running'
  const poll = useCallback(async () => {
    try {
      const r = await fetch('/api/leads/engine')
      const j = await r.json() as { job?: EngineStatus | null; data?: LeadAgentData }
      setJob(prev => {
        // It just finished: show the new leads and what it says
        if (prev?.status === 'running' && j.job && j.job.status !== 'running') {
          if (j.data) setData(j.data)
          notify(j.job.status === 'failed' ? `The search stopped: ${j.job.error ?? 'something went wrong'}` : j.job.added ? `${j.job.added} new lead${j.job.added === 1 ? '' : 's'} found.` : 'The search found no new leads this time.')
        }
        return j.job ?? null
      })
    } catch { /* try again on the next poll */ }
  }, [setData, notify])
  useEffect(() => { poll() }, [poll])
  useEffect(() => {
    if (!searching) return
    const t = setInterval(poll, 4000)
    return () => clearInterval(t)
  }, [searching, poll])
  async function startSearch() {
    if (!s.engine) { setView('settings'); window.scrollTo({ top: 0 }); return }
    const r = await fetch('/api/leads/engine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'start' }) })
    const j = await r.json().catch(() => ({})) as { job?: EngineStatus; error?: string }
    if (j.job) { setJob(j.job); setLane('direct'); setView('list') } else notify(j.error ?? 'Couldn’t start the search.')
  }
  async function stopSearch() {
    const r = await fetch('/api/leads/engine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'stop' }) })
    const j = await r.json().catch(() => ({})) as { job?: EngineStatus }
    if (j.job) setJob(j.job)
  }

  const running = busy === 'run' || busy === 'more'
  const firstVisit = !data.lastRunAt && !leads.length && !running && !searching

  const act = (op: string, payload: Record<string, unknown> = {}, key = `${op}:${payload.id ?? ''}`) =>
    call(op, payload, key) as Promise<{ ok?: boolean; error?: string; message?: string; data?: LeadAgentData } | null>

  // What's on the list: this tab's leads waiting for you, best first; replies sit above them
  const todoIn = (ln: Lane) => leads.filter(l => laneOf(l) === ln && tabOf(l) === 'needs' && l.status !== 'replied').sort((a, b) => b.score - a.score)
  const todo = todoIn(lane)
  const replies = leads.filter(l => laneOf(l) === lane && l.status === 'replied' && !l.handledAt)
  const done = leads.filter(l => laneOf(l) === lane && tabOf(l) !== 'needs')
  const maybe = (data.maybe ?? []).filter(m => (m.source === 'reddit' || m.source === 'forum' ? 'talk' : 'direct') === lane)
  const [first, ...rest] = todo
  const pg = usePages(rest, [lane])
  const listTop = useRef<HTMLDivElement>(null)
  const open = openId ? leads.find(l => l.id === openId) ?? null : null

  function openLead(l: Lead) {
    setOpenId(l.id); setView('lead'); setEmailInstead(false)
    setTo(l.email ?? ''); setSubject(l.draft?.subject ?? ''); setBody(l.draft?.body ?? ''); setReply(l.reply ?? '')
    window.scrollTo({ top: 0 })
    // Nothing is written during a search: the email or message is written when the lead is opened
    if (l.status !== 'ready') return
    if (isForum(l) && !l.reply) {
      act('reply', { id: l.id }).then(r => { const x = r?.data?.leads.find(y => y.id === l.id); if (x?.reply) setReply(x.reply) })
    } else if (!isForum(l) && l.email && !l.draft) {
      act('email', { id: l.id, email: l.email }).then(r => { const x = r?.data?.leads.find(y => y.id === l.id); if (x?.draft) { setSubject(x.draft.subject); setBody(x.draft.body) } })
    }
  }
  const back = () => { setView('list'); setOpenId(null); window.scrollTo({ top: 0 }) }

  /** One lead finished: open the next in this tab, or go back to the list when none is left. */
  function finish(l: Lead, msg: string, undo?: () => void) {
    const next = todoIn(laneOf(l)).find(x => x.id !== l.id)
    if (next) { openLead(next); notify(`${msg} Next: ${nameOf(next)}.`, undo) }
    else { back(); notify(`${msg} All caught up.`, undo) }
  }
  function skip(l: Lead) {
    act('skip', { id: l.id })
    finish(l, 'Skipped.', () => { call('restore', { id: l.id }, `restore:${l.id}`) })
  }

  // ── Header ──────────────────────────────────────────────────────────────────

  function header() {
    return <>
      <nav className="lfp-crumbs" aria-label="Breadcrumb">Tools / Get customers</nav>
      <h1 className="lfp-title">Lead Finder</h1>
      <div className="lfp-line">
        <span>{searching ? 'Searching…' : running ? 'Checking the next posts…' : data.lastRunAt ? `Last search ${fmtAgo(data.lastRunAt)}` : 'Not searched yet'}</span>
        <button type="button" className="lfp-link" onClick={() => { setView('how'); window.scrollTo({ top: 0 }) }}>How it finds people</button>
        <button type="button" className="lfp-link" onClick={() => { setView('settings'); window.scrollTo({ top: 0 }) }}>Settings</button>
        {!firstVisit && !searching && <button type="button" className="lfp-link" disabled={running || !!busy} onClick={startSearch}>Find new leads</button>}
        {demo && <span>Demo: nothing is sent</span>}
      </div>
      {/* Only what's wrong shows on the page; the rest lives in Settings */}
      {!gmail && <div className="ag-note ag-note-warn">Connect Gmail so approved emails go out from your address. <a href="/api/gmail/connect">Connect Gmail</a></div>}
      {flags.hunterOut && !demo && <div className="ag-note ag-note-warn">Hunter’s email credits are used up, so new leads come without an email until they renew. You can still add one by hand.</div>}
      {data.lastError && !running && !searching && <div className="ag-note ag-note-crit">The last search had a problem: {data.lastError}</div>}
      {searching && job && <SearchProgress job={job} onStop={stopSearch} />}
      <LiveProgress agent="lead" active={running} fallback={['Picking search phrases', 'Searching Reddit and Hacker News', 'Checking who’s a good fit']} />
    </>
  }

  // ── The list ────────────────────────────────────────────────────────────────

  function card(l: Lead) {
    const needs = tabOf(l) === 'needs'
    const state =
      l.status === 'replied' ? <Tag tone={l.handledAt ? 'ok' : 'crit'}>{l.handledAt ? '✓ Answered' : `Replied${l.repliedAt ? ` ${fmtDate(l.repliedAt)}` : ''}`}</Tag>
      : l.status === 'needs_contact' ? <Tag tone="warn">Needs an email</Tag>
      : l.status === 'ready' ? <Tag>{isForum(l) ? (isPage(l) ? (l.reply ? 'Message written' : 'Message to write') : (l.reply ? 'Reply written' : 'Post to answer')) : l.draft ? 'Email written' : 'Email found'}</Tag>
      : l.status === 'queued' ? <Tag tone="warn">Approved · goes out soon</Tag>
      : l.status === 'sent' ? <Tag tone="ok">✓ Emailed {fmtDate(l.sentAt)}</Tag>
      : l.status === 'posted' ? <Tag tone="ok">✓ Sent</Tag>
      : l.status === 'opted_out' ? <Tag>Not interested</Tag>
      : l.status === 'bounced' ? <Tag tone="crit">Bounced</Tag>
      : <Tag>Skipped</Tag>
    const why = l.status === 'sent'
      ? (l.nextFollowUpAt ? `Follow-up ${l.followupsSent + 1} goes out ${fmtDate(l.nextFollowUpAt)} unless they reply.` : 'All follow-ups sent. Waiting for a reply.')
      : l.why
    const quote = l.status === 'replied' && l.replyNote ? `“${l.replyNote}”` : isPost(l) && l.snippet ? `“${l.snippet}”` : l.source === 'review' ? l.snippet : undefined
    const label = !needs ? 'View' : l.status === 'replied' ? 'Reply →' : isForum(l) ? (isPage(l) ? 'Write message →' : 'Write reply →') : 'Review email →'
    const site = l.website?.replace(/^https?:\/\//, '')
    return (
      <Card key={l.id} av={people(l) ? avOf(l) : initials(nameOf(l))} square={people(l)}
        name={nameOf(l)}
        sub={<>
          <span className="lfx-from">{FINDER_SOURCE[l.source]}{isPage(l) && l.source !== 'profile' ? ' · message' : ''}</span>
          {l.role && <span>{l.role}</span>}
          {people(l) ? <span>{where(l)}</span> : <span>{l.company && l.company !== nameOf(l) ? `${l.company}${site ? ' · ' : ''}` : null}{site && <a className="tu-site" href={`https://${site}`} target="_blank" rel="noopener noreferrer">{site}</a>}</span>}
          <span>found <Day iso={l.foundAt} /></span>
        </>}
        badge={l.source === 'own' ? undefined : <span className="cl-fitb cl-fitb--good">{l.fitLabel ?? `Fit ${l.score}/10`}</span>}
        why={why} quote={quote} state={state}
        onSkip={needs && l.status !== 'replied' ? () => skip(l) : undefined}
        action={<button type="button" className={`btn btn-sm ${needs ? 'btn-primary cl-reach' : 'cl-btn-outline'}`} onClick={() => openLead(l)}>{label}</button>} />
    )
  }

  function list() {
    const noun = lane === 'direct' ? ['person', 'people'] : ['post', 'posts']
    const verb = (l: Lead) => (l.status === 'needs_contact' ? 'Add their email' : isForum(l) ? (isPage(l) ? 'Write the message' : 'Write the reply') : 'Review the email')
    // "More" for people is a new search; for posts, the Lead Agent's next Reddit / Hacker News posts
    const more = lane === 'talk' && s.sources.reddit
    const findMore = () => (lane === 'direct' ? startSearch() : call('more', { lane: 'community' }, 'more'))
    return <>
      {header()}
      <Tabs value={lane} onChange={k => setLane(k)} tabs={[
        { key: 'direct', label: 'Contact directly', count: todoIn('direct').length, hot: leads.some(l => laneOf(l) === 'direct' && l.status === 'replied' && !l.handledAt) },
        { key: 'talk', label: 'Join conversations', count: todoIn('talk').length },
      ]} />

      {replies.map(l => (
        <button key={l.id} type="button" className="lfp-replied" onClick={() => openLead(l)}>
          <span className="lfp-dot" aria-hidden="true" />
          <span><b>{nameOf(l)}{l.company && l.company !== nameOf(l) ? ` at ${l.company}` : ''} replied.</b> {l.replyNote && <span>“{l.replyNote.slice(0, 70)}{l.replyNote.length > 70 ? '…' : ''}”</span>}</span>
        </button>
      ))}

      {firstVisit ? (
        <section className="lfp-empty">
          <b>{s.engine ? 'Find your first leads' : 'Tell Lead Finder who you’re looking for'}</b>
          <p>{s.engine ? 'It searches Google, LinkedIn, Instagram and more for companies that fit your brief, checks each one is real, and finds the right person to contact. A search takes a few minutes.' : 'Describe your ideal customer in your own words, and set where, how big and who to contact. Then it searches for you.'}</p>
          <button type="button" className="btn btn-primary" onClick={startSearch}>{s.engine ? 'Find leads' : 'Describe who you’re looking for'}</button>
        </section>
      ) : !first ? (
        !running && !searching && <section className="lfp-empty">
          <b>All caught up</b>
          <p>{lane === 'direct' ? 'Everyone is emailed, messaged or skipped.' : 'Every post is answered or skipped.'}</p>
          <button type="button" className="btn btn-primary" disabled={!!busy} onClick={findMore}>{lane === 'direct' ? 'Find more leads' : 'Find more posts'}</button>
        </section>
      ) : <>
        <section className="lfp-next">
          <div className="lfp-next-text">
            <b>{todo.length} {todo.length === 1 ? noun[0] : noun[1]} ready for your OK</b>
            <span>Start with {nameOf(first)}{first.company && first.company !== nameOf(first) ? ` at ${first.company}` : ''}. {first.why}</span>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => openLead(first)}>{verb(first)} →</button>
        </section>
        {rest.length > 0 && <div className="lfp-rest">
          <div ref={listTop} className="tu-anchor" />
          <p className="lfp-rest-h">Also ready</p>
          {pg.items.map(card)}
          <Pager p={pg} top={listTop} />
        </div>}
      </>}

      {!firstVisit && <div className="lfp-more">
        {more && <button type="button" className="lfp-link" disabled={!!busy} onClick={findMore}>{busy === 'more' ? 'Checking the next 10…' : 'Show 10 more posts'}</button>}
        {maybe.length > 0 && <button type="button" className="lfp-link" onClick={() => { setView('maybe'); window.scrollTo({ top: 0 }) }}>Checked but not kept ({maybe.length})</button>}
        {done.length > 0 && <button type="button" className="lfp-link" onClick={() => { setView('done'); window.scrollTo({ top: 0 }) }}>{done.length} sent or skipped</button>}
        {lane === 'direct' && <button type="button" className="lfp-link" onClick={() => { setView('own'); window.scrollTo({ top: 0 }) }}>Add your own emails</button>}
      </div>}
    </>
  }

  // ── One lead ────────────────────────────────────────────────────────────────

  function leadView(l: Lead) {
    const company = l.company && l.company !== nameOf(l) ? l.company : null
    const site = l.website?.replace(/^https?:\/\//, '')
    const who = (
      <aside className="lfp-who">
        <h2>{nameOf(l)}</h2>
        <div className="lfp-role">{[l.role, company].filter(Boolean).join(', ')}{(l.role || company) && site ? ' · ' : ''}{site && <a href={`https://${site}`} target="_blank" rel="noopener noreferrer">{site}</a>}{!site && people(l) && <a href={l.url} target="_blank" rel="noopener noreferrer">{where(l)}</a>}</div>
        <p className="lfp-why">{l.why}</p>
        {(isPost(l) || l.source === 'review') && l.snippet && <blockquote className="lfp-quote">{l.snippet}</blockquote>}
        <LeadFacts l={l} />
        <div className="lfp-fit">Fit {l.score}/10 · {FINDER_SOURCE[l.source]}</div>
      </aside>
    )
    const backBtn = <button type="button" className="lfp-link lfp-back" onClick={back}>← All leads</button>
    const page = (step: React.ReactNode) => <>{backBtn}<div className="lfp-open">{who}<section className="lfp-step">{step}</section></div></>

    // Already handled (from "sent or skipped"): what happened, and a way back
    if (tabOf(l) !== 'needs') {
      const text = l.status === 'sent' ? `Emailed ${fmtDate(l.sentAt)}${l.email ? ` to ${l.email}` : ''}. ${l.nextFollowUpAt ? `A follow-up goes out ${fmtDate(l.nextFollowUpAt)} if they don’t reply.` : 'All follow-ups are sent.'}`
        : l.status === 'queued' ? `Approved. It goes out within your limit of ${s.dailyLimit} a day.`
        : l.status === 'posted' ? 'Marked as sent.'
        : l.status === 'replied' ? `Answered.${l.replyNote ? ` They said: “${l.replyNote}”` : ''}`
        : l.status === 'opted_out' ? 'Not interested. Follow-ups stopped.'
        : l.status === 'bounced' ? 'The email bounced, so follow-ups stopped.'
        : 'You skipped this one.'
      return page(<>
        <div className="lfp-step-of">Done</div>
        <h3>{l.status === 'skipped' ? 'Skipped' : l.status === 'sent' ? `Emailed ${firstOf(l)}` : 'Handled'}</h3>
        <p className="lfp-hint">{text}</p>
        {(l.status === 'skipped' || (l.status === 'replied' && l.handledAt)) && <div className="lfp-acts">
          <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => call('restore', { id: l.id }, `restore:${l.id}`)}>Bring it back</button>
        </div>}
      </>)
    }

    // They replied: answer in Gmail, then mark it
    if (l.status === 'replied') {
      return page(<>
        <div className="lfp-step-of">They replied</div>
        <h3>Reply while it’s warm</h3>
        <p className="lfp-hint">Answer from Gmail, in the same thread. Then mark it as answered here.</p>
        {l.replyNote && <blockquote className="lfp-quote lfp-quote--reply">“{l.replyNote}”</blockquote>}
        <div className="lfp-acts">
          {l.threadId && <a className="btn cl-btn-outline" href={`https://mail.google.com/mail/u/0/#all/${l.threadId}`} target="_blank" rel="noopener noreferrer">Open in Gmail ↗</a>}
          <button type="button" className="btn btn-primary lfp-main" disabled={!!busy} onClick={() => { act('handled', { id: l.id }); finish(l, 'Marked as answered.') }}>I’ve answered</button>
        </div>
      </>)
    }

    // A post to answer, or a message to send on their page: copy it, open the page, send it there
    if (isForum(l) && !emailInstead) {
      const where = isPost(l) ? (l.source === 'reddit' ? 'Reddit' : 'Hacker News') : pageName(l)
      const writing = busy === `reply:${l.id}` && !reply
      return page(<>
        <div className="lfp-step-of">{isPost(l) ? 'A reply for their post' : 'A direct message'}</div>
        <h3>{isPost(l) ? 'Check the reply' : 'Check the message'}</h3>
        <p className="lfp-hint">{isPost(l) ? `${where} doesn’t allow posting for you. Copy it, open the post and paste it.` : `Copy it, open their ${where} page and send it yourself. Then tell us you sent it.`}
          {isPage(l) && l.source !== 'profile' && <> <button type="button" className="lfp-link" onClick={() => setEmailInstead(true)}>Have their email? Write an email instead</button></>}</p>
        {writing ? <div className="ro-working"><Spinner /><span>Writing it…</span><i /></div> : <div className="lfp-mail">
          {isPage(l) && <label><span>To</span><input readOnly value={`${where} · ${pageUrl(l).replace(/^https?:\/\/(www\.)?/, '')}`} /></label>}
          <textarea aria-label="Message" rows={8} value={reply} onChange={e => setReply(e.target.value)} />
        </div>}
        <div className="lfp-acts">
          <button type="button" className="btn btn-ghost" onClick={() => skip(l)}>Skip</button>
          <button type="button" className="btn cl-btn-outline" disabled={!reply.trim()} onClick={async () => { try { await navigator.clipboard.writeText(reply); notify('Copied.') } catch { notify('Couldn’t copy. Select the text and copy it.') } }}>Copy</button>
          <a className="btn cl-btn-outline" href={pageUrl(l)} target="_blank" rel="noopener noreferrer">{isPost(l) ? 'Open the post ↗' : `Open their ${where} ↗`}</a>
          <button type="button" className="btn btn-primary lfp-main" disabled={!reply.trim() || !!busy} onClick={async () => {
            if (reply !== l.reply) await call('save', { id: l.id, reply }, `save:${l.id}`)
            act('posted', { id: l.id })
            finish(l, isPost(l) ? 'Marked as posted.' : 'Marked as sent.')
          }}>{isPost(l) ? 'I’ve posted it' : 'I’ve sent it'}</button>
        </div>
      </>)
    }

    // No email yet: paste one and the email is written for them
    const writing = busy === `email:${l.id}`
    if (!l.email || l.status === 'needs_contact' || emailInstead && !l.draft) {
      return page(<>
        <div className="lfp-step-of">An email for your OK</div>
        <h3>Where should it go?</h3>
        <p className="lfp-hint">No public email was found. Paste it if you know it, and the email gets written for them.{l.website ? <> Try <a className="th-link" href={`https://${l.website}`} target="_blank" rel="noopener noreferrer">their website ↗</a>{l.phone ? ` or call ${l.phone}` : ''}.</> : ''}</p>
        <form className="lfp-mail" onSubmit={async e => {
          e.preventDefault()
          if (!validEmail(to)) return
          const r = await act('email', { id: l.id, email: to })
          const x = r?.data?.leads.find(y => y.id === l.id)
          if (x?.draft) { setSubject(x.draft.subject); setBody(x.draft.body); setEmailInstead(false) }
        }}>
          <label><span>To</span><input id={`to-${l.id}`} type="email" value={to} onChange={e => setTo(e.target.value)} placeholder="name@company.com" /></label>
          <div className="lfp-acts">
            <button type="button" className="btn btn-ghost" onClick={() => (emailInstead ? setEmailInstead(false) : skip(l))}>{emailInstead ? '← Back to the message' : 'Skip'}</button>
            <button type="submit" className="btn btn-primary lfp-main" disabled={!validEmail(to) || writing}>{writing ? <><Spinner />Writing…</> : 'Write the email'}</button>
          </div>
        </form>
      </>)
    }

    // The email: check it, then send
    const sending = busy === `approve:${l.id}`
    return page(<>
      <div className="lfp-step-of">An email for your OK</div>
      <h3>Check the email</h3>
      <p className="lfp-hint">Sent from your Gmail. Follow-ups after {s.followUpDays.join(' and ') || '—'} days stop when they reply.</p>
      {writing && !body ? <div className="ro-working"><Spinner /><span>Writing the email for {firstOf(l)}…</span><i /></div> : <div className="lfp-mail">
        <label><span>To</span><input readOnly value={l.email} /></label>
        <label><span>Subject</span><input value={subject} onChange={e => setSubject(e.target.value)} /></label>
        <textarea aria-label="Email" rows={10} value={body} onChange={e => setBody(e.target.value)} />
      </div>}
      {l.emailVia && <p className="lfp-note">Email: {l.emailVia}{l.emailVerified ? '' : ' · not checked, so look it over'}.</p>}
      <div className="lfp-acts">
        <button type="button" className="btn btn-ghost" disabled={sending} onClick={() => skip(l)}>Skip</button>
        <button type="button" className="btn btn-primary lfp-main" disabled={sending || !gmail || !subject.trim() || !body.trim()} onClick={async () => {
          const r = await act('approve', { id: l.id, subject, body }, `approve:${l.id}`)
          if (r?.ok) finish(l, r.message ?? 'Sent.')
        }}>{sending ? <><Spinner />Sending…</> : 'Approve and send'}</button>
      </div>
    </>)
  }

  // ── Side views ──────────────────────────────────────────────────────────────

  const backLink = <button type="button" className="lfp-link lfp-back" onClick={back}>← All leads</button>

  function settingsView() {
    return <>
      {backLink}
      <h1 className="lfp-title">Settings</h1>
      <div className="lfp-line">
        <span>Gmail: {flags.gmail ? 'connected' : <a href="/api/gmail/connect">not connected, connect it</a>}</span>
        <DemoSwitch on={demo} forced={flags.demoForced} busy={!!busy} onChange={async on => {
          const r = await call('demo', { on }) as { demo?: boolean } | null
          if (typeof r?.demo === 'boolean') setDemo(r.demo)
        }} />
      </div>
      <SearchSettings initial={s} saving={busy === 'settings'} onCancel={back}
        onSave={async next => { const r = await call('settings', { settings: next }); if (r?.data) { back(); notify('Saved') } }} />
    </>
  }

  function maybeView() {
    return <>
      {backLink}
      <h1 className="lfp-title">Checked but not kept</h1>
      <div className="lfp-line"><span>Close to a fit, but one check failed. Use one anyway if you know better.</span></div>
      <div className="lfp-rows">
        {maybe.map(m => (
          <div key={m.id} className="lfp-row">
            <div className="lfp-row-main"><b>{m.url ? <a href={m.url} target="_blank" rel="noopener noreferrer">{m.title}</a> : m.title}</b><span>{m.reason} · {m.why}</span></div>
            <span className="lfp-row-src">{FINDER_SOURCE[m.source]}</span>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => call('use', { id: m.id }, `use:${m.id}`)}>{busy === `use:${m.id}` ? <><Spinner />Adding…</> : 'Use anyway'}</button>
          </div>
        ))}
      </div>
    </>
  }

  function doneView() {
    return <>
      {backLink}
      <h1 className="lfp-title">Sent or skipped</h1>
      <div className="lfp-line"><span>{lane === 'direct' ? 'Everyone you emailed, messaged or skipped. Follow-ups stop when they reply.' : 'Posts you answered or skipped.'}</span></div>
      <div className="lfp-rest">{done.map(card)}</div>
    </>
  }

  function howView() {
    const r = data.engineRun
    const p = r?.profile
    const listOf = (label: string, items?: string[]) => items?.length ? <li><h4>{label}</h4><p>{items.join(' · ')}</p></li> : null
    return <>
      {backLink}
      <h1 className="lfp-title">How it finds people</h1>
      <div className="lfp-line"><span>Claude searches with your brief and filters, using DataForSEO (Google, Maps, websites), Hunter (emails) and Apify (LinkedIn, Instagram, Facebook, Product Hunt, ads).</span></div>
      <ol className="lfp-funnel">
        <li><h4>Your brief becomes a lead profile</h4><p>What you sell, what a lead must have, what makes a strong fit, what rules one out, which competitors to skip, which extra checks matter for you, and the pitch.</p></li>
        <li><h4>Discover</h4><p>Narrow searches the way your customers’ customers search, across niches and countries, for two to three times as many companies as you asked for.</p></li>
        <li><h4>Is it real?</h4><p>Dead sites, placeholders, test projects, competitors, name mix-ups and anything outside your filters are dropped.</p></li>
        <li><h4>Checks that matter for you</h4><p>Only the ones your profile needs, such as social activity, app stores, hiring or ads, cheapest first.</p></li>
        <li><h4>The right person</h4><p>Hunter first, then LinkedIn and company records. A shared inbox only when no person turns up, and every guessed email is marked.</p></li>
        <li><h4>Rated and explained</h4><p>From Very Likely to Very Unlikely, with one line on why. Neutral or better goes to your list, the rest to “Checked but not kept”. Nothing is invented; every fact comes from a tool.</p></li>
      </ol>
      <p className="lfp-note">A search spends at most about $1 per 10 leads on data, plus the AI, and stops at that cap with what it has found.</p>
      {r && <>
        <h2 className="lfp-sub">Your last search ({fmtAgo(r.at)})</h2>
        {r.summary && <p className="lfp-hint">{r.summary}</p>}
        {p && <ol className="lfp-funnel lfp-funnel--plain">
          {p.sells && <li><h4>What you sell</h4><p>{p.sells}</p></li>}
          {listOf('Must have', p.must_haves)}
          {listOf('Strong fit', p.strong_fit)}
          {listOf('Ruled out', p.disqualifiers)}
          {listOf('Competitors skipped', p.excluded_competitors)}
          {listOf('Extra checks', p.extra_checks)}
          {p.pitch_angle && <li><h4>Pitch</h4><p>{p.pitch_angle}</p></li>}
          {listOf('Assumptions', p.conflicts_or_assumptions)}
        </ol>}
        {r.toolIssues.length > 0 && <div className="ag-note ag-note-warn">Tools that had problems: {r.toolIssues.join(' · ')}</div>}
        <p className="lfp-note">{r.added} new lead{r.added === 1 ? '' : 's'} · cost about ${r.costUsd.toFixed(2)}</p>
      </>}
    </>
  }

  return (
    <div className="tool-page lfp">
      {view === 'lead' && open ? leadView(open)
        : view === 'settings' ? settingsView()
        : view === 'how' ? howView()
        : view === 'maybe' ? maybeView()
        : view === 'done' ? doneView()
        : view === 'own' ? <>
          {backLink}
          <OwnListFlow tool="Lead Finder" repliesIn="Contact directly" call={call} busy={busy} gmail={gmail} dailyLimit={s.dailyLimit} followUpDays={s.followUpDays} notify={notify} onClose={back} />
        </>
        : list()}
      {toast}
    </div>
  )
}

/** The running search: what it's doing now, and a way to stop it early. */
function SearchProgress({ job, onStop }: { job: EngineStatus; onStop: () => void }) {
  const lines = job.log.slice(-5)
  return <>
    <WaitPanel
      steps={lines.map((l, i) => ({ label: l.text, state: i === lines.length - 1 ? 'on' as const : 'done' as const }))}
      expectedMs={6 * 60_000} startedAt={Date.parse(job.startedAt)} page="leadAgent"
      note={`${job.toolCalls} lookups · about $${job.costUsd.toFixed(2)} so far. You can leave this page; the search keeps going while it’s open in a tab.`} />
    {!job.wrapUp && <p className="lfp-note"><button type="button" className="lfp-link" onClick={onStop}>Stop and keep what’s found</button></p>}
  </>
}

const EMPTY: EngineInputs = { brief: '', industry: '', location: '', companySize: '', contactRole: '', leadCount: 10 }

/** Lead Finder's Settings: who to look for (brief + five filters), and sending. */
function SearchSettings({ initial, saving, onSave, onCancel }: {
  initial: LeadAgentData['settings']; saving: boolean; onSave: (s: Partial<LeadAgentData['settings']>) => void; onCancel: () => void
}) {
  const [e, setE] = useState<EngineInputs>(initial.engine ?? EMPTY)
  const [reddit, setReddit] = useState(initial.sources.reddit)
  const [enabled, setEnabled] = useState(initial.enabled)
  const [limit, setLimit] = useState(initial.dailyLimit)
  const [days, setDays] = useState(initial.followUpDays.join(', '))
  const set = <K extends keyof EngineInputs>(k: K, v: EngineInputs[K]) => setE(x => ({ ...x, [k]: v }))
  return (
    <form className="tu-panel lfp-form" onSubmit={ev => {
      ev.preventDefault()
      onSave({ engine: e, sources: { ...initial.sources, reddit }, enabled, dailyLimit: limit, followUpDays: days.split(/[,\s]+/).map(Number).filter(n => n > 0) })
    }}>
      <h3>Who you’re looking for</h3>
      <p className="tu-hint">Your brief is what “a good lead” means. The filters set the limits. Where they clash, the brief wins on what you want and the filters on where and how big.</p>
      <label className="lfp-field">Your brief
        <textarea id="lfp-brief" rows={6} value={e.brief} onChange={ev => set('brief', ev.target.value)}
          placeholder="e.g. Small SaaS with a real product, not test apps. Ideally they already post on social media but it isn’t working well. If they have no social, the product has to look legit. Skip founders juggling many projects." />
      </label>
      <div className="lfp-grid">
        <label className="lfp-field">Industry<input id="lfp-industry" value={e.industry} onChange={ev => set('industry', ev.target.value)} placeholder="e.g. small SaaS / app companies" /></label>
        <label className="lfp-field">Location<input id="lfp-location" value={e.location} onChange={ev => set('location', ev.target.value)} placeholder="e.g. UK, Ireland, Netherlands" /></label>
        <label className="lfp-field">Company size<input id="lfp-size" value={e.companySize} onChange={ev => set('companySize', ev.target.value)} placeholder="e.g. 1–10, early stage" /></label>
        <label className="lfp-field">Who to contact<input id="lfp-role" value={e.contactRole} onChange={ev => set('contactRole', ev.target.value)} placeholder="e.g. Founder/CEO, Head of Marketing" /></label>
        <label className="lfp-field">Leads per search<input id="lfp-count" type="number" min={1} max={50} value={e.leadCount} onChange={ev => set('leadCount', Math.max(1, Math.min(50, Number(ev.target.value) || 10)))} /></label>
      </div>
      <h3 className="lfp-form-h">Also</h3>
      <label className="tu-chk"><input type="checkbox" checked={reddit} onChange={ev => setReddit(ev.target.checked)} />
        <span>Find Reddit and Hacker News posts<small>Posts asking for a tool like yours, in “Join conversations”. You post the reply yourself.</small></span></label>
      <label className="tu-chk"><input type="checkbox" checked={enabled} onChange={ev => setEnabled(ev.target.checked)} />
        <span>Check replies and send follow-ups every morning<small>Follow-ups stop when someone replies. Nothing new is sent without you.</small></span></label>
      <div className="lfp-grid">
        <label className="lfp-field">Most new emails a day<input id="lfp-limit" type="number" min={1} max={30} value={limit} onChange={ev => setLimit(Math.max(1, Math.min(30, Number(ev.target.value) || 1)))} /></label>
        <label className="lfp-field">Follow up after (days)<input id="lfp-days" value={days} onChange={ev => setDays(ev.target.value)} placeholder="3, 7" /></label>
      </div>
      <div className="tu-panel-acts">
        <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" type="submit" disabled={saving || (!e.brief.trim() && !e.industry.trim())}>{saving ? <><Spinner />Saving…</> : 'Save'}</button>
      </div>
    </form>
  )
}
