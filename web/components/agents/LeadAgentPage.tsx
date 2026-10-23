'use client'

import { useEffect, useRef, useState } from 'react'
import ToolHeader from '@/components/ToolHeader'
import type { Lead, LeadAgentData, LeadSettings } from '@/lib/agents/store'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/email-outreach/shared'
import { ActionBar, Card, DemoSwitch, Pager, usePages, Finished, Flow, ListTools, LiveProgress, Sec, Side, Src, Tabs, Tag } from '@/components/tool-ui'
import { Day, fmtAgo, fmtDate, initials, useAgentApi } from './shared'

// Lead Agent: finds people who need the product in two places, Reddit / Hacker News posts (a reply
// to post yourself) and Google Maps businesses (an email to approve), and follows up until they
// reply. Competitor reviews are Competitor Leads' job, not this one's. The two jobs are the two
// tabs (Community, Email); inside each, To do / Waiting / Done. The bar at the top says what it searches for (Change opens the settings); it searches
// by itself the first time the page is opened. Leads sit in three tabs: Needs you (replies to
// answer, emails to approve, forum replies to post), Waiting (sent, follow-ups running) and Done.
// A lead opens into two short steps, the same as Competitor Leads' reach-out page.

export interface LeadAgentFlags { dataforseo: boolean; hunter: boolean; gmail: boolean; demo: boolean; demoForced: boolean }

type TabKey = 'needs' | 'waiting' | 'done'
type Lane = 'community' | 'email'
type Section = 'replied' | 'approve' | 'post'

const COUNTRIES: [string, string][] = [['US', 'United States'], ['IN', 'India'], ['GB', 'United Kingdom'], ['CA', 'Canada'], ['AU', 'Australia'], ['DE', 'Germany'], ['FR', 'France'], ['AE', 'UAE'], ['SG', 'Singapore']]
const SOURCE: Record<Lead['source'], [string, 'orange' | 'amber' | undefined]> = {
  review: ['Unhappy reviewer', undefined], local: ['Google Maps', 'amber'], reddit: ['Reddit', 'orange'], forum: ['Hacker News', 'orange'],
}
const PROGRESS = ['Checking replies', 'Searching Google Maps', 'Searching Reddit and Hacker News', 'Checking who’s a good fit', 'Writing the emails and replies']

const isForum = (l: Lead) => l.source === 'reddit' || l.source === 'forum'
const laneOf = (l: Lead): Lane => (isForum(l) ? 'community' : 'email')
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())

function tabOf(l: Lead): TabKey {
  if (l.status === 'replied') return l.handledAt ? 'done' : 'needs'
  if (l.status === 'ready' || l.status === 'needs_contact') return 'needs'
  if (l.status === 'queued' || l.status === 'sent' || l.status === 'posted') return 'waiting'
  return 'done'
}
const sectionOf = (l: Lead): Section => (l.status === 'replied' ? 'replied' : l.reply ? 'post' : 'approve')
const nameOf = (l: Lead) => (isForum(l) ? l.title : l.name || l.company || l.title)
const firstOf = (l: Lead) => (isForum(l) ? 'them' : (l.name || l.company || l.title).split(/\s+/)[0])
const where = (l: Lead) => { try { return new URL(l.url).hostname.replace(/^www\./, '') } catch { return '' } }

function Settings({ initial, saving, onSave, onCancel }: {
  initial: LeadSettings; saving: boolean; onSave: (s: LeadSettings) => void; onCancel: () => void
}) {
  const [s, setS] = useState<LeadSettings>(initial)
  const [days, setDays] = useState(initial.followUpDays.join(', '))
  const set = <K extends keyof LeadSettings>(k: K, v: LeadSettings[K]) => setS(x => ({ ...x, [k]: v }))
  return (
    <form className="tu-panel" onSubmit={e => {
      e.preventDefault()
      onSave({ ...s, followUpDays: days.split(/[,\s]+/).map(Number).filter(n => n > 0) })
    }}>
      <h3>Search settings</h3>
      <p className="tu-hint">Filled in from your brand. Change anything.</p>
      <div className="tu-grid">
        <label className="tu-full">Who is your customer?
          <textarea rows={2} value={s.customer} onChange={e => set('customer', e.target.value)} placeholder="e.g. Small business owners (cafés, salons, shops) who post on Instagram and struggle to make content" />
        </label>
        <label className="tu-full">Google Maps search
          <input value={s.localQuery} onChange={e => set('localQuery', e.target.value)} placeholder="e.g. cafés in Pune" />
        </label>
        <label className="tu-chk tu-full"><input type="checkbox" checked={s.sources.local} onChange={e => set('sources', { ...s.sources, local: e.target.checked })} />
          <span>Email: businesses on Google Maps<small>No website, few reviews or a low rating. You approve each email.</small></span></label>
        <label className="tu-chk tu-full"><input type="checkbox" checked={s.sources.reddit} onChange={e => set('sources', { ...s.sources, reddit: e.target.checked })} />
          <span>Community: Reddit and Hacker News<small>Posts asking for a tool like yours. You post the reply yourself.</small></span></label>
        <label className="tu-chk tu-full"><input type="checkbox" checked={s.enabled} onChange={e => set('enabled', e.target.checked)} />
          <span>Search every morning automatically<small>New leads are waiting each day. Nothing is sent without you.</small></span></label>
      </div>
      <details className="tu-more">
        <summary>More options</summary>
        <div className="tu-grid">
          <label>Country
            <select value={s.country} onChange={e => set('country', e.target.value)}>{COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
          </label>
          <label>Most new emails a day
            <input type="number" min={1} max={30} value={s.dailyLimit} onChange={e => set('dailyLimit', Math.max(1, Math.min(30, Number(e.target.value) || 1)))} />
          </label>
          <label>Follow up after (days)
            <input value={days} onChange={e => setDays(e.target.value)} placeholder="3, 7" />
          </label>
          <label className="tu-chk tu-full"><input type="checkbox" checked={s.skipEU} onChange={e => set('skipEU', e.target.checked)} />
            <span>Don&apos;t cold-email businesses in the EU<small>EU rules on marketing email are stricter. They still show up as leads.</small></span></label>
          <label className="tu-chk tu-full"><input type="checkbox" checked={s.mode === 'auto'} onChange={e => set('mode', e.target.checked ? 'auto' : 'approve')} />
            <span>Send on its own after I&apos;ve approved 20<small>Only leads scoring 8 or more, within your daily limit.</small></span></label>
        </div>
      </details>
      <div className="tu-panel-acts">
        <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? <><Spinner />Saving…</> : 'Save'}</button>
      </div>
    </form>
  )
}

export default function LeadAgentPage({ initial, flags }: { initial: LeadAgentData; flags: LeadAgentFlags }) {
  const { data, busy, call, toast: said } = useAgentApi<LeadAgentData>('/api/agents/lead', initial)
  const [toast, notify] = useToast()
  // What the server says back (errors, "Sent", the search summary) shows in the toast
  useEffect(() => { if (said) notify(said) }, [said, notify])
  const s = data.settings
  // Open on the job with something to do: email first (replies wait there), else community
  const [lane, setLane] = useState<Lane>(() => initial.leads.some(l => tabOf(l) === 'needs' && laneOf(l) === 'email') || !initial.leads.some(l => tabOf(l) === 'needs') ? 'email' : 'community')
  const [demo, setDemo] = useState(flags.demo)
  // In demo mode nothing is really sent, so Gmail isn't needed
  const gmail = flags.gmail || demo
  const [tab, setTab] = useState<TabKey>('needs')
  const [panel, setPanel] = useState(false)
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [stepNo, setStepNo] = useState(1)
  // Drafts being edited in the open lead
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [reply, setReply] = useState('')

  const running = busy === 'run' || busy === 'demo_skip'
  // Nothing to fill in first: the first visit starts a search straight away
  const auto = useRef(false)
  useEffect(() => {
    if (auto.current || data.lastRunAt || data.leads.length) return
    auto.current = true
    call('run')
  }, [call, data.lastRunAt, data.leads.length])

  const act = (op: string, payload: Record<string, unknown>, key = `${op}:${payload.id ?? ''}`) =>
    call(op, payload, key) as Promise<{ ok?: boolean; error?: string; message?: string; data?: LeadAgentData } | null>

  const leads = data.leads
  const inLane = (ln: Lane, k: TabKey) => leads.filter(l => laneOf(l) === ln && tabOf(l) === k)
  const byTab = (k: TabKey) => inLane(lane, k)
  const hot = leads.some(l => tabOf(l) === 'needs' && l.status === 'replied')

  // The list on screen: this tab, searched, in section order (replies first), a page at a time
  const SECTIONS = ['replied', 'approve', 'post'] as const
  const tabAll = byTab(tab)
  const needle = q.trim().toLowerCase()
  const shown = tabAll
    .filter(l => !needle || `${nameOf(l)} ${l.why} ${l.snippet}`.toLowerCase().includes(needle))
    .sort((a, b) => (tab === 'needs' ? SECTIONS.indexOf(sectionOf(a)) - SECTIONS.indexOf(sectionOf(b)) : 0))
  const pg = usePages(shown, [lane, tab, needle])
  const listTop = useRef<HTMLDivElement>(null)
  const open = openId ? leads.find(l => l.id === openId) ?? null : null

  function openLead(l: Lead) {
    setOpenId(l.id); setStepNo(1)
    setTo(l.email ?? ''); setSubject(l.draft?.subject ?? ''); setBody(l.draft?.body ?? ''); setReply(l.reply ?? '')
    window.scrollTo({ top: 0 })
  }
  function skip(l: Lead) {
    act('skip', { id: l.id })
    if (openId === l.id) setOpenId(null)
    notify('Skipped. Moved to Done.', () => { call('restore', { id: l.id }, `restore:${l.id}`) })
  }

  // ── The list ───────────────────────────────────────────────────────────────

  function card(l: Lead) {
    const t = tabOf(l)
    const [srcLabel, tone] = SOURCE[l.source]
    const state =
      l.status === 'replied' ? <Tag tone={l.handledAt ? 'ok' : 'crit'}>{l.handledAt ? '✓ Answered' : `Replied${l.repliedAt ? ` ${fmtDate(l.repliedAt)}` : ''}`}</Tag>
      : l.status === 'needs_contact' ? <Tag tone="warn">Needs an email</Tag>
      : l.status === 'ready' ? <Tag>{l.reply ? 'Reply drafted' : 'Email drafted'}</Tag>
      : l.status === 'queued' ? <Tag tone="warn">Approved · goes out tomorrow</Tag>
      : l.status === 'sent' ? <Tag tone="ok">✓ Emailed {fmtDate(l.sentAt)}</Tag>
      : l.status === 'posted' ? <Tag tone="ok">✓ Posted</Tag>
      : l.status === 'opted_out' ? <Tag>Not interested</Tag>
      : l.status === 'bounced' ? <Tag tone="crit">Bounced</Tag>
      : <Tag>Skipped</Tag>
    const why = l.status === 'sent'
      ? (l.nextFollowUpAt ? `Follow-up ${l.followupsSent + 1} goes out ${fmtDate(l.nextFollowUpAt)} unless they reply.` : 'All follow-ups sent. Waiting for a reply.')
      : l.status === 'replied' && !l.handledAt ? 'They answered your email. Reply while they’re interested.'
      : l.why
    const quote = l.status === 'replied' && l.replyNote ? `“${l.replyNote}”` : l.snippet ? (isForum(l) ? `“${l.snippet}”` : l.snippet) : undefined
    const label = t !== 'needs' ? 'View' : l.status === 'replied' ? 'Reply →' : l.reply ? 'Write reply →' : 'Review email →'
    return (
      <Card key={l.id} av={isForum(l) ? (l.source === 'reddit' ? 'r/' : 'Y') : initials(nameOf(l))} square={isForum(l)}
        name={nameOf(l)}
        sub={<><Src label={srcLabel} tone={tone} /><span>{isForum(l) ? where(l) : [l.company !== nameOf(l) ? l.company : null, l.website].filter(Boolean).join(' · ')}</span><span>found <Day iso={l.foundAt} /></span></>}
        badge={<span className="cl-fitb cl-fitb--good">Fit {l.score}/10</span>}
        why={why} quote={quote} state={state}
        onSkip={t === 'needs' && l.status !== 'replied' ? () => skip(l) : undefined}
        action={<button type="button" className={`btn btn-sm ${t === 'needs' ? 'btn-primary cl-reach' : 'cl-btn-outline'}`} onClick={() => openLead(l)}>{label}</button>} />
    )
  }

  function list() {
    const all = tabAll
    const tools = <>
      <div ref={listTop} className="tu-anchor" />
      <div className="tu-filter">
        <div className="cl-seg" role="group" aria-label="Show">
          {([['needs', 'To do'], ['waiting', 'Waiting'], ['done', 'Done']] as const).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={tab === k} onClick={() => { setTab(k); setQ('') }}>{label} <span>{byTab(k).length}</span></button>
          ))}
        </div>
        <span className="cl-muted">{lane === 'email' ? 'Businesses on Google Maps. You approve every email.' : 'Posts on Reddit and Hacker News. You post every reply yourself.'}</span>
      </div>
      <ListTools q={q} setQ={setQ} shown={shown.length} total={all.length} onClear={() => setQ('')} />
    </>
    if (!shown.length) {
      return <>{tools}<div className="tu-empty">{all.length ? 'Nothing matches.'
        : running && !leads.length ? 'Your first leads appear here in a moment.'
        : tab === 'needs' ? (lane === 'email'
          ? (s.sources.local ? 'No emails to approve. New businesses appear after the next search.' : 'Google Maps is off. Turn it on in Search settings to find businesses to email.')
          : (s.sources.reddit ? 'No posts to answer. New ones appear after the next search.' : 'Reddit and Hacker News are off. Turn them on in Search settings.'))
        : tab === 'waiting' ? (lane === 'email' ? 'Nothing waiting. Emails you send show up here until they reply.' : 'Nothing waiting. Replies you post show up here.')
        : 'Nothing here yet.'}</div></>
    }
    if (tab !== 'needs') return <>{tools}{pg.items.map(card)}<Pager p={pg} top={listTop} /></>
    const approvable = shown.filter(l => l.status === 'ready' && !l.reply && l.email && l.draft).length
    return <>{tools}
      {([['replied', 'Replied: answer while they’re interested', 'crit'], ['approve', 'Emails to approve', undefined], ['post', 'Replies to post', undefined]] as const).map(([k, label, tone]) => {
        // This page's cards of the section; the heading counts the whole section
        const items = pg.items.filter(l => sectionOf(l) === k)
        if (!items.length) return null
        // Community has only one kind, so no heading
        if (k === 'post') return <div key={k}>{items.map(card)}</div>
        return (
          <div key={k}>
            <div className="tu-sec-row">
              <Sec label={label} count={shown.filter(l => sectionOf(l) === k).length} tone={tone} />
              {k === 'approve' && approvable > 1 && gmail && (
                <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => act('approve_all', {}, 'approve_all')}>
                  {busy === 'approve_all' ? <><Spinner />Sending…</> : `Approve all ${approvable}`}
                </button>
              )}
            </div>
            {items.map(card)}
          </div>
        )
      })}
      <Pager p={pg} top={listTop} />
    </>
  }

  // ── One lead ───────────────────────────────────────────────────────────────

  function detail(l: Lead) {
    const [srcLabel, tone] = SOURCE[l.source]
    const side = <Side av={isForum(l) ? (l.source === 'reddit' ? 'r/' : 'Y') : initials(nameOf(l))} square={isForum(l)} name={nameOf(l)}
      sub={<><Src label={srcLabel} tone={tone} /><a className="th-link" href={l.url} target="_blank" rel="noopener noreferrer">See it ↗</a></>}
      quote={l.snippet || undefined} why={l.why} />
    const back = { label: 'Lead Agent', onClick: () => setOpenId(null) }
    const next = leads.find(x => x.id !== l.id && tabOf(x) === 'needs' && laneOf(x) === laneOf(l))
    const nextBtn = next && <button key="next" type="button" className="btn btn-primary" onClick={() => openLead(next)}>Next: {firstOf(next) === 'them' ? nameOf(next).slice(0, 28) + (nameOf(next).length > 28 ? '…' : '') : firstOf(next)} →</button>
    const backBtn = <button key="back" type="button" className="btn btn-ghost ro-back" onClick={() => setOpenId(null)}>← Back to the list</button>
    const steps = l.reply ? ['Check the reply', 'Post it'] : l.status === 'replied' ? ['Reply'] : ['Their email', 'Review & send']
    const flow = (at: number, title: string, hint: React.ReactNode, content: React.ReactNode, actions: React.ReactNode) =>
      <Flow back={back} crumb={nameOf(l)} side={side} steps={steps} at={at} title={title} hint={hint} actions={actions} stepKey={`${l.id}:${at}:${l.status}`}>{content}</Flow>

    // Finished: what happened, a way back, and the next one
    if (tabOf(l) !== 'needs') {
      const [title, text, grey] =
        l.status === 'queued' ? ['Approved', `You've reached today's limit of ${s.dailyLimit} emails, so it goes out tomorrow.`, false]
        : l.status === 'sent' ? [`Email sent to ${firstOf(l)}`, <>Sent {l.sentAt ? `on ${fmtDate(l.sentAt)} ` : ''}from your Gmail{l.email ? <> to <b>{l.email}</b></> : null}. {l.nextFollowUpAt ? `A follow-up goes out ${fmtDate(l.nextFollowUpAt)} if they don’t reply.` : 'All follow-ups are sent.'}</>, false]
        : l.status === 'posted' ? ['Marked as posted', 'Thanks. Keep an eye on the thread for answers.', false]
        : l.status === 'replied' ? ['Answered', l.replyNote ? `They said: “${l.replyNote}”` : 'You answered their reply.', false]
        : l.status === 'opted_out' ? ['Not interested', `${l.replyNote ? `They said: “${l.replyNote}”. ` : ''}Follow-ups stopped.`, true]
        : l.status === 'bounced' ? ['The email bounced', 'The address doesn’t work, so follow-ups stopped.', true]
        : ['Skipped', 'You skipped this one. Bring it back if you change your mind.', true]
      return flow(steps.length + 1, '', null, <Finished title={title} text={text} grey={grey} />, <>
        {backBtn}
        {(l.status === 'skipped' || (l.status === 'replied' && l.handledAt)) && (
          <button key="restore" type="button" className="btn cl-btn-outline" disabled={!!busy} onClick={() => { call('restore', { id: l.id }, `restore:${l.id}`); setStepNo(1) }}>Bring it back</button>
        )}
        {nextBtn}
      </>)
    }

    // They replied: open the thread in Gmail and answer there
    if (l.status === 'replied') {
      return flow(1, `${firstOf(l)} replied`, 'Answer from Gmail, in the same thread. Then mark it as answered here.',
        <div className="tu-stack">
          {l.replyNote && <blockquote className="ro-quote tu-reply">“{l.replyNote}”</blockquote>}
          {l.threadId && <a className="btn cl-btn-outline tu-self" href={`https://mail.google.com/mail/u/0/#all/${l.threadId}`} target="_blank" rel="noopener noreferrer">Open the thread in Gmail ↗</a>}
        </div>,
        <>
          {backBtn}
          <button key="answered" type="button" className="btn btn-primary" disabled={!!busy} onClick={() => act('handled', { id: l.id })}>I’ve answered →</button>
        </>)
    }

    // A forum reply: check it, then copy it onto the post
    if (l.reply) {
      if (stepNo === 1) {
        return flow(1, 'Check the reply', 'Helpful answer first, your product second. Make it sound like you.',
          <div className="ro-mail"><textarea className="ro-mail-body" aria-label="Reply" rows={9} value={reply} onChange={e => setReply(e.target.value)} /></div>,
          <>
            <button key="skip" type="button" className="btn btn-ghost ro-back" onClick={() => skip(l)}>Skip</button>
            <button key="ok" type="button" className="btn btn-primary" disabled={!reply.trim()} onClick={() => { if (reply !== l.reply) call('save', { id: l.id, reply }, `save:${l.id}`); setStepNo(2) }}>Looks good →</button>
          </>)
      }
      return flow(2, `Post it on ${l.source === 'reddit' ? 'Reddit' : 'Hacker News'}`, `${l.source === 'reddit' ? 'Reddit' : 'Hacker News'} doesn’t allow posting for you. Copy the reply, open the post, paste it.`,
        <div className="tu-stack">
          <div className="tu-draft">{reply}</div>
          <div className="tu-row">
            <button type="button" className="btn cl-btn-outline" onClick={async () => { try { await navigator.clipboard.writeText(reply); notify('Reply copied. Paste it on the post.') } catch { notify('Couldn’t copy. Select the text and copy it.') } }}>1 · Copy reply</button>
            <a className="btn cl-btn-outline" href={l.url} target="_blank" rel="noopener noreferrer">2 · Open post ↗</a>
          </div>
        </div>,
        <>
          <button key="b2" type="button" className="btn btn-ghost ro-back" onClick={() => setStepNo(1)}>← Back</button>
          <button key="posted" type="button" className="btn btn-primary" disabled={!!busy} onClick={() => act('posted', { id: l.id })}>3 · I’ve posted it</button>
        </>)
    }

    // An email: who it goes to, then the email itself
    if (stepNo === 1) {
      const writing = busy === `email:${l.id}`
      return flow(1, 'Where should it go?', l.email ? 'We looked up their email. Check it, or paste the right one.' : 'No public email was found. Paste it if you know it, and the email gets written for them.',
        writing ? <div className="ro-working"><Spinner /><span>Writing the email for {firstOf(l)}…</span><i /></div> : <>
          {l.email
            ? <div className="ro-found"><span className="ro-found-ic" aria-hidden="true">✉</span><div><b>Found {firstOf(l)}’s email</b><span>{l.emailVerified ? 'verified' : `on ${l.website ?? 'their website'} · not verified, so double-check it`}</span></div></div>
            : <div className="ro-found ro-found--none"><span className="ro-found-ic" aria-hidden="true">?</span><div><b>No public email found</b><span>Try their {l.website ? <a className="th-link" href={`https://${l.website}`} target="_blank" rel="noopener noreferrer">website ↗</a> : 'website'}{l.phone ? ` or call ${l.phone}` : ''}.</span></div></div>}
          <form id={`to-${l.id}`} className="ro-field" onSubmit={async e => {
            e.preventDefault()
            if (!validEmail(to)) return
            if (to.trim().toLowerCase() !== (l.email ?? '') || !l.draft) {
              const r = await act('email', { id: l.id, email: to })
              if (r?.error) return
              const fresh = r?.data?.leads.find(x => x.id === l.id)
              if (fresh?.draft) { setSubject(fresh.draft.subject); setBody(fresh.draft.body) }
            }
            setStepNo(2)
          }}>
            <label htmlFor={`to-in-${l.id}`}>Email address</label>
            <input id={`to-in-${l.id}`} type="email" value={to} onChange={e => setTo(e.target.value)} placeholder="name@company.com" />
          </form>
        </>,
        writing ? null : <>
          <button key="skip" type="button" className="btn btn-ghost ro-back" onClick={() => skip(l)}>Skip</button>
          <button key="cont" type="submit" form={`to-${l.id}`} className="btn btn-primary" disabled={!validEmail(to)}>Continue →</button>
        </>)
    }
    const sending = busy === `approve:${l.id}`
    return flow(2, 'Check the email, then send it', 'Short and plain, from your Gmail. Edit anything.',
      <>
        {!gmail && <div className="ro-error"><span>Connect Gmail so the email goes out from your address.</span><a className="btn btn-primary btn-sm" href="/api/gmail/connect">Connect Gmail</a></div>}
        <div className="ro-mail">
          <label className="ro-mail-row"><span>To</span><input value={to} readOnly /></label>
          <label className="ro-mail-row"><span>Subject</span><input value={subject} onChange={e => setSubject(e.target.value)} /></label>
          <textarea className="ro-mail-body" aria-label="Message" rows={10} value={body} onChange={e => setBody(e.target.value)} />
          <div className="ro-mail-tools">
            <span className="cl-muted">Ends with a short “reply no if this isn’t relevant” line. Follow-ups after {s.followUpDays.join(' and ') || '—'} days stop when they reply.</span>
          </div>
        </div>
      </>,
      <>
        <button key="b" type="button" className="btn btn-ghost ro-back" disabled={sending} onClick={() => setStepNo(1)}>← Back</button>
        <button key="send" type="button" className="btn btn-primary" disabled={sending || !gmail || !subject.trim() || !body.trim()}
          onClick={() => act('approve', { id: l.id, subject, body }, `approve:${l.id}`)}>
          {sending ? <><Spinner />Sending…</> : 'Send email →'}
        </button>
      </>)
  }

  // ── Page ───────────────────────────────────────────────────────────────────

  const sources = [
    s.sources.local ? (s.localQuery ? `Google Maps “${s.localQuery}”` : 'Google Maps (add a search)') : null,
    s.sources.reddit ? 'Reddit and Hacker News' : null,
  ].filter(Boolean)
  const customer = (s.customer || 'your customers').split(/[.(]/)[0].trim().slice(0, 70)

  return (
    <div className="tool-page">
      <ToolHeader
        icon="bot"
        title="Lead Agent"
        intro="leadAgent"
        chips={<>
          {demo ? <span className="th-chip th-chip--warn">Demo: nothing is sent</span>
            : <span className={`th-chip ${gmail ? 'th-chip--on' : 'th-chip--warn'}`}>{gmail ? 'Gmail connected' : 'Gmail not connected'}</span>}
          {s.enabled && !demo && <span className="th-chip">Searches every morning</span>}
        </>}
        actions={<DemoSwitch on={demo} forced={flags.demoForced} busy={!!busy} onChange={async on => {
          const r = await call('demo', { on }) as { demo?: boolean; data?: LeadAgentData } | null
          if (typeof r?.demo !== 'boolean') return
          setDemo(r.demo); setOpenId(null); setTab('needs')
          // Never run in this mode yet (first time in demo): the first-visit search above starts it
        }} />}
      />
      {open ? detail(open) : <>
        {!gmail && <div className="ag-note ag-note-warn">Connect Gmail so approved emails go out from your address. <a href="/api/gmail/connect">Connect Gmail</a></div>}
        {!flags.dataforseo && (s.sources.reddit || s.sources.local) && <div className="ag-note ag-note-warn">Reddit and Google Maps search need GrowJin&apos;s DataForSEO account, which isn&apos;t set up yet. Hacker News and competitor reviews still work.</div>}
        {data.lastError && !running && <div className="ag-note ag-note-crit">The last search had a problem: {data.lastError}</div>}

        {panel && <Settings initial={s} saving={busy === 'settings'} onCancel={() => setPanel(false)}
          onSave={async next => { const r = await call('settings', { settings: next }); if (r?.data) { setPanel(false); notify('Saved') } }} />}
        <ActionBar
          status={running ? (data.lastRunAt ? 'Looking for new leads…' : 'Running your first search…') : data.lastRunAt ? `Last search ${fmtAgo(data.lastRunAt)}${data.lastRunSummary ? ` · ${data.lastRunSummary}` : ''}` : 'Not searched yet'}
          setup={<>Looking for <b>{customer}</b>{sources.length ? ` via ${sources.join(', ')}` : ' (no sources on)'}</>}
          onChange={() => setPanel(p => !p)}
          secondary={<>
            {/* Demo mode: move time on so follow-ups and replies show */}
            {demo && data.lastRunAt && <button className="btn btn-ghost" type="button" disabled={!!busy} onClick={() => call('demo_skip')}>{busy === 'demo_skip' ? <><Spinner />Skipping ahead…</> : 'Skip ahead 3 days'}</button>}
            <button type="button" className="btn btn-ghost" aria-expanded={panel} onClick={() => setPanel(p => !p)}>Search settings</button>
          </>}
          primary={<button type="button" className="btn btn-primary" disabled={running || !!busy} onClick={() => { setPanel(false); call('run') }}>{running ? <><Spinner />Working…</> : 'Find new leads'}</button>} />
        <LiveProgress agent="lead" active={running} fallback={PROGRESS} />

        <Tabs value={lane} onChange={k => { setLane(k); setTab('needs'); setQ('') }} tabs={[
          { key: 'email', label: 'Email', count: inLane('email', 'needs').length, hot },
          { key: 'community', label: 'Community', count: inLane('community', 'needs').length },
        ]} />
        {list()}
      </>}
      {toast}
    </div>
  )
}
