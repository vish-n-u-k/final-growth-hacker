'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LeadList, ThreadList, ToolLead, ToolThread } from '@/lib/mcp/tools/inbox'
import { copy, LeadPanel, ReplyPanel, tool, Top } from './AskPanel'

// Ask's workspaces (design-previews/seo-ask/ask-everything-here.html): Leads, Email and Write, in a
// panel over Ask, so nothing sends people to the old pages. Everything is read and done through the
// MCP tools (POST /api/ask/tool); Claude writes (POST /api/ask/write). One blue button per screen.

const ago = (iso?: string | null) => {
  if (!iso) return ''
  const h = Math.round((Date.now() - Date.parse(iso)) / 3_600_000)
  return h < 1 ? 'less than an hour ago' : h < 24 ? `${h} h ago` : `${Math.round(h / 24)} days ago`
}
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`

async function write<T>(body: Record<string, unknown>): Promise<T & { error?: string }> {
  const r = await fetch('/api/ask/write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return r.json().catch(() => ({ error: 'Couldn’t write it this time. Try again.' }))
}

function Tabs<T extends string>({ tabs, cur, set }: { tabs: { id: T; label: string }[]; cur: T; set: (t: T) => void }) {
  return (
    <div className="ask-tabs" role="tablist">
      {tabs.map(t => <button key={t.id} type="button" role="tab" aria-selected={cur === t.id} className="ask-tab" onClick={() => set(t.id)}>{t.label}</button>)}
    </div>
  )
}

function Start({ title, why, label, onClick }: { title: string; why: string; label: string; onClick: () => void }) {
  return (
    <div className="ask-start">
      <div><b>{title}</b><span>{why}</span></div>
      <button type="button" className="ask-btn" onClick={onClick}>{label}</button>
    </div>
  )
}

// ── Leads ─────────────────────────────────────────────────────────────────────

interface EngineStatus { status: 'running' | 'done' | 'failed' | 'stopped'; log: { at: string; text: string }[]; added?: number; error?: string; costUsd: number; startedAt: string }

export function LeadsWorkspace({ lane: startLane, find, onChange, onClose }: { lane?: 'email' | 'talk'; find?: boolean; onChange: () => void; onClose: () => void }) {
  const [lane, setLane] = useState<'email' | 'talk'>(startLane ?? 'email')
  const [lists, setLists] = useState<{ email: LeadList; talk: LeadList } | null>(null)
  const [view, setView] = useState<'list' | 'find' | 'done'>(find ? 'find' : 'list')
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [email, talk] = await Promise.all([
      tool<LeadList>('list_leads', { status: 'to_do', lane: 'email', limit: 100 }),
      tool<LeadList>('list_leads', { status: 'to_do', lane: 'talk', limit: 100 }),
    ])
    if (email.error) return setError(email.error)
    setLists({ email, talk })
  }, [])
  useEffect(() => { load() }, [load])

  if (open) return <LeadPanel start={open} lane={lane} onChange={onChange} onClose={() => { setOpen(null); load() }} />
  if (view === 'find') return <FindLeads onBack={() => { setView('list'); load() }} onClose={onClose} onChange={onChange} />
  if (view === 'done') return <SentLeads onBack={() => setView('list')} onClose={onClose} />
  if (!lists) return <div className="ask-sheet-in"><Top label="Leads" onClose={onClose} /><p className="ask-sheet-lede">{error || 'Opening…'}</p></div>

  const cur = lists[lane]
  const workable = (cur.leads ?? []).filter(l => !l.needs_email || l.message_on)
  const noEmail = (cur.leads ?? []).length - workable.length
  const done = (cur.counts?.sent ?? 0) + (cur.counts?.skipped ?? 0) + (cur.counts?.posted ?? 0) + (cur.counts?.replied ?? 0)
  const count = (l: LeadList) => (l.leads ?? []).filter(x => !x.needs_email || x.message_on).length
  const [top, ...rest] = workable
  return (
    <div className="ask-sheet-in">
      <Top label="Leads" onClose={onClose} />
      <h2 className="ask-sheet-h">Your leads</h2>
      <p className="ask-quiet">
        {cur.last_search?.at ? <>Last search {ago(cur.last_search.at)} · </> : null}
        <button type="button" className="ask-tl" onClick={() => setView('find')}>Find new leads</button>
        {done > 0 && <> · <button type="button" className="ask-tl" onClick={() => setView('done')}>{plural(done, 'lead')} sent or skipped</button></>}
      </p>
      <Tabs tabs={[{ id: 'email' as const, label: `Contact directly · ${count(lists.email)}` }, { id: 'talk' as const, label: `Join conversations · ${count(lists.talk)}` }]} cur={lane} set={setLane} />
      {!top
        ? <div className="ask-empty"><p>{lane === 'talk' ? 'No posts to reply to right now. New ones are found every morning.' : 'Nothing waiting for your OK.'}</p><button type="button" className="ask-btn" onClick={() => setView('find')}>Find new leads</button></div>
        : <>
          <Start
            title={lane === 'talk' ? `${plural(workable.length, 'post')} to reply to` : `${plural(workable.length, 'lead')} ready for your OK`}
            why={`Start with ${top.name}${top.why ? `: ${top.why}` : ''}`}
            label={lane === 'talk' ? 'Write a reply' : 'Review the email'}
            onClick={() => setOpen(top.id)}
          />
          <div className="ask-rows">
            {rest.slice(0, 30).map(l => (
              <button key={l.id} type="button" className="ask-row" onClick={() => setOpen(l.id)}>
                <span><b>{l.name}</b><small>{l.why || l.from}</small></span>
                {l.rating && <em>{l.rating}</em>}
              </button>
            ))}
          </div>
          {rest.length > 30 && <p className="ask-faint">And {rest.length - 30} more after these.</p>}
        </>}
      {noEmail > 0 && <p className="ask-faint">{plural(noEmail, 'good fit')} without an email or page to message yet.</p>}
      {error && <p className="ask-err" role="alert">{error}</p>}
    </div>
  )
}

function FindLeads({ onBack, onClose, onChange }: { onBack: () => void; onClose: () => void; onChange: () => void }) {
  const [job, setJob] = useState<EngineStatus | null>(null)
  const [error, setError] = useState('')
  const [started, setStarted] = useState(false)
  const [queued, setQueued] = useState('')   // runs go to the admin queue: the team starts it
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The Lead Engine: Claude with the dataforseo / hunter / apify tools, saving with save_leads' code
  const poll = useCallback(async () => {
    const j = await fetch('/api/leads/engine').then(r => r.json()).catch(() => null) as { job?: EngineStatus | null } | null
    if (j?.job) setJob(j.job)
    if (j?.job?.status === 'running') timer.current = setTimeout(poll, 4000)
    else if (j?.job) onChange()
  }, [onChange])
  useEffect(() => { poll(); return () => { if (timer.current) clearTimeout(timer.current) } }, [poll])

  async function start() {
    setError(''); setStarted(true)
    const r = await fetch('/api/leads/engine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'start' }) })
    const j = await r.json().catch(() => ({})) as { job?: EngineStatus; error?: string; queued?: boolean }
    if (j.queued) { setStarted(false); return setQueued(j.error ?? 'Sent to the GrowJin team.') }
    if (!r.ok || !j.job) { setStarted(false); return setError(j.error ?? 'Couldn’t start a search.') }
    setJob(j.job); timer.current = setTimeout(poll, 4000)
  }
  async function stop() {
    await fetch('/api/leads/engine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'stop' }) })
    poll()
  }

  const running = job?.status === 'running'
  const fresh = job && (started || running)
  return (
    <div className="ask-sheet-in">
      <Top label="Leads · find new ones" onClose={onClose} />
      <p className="ask-quiet"><button type="button" className="ask-tl" onClick={onBack}>← Your leads</button></p>
      <h2 className="ask-sheet-h">{running ? 'Finding new leads…' : fresh && job?.status === 'done' ? `${plural(job.added ?? 0, 'new lead')} found` : 'Find new leads'}</h2>
      <p className="ask-sheet-lede">
        {running ? 'Usually 3 to 10 minutes. Keep this open: the search moves on while Ask is open.'
          : fresh && job?.status === 'done' ? 'They’re at the top of your list.'
            : 'Searches Google, company data and LinkedIn for businesses like your customers, checks each one and finds the right email. Uses your lead settings.'}
      </p>
      {fresh && job && (
        <ul className="ask-fill-list">
          {job.log.map((l, i) => <li key={i} className={`ask-fs ${running && i === job.log.length - 1 ? 'is-on' : 'is-done'}`}><i aria-hidden="true" />{l.text}</li>)}
        </ul>
      )}
      {fresh && job && <p className="ask-faint">Spent so far: ${job.costUsd.toFixed(2)}</p>}
      <div className="ask-acts">
        {running
          ? <button type="button" className="ask-btn ask-btn-quiet" onClick={stop}>Stop and keep what’s found</button>
          : fresh && job?.status === 'done'
            ? <button type="button" className="ask-btn" onClick={onBack}>See the leads</button>
            : <button type="button" className="ask-btn" onClick={start} disabled={started || !!queued}>Start a search</button>}
      </div>
      {queued && <p className="ask-said" role="status">{queued}</p>}
      {(error || (fresh && job?.error)) && <p className="ask-err" role="alert">{error || job?.error}</p>}
    </div>
  )
}

function SentLeads({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const [rows, setRows] = useState<ToolLead[] | null>(null)
  useEffect(() => {
    Promise.all(['sent', 'replied', 'posted', 'skipped'].map(status => tool<LeadList>('list_leads', { status, limit: 40 })))
      .then(rs => setRows(rs.flatMap(r => r.leads ?? []).sort((a, b) => Date.parse(b.replied_at ?? b.sent_at ?? b.found_at) - Date.parse(a.replied_at ?? a.sent_at ?? a.found_at))))
  }, [])
  const word: Record<string, string> = { sent: 'Sent', replied: 'Replied', posted: 'Posted', skipped: 'Skipped' }
  return (
    <div className="ask-sheet-in">
      <Top label="Leads · sent or skipped" onClose={onClose} />
      <p className="ask-quiet"><button type="button" className="ask-tl" onClick={onBack}>← Your leads</button></p>
      <h2 className="ask-sheet-h">Sent or skipped</h2>
      {!rows ? <p className="ask-sheet-lede">Opening…</p> : !rows.length ? <p className="ask-sheet-lede">Nothing yet.</p> : (
        <div className="ask-rows">
          {rows.slice(0, 80).map(l => (
            <div key={l.id} className={`ask-row is-static${l.status === 'replied' ? ' is-reply' : ''}`}>
              <span><b>{l.name}</b><small>{l.reply_says ? `“${l.reply_says}”` : l.why}</small></span>
              <em>{word[l.status] ?? l.status}{l.sent_at ? ` · ${ago(l.sent_at)}` : ''}{l.skipped_by === 'GrowJin' ? ' by GrowJin' : ''}</em>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Email ─────────────────────────────────────────────────────────────────────

interface Gmail { connected?: boolean; address?: string | null; left_today?: number; daily_limit?: number; ready_to_send?: boolean; problem?: string | null }

export function EmailWorkspace({ tab: startTab, onChange, onClose }: { tab?: 'replies' | 'due' | 'list'; onChange: () => void; onClose: () => void }) {
  const [tab, setTab] = useState<'replies' | 'due' | 'list'>(startTab ?? 'replies')
  const [replies, setReplies] = useState<ToolThread[] | null>(null)
  const [due, setDue] = useState<ToolThread[] | null>(null)
  const [gmail, setGmail] = useState<Gmail | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(() => {
    tool<ThreadList>('list_replies', { show: 'replies', days: 14, limit: 50 }).then(r => setReplies(r.threads ?? []))
    tool<ThreadList>('list_replies', { show: 'due', limit: 50 }).then(r => setDue(r.threads ?? []))
    tool<Gmail>('gmail_status').then(setGmail)
  }, [])
  useEffect(() => { load() }, [load])

  if (open) return <ReplyPanel start={open} show={tab === 'due' ? 'due' : 'replies'} onChange={onChange} onClose={() => { setOpen(null); load() }} />

  const rows = tab === 'replies' ? replies : due
  return (
    <div className="ask-sheet-in">
      <Top label="Email" onClose={onClose} />
      <h2 className="ask-sheet-h">Email</h2>
      <p className="ask-quiet">
        {!gmail ? 'Checking Gmail…'
          : gmail.connected ? <>Sending from {gmail.address ?? 'your Gmail'} · {plural(gmail.left_today ?? 0, 'email')} left today</>
            : <>{gmail.problem ?? 'Gmail isn’t connected.'} <a className="ask-tl" href="/api/gmail/connect">Connect Gmail</a></>}
      </p>
      <Tabs tabs={[
        { id: 'replies' as const, label: `Replies · ${replies?.length ?? '…'}` },
        { id: 'due' as const, label: `Follow-ups · ${due?.length ?? '…'}` },
        { id: 'list' as const, label: 'Send to a list' },
      ]} cur={tab} set={setTab} />
      {tab === 'list' ? <ListSend gmail={gmail} onChange={onChange} />
        : !rows ? <p className="ask-faint">Opening…</p>
          : !rows.length ? <p className="ask-empty">{tab === 'replies' ? 'No new replies in the last 14 days. Follow-ups keep going out by themselves.' : 'No follow-ups are due.'}</p>
            : <>
              <Start
                title={tab === 'replies' ? `${plural(rows.length, 'person', 'people')} replied` : `${plural(rows.length, 'follow-up')} due`}
                why={tab === 'replies' ? `${rows[0].to}${rows[0].says ? `: “${rows[0].says}”` : ''}` : `${rows[0].to}: ${rows[0].subject}`}
                label={tab === 'replies' ? 'Answer' : 'Write the follow-up'}
                onClick={() => setOpen(rows[0].thread_id)}
              />
              <div className="ask-rows">
                {rows.slice(1).map(c => (
                  <button key={c.thread_id} type="button" className={`ask-row${tab === 'replies' ? ' is-reply' : ''}`} onClick={() => setOpen(c.thread_id)}>
                    <span><b>{c.to}</b><small>{c.says ? `“${c.says}”` : c.subject}</small></span>
                    <em>{tab === 'replies' ? ago(c.replied_at) : 'due'}</em>
                  </button>
                ))}
              </div>
            </>}
    </div>
  )
}

interface Person { email: string; name: string; company: string; verdict?: string }
const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? ''
const fill = (t: string, p: Person) => t.replace(/\{first name\}/gi, firstName(p.name) || 'there').replace(/\{company\}/gi, p.company || 'your business')

/** Paste people, Claude writes one email, send it to all (send_email, up to 20 per call). */
function ListSend({ gmail, onChange }: { gmail: Gmail | null; onChange: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [text, setText] = useState('')
  const [people, setPeople] = useState<Person[]>([])
  const [about, setAbout] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [said, setSaid] = useState('')

  // "email, name, company" per line; any line with an address works
  function parse(): Person[] {
    const seen = new Set<string>()
    return text.split(/\n+/).flatMap(line => {
      const email = /[^\s,;<>"]+@[^\s,;<>"]+\.[^\s,;<>"]+/.exec(line)?.[0]?.toLowerCase()
      if (!email || seen.has(email)) return []
      seen.add(email)
      const parts = line.replace(email, '').split(/[,;\t]/).map(x => x.replace(/[<>"]/g, '').trim()).filter(Boolean)
      return [{ email, name: parts[0] ?? '', company: parts[1] ?? '' }]
    })
  }
  async function check() {
    const list = parse()
    if (!list.length) return setError('Paste at least one email address.')
    setBusy('check'); setError('')
    const r = await tool<{ results?: { email?: string; status: string }[] }>('check_contacts', { emails: list.map(p => p.email) })
    setBusy('')
    if (r.error) return setError(r.error)
    const v = new Map((r.results ?? []).filter(x => x.email).map(x => [x.email!.toLowerCase(), x.status]))
    setPeople(list.map(p => ({ ...p, verdict: v.get(p.email) ?? 'new' })))
    setStep(2)
  }
  async function draft() {
    setBusy('write'); setError('')
    const r = await write<{ subject?: string; body?: string }>({ list_about: about })
    setBusy('')
    if (r.error) return setError(r.error)
    setSubject(r.subject ?? ''); setBody(r.body ?? '')
  }
  const sendTo = people.filter(p => p.verdict === 'new' || p.verdict === 'already_a_lead')
  async function send() {
    setBusy('send'); setError('')
    let sent = 0
    const problems: string[] = []
    for (let i = 0; i < sendTo.length; i += 20) {
      const chunk = sendTo.slice(i, i + 20)
      const r = await tool<{ sent?: number; error?: string; results?: { to: string; status: string; reason?: string }[] }>('send_email', {
        emails: chunk.map(p => ({ to: p.name ? `${p.name} <${p.email}>` : p.email, subject: fill(subject, p), body: fill(body, p), follow_up_days: 4 })),
      })
      if (r.error && !r.sent) { problems.push(r.error); break }
      sent += r.sent ?? 0
      for (const x of r.results ?? []) if (x.status !== 'sent') problems.push(`${x.to}: ${x.reason}`)
      if ((r.results ?? []).some(x => /limit/i.test(x.reason ?? ''))) break
    }
    setBusy('')
    onChange()
    setSaid(`${plural(sent, 'email')} sent from your Gmail, with a follow-up reminder in 4 days.`)
    if (problems.length) setError(problems.slice(0, 4).join(' · '))
    if (sent) { setStep(1); setText(''); setPeople([]); setSubject(''); setBody('') }
  }

  const skipped = people.length - sendTo.length
  return (
    <div className="ask-list-send">
      <div className="ask-steps">{['Who gets it', 'The email', 'Review & send'].map((t, i) => <span key={t} className={step >= i + 1 ? 'is-on' : ''}>{i + 1} · {t}</span>)}</div>
      {step === 1 && <>
        <label className="ask-field"><span>Paste emails, one per line: email, name, company</span>
          <textarea rows={6} value={text} onChange={e => setText(e.target.value)} placeholder={'maya@bloomsalon.co, Maya, Bloom Salon\nsam@oakember.com, Sam, Oak & Ember'} /></label>
        <div className="ask-acts"><button type="button" className="ask-btn" disabled={!!busy || !text.trim()} onClick={check}>{busy ? 'Checking…' : 'Next: the email'}</button></div>
      </>}
      {step === 2 && <>
        <p className="ask-faint">{plural(sendTo.length, 'person', 'people')} to email{skipped ? ` · ${skipped} left out (already emailed, opted out or bounced)` : ''}.</p>
        <label className="ask-field"><span>What’s it about? (optional)</span>
          <input value={about} onChange={e => setAbout(e.target.value)} placeholder="e.g. 3 free posts made from their photos" /></label>
        {!body && <div className="ask-acts"><button type="button" className="ask-btn" disabled={!!busy} onClick={draft}>{busy ? 'Writing…' : 'Write the email'}</button><button type="button" className="ask-tl" onClick={() => setStep(1)}>Back</button></div>}
        {body && <>
          <div className="ask-mail">
            <input aria-label="Subject" className="ask-subj" value={subject} onChange={e => setSubject(e.target.value)} />
            <textarea aria-label="Email" rows={9} value={body} onChange={e => setBody(e.target.value)} />
          </div>
          <p className="ask-faint">{'{first name}'} and {'{company}'} are filled in for each person.</p>
          <div className="ask-acts"><button type="button" className="ask-btn" disabled={!subject || !body} onClick={() => setStep(3)}>Next: review</button><button type="button" className="ask-tl" disabled={!!busy} onClick={draft}>Write it again</button></div>
        </>}
      </>}
      {step === 3 && <>
        <div className="ask-rows">
          {sendTo.slice(0, 6).map(p => <div key={p.email} className="ask-row is-static"><span><b>{p.name || p.email}</b><small>{fill(subject, p)}</small></span></div>)}
          {sendTo.length > 6 && <p className="ask-faint">And {sendTo.length - 6} more.</p>}
        </div>
        <p className="ask-faint">{gmail?.left_today != null ? `${plural(gmail.left_today, 'email')} left today; the rest can go tomorrow.` : ''}</p>
        <div className="ask-acts">
          <button type="button" className="ask-btn" disabled={!!busy || !sendTo.length || gmail?.connected === false} onClick={send}>{busy ? 'Sending…' : `Send ${plural(sendTo.length, 'email')}`}</button>
          <button type="button" className="ask-tl" onClick={() => setStep(2)}>Back</button>
        </div>
      </>}
      {error && <p className="ask-err" role="alert">{error}</p>}
      {said && <p className="ask-said" role="status">{said}</p>}
    </div>
  )
}

// ── Write ─────────────────────────────────────────────────────────────────────

interface Topic { keyword: string; kind: string; status: string; volume: number; difficulty: number | null; why: string; blog_id?: string; page_to_rewrite?: string }
const OPEN = ['drafted', 'writing', 'picked']

export function WriteWorkspace({ topic: startTopic, onClose }: { topic?: string; onClose: () => void }) {
  const [topics, setTopics] = useState<Topic[] | null>(null)
  const [note, setNote] = useState('')
  const [open, setOpen] = useState<string | null>(startTopic ?? null)

  useEffect(() => {
    tool<{ topics?: Topic[]; set_up?: boolean; message?: string }>('get_search_agent', { section: 'topics', limit: '50' }).then(r => {
      if (r.set_up === false) setNote(r.message ?? 'The Search Agent hasn’t researched your market yet.')
      setTopics((r.topics ?? []).filter(t => OPEN.includes(t.status)).sort((a, b) => OPEN.indexOf(a.status) - OPEN.indexOf(b.status) || b.volume - a.volume))
    })
  }, [])

  const t = topics?.find(x => x.keyword === open)
  if (t) return <PostView t={t} onBack={() => setOpen(null)} onClose={onClose} />
  if (!topics) return <div className="ask-sheet-in"><Top label="Write" onClose={onClose} /><p className="ask-sheet-lede">Opening…</p></div>
  const [top, ...rest] = topics
  return (
    <div className="ask-sheet-in">
      <Top label="Write" onClose={onClose} />
      <h2 className="ask-sheet-h">Posts to write</h2>
      <p className="ask-quiet">What your buyers search for, from the Search Agent’s research</p>
      {!top ? <p className="ask-empty">{note || 'Nothing to write right now. New topics come with the weekly research.'}</p> : <>
        <Start
          title={top.status === 'drafted' ? 'A post is written' : 'Write this one next'}
          why={`“${top.keyword}” · ${top.volume.toLocaleString('en')} searches a month`}
          label={top.status === 'drafted' ? 'Check the draft' : 'Write it'}
          onClick={() => setOpen(top.keyword)}
        />
        <div className="ask-rows">
          {rest.map(x => (
            <button key={x.keyword} type="button" className="ask-row" onClick={() => setOpen(x.keyword)}>
              <span><b>{x.keyword}</b><small>{x.why}</small></span>
              <em>{x.status === 'drafted' ? 'drafted' : x.kind === 'improve' ? 'rewrite' : `${x.volume.toLocaleString('en')}/mo`}</em>
            </button>
          ))}
        </div>
      </>}
    </div>
  )
}

function PostView({ t, onBack, onClose }: { t: Topic; onBack: () => void; onClose: () => void }) {
  const [md, setMd] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [said, setSaid] = useState('')
  const [url, setUrl] = useState('')
  const [asking, setAsking] = useState(false)

  // A drafted post is read with get_blog_post; otherwise Claude writes one when asked
  useEffect(() => {
    if (!t.blog_id) return
    tool<{ content_markdown?: string; title?: string }>('get_blog_post', { blog_id: t.blog_id }).then(r => {
      if (r.error) setError(r.error)
      else setMd(r.content_markdown ?? '')
    })
  }, [t.blog_id])

  async function writeIt() {
    setBusy('write'); setError('')
    const r = await write<{ markdown?: string }>({ topic: t.keyword })
    setBusy('')
    if (r.error) return setError(r.error)
    setMd(r.markdown ?? '')
  }
  async function published() {
    if (!t.blog_id) return
    setBusy('pub'); setError('')
    const r = await tool<{ ok?: boolean; message?: string }>('mark_blog_published', { blog_id: t.blog_id, ...(url ? { live_url: url } : {}) })
    setBusy('')
    if (r.error) return setError(r.error)
    setSaid('Marked as published. GrowJin checks it’s live and on Google.'); setAsking(false)
  }

  return (
    <div className="ask-sheet-in">
      <Top label="Write" onClose={onClose} />
      <p className="ask-quiet"><button type="button" className="ask-tl" onClick={onBack}>← Posts to write</button></p>
      <h2 className="ask-sheet-h">{t.keyword}</h2>
      <p className="ask-sheet-lede">{t.volume.toLocaleString('en')} searches a month{t.kind === 'improve' && t.page_to_rewrite ? ` · a rewrite of ${t.page_to_rewrite}` : ''}</p>
      {t.why && <p className="ask-why">{t.why}</p>}
      {md === null
        ? (t.blog_id ? <p className="ask-faint">Opening the draft…</p>
          : <div className="ask-acts"><button type="button" className="ask-btn" disabled={!!busy} onClick={writeIt}>{busy ? 'Writing… (about a minute)' : 'Write the post'}</button></div>)
        : <>
          <div className="ask-mail"><textarea aria-label="The post" rows={18} value={md} onChange={e => setMd(e.target.value)} /></div>
          <div className="ask-acts">
            <button type="button" className="ask-btn" onClick={async () => setSaid((await copy(md)) ? 'Copied. Paste it into your blog.' : 'Couldn’t copy here. Select the text instead.')}>Copy the post</button>
            {t.blog_id && !asking && <button type="button" className="ask-tl" onClick={() => setAsking(true)}>I published it</button>}
            {!t.blog_id && <button type="button" className="ask-tl" disabled={!!busy} onClick={writeIt}>Write it again</button>}
          </div>
          {asking && (
            <div className="ask-acts">
              <input className="ask-input" value={url} onChange={e => setUrl(e.target.value)} placeholder="Its address, e.g. https://yoursite.com/blog/…" aria-label="Where it's live" />
              <button type="button" className="ask-btn" disabled={!!busy} onClick={published}>Done</button>
            </div>
          )}
          {!t.blog_id && <p className="ask-faint">Not saved in GrowJin: copy it before closing.</p>}
        </>}
      {error && <p className="ask-err" role="alert">{error}</p>}
      {said && !error && <p className="ask-said" role="status">{said}</p>}
    </div>
  )
}

