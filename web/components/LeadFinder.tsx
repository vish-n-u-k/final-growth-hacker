'use client'

import { useState } from 'react'
import Link from 'next/link'

interface ScrapedLead {
  id: string
  company: string
  website: string | null
  email: string | null
  reviewText: string
  rating: number
  reviewDate: string | null
  fitScore: number
  fitReason: string
  platform: string
}

interface EmailState {
  status: 'idle' | 'generating' | 'ready' | 'sending' | 'sent' | 'error'
  subject: string
  body: string
  error?: string
}

type PageStatus = 'idle' | 'loading' | 'done' | 'error'

export default function LeadFinder({
  brandName,
  gmailConnected,
  savedLimitations,
}: {
  brandName: string
  gmailConnected: boolean
}) {
  const [url, setUrl] = useState('')
  const [platform, setPlatform] = useState<'shopify' | 'trustpilot'>('shopify')
  const [status, setStatus] = useState<PageStatus>('idle')
  const [leads, setLeads] = useState<ScrapedLead[]>([])
  const [total, setTotal] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [emailStates, setEmailStates] = useState<Record<string, EmailState>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  async function scrape() {
    if (!url.trim()) return
    setStatus('loading')
    setLeads([])
    setTotal(0)
    setErrorMsg('')
    setEmailStates({})
    setExpanded(null)
    try {
      const res = await fetch('/api/lead-finder/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), platform }),
      })
      const data = await res.json() as { leads?: ScrapedLead[]; total?: number; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Scrape failed')
      setLeads(data.leads ?? [])
      setTotal(data.total ?? 0)
      setStatus('done')
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Something went wrong')
      setStatus('error')
    }
  }

  async function generateEmail(lead: ScrapedLead) {
    setEmailStates(prev => ({ ...prev, [lead.id]: { status: 'generating', subject: '', body: '' } }))
    if (expanded === lead.id) setExpanded(null)
    try {
      const res = await fetch('/api/gmail/generate-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospectName: lead.company,
          prospectEmail: lead.email ?? '',
          prospectCompany: lead.company,
          prospectTitle: 'Business Owner',
          prospectContext: `This merchant left a review for a competitor saying: "${lead.reviewText.slice(0, 300)}" — write the email to show how ${brandName} directly solves this problem. Reason they are a good fit: ${lead.fitReason}`,
        }),
      })
      const data = await res.json() as { subject?: string; body?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Generation failed')
      setEmailStates(prev => ({
        ...prev,
        [lead.id]: { status: 'ready', subject: data.subject ?? '', body: data.body ?? '' },
      }))
      setExpanded(lead.id)
    } catch (e: unknown) {
      setEmailStates(prev => ({
        ...prev,
        [lead.id]: { status: 'error', subject: '', body: '', error: e instanceof Error ? e.message : 'Failed' },
      }))
    }
  }

  async function sendEmail(lead: ScrapedLead) {
    const state = emailStates[lead.id]
    if (!state?.subject || !state?.body || !lead.email) return
    setEmailStates(prev => ({ ...prev, [lead.id]: { ...state, status: 'sending' } }))
    try {
      const res = await fetch('/api/gmail/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: lead.email, subject: state.subject, body: state.body }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Send failed')
      setEmailStates(prev => ({ ...prev, [lead.id]: { ...state, status: 'sent' } }))
      setExpanded(null)
    } catch (e: unknown) {
      setEmailStates(prev => ({
        ...prev,
        [lead.id]: { ...state, status: 'error', error: e instanceof Error ? e.message : 'Send failed' },
      }))
    }
  }

  function copyEmail(leadId: string) {
    const state = emailStates[leadId]
    if (!state?.subject || !state?.body) return
    const plain = `Subject: ${state.subject}\n\n${state.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`
    navigator.clipboard.writeText(plain)
    setCopied(leadId)
    setTimeout(() => setCopied(null), 2000)
  }

  function fitLabel(score: number) {
    if (score >= 8) return { label: 'Strong fit', cls: 'lf-fit-high' }
    if (score >= 6) return { label: 'Good fit', cls: 'lf-fit-mid' }
    return { label: 'Possible fit', cls: 'lf-fit-low' }
  }

  function starsText(rating: number) {
    const n = Math.round(rating)
    return '★'.repeat(Math.max(0, Math.min(5, n))) + '☆'.repeat(5 - Math.max(0, Math.min(5, n)))
  }

  function hostname(url: string) {
    try { return new URL(url).hostname.replace('www.', '') } catch { return url }
  }


  return (
    <div className="gh-page">
      <div className="gh-inner">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="gh-header">
          <div>
            <Link href="/gmail-hub" className="gh-back">← Gmail Hub</Link>
            <h1 className="gh-title">
              Lead Finder
              <span className="gh-badge-new">BETA</span>
            </h1>
            <p className="gh-subtitle">
              Scan competitor reviews · AI scores each merchant for product fit · generate targeted outreach
            </p>
          </div>
          <div className="gh-header-right">
            {gmailConnected && (
              <span className="gh-connected-badge">
                <span className="gh-connected-dot" />
                Gmail connected
              </span>
            )}
            <Link href="/gmail-hub" className="gh-hbtn gh-hbtn-outline">Open Gmail Hub</Link>
          </div>
        </div>

        {/* ── Search form ────────────────────────────────────────────── */}
        <div className="lf-form">
          <div className="lf-platform-tabs">
            {(['shopify', 'trustpilot'] as const).map(p => (
              <button
                key={p}
                className={`lf-ptab${platform === p ? ' lf-ptab-active' : ''}`}
                onClick={() => { setPlatform(p); setUrl('') }}
              >
                {p === 'shopify' ? 'Shopify App Store' : 'Trustpilot'}
              </button>
            ))}
          </div>

          <div className="lf-input-row">
            <input
              className="lf-url-input"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && scrape()}
              placeholder={
                platform === 'shopify'
                  ? 'https://apps.shopify.com/competitor-app'
                  : 'https://www.trustpilot.com/review/competitor.com  or  competitor.com'
              }
            />
            <button
              className="lf-find-btn"
              onClick={scrape}
              disabled={status === 'loading' || !url.trim()}
            >
              {status === 'loading' ? 'Analysing...' : 'Find Leads'}
            </button>
          </div>

          <p className="lf-tip">
            {platform === 'shopify'
              ? `We fetch all reviews from the competitor app, then AI scores each merchant 1-10 based on how well ${brandName} solves their specific problem. Only the best matches surface.`
              : `We fetch reviews from the Trustpilot page, then AI scores each reviewer based on how well ${brandName} fits their needs — regardless of star rating.`}
          </p>
        </div>

        {/* ── Loading ─────────────────────────────────────────────────── */}
        {status === 'loading' && (
          <div className="lf-loading">
            <div className="lf-loading-bar" />
            <p className="lf-loading-text">
              Fetching competitor reviews and scoring each one for fit with {brandName}...
            </p>
          </div>
        )}

        {/* ── Error ──────────────────────────────────────────────────── */}
        {status === 'error' && (
          <div className="lf-banner lf-banner-error">{errorMsg}</div>
        )}

        {/* ── Empty state ────────────────────────────────────────────── */}
        {status === 'done' && leads.length === 0 && (
          <div className="lf-empty">
            <div className="lf-empty-icon">0</div>
            <div className="lf-empty-title">No strong matches found</div>
            <p className="lf-empty-body">
              {total > 0
                ? `We scanned ${total} reviews but none scored high enough to be a good lead for ${brandName}. Try a different competitor whose weaknesses better match your strengths.`
                : 'No reviews could be extracted. The URL may be incorrect or the page uses client-side rendering.'}
            </p>
          </div>
        )}

        {/* ── Results ────────────────────────────────────────────────── */}
        {status === 'done' && leads.length > 0 && (
          <div className="lf-results">
            <div className="lf-results-hd">
              <span className="lf-count">{leads.length} leads matched</span>
              <span className="lf-count-sub">from {total} reviews scanned</span>
            </div>

            <div className="lf-grid">
              {leads.map(lead => {
                const es = emailStates[lead.id]
                const isExpanded = expanded === lead.id
                const fit = fitLabel(lead.fitScore)

                return (
                  <div key={lead.id} className={`lf-card${isExpanded ? ' lf-card-open' : ''}`}>

                    {/* Top row */}
                    <div className="lf-card-top">
                      <div>
                        <div className="lf-company">{lead.company}</div>
                        <div className="lf-stars" title={`${lead.rating} stars on competitor`}>
                          {starsText(lead.rating)}
                          <span className="lf-stars-label"> · on competitor</span>
                          {lead.reviewDate && (
                            <span className="lf-review-date">
                              {' · '}{new Date(lead.reviewDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                            </span>
                          )}
                        </div>
                        <div className="lf-store-links">
                          {lead.website ? (
                            <a
                              href={lead.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="lf-store-link lf-store-link-verified"
                            >
                              {hostname(lead.website)} ↗
                            </a>
                          ) : (
                            <span className="lf-store-link lf-store-link-unverified">
                              Store not found on myshopify
                            </span>
                          )}
                          <a
                            href={`https://www.google.com/search?q=${encodeURIComponent(`"${lead.company}" shopify store`)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="lf-store-link lf-store-link-google"
                          >
                            Google ↗
                          </a>
                        </div>
                      </div>
                      <div className="lf-chips">
                        <span className={`lf-fit-badge ${fit.cls}`}>
                          {lead.fitScore}/10 · {fit.label}
                        </span>
                        {lead.email ? (
                          <span className="lf-chip lf-chip-email">{lead.email}</span>
                        ) : (
                          <span className="lf-chip lf-chip-none">No email found</span>
                        )}
                      </div>
                    </div>

                    {/* Why they're a good lead */}
                    <div className="lf-fit-reason">
                      <span className="lf-fit-reason-label">Why ↗</span>
                      <span>{lead.fitReason}</span>
                    </div>

                    {/* Their actual review */}
                    <p className="lf-review">"{lead.reviewText}"</p>

                    {/* Actions */}
                    <div className="lf-actions">
                      {es?.status === 'sent' ? (
                        <span className="lf-sent-badge">Sent</span>
                      ) : (
                        <button
                          className="lf-gen-btn"
                          onClick={() => {
                            if (es?.status === 'ready' && isExpanded) setExpanded(null)
                            else if (es?.status === 'ready') setExpanded(lead.id)
                            else generateEmail(lead)
                          }}
                          disabled={es?.status === 'generating' || es?.status === 'sending'}
                        >
                          {es?.status === 'generating' ? 'Generating...' :
                           es?.status === 'sending'    ? 'Sending...'   :
                           es?.status === 'ready'      ? (isExpanded ? 'Hide email' : 'View email') :
                           es?.status === 'error'      ? 'Retry'        :
                           'Generate Email'}
                        </button>
                      )}
                      {es?.status === 'ready' && (
                        <button className="lf-regen-btn" onClick={() => generateEmail(lead)}>
                          Regen
                        </button>
                      )}
                    </div>

                    {es?.status === 'error' && es.error && (
                      <div className="lf-card-err">{es.error}</div>
                    )}

                    {/* Email preview */}
                    {isExpanded && es?.status === 'ready' && (
                      <div className="lf-preview">
                        <div className="lf-preview-subject">
                          <span className="lf-preview-label">Subject</span>
                          <span className="lf-preview-subj-text">{es.subject}</span>
                        </div>
                        <div className="lf-preview-body">
                          <iframe
                            srcDoc={es.body}
                            title="Email preview"
                            className="lf-iframe"
                            sandbox=""
                          />
                        </div>
                        <div className="lf-preview-footer">
                          <button className="lf-copy-btn" onClick={() => copyEmail(lead.id)}>
                            {copied === lead.id ? 'Copied!' : 'Copy email'}
                          </button>
                          {gmailConnected && lead.email && (
                            <button
                              className="lf-send-btn"
                              onClick={() => sendEmail(lead)}
                              disabled={emailStates[lead.id]?.status === 'sending'}
                            >
                              Send to {lead.email}
                            </button>
                          )}
                          {!gmailConnected && (
                            <Link href="/gmail-hub" className="lf-connect-hint">
                              Connect Gmail to send
                            </Link>
                          )}
                          {gmailConnected && !lead.email && (
                            <span className="lf-no-email-note">
                              No email found — copy and send manually
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
