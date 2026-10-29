'use client'

// Lead Finder (/leads), built from the approved preview design-previews/tools-cleanup/lead-finder-unified.html.
// Every source (websites, Google Maps, LinkedIn people, competitors' unhappy reviewers, seller pages, your
// own lists) goes through the Lead Agent's one funnel (lib/agents/lead-agent.ts), so this page reads and
// writes the Lead Agent's data (/api/agents/lead). Two tabs: "Contact directly" and "Join conversations".
// A quiet top line, one "Start here" panel, then the leads as the Lead Agent's cards. An opened lead shows
// what we know on the left (the same facts for every source) and the email or message on the right;
// finishing one opens the next.

import { useEffect, useRef, useState } from 'react'
import type { Lead, LeadAgentData } from '@/lib/agents/store'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/email-outreach/shared'
import { Card, DemoSwitch, LiveProgress, Pager, Tabs, Tag, usePages } from '@/components/tool-ui'
import { Day, fmtAgo, fmtDate, initials, useAgentApi } from '@/components/agents/shared'
import OwnListFlow from '@/components/agents/OwnListFlow'
import {
  FINDER_PROGRESS, FINDER_SOURCE, LeadFacts, Settings, avOf, firstOf, isForum, isPage, isPost, nameOf, pageName, pageUrl, tabOf, validEmail, where,
  type LeadAgentFlags,
} from '@/components/agents/LeadAgentPage'

type Lane = 'direct' | 'talk'
type View = 'list' | 'lead' | 'settings' | 'how' | 'maybe' | 'done' | 'own'

const laneOf = (l: Lead): Lane => (isPost(l) ? 'talk' : 'direct')
const people = (l: Lead) => isPost(l) || l.source === 'profile'

export default function LeadFinderPage({ initial, flags, competitors = [] }: { initial: LeadAgentData; flags: LeadAgentFlags; competitors?: string[] }) {
  const { data, busy, call, toast: said } = useAgentApi<LeadAgentData>('/api/agents/lead', initial)
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

  const running = busy === 'run' || busy === 'more'
  const firstVisit = !data.lastRunAt && !leads.length && !running
  const picked = useRef(false)
  useEffect(() => {
    if (picked.current || !firstVisit || s.picked) return
    picked.current = true
    call('pick')
  }, [call, firstVisit, s.picked])

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
        <span>{running ? (busy === 'more' ? 'Checking the next ones…' : 'Searching…') : data.lastRunAt ? `Last search ${fmtAgo(data.lastRunAt)}` : 'Not searched yet'}</span>
        <button type="button" className="lfp-link" onClick={() => { setView('how'); window.scrollTo({ top: 0 }) }}>How it finds people</button>
        <button type="button" className="lfp-link" onClick={() => { setView('settings'); window.scrollTo({ top: 0 }) }}>Settings</button>
        {!firstVisit && <button type="button" className="lfp-link" disabled={running || !!busy} onClick={() => call('run')}>Find new leads</button>}
        {demo && <span>Demo: nothing is sent</span>}
      </div>
      {/* Only what's wrong shows on the page; the rest lives in Settings */}
      {!gmail && <div className="ag-note ag-note-warn">Connect Gmail so approved emails go out from your address. <a href="/api/gmail/connect">Connect Gmail</a></div>}
      {flags.hunterOut && !demo && <div className="ag-note ag-note-warn">Hunter’s email credits are used up, so new leads come without an email until they renew. You can still add one by hand.</div>}
      {data.lastError && !running && <div className="ag-note ag-note-crit">The last search had a problem: {data.lastError}</div>}
      <LiveProgress agent="lead" active={running} fallback={FINDER_PROGRESS} />
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
        badge={l.source === 'own' ? undefined : <span className="cl-fitb cl-fitb--good">Fit {l.score}/10</span>}
        why={why} quote={quote} state={state}
        onSkip={needs && l.status !== 'replied' ? () => skip(l) : undefined}
        action={<button type="button" className={`btn btn-sm ${needs ? 'btn-primary cl-reach' : 'cl-btn-outline'}`} onClick={() => openLead(l)}>{label}</button>} />
    )
  }

  function list() {
    const noun = lane === 'direct' ? ['person', 'people'] : ['post', 'posts']
    const verb = (l: Lead) => (l.status === 'needs_contact' ? 'Add their email' : isForum(l) ? (isPage(l) ? 'Write the message' : 'Write the reply') : 'Review the email')
    const more = lane === 'direct' ? s.sources.companies || !!s.sources.linkedin : s.sources.reddit
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
          <b>{busy === 'pick' ? 'Reading your brand to pick where to look…' : 'Find your first leads'}</b>
          {s.picked?.why && <p>{s.picked.why}</p>}
          <div className="lfp-acts lfp-acts--center">
            <button type="button" className="btn btn-ghost" onClick={() => setView('settings')}>Change where to look</button>
            <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => call('run')}>{busy === 'pick' ? <><Spinner />Picking…</> : 'Find leads'}</button>
          </div>
        </section>
      ) : !first ? (
        !running && <section className="lfp-empty">
          <b>All caught up</b>
          <p>{lane === 'direct' ? 'Everyone is emailed, messaged or skipped.' : 'Every post is answered or skipped.'} {s.enabled ? 'The next search runs tomorrow morning.' : ''}</p>
          <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => (more ? call('more', { lane: lane === 'direct' ? 'email' : 'community' }, 'more') : call('run'))}>Find more now</button>
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
        {more && <button type="button" className="lfp-link" disabled={!!busy} onClick={() => call('more', { lane: lane === 'direct' ? 'email' : 'community' }, 'more')}>{busy === 'more' ? 'Checking the next 10…' : 'Show 10 more'}</button>}
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
      <Settings key={s.picked?.at ?? 'none'} initial={s} saving={busy === 'settings'} picking={busy === 'pick'} hunter={flags.hunter}
        variant="finder" linkedin={!!flags.linkedin} competitors={competitors} quietDefault={!!flags.quietSocial}
        onCancel={back} onPick={() => call('pick')}
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
    return <>
      {backLink}
      <h1 className="lfp-title">How it finds people</h1>
      <div className="lfp-line"><span>Every source goes through the same steps, so every lead looks and reads the same.</span></div>
      <div className="lfp-srcs">
        <span>Google search and websites <small>DataForSEO</small></span>
        <span>People on LinkedIn <small>Apify</small></span>
        <span>Etsy and Instagram shops <small>Google</small></span>
        <span>Google Maps <small>DataForSEO</small></span>
        <span>Competitor reviewers <small>Trustpilot, Shopify</small></span>
        <span>Your own list <small>upload</small></span>
      </div>
      <div className="lfp-into">↓ all into one funnel</div>
      <ol className="lfp-funnel">
        <li><h4>Find</h4><p>Each source adds a company or a person. Repeats, people already emailed and people who opted out are dropped.</p></li>
        <li><h4>Fill in <small>free</small></h4><p>Read their website: what they sell, how many products, the newest product or post, who does their marketing, which social accounts they link. Size from DataForSEO visits, or LinkedIn headcount.</p></li>
        <li><h4>Check</h4><p>One AI check against your customer card: right trade, small, active, needs it, does their own marketing, buyers reached this way, and the right person (owner, founder or marketing). It learns from what you approve and skip. The rest go to “Checked but not kept”.</p></li>
        <li><h4>Social check <small>about 1–2¢ each, only for the ones kept</small></h4><p>When they last posted on Instagram and Facebook. Not posting for 3 months counts in their favour when your card says so.</p></li>
        <li><h4>Find the person and their email</h4><p>Stops at the first that works:</p>
          <ol>
            <li>An email that came with the lead (LinkedIn record, business listing)</li>
            <li>A person’s email on their own website</li>
            <li>Hunter, from the person’s name or the owner their site names, else an owner or marketing person</li>
            <li>LinkedIn search for an owner or marketing person at that company</li>
            <li>A shared address on their site, like hello@</li>
            <li>An email in their Instagram bio</li>
            <li>No email: a message on their Instagram or Facebook page</li>
          </ol></li>
        <li><h4>Write, you approve</h4><p>An email, or a short message when there’s no email, written when you open the lead. Nothing goes out until you approve. Same daily limit and follow-ups for everyone.</p></li>
      </ol>
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
