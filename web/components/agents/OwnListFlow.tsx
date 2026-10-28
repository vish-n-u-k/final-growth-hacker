'use client'

import { useMemo, useState } from 'react'
import { Spinner } from '@/components/ui/spinner'
import { Flow, Side } from '@/components/tool-ui'
import { EMAIL, MAX_LIST, fillFor, readPasted, type Person, type Skipped } from '@/lib/agents/own-list-text'

// "Add your own emails" in the Lead Agent's Email tab, in three steps like an Email Outreach
// campaign: who gets it (paste or upload), the email (one for all, name and company filled in),
// then check and approve all. The agent sends it within the daily limit, with follow-ups.

type Call = (op: string, payload?: Record<string, unknown>, busyKey?: string) => Promise<unknown>
const STEPS = ['Who gets it', 'The email', 'Review & approve']
const label = (p: Person) => (p.first ? `${p.first}${p.company ? ` · ${p.company}` : ''}` : p.company || p.email)

export default function OwnListFlow({ call, busy, gmail, dailyLimit, followUpDays, notify, onClose, tool = 'Lead Agent', repliesIn = 'the Email tab', initialRaw = '', initialName = '' }: {
  call: Call
  busy: string | null
  gmail: boolean
  dailyLimit: number
  followUpDays: number[]
  notify: (msg: string) => void
  onClose: () => void
  tool?: string        // the page it sits in, for the way back (Lead Finder reuses it)
  repliesIn?: string   // where replies show up on that page
  initialRaw?: string  // people to start with, one "email, name" per line (Lead Finder's LinkedIn search)
  initialName?: string // and what to call the list
}) {
  const [step, setStep] = useState(1)
  const [name, setName] = useState(initialName)
  const [raw, setRaw] = useState(initialRaw)
  const [reading, setReading] = useState(false)
  const [fileErr, setFileErr] = useState<string | null>(null)
  // How the list is given, like an Email Outreach campaign: one per line, any text (AI picks the
  // emails out), or a file
  const [mode, setMode] = useState<'lines' | 'ai' | 'file'>('lines')
  const [aiText, setAiText] = useState('')
  const [picking, setPicking] = useState(false)
  const [people, setPeople] = useState<Person[]>([])
  const [skipped, setSkipped] = useState<Skipped[]>([])
  const [about, setAbout] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [who, setWho] = useState(0)
  // Step 2's email box: the email you edit, or one person's copy with their name filled in
  const [view, setView] = useState<'edit' | 'preview'>('edit')
  const [openEmail, setOpenEmail] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})

  const pasted = useMemo(() => readPasted(raw), [raw])
  const unique = useMemo(() => new Set(pasted.map(p => p.email).filter(e => EMAIL.test(e))).size, [pasted])
  const checking = busy === 'list_check', writing = busy === 'list_draft', approving = busy === 'list_add'
  const drafted = !!(subject && body)
  const days = Math.ceil(people.length / Math.max(1, dailyLimit))

  async function upload(file: File | undefined) {
    if (!file) return
    setReading(true); setFileErr(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/outreach/parse-file', { method: 'POST', body: form })
      const j = await res.json().catch(() => ({})) as { prospects?: { email: string; name?: string }[]; error?: string }
      if (!res.ok) throw new Error(j.error ?? 'Could not read that file')
      const list = j.prospects ?? []
      if (!list.length) { setFileErr(`No email addresses found in ${file.name}.`); return }
      setRaw(r => [r.trim(), ...list.map(p => p.name ? `${p.email}, ${p.name}` : p.email)].filter(Boolean).join('\n'))
      if (!name.trim()) setName(file.name.replace(/\.[^.]+$/, '').slice(0, 80))
      setMode('lines')
      notify(`Read ${list.length} ${list.length === 1 ? 'email' : 'emails'} from ${file.name}`)
    } catch (e) {
      setFileErr(e instanceof Error ? e.message : 'Could not read that file')
    } finally {
      setReading(false)
    }
  }

  // "Any format": AI reads pasted text (LinkedIn profiles, notes, a spreadsheet column) and picks out
  // the emails and names; they're added to the list, one per line, for the user to check
  async function pickOut() {
    if (!aiText.trim()) return
    setPicking(true); setFileErr(null)
    try {
      const res = await fetch('/api/outreach/parse-prospects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: aiText }) })
      const j = await res.json().catch(() => ({})) as { prospects?: { email: string; name?: string }[]; error?: string }
      if (!res.ok) throw new Error(j.error ?? 'Couldn’t read that')
      const list = (j.prospects ?? []).filter(p => p.email)
      if (!list.length) { setFileErr('No emails found in that text.'); return }
      setRaw(r => [r.trim(), ...list.map(p => p.name ? `${p.email}, ${p.name}` : p.email)].filter(Boolean).join('\n'))
      setAiText(''); setMode('lines')
      notify(`Found ${list.length} ${list.length === 1 ? 'email' : 'emails'}. Check them below.`)
    } catch (e) {
      setFileErr(e instanceof Error ? e.message : 'Couldn’t read that')
    } finally {
      setPicking(false)
    }
  }

  async function check() {
    const r = await call('list_check', { people: pasted }, 'list_check') as { people?: Person[]; skipped?: Skipped[] } | null
    if (!r?.people) return
    setPeople(r.people); setSkipped(r.skipped ?? [])
    setEdits(e => Object.fromEntries(Object.entries(e).filter(([k]) => r.people!.some(p => p.email === k))))
    if (r.people.length) { setStep(2); setWho(0) }
  }

  async function write() {
    const r = await call('list_draft', { about }, 'list_draft') as { draft?: { subject: string; body: string } } | null
    if (r?.draft) { setSubject(r.draft.subject); setBody(r.draft.body); setEdits({}); setView('edit') }
  }

  async function approve() {
    const r = await call('list_add', {
      name, about, subject, body,
      people: people.map(p => ({ email: p.email, name: p.first || undefined, company: p.company || undefined, text: edits[p.email] })),
    }, 'list_add') as { ok?: boolean } | null
    if (r?.ok) onClose()
  }

  function remove(email: string) {
    setPeople(ps => ps.filter(p => p.email !== email))
    setOpenEmail(null)
    notify('Removed from the list')
  }

  const side = <Side av="+" name={name.trim() || 'Your own list'}
    sub={<span>{step === 1 ? (unique ? `${unique} ${unique === 1 ? 'email' : 'emails'} so far` : 'No emails yet') : `${people.length} ${people.length === 1 ? 'person' : 'people'}`}</span>}
    whyLabel="How it goes out"
    why={`From your Gmail, up to ${dailyLimit} a day. A short follow-up after ${followUpDays.join(' and ') || '3'} days if they don’t reply. It stops for anyone who replies, and their reply shows in ${repliesIn}.`} />
  const back = { label: tool, onClick: onClose }
  const flow = (title: string, hint: React.ReactNode, content: React.ReactNode, actions: React.ReactNode) =>
    <Flow back={back} crumb="Add your own emails" side={side} steps={STEPS} at={step} title={title} hint={hint} actions={actions} stepKey={`own:${step}`}>{content}</Flow>

  if (step === 1) {
    return flow('Who gets it?', 'Paste the emails, paste any text and let AI pick them out, or upload a file. To send one email to everyone right now, without follow-ups, use Email Outreach.',
      <div className="tu-stack">
        <div className="ro-field">
          <label htmlFor="own-name">Name this list</label>
          <input id="own-name" value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder="e.g. Café owners from the Pune meetup" />
        </div>
        <div className="cl-seg" role="group" aria-label="How to add people">
          <button type="button" aria-pressed={mode === 'lines'} onClick={() => { setMode('lines'); setFileErr(null) }}>One per line</button>
          <button type="button" aria-pressed={mode === 'ai'} onClick={() => { setMode('ai'); setFileErr(null) }}>Any format (AI)</button>
          <button type="button" aria-pressed={mode === 'file'} onClick={() => { setMode('file'); setFileErr(null) }}>Upload a file</button>
        </div>
        {mode === 'ai' && (
          <div className="ro-field">
            <label htmlFor="own-ai">Paste anything</label>
            <textarea id="own-ai" className="own-raw" rows={6} value={aiText} onChange={e => setAiText(e.target.value)} disabled={picking}
              placeholder={'LinkedIn profiles, notes, a spreadsheet column…\ne.g. "Anna Rao runs Brewlab, anna@brewlab.in"'} />
            <div className="own-ai-row">
              <span className="cl-muted">AI picks out the emails and names. Nothing is made up.</span>
              <button type="button" className="btn cl-btn-outline btn-sm" disabled={!aiText.trim() || picking} onClick={pickOut}>
                {picking ? <><Spinner />Reading…</> : 'Pick out the emails'}
              </button>
            </div>
          </div>
        )}
        {(mode === 'lines' || raw.trim()) && (
          <div className="ro-field">
            <label htmlFor="own-raw">{mode === 'lines' ? 'Emails' : 'Emails so far'}</label>
            <textarea id="own-raw" className="own-raw" rows={mode === 'lines' ? 7 : 4} value={raw} onChange={e => setRaw(e.target.value)} placeholder={'anna@brewlab.in, Anna Rao\nravi@kiteprints.com'} />
          </div>
        )}
        {mode === 'file' && <label className={`eo-drop${reading ? ' eo-drop--busy' : ''}`}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); if (!reading) upload(e.dataTransfer.files[0]) }}>
          <input type="file" className="eo-drop-in" disabled={reading}
            accept=".csv,.tsv,.txt,.vcf,.xlsx,.pdf,.docx,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={e => { upload(e.target.files?.[0]); e.target.value = '' }} />
          {reading
            ? <span className="eo-drop-t"><Spinner />Reading the file…</span>
            : <><span className="eo-drop-t">Drop a file here or <u>choose one</u></span>
                <span className="cl-muted">CSV, Excel (.xlsx), PDF, Word (.docx), text or contact cards (.vcf), up to 5 MB.</span></>}
        </label>}
        {fileErr && <div className="ro-error"><span>{fileErr}</span></div>}
        <p className="cl-muted own-count">
          {unique ? <><b>{unique} {unique === 1 ? 'email' : 'emails'}</b> found. Anyone already emailed, already in the {tool} or who asked not to be emailed is skipped on the next step.</> : 'No emails yet.'}
          {unique > MAX_LIST && <> Up to {MAX_LIST} people per list.</>}
        </p>
      </div>,
      <>
        <button key="cancel" type="button" className="btn btn-ghost ro-back" onClick={onClose}>Cancel</button>
        <button key="go" type="button" className="btn btn-primary" disabled={!unique || checking || reading || picking} onClick={check}>
          {checking ? <><Spinner />Checking…</> : 'Continue →'}
        </button>
      </>)
  }

  if (step === 2) {
    const p = people.length ? people[who % people.length] : undefined
    return flow('What’s the email about?', 'One line is enough. GrowJin writes one email and puts in each person’s first name and company.',
      <div className="tu-stack">
        {skipped.length > 0 && (
          <p className="cl-muted own-skips">Skipped {skipped.length}: {skipped.slice(0, 6).map(s => `${s.email} (${s.why})`).join(', ')}{skipped.length > 6 ? ` and ${skipped.length - 6} more` : ''}.</p>
        )}
        <form className="ro-field" onSubmit={e => { e.preventDefault(); if (!writing) write() }}>
          <label htmlFor="own-about">In one line</label>
          <input id="own-about" value={about} maxLength={300} onChange={e => setAbout(e.target.value)} placeholder="e.g. We make a week of café posts from your menu photos" />
        </form>
        {writing && <div className="ro-working"><Spinner /><span>Writing the email…</span><i /></div>}
        {drafted && !writing && <>
          <div className="ro-mail own-mail">
            <div className="own-mail-top">
              <div className="cl-seg" role="group" aria-label="Email">
                <button type="button" aria-pressed={view === 'edit'} onClick={() => setView('edit')}>Edit</button>
                <button type="button" aria-pressed={view === 'preview'} disabled={!p} onClick={() => setView('preview')}>Preview{p ? ` as ${p.first || p.company || p.email}` : ''}</button>
              </div>
              {view === 'preview' && people.length > 1 && (
                <button type="button" className="th-link tu-linkbtn" onClick={() => setWho(w => (w + 1) % people.length)}>Next person ({who % people.length + 1} of {people.length}) →</button>
              )}
            </div>
            {view === 'edit' || !p ? <>
              <label className="ro-mail-row"><span>Subject</span><input value={subject} onChange={e => setSubject(e.target.value)} /></label>
              <textarea className="ro-mail-body" aria-label="Email" rows={9} value={body} onChange={e => setBody(e.target.value)} />
              <div className="ro-mail-tools"><span className="cl-muted">{'{first name}'} and {'{company}'} are filled in for each person. With no name, it starts with “Hi,”.</span></div>
            </> : <>
              <div className="ro-mail-row"><span>To</span><span className="own-to">{p.email}</span></div>
              <div className="ro-mail-row"><span>Subject</span><b className="own-to">{fillFor(subject, p)}</b></div>
              <div className="own-prev-b">{fillFor(body, p)}</div>
              <div className="ro-mail-tools"><span className="cl-muted">This is what {p.first || 'they'} will get. Switch to Edit to change it for everyone.</span></div>
            </>}
          </div>
        </>}
      </div>,
      <>
        <button key="b1" type="button" className="btn btn-ghost ro-back" disabled={writing} onClick={() => setStep(1)}>← Back</button>
        {drafted && <button key="again" type="button" className="btn btn-ghost" disabled={writing} onClick={write}>Write it again</button>}
        {drafted
          ? <button key="to3" type="button" className="btn btn-primary" disabled={writing || !subject.trim() || !body.trim()} onClick={() => { setStep(3); setOpenEmail(null) }}>Continue →</button>
          : <button key="write" type="button" className="btn btn-primary" disabled={writing} onClick={write}>{writing ? <><Spinner />Writing…</> : 'Write the email'}</button>}
      </>)
  }

  return flow('Check, then approve all', null,
    <div className="tu-stack">
      {!gmail && <div className="ro-error"><span>Connect Gmail so the emails go out from your address.</span><a className="btn btn-primary btn-sm" href="/api/gmail/connect">Connect Gmail</a></div>}
      <div className="own-sum">
        <b>{people.length} {people.length === 1 ? 'email' : 'emails'}{name.trim() ? ` to ${name.trim()}` : ''}</b>
        <ul>
          <li>{days <= 1 ? 'All go out today, within your daily limit' : `${dailyLimit} a day, so it takes about ${days} days`}</li>
          <li>A short follow-up after {followUpDays.join(' and ') || '3'} days if they don’t reply</li>
          <li>Stops for anyone who replies</li>
        </ul>
      </div>
      <div className="own-ppl">
        {people.map(q => {
          const open = openEmail === q.email
          return (
            <div key={q.email} className="own-pp">
              <button type="button" className="own-pp-row" aria-expanded={open} onClick={() => setOpenEmail(open ? null : q.email)}>
                <span className="own-pp-main"><b>{label(q)}</b><span>{q.email}{edits[q.email] ? ' · edited' : ''}</span></span>
                <span className="cl-muted">{open ? 'Close' : 'See email'}</span>
              </button>
              {open && (
                <div className="own-pp-open">
                  <div className="ro-mail">
                    <label className="ro-mail-row"><span>Subject</span><input value={fillFor(subject, q)} readOnly /></label>
                    <textarea className="ro-mail-body" aria-label={`Email to ${q.email}`} rows={8}
                      value={edits[q.email] ?? fillFor(body, q)} onChange={e => setEdits(x => ({ ...x, [q.email]: e.target.value }))} />
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(q.email)}>Remove from list</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <p className="cl-muted">Nothing goes out until you approve. Ends with a short “reply no if this isn’t relevant” line.</p>
    </div>,
    <>
      <button key="b2" type="button" className="btn btn-ghost ro-back" disabled={approving} onClick={() => setStep(2)}>← Back</button>
      <button key="approve" type="button" className="btn btn-primary" disabled={approving || !gmail || !people.length} onClick={approve}>
        {approving ? <><Spinner />Approving…</> : `Approve all ${people.length}`}
      </button>
    </>)
}
