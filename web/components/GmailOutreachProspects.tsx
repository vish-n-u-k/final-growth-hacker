'use client'

import { useState } from 'react'
import type { DBItemFull } from '@/lib/modules/types'

// ── Types ─────────────────────────────────────────────────────────────────────

type ProspectStatus = 'idle' | 'generating' | 'ready' | 'saving' | 'saved' | 'confirming' | 'sending' | 'sent' | 'error'

interface ProspectMeta {
  name: string
  company: string
  title: string
  suggestedEmail: string
}

interface ProspectState {
  status: ProspectStatus
  subject: string
  body: string
  toEmail?: string
  error?: string
  editingHtml?: boolean
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const IcAI = () => (
  <svg viewBox="0 0 20 20" fill="none" width="13" height="13">
    <path d="M10 2l1.5 4.5H16l-3.5 2.5 1.5 4.5L10 11l-4 2.5 1.5-4.5L4 6.5h4.5L10 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
  </svg>
)
const IcSend = () => (
  <svg viewBox="0 0 20 20" fill="none" width="13" height="13">
    <path d="M3 10l14-7-5 7 5 7-14-7z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
  </svg>
)

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseMeta(raw: string | null): ProspectMeta {
  try {
    const obj = JSON.parse(raw ?? '{}') as Partial<ProspectMeta>
    return {
      name:           obj.name           ?? 'Unknown',
      company:        obj.company        ?? 'Unknown',
      title:          obj.title          ?? 'Unknown',
      suggestedEmail: obj.suggestedEmail ?? '',
    }
  } catch {
    return { name: 'Unknown', company: 'Unknown', title: 'Unknown', suggestedEmail: '' }
  }
}

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
}

function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim()
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function GmailOutreachProspects({
  items,
  gmailConnected,
}: {
  items: DBItemFull[]
  gmailConnected: boolean
}) {
  const [states, setStates]                     = useState<Record<string, ProspectState>>({})
  const [expanded, setExpanded]                 = useState<string | null>(null)
  const [needsReconnect, setNeedsReconnect]     = useState(false)
  const [copied, setCopied]                     = useState<string | null>(null)

  const prospects = items
    .filter(item => item.slug !== 'prospect-error')
    .map(item => ({ item, meta: parseMeta(item.aiDetail) }))

  function getState(id: string): ProspectState {
    return states[id] ?? { status: 'idle', subject: '', body: '' }
  }

  function patchState(id: string, patch: Partial<ProspectState>) {
    setStates(prev => ({ ...prev, [id]: { ...getState(id), ...patch } }))
  }

  async function generateEmail(item: DBItemFull, meta: ProspectMeta) {
    patchState(item.id, { status: 'generating', subject: '', body: '' })
    try {
      const res = await fetch('/api/gmail/generate-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospectName:    meta.name,
          prospectEmail:   getState(item.id).toEmail ?? meta.suggestedEmail,
          prospectCompany: meta.company,
          prospectTitle:   meta.title,
        }),
      })
      const data = await res.json() as { subject?: string; body?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Generation failed')
      patchState(item.id, { status: 'ready', subject: data.subject ?? '', body: data.body ?? '' })
      setExpanded(item.id)
    } catch (e: unknown) {
      patchState(item.id, { status: 'error', error: e instanceof Error ? e.message : 'Failed' })
    }
  }

  async function saveDraft(item: DBItemFull, meta: ProspectMeta) {
    const state = getState(item.id)
    patchState(item.id, { status: 'saving' })
    try {
      const res = await fetch('/api/gmail/save-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: state.toEmail ?? meta.suggestedEmail, subject: state.subject, body: state.body }),
      })
      const data = await res.json() as { draftId?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Save failed')
      patchState(item.id, { status: 'saved' })
    } catch (e: unknown) {
      patchState(item.id, { status: 'error', error: e instanceof Error ? e.message : 'Save failed' })
    }
  }

  async function sendEmail(item: DBItemFull, meta: ProspectMeta) {
    const state = getState(item.id)
    patchState(item.id, { status: 'sending' })
    try {
      const res = await fetch('/api/gmail/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: state.toEmail ?? meta.suggestedEmail, subject: state.subject, body: state.body }),
      })
      const data = await res.json() as { messageId?: string; error?: string }
      if (res.status === 403 && data.error === 'missing_send_scope') {
        setNeedsReconnect(true)
        patchState(item.id, { status: 'ready' })
        return
      }
      if (!res.ok) throw new Error(data.error ?? 'Send failed')
      patchState(item.id, { status: 'sent' })
      setExpanded(null)
    } catch (e: unknown) {
      patchState(item.id, { status: 'error', error: e instanceof Error ? e.message : 'Send failed' })
    }
  }

  function copyText(text: string, id: string) {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  if (items.length === 0) {
    return (
      <div className="gop-empty">
        No prospects found. Click <strong>Analyse</strong> to identify potential clients.
      </div>
    )
  }

  return (
    <div className="gop-wrap">

      {/* Gmail not connected banner */}
      {!gmailConnected && (
        <div className="gop-banner gop-banner-info">
          <span>Connect Gmail to generate and send cold emails directly from this module.</span>
          <a href="/api/gmail/connect" className="gop-banner-link">Connect Gmail</a>
        </div>
      )}

      {/* Reconnect banner */}
      {needsReconnect && (
        <div className="gop-banner gop-banner-warn">
          <span>Gmail needs reconnecting to enable sending — missing send permission.</span>
          <a href="/api/gmail/connect" className="gop-banner-link">Reconnect Gmail</a>
        </div>
      )}

      {/* Header */}
      <div className="gop-header">
        <div>
          <div className="gop-header-title">
            {prospects.length} potential client{prospects.length !== 1 ? 's' : ''} identified
          </div>
          <div className="gop-header-sub">
            Email addresses are AI-suggested — verify before sending
          </div>
        </div>
        <button
          className="gop-gen-all"
          onClick={() => prospects.forEach(({ item, meta }) => {
            const s = getState(item.id)
            if (s.status === 'idle' || s.status === 'error') generateEmail(item, meta)
          })}
        >
          <IcAI />
          Generate All
        </button>
      </div>

      {/* Gmail Hub link */}
      <a
        href="/gmail-hub"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 20, padding: '9px 16px', borderRadius: 10, background: 'var(--card)', border: '1px solid var(--line)', fontSize: 13, color: 'var(--text-dim)', textDecoration: 'none', transition: 'border-color .15s' }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--green)')}
        onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--line)')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--green)', flexShrink: 0 }}>
          <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.8"/>
          <path d="M2 7l10 7 10-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span>Open Gmail Hub</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ marginLeft: 2, opacity: 0.5 }}>
          <path d="M7 17L17 7M17 7H7M17 7v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </a>

      {/* Prospect cards */}
      <div className="gop-cards">
        {prospects.map(({ item, meta }) => {
          const state      = getState(item.id)
          const status     = state.status
          const isExpanded = expanded === item.id && (status === 'ready' || status === 'saved' || status === 'confirming')
          const toEmail    = state.toEmail ?? meta.suggestedEmail

          const fitClass = item.weight === 3 ? 'gop-fit-strong' : item.weight === 2 ? 'gop-fit-good' : 'gop-fit-potential'
          const fitLabel = item.weight === 3 ? 'Strong fit' : item.weight === 2 ? 'Good fit' : 'Potential fit'

          let cardClass = `gop-card gop-card-${status}`
          if (isExpanded) cardClass += ' gop-card-expanded'

          return (
            <div key={item.id} className={cardClass}>

              {/* Card header */}
              <div className="gop-card-top">
                <div className="gop-card-left">
                  <div className="gop-avatar">{getInitials(meta.name)}</div>
                  <div className="gop-meta">
                    <div className="gop-name-row">
                      <span className="gop-name">{meta.name}</span>
                      {status === 'ready'      && <span className="gop-badge gop-badge-ready">Email ready</span>}
                      {status === 'confirming' && <span className="gop-badge gop-badge-ready">Email ready</span>}
                      {status === 'saved'      && <span className="gop-badge gop-badge-saved">Saved to Drafts</span>}
                      {status === 'sent'       && <span className="gop-badge gop-badge-sent">Sent</span>}
                      {status === 'error'      && <span className="gop-badge gop-badge-error">Error</span>}
                    </div>
                    <div className="gop-role">{meta.title} · {meta.company}</div>
                    {item.aiNarrative && <div className="gop-narrative">{item.aiNarrative}</div>}
                    <div className="gop-fit">
                      <span className={`gop-fit-tag ${fitClass}`}>{fitLabel}</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="gop-actions">
                  {(status === 'idle' || status === 'error') && (
                    <button className="gop-gen-btn" onClick={() => generateEmail(item, meta)}>
                      <IcAI />
                      {status === 'error' ? 'Retry' : 'Generate Email'}
                    </button>
                  )}
                  {status === 'generating' && (
                    <span className="gop-status-text">Generating…</span>
                  )}
                  {(status === 'ready' || status === 'confirming' || status === 'saved') && (
                    <>
                      <button
                        className={`gop-view-btn${isExpanded ? ' gop-view-btn-open' : ''}`}
                        onClick={() => setExpanded(isExpanded ? null : item.id)}
                      >
                        {isExpanded ? 'Collapse' : 'View / Edit'}
                      </button>
                      <button className="gop-regen-btn" title="Regenerate" onClick={() => generateEmail(item, meta)}>↺</button>
                    </>
                  )}
                  {(status === 'saving' || status === 'sending') && (
                    <span className="gop-status-text">{status === 'sending' ? 'Sending…' : 'Saving…'}</span>
                  )}
                  {status === 'sent' && (
                    <span className="gop-sent-label">Sent</span>
                  )}
                </div>
              </div>

              {/* Subject preview strip (collapsed) */}
              {(status === 'ready' || status === 'confirming' || status === 'saved') && !isExpanded && state.subject && (
                <div className="gop-subject-strip">
                  <span className="gop-subject-label">Subject:</span>
                  {state.subject}
                </div>
              )}

              {/* Error strip */}
              {status === 'error' && state.error && (
                <div className="gop-error-strip">{state.error}</div>
              )}

              {/* Email editor */}
              {isExpanded && (
                <div className="gop-editor">
                  {/* To row */}
                  <div className="gop-to-row">
                    <span className="gop-to-label">To:</span>
                    <input
                      className="gop-to-input"
                      value={toEmail}
                      onChange={e => patchState(item.id, { toEmail: e.target.value })}
                      placeholder="recipient@company.com"
                    />
                    <span className="gop-verify-badge">Verify before sending</span>
                  </div>

                  {/* Fields */}
                  <div className="gop-fields">
                    <div className="gop-field">
                      <label className="gop-field-label">Subject</label>
                      <input
                        className="gop-input"
                        value={state.subject}
                        onChange={e => patchState(item.id, { subject: e.target.value })}
                      />
                    </div>
                    <div className="gop-field">
                      <div className="gop-field-header">
                        <label className="gop-field-label">Body</label>
                        <button
                          className="gop-html-toggle"
                          onClick={() => patchState(item.id, { editingHtml: !state.editingHtml })}
                        >
                          {state.editingHtml ? 'Preview' : 'Edit HTML'}
                        </button>
                      </div>
                      {state.editingHtml ? (
                        <textarea
                          className="gop-textarea"
                          rows={10}
                          value={state.body}
                          onChange={e => patchState(item.id, { body: e.target.value })}
                        />
                      ) : (
                        <div
                          className="gop-preview"
                          dangerouslySetInnerHTML={{ __html: state.body }}
                        />
                      )}
                    </div>
                  </div>

                  {/* Action bar */}
                  <div className="gop-action-bar">
                    {status !== 'confirming' ? (
                      <button className="gop-send-btn" onClick={() => patchState(item.id, { status: 'confirming' })}>
                        <IcSend />
                        Send Email
                      </button>
                    ) : (
                      <div className="gop-confirm-box">
                        <span className="gop-confirm-text">Send to {toEmail}?</span>
                        <button className="gop-confirm-yes" onClick={() => sendEmail(item, meta)}>Yes, send now</button>
                        <button className="gop-confirm-no" onClick={() => patchState(item.id, { status: 'ready' })}>Cancel</button>
                      </div>
                    )}
                    <button className="gop-draft-btn" onClick={() => saveDraft(item, meta)}>Save to Drafts</button>
                    <button className="gop-copy-btn" onClick={() => copyText(`Subject: ${state.subject}\n\n${stripHtml(state.body)}`, item.id)}>
                      {copied === item.id ? 'Copied' : 'Copy'}
                    </button>
                    <button className="gop-regen-small" onClick={() => generateEmail(item, meta)}>Regenerate</button>
                  </div>
                </div>
              )}

            </div>
          )
        })}
      </div>
    </div>
  )
}
