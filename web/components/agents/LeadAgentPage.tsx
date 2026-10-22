'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Lead, LeadAgentData, LeadSettings } from '@/lib/agents/store'
import { Spinner } from '@/components/ui/spinner'
import { Ago, Day, DemoBanner, Toast, initials, useAgentApi } from './shared'

export interface LeadAgentFlags { dataforseo: boolean; hunter: boolean; gmail: boolean; demo: boolean }

const COUNTRIES: [string, string][] = [['US', 'United States'], ['IN', 'India'], ['GB', 'United Kingdom'], ['CA', 'Canada'], ['AU', 'Australia'], ['DE', 'Germany'], ['FR', 'France'], ['AE', 'UAE'], ['SG', 'Singapore']]
const SOURCE_LABEL: Record<Lead['source'], string> = { reddit: 'Reddit', forum: 'Hacker News', review: 'Unhappy reviewer', local: 'Google Maps' }

function Settings({ initial, onSave, saving, competitorsHint, firstTime }: {
  initial: LeadSettings
  onSave: (s: LeadSettings) => void
  saving: boolean
  competitorsHint: string[]
  firstTime: boolean
}) {
  const [s, setS] = useState<LeadSettings>(initial)
  const [comps, setComps] = useState(initial.competitors.join(', '))
  const [days, setDays] = useState(initial.followUpDays.join(', '))
  const set = <K extends keyof LeadSettings>(k: K, v: LeadSettings[K]) => setS(x => ({ ...x, [k]: v }))
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave({
      ...s,
      enabled: firstTime ? true : s.enabled,
      competitors: comps.split(/[,\s]+/).map(x => x.trim()).filter(Boolean),
      followUpDays: days.split(/[,\s]+/).map(Number).filter(n => n > 0),
    })
  }
  return (
    <form className="ag-card" onSubmit={submit}>
      <h2>{firstTime ? 'Set up your Lead Agent' : 'Lead Agent settings'}</h2>
      <p className="ag-card-sub">Pre-filled from your brand. Nothing is sent until you approve it.</p>

      <div className="ag-field">
        <label className="ag-label" htmlFor="la-customer">Who is your customer?</label>
        <textarea id="la-customer" className="ag-textarea" rows={3} value={s.customer} onChange={e => set('customer', e.target.value)} placeholder="e.g. Small business owners (cafés, salons, gyms) who post on Instagram and struggle to make content every day" />
      </div>

      <div className="ag-field">
        <span className="ag-label">Where should it look?</span>
        <label className="ag-check">
          <input type="checkbox" checked={s.sources.reddit} onChange={e => set('sources', { ...s.sources, reddit: e.target.checked })} />
          <span><span className="ag-check-title">Reddit and Hacker News</span><br /><span className="ag-check-sub">People asking for a tool like yours. You get a drafted reply to post yourself.</span></span>
        </label>
        <label className="ag-check">
          <input type="checkbox" checked={s.sources.reviews} onChange={e => set('sources', { ...s.sources, reviews: e.target.checked })} />
          <span><span className="ag-check-title">Unhappy customers of your competitors</span><br /><span className="ag-check-sub">1–3 star Trustpilot reviews from the last 3 months.</span></span>
        </label>
        {s.sources.reviews && (
          <div className="ag-field" style={{ paddingLeft: 29 }}>
            <label className="ag-label" htmlFor="la-comps">Competitor websites (up to 3)</label>
            <input id="la-comps" className="ag-input" value={comps} onChange={e => setComps(e.target.value)} placeholder={competitorsHint.slice(0, 3).join(', ') || 'competitor.com, other.com'} />
          </div>
        )}
        <label className="ag-check">
          <input type="checkbox" checked={s.sources.local} onChange={e => set('sources', { ...s.sources, local: e.target.checked })} />
          <span><span className="ag-check-title">Local businesses on Google Maps</span><br /><span className="ag-check-sub">Businesses with no website, few reviews or a low rating.</span></span>
        </label>
        {s.sources.local && (
          <div className="ag-field" style={{ paddingLeft: 29 }}>
            <label className="ag-label" htmlFor="la-local">What to search on Maps</label>
            <input id="la-local" className="ag-input" value={s.localQuery} onChange={e => set('localQuery', e.target.value)} placeholder="e.g. cafés in Pune" />
          </div>
        )}
      </div>

      <div className="ag-grid2" style={{ gap: 14 }}>
        <div className="ag-field">
          <label className="ag-label" htmlFor="la-country">Country</label>
          <select id="la-country" className="ag-select" value={s.country} onChange={e => set('country', e.target.value)}>
            {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </div>
        <div className="ag-field">
          <label className="ag-label" htmlFor="la-limit">Max new emails a day</label>
          <input id="la-limit" className="ag-input" type="number" min={1} max={30} value={s.dailyLimit} onChange={e => set('dailyLimit', Math.max(1, Math.min(30, Number(e.target.value) || 1)))} />
        </div>
        <div className="ag-field">
          <label className="ag-label" htmlFor="la-days">Follow up after (days)</label>
          <input id="la-days" className="ag-input" value={days} onChange={e => setDays(e.target.value)} placeholder="3, 7" />
        </div>
      </div>

      <label className="ag-check">
        <input type="checkbox" checked={s.skipEU} onChange={e => set('skipEU', e.target.checked)} />
        <span><span className="ag-check-title">Don&apos;t cold-email businesses in the EU</span><br /><span className="ag-check-sub">EU rules on marketing email are stricter. They still show up as leads.</span></span>
      </label>

      <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <legend className="ag-label" style={{ marginBottom: 8 }}>How much should it do on its own?</legend>
        <label className="ag-check">
          <input type="radio" name="la-mode" checked={s.mode === 'approve'} onChange={() => set('mode', 'approve')} />
          <span><span className="ag-check-title">I approve every first email (recommended)</span><br /><span className="ag-check-sub">Follow-ups go out by themselves and stop when they reply.</span></span>
        </label>
        <label className="ag-check">
          <input type="radio" name="la-mode" checked={s.mode === 'auto'} onChange={() => set('mode', 'auto')} />
          <span><span className="ag-check-title">Send on its own after I&apos;ve approved 20</span><br /><span className="ag-check-sub">Only leads scoring 8 or more, within your daily limit.</span></span>
        </label>
      </fieldset>

      <div className="ag-row-actions">
        <button className="ag-btn ag-btn-primary" type="submit" disabled={saving}>{saving ? <><Spinner />Saving…</> : firstTime ? 'Start Lead Agent' : 'Save settings'}</button>
      </div>
    </form>
  )
}

function EmailLead({ lead, busy, onApprove, onSave, onSkip }: {
  lead: Lead
  busy: string | null
  onApprove: (subject: string, body: string) => void
  onSave: (subject: string, body: string) => void
  onSkip: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [subject, setSubject] = useState(lead.draft?.subject ?? '')
  const [body, setBody] = useState(lead.draft?.body ?? '')
  const who = lead.name || lead.company || lead.title
  return (
    <article className="ag-lead">
      <div className="ag-lead-info">
        <div className="ag-lead-who">
          <div className="ag-avatar" aria-hidden="true">{initials(who)}</div>
          <div style={{ minWidth: 0 }}>
            <div className="ag-lead-name">{who}</div>
            <div className="ag-lead-line">{lead.company && lead.company !== who ? `${lead.company} · ` : ''}{lead.website ?? ''}</div>
          </div>
          <span className="ag-pill ag-pill-good" style={{ marginLeft: 'auto' }}>Fit {lead.score}/10</span>
        </div>
        <div className="ag-lead-line"><strong>Found:</strong> {SOURCE_LABEL[lead.source]} · <a href={lead.url} target="_blank" rel="noopener noreferrer">see it</a> · <Day iso={lead.foundAt} /></div>
        <div className="ag-lead-line"><strong>What they said:</strong> {lead.snippet.slice(0, 220)}{lead.snippet.length > 220 ? '…' : ''}</div>
        <div className="ag-lead-line"><strong>Why a fit:</strong> {lead.why}</div>
        <div className="ag-lead-line"><strong>Email:</strong> {lead.email} {lead.emailVerified ? <span className="ag-pill ag-pill-good">Verified</span> : <span className="ag-pill">From their website</span>}</div>
        {lead.error && <div className="ag-note ag-note-crit">{lead.error}</div>}
      </div>
      <div className="ag-lead-draft">
        {editing ? (
          <>
            <div className="ag-field"><label className="ag-label" htmlFor={`s-${lead.id}`}>Subject</label><input id={`s-${lead.id}`} className="ag-input" value={subject} onChange={e => setSubject(e.target.value)} /></div>
            <div className="ag-field"><label className="ag-label" htmlFor={`b-${lead.id}`}>Email</label><textarea id={`b-${lead.id}`} className="ag-textarea" rows={8} value={body} onChange={e => setBody(e.target.value)} /></div>
          </>
        ) : (
          <div className="ag-draft">
            <div className="ag-draft-subject">Subject: <b>{subject}</b></div>
            <div>{body}</div>
            <div className="ag-draft-subject">+ an “if this isn&apos;t relevant, reply no” line</div>
          </div>
        )}
        <div className="ag-row-actions">
          {lead.status === 'queued'
            ? <span className="ag-pill ag-pill-warn">Approved · sends tomorrow</span>
            : <button className="ag-btn ag-btn-primary" type="button" disabled={!!busy} onClick={() => onApprove(subject, body)}>{busy === `approve:${lead.id}` ? <><Spinner />Sending…</> : 'Approve & send'}</button>}
          {editing
            ? <button className="ag-btn" type="button" disabled={!!busy} onClick={() => { onSave(subject, body); setEditing(false) }}>Save</button>
            : <button className="ag-btn" type="button" onClick={() => setEditing(true)}>Edit</button>}
          <button className="ag-btn" type="button" disabled={!!busy} onClick={onSkip}>Skip</button>
        </div>
      </div>
    </article>
  )
}

function ForumLead({ lead, busy, onPosted, onSkip, onCopy }: { lead: Lead; busy: string | null; onPosted: () => void; onSkip: () => void; onCopy: () => void }) {
  return (
    <article className="ag-lead">
      <div className="ag-lead-info">
        <div className="ag-lead-line"><strong>{SOURCE_LABEL[lead.source]}</strong>{lead.name ? ` · ${lead.name}` : ''} · <Day iso={lead.foundAt} /> · <span className="ag-pill ag-pill-good">Fit {lead.score}/10</span></div>
        <div className="ag-lead-name">{lead.title}</div>
        <div className="ag-lead-line">{lead.why}</div>
      </div>
      <div className="ag-lead-draft">
        <div className="ag-draft">{lead.reply}</div>
        <div className="ag-row-actions">
          <button className="ag-btn ag-btn-primary" type="button" onClick={onCopy}>Copy reply</button>
          <a className="ag-btn" href={lead.url} target="_blank" rel="noopener noreferrer">Open post</a>
          <button className="ag-btn" type="button" disabled={!!busy} onClick={onPosted}>Mark as posted</button>
          <button className="ag-btn" type="button" disabled={!!busy} onClick={onSkip}>Skip</button>
        </div>
      </div>
    </article>
  )
}

export default function LeadAgentPage({ initial, flags, competitorsHint }: { initial: LeadAgentData; flags: LeadAgentFlags; competitorsHint: string[] }) {
  const { data, busy, call, toast, say } = useAgentApi<LeadAgentData>('/api/agents/lead', initial)
  const firstTime = !data.settings.enabled && !data.lastRunAt && data.leads.length === 0
  const [showSettings, setShowSettings] = useState(firstTime)
  const s = data.settings

  const ready = data.leads.filter(l => (l.status === 'ready' || l.status === 'queued') && l.draft && l.email)
  const forum = data.leads.filter(l => l.status === 'ready' && l.reply)
  const noContact = data.leads.filter(l => l.status === 'needs_contact')
  const sent = data.leads.filter(l => l.sentAt && ['sent', 'replied', 'opted_out', 'bounced'].includes(l.status))
  const replies = data.leads.filter(l => l.status === 'replied' || l.status === 'opted_out' || l.status === 'bounced')
  const readyToSend = ready.filter(l => l.status === 'ready').length

  const stats: [number, string][] = [
    [data.leads.length, 'Leads found'],
    [readyToSend + forum.length, 'Waiting for your OK'],
    [sent.length, 'Emails sent'],
    [data.leads.filter(l => l.status === 'replied').length, 'Replies'],
    [data.leads.filter(l => l.status === 'posted').length, 'Replies posted'],
  ]

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); say('Reply copied. Paste it on the post.') } catch { say('Could not copy. Select the text and copy it.') }
  }

  return (
    <div className="wrap ag-page">
      <Link href="/agents" className="ag-back">← AI Agents</Link>
      <div className="ag-hd">
        <h1 className="st-page-title">Lead Agent</h1>
        <span className={`ag-pill ${s.enabled ? 'ag-pill-on' : ''}`}>{s.enabled ? 'On · runs daily' : 'Off'}</span>
        <div className="ag-hd-actions">
          {!firstTime && (
            <button className="ag-btn" type="button" disabled={!!busy} onClick={() => call('settings', { settings: { enabled: !s.enabled } })}>{s.enabled ? 'Pause' : 'Turn on'}</button>
          )}
          <button className="ag-btn ag-btn-primary" type="button" disabled={!!busy || firstTime} onClick={() => call('run')}>{busy === 'run' ? <><Spinner />Looking for leads…</> : 'Run now'}</button>
          {!firstTime && <button className="ag-btn" type="button" aria-expanded={showSettings} onClick={() => setShowSettings(v => !v)}>Settings</button>}
        </div>
      </div>
      <p className="st-page-sub" style={{ marginTop: -12 }}>
        Finds people who need what you sell, drafts a personal note, sends from your Gmail after you approve, and follows up.
        {data.lastRunAt ? <> Last run <Ago iso={data.lastRunAt} />{data.lastRunSummary ? `: ${data.lastRunSummary}` : ''}.</> : null}
      </p>
      {busy === 'run' && <div className="ag-note">Searching, scoring and drafting usually takes 1–3 minutes. You can keep this page open.</div>}

      {flags.demo && (
        <DemoBanner>
          {!firstTime && <button className="ag-btn" type="button" disabled={!!busy} onClick={() => call('demo_skip')}>{busy === 'demo_skip' ? <><Spinner />Skipping ahead…</> : 'Skip ahead 3 days'}</button>}
          {!firstTime && <span className="ag-meta" style={{ display: 'block', marginTop: 6 }}>Moves sent dates back 3 days and runs the agent, so you can see follow-ups go out and replies come in.</span>}
        </DemoBanner>
      )}
      {!flags.gmail && <div className="ag-note ag-note-warn">Connect Gmail so the agent can send approved emails from your address. <a href="/api/gmail/connect">Connect Gmail</a></div>}
      {!flags.dataforseo && (s.sources.reddit || s.sources.local) && <div className="ag-note ag-note-warn">Reddit and Google Maps search need GrowJin&apos;s DataForSEO account, which isn&apos;t set up yet. Hacker News and competitor reviews still work.</div>}
      {!flags.hunter && <div className="ag-note">Verified emails (Hunter) aren&apos;t set up yet, so the agent only uses emails it finds on company websites.</div>}
      {data.lastError && <div className="ag-note ag-note-crit">Last run had a problem: {data.lastError}</div>}

      {showSettings && (
        <Settings
          initial={s}
          firstTime={firstTime}
          competitorsHint={competitorsHint}
          saving={busy === 'settings'}
          onSave={async (next) => {
            const r = await call('settings', { settings: next })
            if (r?.data) {
              setShowSettings(false)
              if (firstTime) await call('run')
            }
          }}
        />
      )}

      {!firstTime && (
        <>
          <div className="ag-stats">
            {stats.map(([n, label]) => <div key={label} className="ag-stat"><b>{n}</b><span>{label}</span></div>)}
          </div>

          <section className="ag-card ag-card-focus">
            <div className="ag-row-actions">
              <h2>Emails waiting for your OK</h2>
              <span className="ag-pill ag-pill-warn">{readyToSend} ready</span>
              {readyToSend > 1 && (
                <button className="ag-btn ag-btn-primary ag-meta-right" type="button" disabled={!!busy || !flags.gmail} onClick={() => call('approve_all')}>
                  {busy === 'approve_all' ? <><Spinner />Sending…</> : `Approve all ${readyToSend}`}
                </button>
              )}
            </div>
            <p className="ag-card-sub">Sent from your Gmail, at most {s.dailyLimit} a day. Follow-ups after {s.followUpDays.join(' and ') || '—'} days stop as soon as they reply.</p>
            {ready.length === 0 && <p className="ag-meta">Nothing waiting. New leads appear after each run.</p>}
            {ready.map(l => (
              <EmailLead
                key={l.id}
                lead={l}
                busy={busy}
                onApprove={(subject, body) => call('approve', { id: l.id, subject, body }, `approve:${l.id}`)}
                onSave={(subject, body) => call('save', { id: l.id, subject, body }, `save:${l.id}`)}
                onSkip={() => call('skip', { id: l.id }, `skip:${l.id}`)}
              />
            ))}
          </section>

          <section className="ag-card">
            <h2>Forum replies to post yourself</h2>
            <p className="ag-card-sub">Reddit bans automated replies, so the agent drafts and you post. Helpful answer first, your product second.</p>
            {forum.length === 0 && <p className="ag-meta">No posts waiting.</p>}
            {forum.map(l => (
              <ForumLead
                key={l.id}
                lead={l}
                busy={busy}
                onCopy={() => copy(l.reply ?? '')}
                onPosted={() => call('posted', { id: l.id }, `posted:${l.id}`)}
                onSkip={() => call('skip', { id: l.id }, `skip:${l.id}`)}
              />
            ))}
          </section>

          <div className="ag-grid2">
            <section className="ag-card">
              <h2>Replies</h2>
              {replies.length === 0 && <p className="ag-meta">No replies yet. They show up here and on Today.</p>}
              <div className="ag-list">
                {replies.slice(0, 10).map(l => (
                  <div key={l.id} className="ag-item">
                    <div className="ag-item-main">
                      <div className="ag-item-title">{l.name || l.company || l.email}</div>
                      <div className="ag-item-detail">{l.replyNote ? `“${l.replyNote}”` : ''}</div>
                    </div>
                    <span className={`ag-pill ${l.status === 'replied' ? 'ag-pill-crit' : ''}`}>{l.status === 'replied' ? 'Replied' : l.status === 'opted_out' ? 'Not interested' : 'Bounced'}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="ag-card">
              <h2>Sent and follow-ups</h2>
              {sent.length === 0 && <p className="ag-meta">Nothing sent yet.</p>}
              {sent.length > 0 && (
                <div className="ag-table-wrap">
                  <table className="ag-table">
                    <thead><tr><th>Lead</th><th>Sent</th><th>Next</th></tr></thead>
                    <tbody>
                      {sent.slice(0, 15).map(l => (
                        <tr key={l.id}>
                          <td>{l.name || l.company || l.email}</td>
                          <td><Day iso={l.sentAt} /></td>
                          <td>{l.status !== 'sent' ? 'Stopped: they replied' : l.nextFollowUpAt ? <>Follow-up {l.followupsSent + 1} · <Day iso={l.nextFollowUpAt} /></> : 'All follow-ups sent'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          {noContact.length > 0 && (
            <section className="ag-card">
              <h2>Good leads without an email</h2>
              <p className="ag-card-sub">Worth a call, a message on their site or social, or a visit.</p>
              <div className="ag-list">
                {noContact.slice(0, 15).map(l => (
                  <div key={l.id} className="ag-item">
                    <span className="ag-pill ag-item-tag">{SOURCE_LABEL[l.source]}</span>
                    <div className="ag-item-main">
                      <div className="ag-item-title">{l.title}</div>
                      <div className="ag-item-detail">{l.why}{l.phone ? ` · ${l.phone}` : ''}{l.website ? ` · ${l.website}` : ''}</div>
                    </div>
                    <div className="ag-row-actions">
                      <a className="ag-btn" href={l.url} target="_blank" rel="noopener noreferrer">Open</a>
                      <button className="ag-btn" type="button" disabled={!!busy} onClick={() => call('skip', { id: l.id }, `skip:${l.id}`)}>Skip</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
      <Toast text={toast} />
    </div>
  )
}
