'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Spinner } from '@/components/ui/spinner'
import type { CampaignSummary } from '@/app/api/outreach/campaign/route'
import { EmailEditor, Steps, ago, plainText, type Notify } from './shared'

// Email Outreach → Campaigns: a list of campaigns (one card each), and the campaign itself in
// three steps: who gets it, what it says (an email written for each person), then review and
// send or schedule. Everything is saved as it changes (app/api/outreach/campaign), so a
// campaign can be left and picked up again from the list.

interface Prospect { id: string; email: string; name: string; domain: string }
type Status = 'idle' | 'generating' | 'ready' | 'sending' | 'sent' | 'scheduled' | 'error'
interface EmailState {
  status: Status; subject: string; body: string; toEmail?: string; error?: string
  editingHtml?: boolean; confirming?: boolean; scheduling?: string; scheduledAt?: string; scheduledId?: string
}

const STEPS = ['Who gets it', 'Write the emails', 'Review & send']

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function tomorrowAt9(): string {
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0)
  return toLocalInputValue(d)
}
const fmtWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
function localTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return 'local time' }
}

// ── The list ──────────────────────────────────────────────────────────────────

export default function Campaigns({ newPending, onNewOpened, notify, onSent }: {
  newPending: boolean     // the header's "New campaign" was clicked
  onNewOpened: () => void
  notify: Notify
  onSent: () => void      // an email was sent or scheduled: refresh the sent list and counts
}) {
  const [list, setList]       = useState<CampaignSummary[] | null>(null)
  const [openId, setOpenId]   = useState<{ id: string; isNew: boolean } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch('/api/outreach/campaign').then(r => r.ok ? r.json() : null)
      .then((d: { campaigns?: CampaignSummary[] } | null) => setList(d?.campaigns ?? []))
      .catch(() => setList([]))
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (newPending) { setOpenId({ id: newId(), isNew: true }); onNewOpened() } }, [newPending, onNewOpened])

  async function remove(c: CampaignSummary) {
    if (deleting !== c.id) { setDeleting(c.id); return }
    setDeleting(null)
    setList(prev => prev?.filter(x => x.id !== c.id) ?? null)
    const ok = await fetch(`/api/outreach/campaign?id=${encodeURIComponent(c.id)}`, { method: 'DELETE' }).then(r => r.ok).catch(() => false)
    notify(ok ? 'Campaign deleted. Emails already sent are still in Done.' : 'Could not delete it')
    if (!ok) load()
  }

  if (openId) {
    return <Editor key={openId.id} id={openId.id} isNew={openId.isNew} notify={notify} onSent={onSent}
      onBack={() => { setOpenId(null); load() }} />
  }

  if (!list) return <div className="ro-working eo-loading"><Spinner /><span>Loading campaigns…</span><i /></div>

  if (list.length === 0) {
    return (
      <div className="cl-none">
        <h3>No campaigns yet</h3>
        <p>A campaign is one email, written for each person on a list and sent from your Gmail. Paste the list, say what it&apos;s about, and check each email before it goes.</p>
        <div className="cl-acts cl-acts--center">
          <button type="button" className="btn btn-primary" onClick={() => setOpenId({ id: newId(), isNew: true })}>New campaign</button>
        </div>
        <p className="eo-find">No list yet? Find people with <Link className="th-link" href="/lead-finder">Competitor Leads</Link> or the <Link className="th-link" href="/agents/leads">Lead Agent</Link>.</p>
      </div>
    )
  }

  return (
    <div>
      {list.map(c => {
        const done = c.recipients > 0 && c.sent + c.scheduled >= c.recipients
        const state = done ? 'Sent' : c.sent + c.scheduled > 0 ? 'Sending' : c.written > 0 ? 'Written' : 'Draft'
        return (
          <article key={c.id} className="cl-rv eo-card">
            <div className="cl-rv-head">
              <span className="cl-av eo-av-mail" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="2.5" y="4.5" width="15" height="11" rx="2" /><path d="M3.5 6l6.5 5 6.5-5" /></svg>
              </span>
              <div className="cl-rv-who">
                <div className="cl-lead-name eo-ellip">{c.title}</div>
                <div className="cl-lead-sub">
                  <span>{c.recipients} recipient{c.recipients !== 1 ? 's' : ''}</span>
                  {c.written > 0 && <span>· {c.written} written</span>}
                  {c.sent > 0 && <span>· {c.sent} sent</span>}
                  {c.scheduled > 0 && <span>· {c.scheduled} scheduled</span>}
                </div>
              </div>
              <span className={`eo-due eo-state--${state.toLowerCase()}`}>{state}</span>
            </div>
            <div className="cl-rv-foot">
              <span className="eo-foot-l">
                <span className="cl-muted">Updated {ago(c.savedAt)}</span>
                <button type="button" className={`btn btn-link${deleting === c.id ? ' eo-danger' : ''}`} onClick={() => remove(c)} onBlur={() => setDeleting(null)}>
                  {deleting === c.id ? 'Click again to delete' : 'Delete'}
                </button>
              </span>
              <button type="button" className={`btn btn-sm ${done ? 'cl-btn-outline' : 'btn-primary cl-reach'}`} onClick={() => setOpenId({ id: c.id, isNew: false })}>
                {done ? 'View' : c.written > 0 || c.recipients > 0 ? 'Continue →' : 'Open →'}
              </button>
            </div>
          </article>
        )
      })}
    </div>
  )
}

// ── One campaign ──────────────────────────────────────────────────────────────

function Editor({ id, isNew, notify, onSent, onBack }: {
  id: string; isNew: boolean; notify: Notify; onSent: () => void; onBack: () => void
}) {
  const [loaded, setLoaded]           = useState(isNew)
  const [stepNo, setStepNo]           = useState(1)
  const [instruction, setInstruction] = useState('')
  const [prospects, setProspects]     = useState<Prospect[]>([])
  const [emails, setEmails]           = useState<Record<string, EmailState>>({})
  const [expanded, setExpanded]       = useState<string | null>(null)
  const [needsReconnect, setNeedsReconnect] = useState(false)
  const [followUp, setFollowUp]       = useState(true)
  const [followUpDays, setFollowUpDays] = useState(3)
  const [sendAllConfirm, setSendAllConfirm] = useState(false)
  const [sendingAll, setSendingAll]   = useState(false)
  const [copied, setCopied]           = useState<string | null>(null)
  const [draftSaving, setDraftSaving] = useState<string | null>(null)
  // Adding recipients
  const [importText, setImportText]   = useState('')
  const [importMode, setImportMode]   = useState<'csv' | 'ai'>('csv')
  const [parsing, setParsing]         = useState(false)
  const [parseErr, setParseErr]       = useState<string | null>(null)
  const [manual, setManual]           = useState<{ email: string; name: string; domain: string } | null>(null)
  const [saved, setSaved]             = useState<Prospect[]>([])
  const [savedOpen, setSavedOpen]     = useState(false)
  const [savedSel, setSavedSel]       = useState<Set<string>>(new Set())
  const [savedQ, setSavedQ]           = useState('')
  // AI edit of written emails
  const [aiOpen, setAiOpen]           = useState(false)
  const [aiText, setAiText]           = useState('')
  const [aiPick, setAiPick]           = useState<'all' | 'select'>('all')
  const [aiSel, setAiSel]             = useState<Set<string>>(new Set())
  const [aiProgress, setAiProgress]   = useState<{ done: number; total: number } | null>(null)

  const loadSaved = useCallback(() => {
    fetch('/api/outreach/prospects').then(r => r.ok ? r.json() : null).then(data => {
      if (!data?.prospects) return
      setSaved(data.prospects.map((p: { id: string; email: string; name?: string | null; domain?: string | null }) => ({
        id: p.id, email: p.email, name: p.name ?? '', domain: p.domain ?? '',
      })))
    }).catch(() => {})
  }, [])
  useEffect(() => { loadSaved() }, [loadSaved])

  // Open a saved campaign where it was left
  useEffect(() => {
    if (isNew) return
    fetch(`/api/outreach/campaign?id=${encodeURIComponent(id)}`).then(r => r.ok ? r.json() : null).then((d: { campaign?: {
      instruction?: string; prospects?: Prospect[]; emails?: Record<string, { subject: string; body: string; toEmail?: string; status: string; scheduledAt?: string }>
    } | null } | null) => {
      const c = d?.campaign
      if (!c) return
      setInstruction(c.instruction ?? '')
      setProspects(c.prospects ?? [])
      const restored = Object.fromEntries(Object.entries(c.emails ?? {}).map(([pid, e]) => [pid, {
        status: (e.status === 'sent' || e.status === 'scheduled' ? e.status : 'ready') as Status,
        subject: e.subject, body: e.body, toEmail: e.toEmail, scheduledAt: e.scheduledAt,
      }]))
      setEmails(restored)
      // Pick up at the step it was left on: no one added yet, emails still to write, or sending
      const people = c.prospects?.length ?? 0, written = Object.keys(restored).length
      setStepNo(people === 0 ? 1 : written < people ? 2 : 3)
    }).catch(() => {}).finally(() => setLoaded(true))
  }, [id, isNew])

  // Autosave once there's something to keep: a second after the last change, and straight
  // away when the campaign is closed so nothing typed just before is lost
  const first = useRef(true)
  const pending = useRef<string | null>(null)
  const flush = useCallback(async () => {
    if (!pending.current) return
    const body = pending.current
    pending.current = null
    await fetch('/api/outreach/campaign', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
  }, [])
  useEffect(() => () => { flush() }, [flush])
  // Back to the list once the latest changes are saved, so the list shows them
  const leave = async () => { await flush(); onBack() }
  useEffect(() => {
    if (!loaded) return
    if (first.current) { first.current = false; if (!isNew) return }
    if (!instruction.trim() && prospects.length === 0) return
    const saveEmails = Object.fromEntries(Object.entries(emails)
      .filter(([, st]) => st.subject || st.body)
      .map(([pid, st]) => [pid, { subject: st.subject, body: st.body, toEmail: st.toEmail, status: st.status, scheduledAt: st.scheduledAt }]))
    pending.current = JSON.stringify({ id, instruction, prospects, emails: saveEmails })
    const t = setTimeout(flush, 1000)
    return () => clearTimeout(t)
  }, [id, isNew, loaded, instruction, prospects, emails, flush])

  const setEmail = (pid: string, patch: Partial<EmailState>) =>
    setEmails(prev => ({ ...prev, [pid]: { ...(prev[pid] ?? { status: 'idle', subject: '', body: '' }), ...patch } }))
  const statusOf = (p: Prospect): Status => emails[p.id]?.status ?? 'idle'
  const ready = prospects.filter(p => statusOf(p) === 'ready')
  const sentCount = prospects.filter(p => statusOf(p) === 'sent').length
  const scheduledCount = prospects.filter(p => statusOf(p) === 'scheduled').length
  const writtenCount = prospects.filter(p => ['ready', 'sending', 'sent', 'scheduled'].includes(statusOf(p))).length
  const toWrite = prospects.filter(p => ['idle', 'error'].includes(statusOf(p)))
  const writing = prospects.some(p => statusOf(p) === 'generating')

  // ── Recipients ──────────────────────────────────────────────────────────────

  function saveProspects(list: Prospect[], rawInput?: string) {
    fetch('/api/outreach/prospects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prospects: list.map(p => ({ email: p.email, name: p.name, domain: p.domain, rawInput: rawInput ?? null })) }),
    }).then(() => loadSaved()).catch(() => {})
  }

  function add(list: Prospect[]) {
    setProspects(prev => {
      const seen = new Set(prev.map(p => p.email.toLowerCase()))
      return [...prev, ...list.filter(p => { const k = p.email.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })]
    })
  }

  function addPasted() {
    const parsed: Prospect[] = importText.split('\n').map(l => l.trim()).filter(Boolean).map((line, i) => {
      const parts = line.split(',').map(p => p.trim())
      return { id: `cp-${Date.now()}-${i}`, email: parts[0] ?? '', name: parts[1] ?? '', domain: parts[2] ?? '' }
    }).filter(p => p.email.includes('@'))
    if (!parsed.length) { setParseErr('No email addresses found. Put one per line, starting with the email.'); return }
    add(parsed); saveProspects(parsed); setImportText('')
  }

  async function addWithAI() {
    if (!importText.trim()) return
    setParsing(true); setParseErr(null)
    try {
      const res = await fetch('/api/outreach/parse-prospects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: importText }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Could not read that')
      const list = data.prospects as Prospect[]
      if (!list.length) { setParseErr('No contacts found in that text.'); return }
      add(list); saveProspects(list, importText); setImportText('')
    } catch (e) {
      setParseErr(e instanceof Error ? e.message : 'Could not read that')
    } finally {
      setParsing(false)
    }
  }

  function removeProspect(pid: string) {
    setProspects(prev => prev.filter(p => p.id !== pid))
    setEmails(prev => { const n = { ...prev }; delete n[pid]; return n })
  }

  async function deleteSaved(pid: string) {
    setSaved(prev => prev.filter(p => p.id !== pid))
    setSavedSel(prev => { const n = new Set(prev); n.delete(pid); return n })
    await fetch('/api/outreach/prospects', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: pid }),
    }).catch(() => {})
  }

  // ── Writing ─────────────────────────────────────────────────────────────────

  async function writeOne(p: Prospect) {
    if (!instruction.trim()) return
    setEmail(p.id, { status: 'generating', subject: '', body: '', error: undefined })
    try {
      const res = await fetch('/api/gmail/campaign/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: p.email, name: p.name || undefined, domain: p.domain || undefined, instruction }),
      })
      const data = await res.json() as { subject?: string; body?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not write it')
      setEmail(p.id, { status: 'ready', subject: data.subject ?? '', body: data.body ?? '' })
    } catch (e) {
      setEmail(p.id, { status: 'error', error: e instanceof Error ? e.message : 'Could not write it' })
    }
  }

  function writeAll() { toWrite.forEach(p => writeOne(p)) }

  async function applyAi() {
    const targets = aiPick === 'all' ? ready : ready.filter(p => aiSel.has(p.id))
    if (!aiText.trim() || !targets.length) return
    setAiProgress({ done: 0, total: targets.length })
    for (let i = 0; i < targets.length; i += 3) {
      const batch = targets.slice(i, i + 3)
      try {
        const res = await fetch('/api/gmail/campaign/refine', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instruction: aiText,
            emails: batch.map(p => ({
              id: p.id, prospectName: p.name, prospectEmail: p.email, prospectDomain: p.domain,
              currentSubject: emails[p.id]?.subject ?? '', currentBody: emails[p.id]?.body ?? '',
            })),
          }),
        })
        if (res.ok) {
          const { results } = await res.json() as { results: { id: string; subject?: string; body?: string }[] }
          setEmails(prev => {
            const next = { ...prev }
            for (const r of results) if (r.body && r.subject) next[r.id] = { ...next[r.id], subject: r.subject, body: r.body, editingHtml: false }
            return next
          })
        }
      } catch { /* one batch failing doesn't stop the rest */ }
      setAiProgress({ done: Math.min(i + 3, targets.length), total: targets.length })
    }
    setAiProgress(null)
    setAiOpen(false)
    notify(`Updated ${targets.length} email${targets.length !== 1 ? 's' : ''}`)
  }

  async function saveToGmailDrafts(p: Prospect) {
    const st = emails[p.id]
    if (!st?.subject || !st.body) return
    setDraftSaving(p.id)
    const ok = await fetch('/api/gmail/save-draft', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: st.toEmail ?? p.email, subject: st.subject, body: st.body }),
    }).then(r => r.ok).catch(() => false)
    setDraftSaving(null)
    notify(ok ? 'Saved to your Gmail drafts' : 'Could not save to Gmail drafts')
  }

  // ── Sending ─────────────────────────────────────────────────────────────────

  async function sendOne(p: Prospect, scheduledAt?: string): Promise<boolean> {
    const st = emails[p.id]
    if (!st?.subject || !st.body) return false
    setEmail(p.id, { status: 'sending', confirming: false, scheduling: undefined })
    try {
      const res = await fetch('/api/gmail/send-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: st.toEmail ?? p.email, subject: st.subject, body: st.body,
          followUpDays: followUp ? followUpDays : undefined, source: 'campaign',
          ...(scheduledAt ? { scheduledAt } : {}),
        }),
      })
      const data = await res.json() as { id?: string; error?: string; message?: string }
      if (res.status === 403 && data.error === 'missing_send_scope') {
        setNeedsReconnect(true)
        setEmail(p.id, { status: 'ready' })
        return false
      }
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Send failed')
      setEmail(p.id, scheduledAt ? { status: 'scheduled', scheduledAt, scheduledId: data.id } : { status: 'sent' })
      onSent()
      return true
    } catch (e) {
      setEmail(p.id, { status: 'error', error: e instanceof Error ? e.message : 'Send failed' })
      return false
    }
  }

  async function sendSingle(p: Prospect, scheduledAt?: string) {
    if (await sendOne(p, scheduledAt)) {
      notify(scheduledAt ? `Scheduled for ${fmtWhen(scheduledAt)}` : `Sent to ${p.name || p.email}${followUp ? `. Follow-up reminder in ${followUpDays} days if they don't reply.` : ''}`)
    }
  }

  async function sendAll() {
    setSendAllConfirm(false)
    setSendingAll(true)
    let sent = 0
    for (const p of ready) {
      if (await sendOne(p)) sent++
      await new Promise(r => setTimeout(r, 400))
    }
    setSendingAll(false)
    const failed = ready.length - sent
    notify(failed ? `Sent ${sent}, ${failed} didn't go. They're marked below.` : `Sent ${sent} email${sent !== 1 ? 's' : ''}`)
  }

  async function cancelScheduled(p: Prospect) {
    const sid = emails[p.id]?.scheduledId
    if (!sid) return
    const res = await fetch(`/api/outreach/emails/${sid}/cancel`, { method: 'POST' })
    const data = await res.json().catch(() => ({})) as { error?: string }
    if (!res.ok) { notify(data.error ?? 'Could not cancel it'); return }
    setEmail(p.id, { status: 'ready', scheduledAt: undefined, scheduledId: undefined })
    notify('Scheduled email cancelled')
    onSent()
  }

  // ── Views ───────────────────────────────────────────────────────────────────

  const followUpToggle = (
    <label className="eo-inline">
      <input type="checkbox" checked={followUp} onChange={e => setFollowUp(e.target.checked)} />
      Follow up if no reply after
      <select className="cl-sel eo-sel-sm" value={followUpDays} disabled={!followUp} onChange={e => setFollowUpDays(Number(e.target.value))}>
        <option value={2}>2 days</option>
        <option value={3}>3 days</option>
        <option value={5}>5 days</option>
        <option value={7}>7 days</option>
      </select>
    </label>
  )

  const statusTag = (p: Prospect) => {
    const st = emails[p.id]
    switch (statusOf(p)) {
      case 'generating': return <span className="eo-tag"><Spinner size={10} />Writing</span>
      case 'ready':      return <span className="eo-tag eo-tag--ok">Written</span>
      case 'sending':    return <span className="eo-tag"><Spinner size={10} />Sending</span>
      case 'sent':       return <span className="eo-tag eo-tag--ok">✓ Sent</span>
      case 'scheduled':  return <span className="eo-tag eo-tag--sched">Scheduled · {fmtWhen(st?.scheduledAt ?? '')}</span>
      case 'error':      return <span className="eo-tag eo-tag--warn" title={st?.error}>Failed</span>
      default:           return <span className="eo-tag">Not written</span>
    }
  }

  const who = (p: Prospect) => (
    <span className="eo-row-main">
      <b>{p.name || p.email}</b>
      <span className="eo-ellip">{p.name ? p.email : ''}{p.domain ? `${p.name ? ' · ' : ''}${p.domain}` : ''}</span>
    </span>
  )

  let title = '', hint = '', body: React.ReactNode = null, actions: React.ReactNode = null

  if (!loaded) {
    body = <div className="ro-working"><Spinner /><span>Opening the campaign…</span><i /></div>
  } else if (stepNo === 1) {
    title = 'Who should get it?'
    hint = 'Paste a list of emails. Each person gets their own email, written for them.'
    const inCampaign = new Set(prospects.map(p => p.email.toLowerCase()))
    const q = savedQ.trim().toLowerCase()
    const savedShown = q ? saved.filter(p => [p.email, p.name, p.domain].some(v => v.toLowerCase().includes(q))) : saved
    const selectable = savedShown.filter(p => !inCampaign.has(p.email.toLowerCase()))
    body = <>
      <div className="eo-import">
        <div className="cl-seg" role="group" aria-label="How to read the list">
          <button type="button" aria-pressed={importMode === 'csv'} onClick={() => { setImportMode('csv'); setParseErr(null) }}>One per line</button>
          <button type="button" aria-pressed={importMode === 'ai'} onClick={() => { setImportMode('ai'); setParseErr(null) }}>Any format (AI)</button>
        </div>
        <textarea rows={importMode === 'ai' ? 6 : 4} value={importText} onChange={e => { setImportText(e.target.value); setParseErr(null) }}
          placeholder={importMode === 'ai'
            ? 'Paste anything: LinkedIn profiles, notes, a spreadsheet column.\ne.g. "John Smith is CEO of Acme, john@acme.com"'
            : 'alice@acme.com, Alice Johnson, acme.com\nbob@startup.io, Bob Smith\ncharlie@company.com'} />
        <div className="eo-import-foot">
          <span className="cl-muted">{importMode === 'csv' ? 'email, name (optional), website (optional)' : 'AI picks out the emails, names and companies'}</span>
          <button type="button" className="btn btn-primary btn-sm" disabled={!importText.trim() || parsing} onClick={importMode === 'csv' ? addPasted : addWithAI}>
            {parsing ? <><Spinner />Reading…</> : 'Add to campaign'}
          </button>
        </div>
        {parseErr && <p className="eo-err">{parseErr}</p>}
      </div>

      {prospects.length > 0 && (
        <div className="eo-chips">
          <span className="eo-chips-n">{prospects.length} recipient{prospects.length !== 1 ? 's' : ''}</span>
          {prospects.map(p => (
            <span key={p.id} className="eo-chip" title={[p.name, p.domain].filter(Boolean).join(' · ') || undefined}>
              {p.email}<button type="button" aria-label={`Remove ${p.email}`} onClick={() => removeProspect(p.id)}>✕</button>
            </span>
          ))}
          <button type="button" className="btn btn-link" onClick={() => { setProspects([]); setEmails({}) }}>Clear all</button>
        </div>
      )}

      {manual ? (
        <div className="eo-manual">
          <input className="cl-in" placeholder="Email *" value={manual.email} onChange={e => setManual({ ...manual, email: e.target.value })} />
          <input className="cl-in" placeholder="Name" value={manual.name} onChange={e => setManual({ ...manual, name: e.target.value })} />
          <input className="cl-in" placeholder="Website" value={manual.domain} onChange={e => setManual({ ...manual, domain: e.target.value })} />
          <button type="button" className="btn btn-primary btn-sm" disabled={!manual.email.includes('@')}
            onClick={() => { const p = { id: `cp-${Date.now()}`, ...manual }; add([p]); saveProspects([p]); setManual(null) }}>Add</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setManual(null)}>Cancel</button>
        </div>
      ) : (
        <div className="eo-addlinks">
          <button type="button" className="btn btn-link" onClick={() => setManual({ email: '', name: '', domain: '' })}>+ Add one person</button>
          {saved.length > 0 && (
            <button type="button" className="btn btn-link" aria-expanded={savedOpen} onClick={() => setSavedOpen(o => !o)}>
              {savedOpen ? 'Hide' : 'Pick from'} people you added before ({saved.length})
            </button>
          )}
        </div>
      )}

      {savedOpen && saved.length > 0 && (
        <div className="eo-saved">
          <div className="eo-saved-bar">
            <input className="cl-search" placeholder="Search email, name or website" value={savedQ} onChange={e => setSavedQ(e.target.value)} />
            <button type="button" className="btn btn-ghost btn-sm" disabled={!selectable.length}
              onClick={() => setSavedSel(selectable.every(p => savedSel.has(p.id)) ? new Set() : new Set(selectable.map(p => p.id)))}>
              {selectable.length && selectable.every(p => savedSel.has(p.id)) ? 'Select none' : 'Select all'}
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={savedSel.size === 0}
              onClick={() => { add(saved.filter(p => savedSel.has(p.id))); setSavedSel(new Set()) }}>
              Add {savedSel.size || ''} to campaign
            </button>
          </div>
          <div className="eo-saved-list">
            {savedShown.map(p => {
              const isIn = inCampaign.has(p.email.toLowerCase())
              return (
                <label key={p.id} className="eo-row eo-row--pick">
                  <input type="checkbox" disabled={isIn} checked={isIn || savedSel.has(p.id)}
                    onChange={e => setSavedSel(prev => { const n = new Set(prev); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n })} />
                  {who(p)}
                  {isIn ? <span className="eo-tag eo-tag--ok">In campaign</span>
                    : <button type="button" className="btn btn-link" aria-label={`Forget ${p.email}`} onClick={e => { e.preventDefault(); deleteSaved(p.id) }}>Remove</button>}
                </label>
              )
            })}
            {savedShown.length === 0 && <p className="eo-empty">No matches</p>}
          </div>
        </div>
      )}

      {prospects.length === 0 && (
        <p className="eo-find">Need people to email? Find them with <Link className="th-link" href="/lead-finder">Competitor Leads</Link> or the <Link className="th-link" href="/agents/leads">Lead Agent</Link>.</p>
      )}
    </>
    actions = <>
      <button key="list" type="button" className="btn btn-ghost ro-back" onClick={leave}>← All campaigns</button>
      <button key="n1" type="button" className="btn btn-primary" disabled={prospects.length === 0} onClick={() => setStepNo(2)}>Next: write the emails →</button>
    </>
  } else if (stepNo === 2) {
    title = 'What should the email say?'
    hint = 'Say what you offer and why it matters to them. A separate email is written for each person, and you can edit any of them.'
    const aiTargets = aiPick === 'all' ? ready.length : ready.filter(p => aiSel.has(p.id)).length
    body = <>
      <textarea className="eo-goal" rows={3} value={instruction} onChange={e => setInstruction(e.target.value)}
        placeholder="e.g. Introduce our SEO audit to marketing leads at B2B SaaS companies. Mention that it checks how they show up in AI answers, and offer a free audit." />
      <div className="eo-writebar">
        <span className="cl-muted">{writtenCount} of {prospects.length} written</span>
        <span className="cl-grow" />
        {ready.length > 1 && (
          <button type="button" className="btn btn-ghost btn-sm" aria-pressed={aiOpen} onClick={() => setAiOpen(o => !o)}>Change all with AI</button>
        )}
        {toWrite.length > 0 && (
          <button type="button" className="btn btn-primary btn-sm" disabled={!instruction.trim() || writing} onClick={writeAll}>
            {writing ? <><Spinner />Writing…</> : writtenCount ? `Write the other ${toWrite.length}` : `Write ${toWrite.length} email${toWrite.length !== 1 ? 's' : ''}`}
          </button>
        )}
      </div>
      {!instruction.trim() && toWrite.length > 0 && <p className="cl-muted eo-gap">Describe the email first, then write them.</p>}

      {aiOpen && ready.length > 0 && (
        <div className="eo-panel">
          <textarea rows={2} value={aiText} onChange={e => setAiText(e.target.value)}
            placeholder={'What to change, e.g. "Make it shorter and more casual" or "Add a P.S. about the free trial"'} />
          <div className="eo-panel-row">
            <span className="cl-seg eo-seg-sm" role="group" aria-label="Which emails">
              <button type="button" aria-pressed={aiPick === 'all'} onClick={() => setAiPick('all')}>All {ready.length}</button>
              <button type="button" aria-pressed={aiPick === 'select'} onClick={() => setAiPick('select')}>Pick some</button>
            </span>
            <span className="eo-foot-r">
              {aiProgress && <span className="cl-muted"><Spinner />{aiProgress.done}/{aiProgress.total}</span>}
              <button type="button" className="btn btn-primary btn-sm" disabled={!!aiProgress || !aiText.trim() || aiTargets === 0} onClick={applyAi}>
                Apply to {aiTargets}
              </button>
            </span>
          </div>
          {aiPick === 'select' && <p className="cl-muted">Tick the emails below to change.</p>}
        </div>
      )}

      <div className="eo-list">
        {prospects.map(p => {
          const st = emails[p.id]
          const s = statusOf(p)
          const isOpen = expanded === p.id && s === 'ready'
          return (
            <Fragment key={p.id}>
              <div className={`eo-row${isOpen ? ' eo-row--open' : ''}`}>
                {aiOpen && aiPick === 'select' && (
                  <input type="checkbox" aria-label={`Change ${p.email}`} disabled={s !== 'ready'} checked={aiSel.has(p.id)}
                    onChange={e => setAiSel(prev => { const n = new Set(prev); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n })} />
                )}
                {who(p)}
                {s === 'ready' && !isOpen && st?.subject && <span className="eo-subj eo-ellip">{st.subject}</span>}
                {statusTag(p)}
                <span className="eo-row-acts">
                  {(s === 'idle' || s === 'error') && (
                    <button type="button" className="btn btn-link" disabled={!instruction.trim()} onClick={() => writeOne(p)}>{s === 'error' ? 'Try again' : 'Write'}</button>
                  )}
                  {s === 'ready' && <button type="button" className="btn btn-link" onClick={() => setExpanded(isOpen ? null : p.id)}>{isOpen ? 'Close' : 'Edit'}</button>}
                </span>
              </div>
              {s === 'error' && st?.error && <p className="eo-err eo-row-err">{st.error}</p>}
              {isOpen && st && (
                <div className="eo-row-editor">
                  <EmailEditor mail={{ to: st.toEmail ?? p.email, subject: st.subject, body: st.body, editingHtml: st.editingHtml }}
                    onChange={patch => setEmail(p.id, { ...(patch.to !== undefined ? { toEmail: patch.to } : {}),
                      ...(patch.subject !== undefined ? { subject: patch.subject } : {}),
                      ...(patch.body !== undefined ? { body: patch.body } : {}),
                      ...(patch.editingHtml !== undefined ? { editingHtml: patch.editingHtml } : {}) })} />
                  <div className="eo-row-tools">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => writeOne(p)}>↻ Rewrite</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={async () => {
                      try { await navigator.clipboard.writeText(`Subject: ${st.subject}\n\n${plainText(st.body)}`); setCopied(p.id); setTimeout(() => setCopied(null), 1800) } catch { /* ignore */ }
                    }}>{copied === p.id ? '✓ Copied' : 'Copy'}</button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={draftSaving === p.id} onClick={() => saveToGmailDrafts(p)}>
                      {draftSaving === p.id ? <><Spinner />Saving…</> : 'Save to Gmail drafts'}
                    </button>
                    <span className="cl-grow" />
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => setExpanded(null)}>Done</button>
                  </div>
                </div>
              )}
            </Fragment>
          )
        })}
      </div>
    </>
    actions = <>
      <button key="b2" type="button" className="btn btn-ghost ro-back" onClick={() => setStepNo(1)}>← Back</button>
      <button key="n2" type="button" className="btn btn-primary" disabled={ready.length + sentCount + scheduledCount === 0} onClick={() => { setExpanded(null); setStepNo(3) }}>
        Next: review &amp; send →
      </button>
    </>
  } else {
    title = 'Review and send'
    hint = 'Emails go out from your Gmail one by one. Send them now, or schedule any of them for later.'
    const allGone = prospects.length > 0 && sentCount + scheduledCount === prospects.length
    body = <>
      <div className="eo-sendsum">
        <span><b>{ready.length}</b> ready</span>
        <span><b>{sentCount}</b> sent</span>
        {scheduledCount > 0 && <span><b>{scheduledCount}</b> scheduled</span>}
        {prospects.length - writtenCount > 0 && <span className="eo-muted-n"><b>{prospects.length - writtenCount}</b> not written</span>}
        <span className="cl-grow" />
        {followUpToggle}
      </div>
      {needsReconnect && (
        <div className="ro-error">
          <span>Gmail needs to be connected again before it can send. Your current connection can only read and save drafts.</span>
          <a className="btn btn-primary btn-sm" href="/api/gmail/connect">Reconnect Gmail</a>
        </div>
      )}
      {sendAllConfirm && (
        <div className="eo-panel eo-panel-row">
          <span>Send {ready.length} email{ready.length !== 1 ? 's' : ''} now?</span>
          <span className="eo-foot-r">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSendAllConfirm(false)}>Cancel</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={sendAll}>Yes, send {ready.length}</button>
          </span>
        </div>
      )}
      <div className="eo-list">
        {prospects.filter(p => statusOf(p) !== 'idle' && statusOf(p) !== 'generating').map(p => {
          const st = emails[p.id]!
          const s = st.status
          return (
            <Fragment key={p.id}>
              <div className="eo-row">
                {who(p)}
                <span className="eo-subj eo-ellip" title={st.subject}>{st.subject}</span>
                {statusTag(p)}
                <span className="eo-row-acts">
                  {s === 'ready' && !st.confirming && st.scheduling === undefined && <>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={sendingAll} onClick={() => setEmail(p.id, { scheduling: tomorrowAt9() })}>Schedule</button>
                    <button type="button" className="btn btn-primary btn-sm" disabled={sendingAll} onClick={() => setEmail(p.id, { confirming: true })}>Send</button>
                  </>}
                  {s === 'scheduled' && st.scheduledId && <button type="button" className="btn btn-ghost btn-sm" onClick={() => cancelScheduled(p)}>Cancel</button>}
                  {s === 'error' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEmail(p.id, { status: st.body ? 'ready' : 'idle' }) }}>Retry</button>}
                </span>
              </div>
              {s === 'error' && st.error && <p className="eo-err eo-row-err">{st.error}</p>}
              {st.confirming && (
                <div className="eo-row-confirm">
                  <span>Send to {st.toEmail ?? p.email} now?</span>
                  <span className="eo-foot-r">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEmail(p.id, { confirming: false })}>Cancel</button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => sendSingle(p)}>Yes, send</button>
                  </span>
                </div>
              )}
              {st.scheduling !== undefined && (
                <div className="eo-row-confirm">
                  <input type="datetime-local" className="cl-in eo-dt" min={toLocalInputValue(new Date())} value={st.scheduling}
                    onChange={e => setEmail(p.id, { scheduling: e.target.value })} />
                  <span className="cl-muted">Your time ({localTimeZone()}). Scheduled emails go out in the daily send (4 PM IST) after this time.</span>
                  <span className="eo-foot-r">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEmail(p.id, { scheduling: undefined })}>Cancel</button>
                    <button type="button" className="btn btn-primary btn-sm" disabled={!st.scheduling}
                      onClick={() => sendSingle(p, new Date(st.scheduling!).toISOString())}>Schedule</button>
                  </span>
                </div>
              )}
            </Fragment>
          )
        })}
      </div>
      <p className="cl-muted eo-gap">Gmail sends up to 500 emails a day (2,000 on Google Workspace). Keep batches small and personal so they don&apos;t land in spam.</p>
    </>
    actions = <>
      <button key="b3" type="button" className="btn btn-ghost ro-back" disabled={sendingAll} onClick={() => setStepNo(2)}>← Back</button>
      {allGone
        ? <button key="fin" type="button" className="btn btn-primary" onClick={leave}>Done · back to campaigns</button>
        : <button key="all" type="button" className="btn btn-primary" disabled={ready.length === 0 || sendingAll} onClick={() => setSendAllConfirm(true)}>
            {sendingAll ? <><Spinner />Sending…</> : `Send ${ready.length} now`}
          </button>}
    </>
  }

  return (
    <div className="eo-editor">
      <nav className="ro-crumbs" aria-label="Breadcrumb">
        <button type="button" className="th-link eo-crumb" onClick={leave}>← All campaigns</button>
        <span aria-hidden="true">/</span>
        <b className="eo-ellip">{instruction.trim().split('\n')[0].slice(0, 80) || 'New campaign'}</b>
      </nav>
      <Steps labels={STEPS} at={stepNo} />
      <div className="ro-card">
        {title && <h2 className="ro-title">{title}</h2>}
        {hint && <p className="ro-hint">{hint}</p>}
        <div className="eo-step-body">{body}</div>
        {actions && <div key={stepNo} className="ro-actions">{actions}</div>}
      </div>
    </div>
  )
}
