'use client'

import { useState } from 'react'
import { Spinner } from '@/components/ui/spinner'

interface LinkedInLead {
  id: string
  name: string
  title: string | null
  email: string | null
  emailStatus: string | null
  linkedinUrl: string | null
  company: string | null
  domain: string | null
  industry: string | null
  location: string | null
  fitScore: number | null
  fitReason: string | null
}

function fitLabel(score: number) {
  if (score >= 8) return { label: 'Strong fit', cls: 'lf-fit-high' }
  if (score >= 6) return { label: 'Good fit', cls: 'lf-fit-mid' }
  return { label: 'Possible fit', cls: 'lf-fit-low' }
}

type Status = 'idle' | 'loading' | 'done' | 'error'

const fieldStyle = { display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 220px' } as const
const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--text-dim)' } as const

export default function LinkedInLeads({ brandName }: { brandName: string }) {
  const [jobTitles, setJobTitles] = useState('')
  const [industries, setIndustries] = useState('')
  const [locations, setLocations] = useState('')
  const [keywords, setKeywords] = useState('')
  const [count, setCount] = useState(25)
  const [status, setStatus] = useState<Status>('idle')
  const [leads, setLeads] = useState<LinkedInLead[]>([])
  const [errorMsg, setErrorMsg] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saved, setSaved] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const canSearch = !!(jobTitles.trim() || industries.trim() || keywords.trim())

  async function search() {
    if (!canSearch) return
    setStatus('loading')
    setLeads([])
    setSelected(new Set())
    setSaved(null)
    setErrorMsg('')
    try {
      const res = await fetch('/api/lead-finder/linkedin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobTitles, industries, locations, keywords, count }),
      })
      const data = await res.json() as { leads?: LinkedInLead[]; error?: string; upgrade?: boolean }
      if (!res.ok) throw new Error(data.upgrade ? 'LinkedIn lead search is part of GrowJin Pro.' : data.error ?? 'Search failed')
      const found = data.leads ?? []
      setLeads(found)
      // Pre-tick leads with an email that scored well (or weren't scored)
      setSelected(new Set(found.filter(l => l.email && (l.fitScore === null || l.fitScore >= 6)).map(l => l.id)))
      setStatus('done')
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Something went wrong')
      setStatus('error')
    }
  }

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function addToOutreach() {
    const chosen = leads.filter(l => selected.has(l.id) && l.email)
    if (chosen.length === 0) return
    setSaving(true)
    setSaved(null)
    try {
      const res = await fetch('/api/outreach/prospects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospects: chosen.map(l => ({
            email: l.email,
            name: l.name,
            domain: l.domain ?? undefined,
            rawInput: [l.title, l.company, l.linkedinUrl].filter(Boolean).join(' · '),
          })),
        }),
      })
      const data = await res.json() as { ids?: string[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not save')
      const added = data.ids?.length ?? 0
      setSaved(added === chosen.length
        ? `Added ${added} to Outreach.`
        : `Added ${added} to Outreach. ${chosen.length - added} were already saved.`)
    } catch (e: unknown) {
      setSaved(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const selectedWithEmail = leads.filter(l => selected.has(l.id) && l.email).length

  return (
    <>
      <div className="lf-form">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <label style={fieldStyle}>
            <span style={labelStyle}>Job titles</span>
            <input className="lf-url-input" value={jobTitles} onChange={e => setJobTitles(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && search()} placeholder="Head of Marketing, Founder, CMO" />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Industries</span>
            <input className="lf-url-input" value={industries} onChange={e => setIndustries(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && search()} placeholder="Retail, Software" />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Company keywords</span>
            <input className="lf-url-input" value={keywords} onChange={e => setKeywords(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && search()} placeholder="ecommerce, shopify" />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Location (optional)</span>
            <input className="lf-url-input" value={locations} onChange={e => setLocations(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && search()} placeholder="United States, London" />
          </label>
        </div>

        <div className="lf-input-row" style={{ marginTop: 12, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-dim)' }}>
            Leads
            <select className="lf-url-input" style={{ width: 90, flex: 'none' }} value={count}
              onChange={e => setCount(Number(e.target.value))}>
              {[10, 25, 50].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button className="lf-find-btn" onClick={search} disabled={status === 'loading' || !canSearch}>
            {status === 'loading' ? <><Spinner />Searching...</> : 'Find LinkedIn Leads'}
          </button>
        </div>

        <p className="lf-tip">
          Separate several values with commas. We return people matching your filters with a verified work email
          and their LinkedIn profile. AI scores each one for how likely they are to buy from {brandName}, and the best matches are ticked for Outreach. Search for roles that buy
          what you sell, and only contact people you have a legitimate business reason to reach.
        </p>
      </div>

      {status === 'loading' && (
        <div className="lf-loading">
          <div className="lf-loading-bar" />
          <p className="lf-loading-text">Searching for leads. This can take up to a minute or two...</p>
        </div>
      )}

      {status === 'error' && <div className="lf-banner lf-banner-error">{errorMsg}</div>}

      {status === 'done' && leads.length === 0 && (
        <div className="lf-empty">
          <div className="lf-empty-icon">0</div>
          <div className="lf-empty-title">No leads found</div>
          <p className="lf-empty-body">Nothing matched those filters with a verified email. Try broader job titles, drop the location, or use fewer keywords.</p>
        </div>
      )}

      {status === 'done' && leads.length > 0 && (
        <div className="lf-results">
          <div className="lf-results-hd">
            <span className="lf-count">{leads.length} leads found</span>
            <span className="lf-count-sub">{selectedWithEmail} selected</span>
            <button className="lf-find-btn" style={{ marginLeft: 'auto' }}
              onClick={addToOutreach} disabled={saving || selectedWithEmail === 0}>
              {saving ? <><Spinner />Saving...</> : `Add ${selectedWithEmail} to Outreach`}
            </button>
          </div>
          {saved && <div className="lf-banner" role="status">{saved}</div>}

          <div className="lf-grid">
            {leads.map(lead => (
              <div key={lead.id} className="lf-card">
                <div className="lf-card-top">
                  <div>
                    <div className="lf-company">{lead.name}</div>
                    <div className="lf-stars">
                      {[lead.title, lead.company].filter(Boolean).join(' · ') || 'No title listed'}
                    </div>
                    <div className="lf-store-links">
                      {lead.linkedinUrl && (
                        <a href={lead.linkedinUrl} target="_blank" rel="noopener noreferrer"
                          className="lf-store-link lf-store-link-verified">LinkedIn ↗</a>
                      )}
                      {lead.domain && (
                        <a href={`https://${lead.domain}`} target="_blank" rel="noopener noreferrer"
                          className="lf-store-link lf-store-link-google">{lead.domain} ↗</a>
                      )}
                    </div>
                  </div>
                  <div className="lf-chips">
                    {lead.fitScore !== null && (
                      <span className={`lf-fit-badge ${fitLabel(lead.fitScore).cls}`}>
                        {lead.fitScore}/10 · {fitLabel(lead.fitScore).label}
                      </span>
                    )}
                    {lead.email
                      ? <span className="lf-chip lf-chip-email">{lead.email}</span>
                      : <span className="lf-chip lf-chip-none">No email found</span>}
                  </div>
                </div>
                {lead.fitReason && (
                  <div className="lf-fit-reason">
                    <span className="lf-fit-reason-label">Why</span>
                    <span>{lead.fitReason}</span>
                  </div>
                )}
                {(lead.industry || lead.location) && (
                  <div className="lf-fit-reason">
                    <span>{[lead.industry, lead.location].filter(Boolean).join(' · ')}</span>
                  </div>
                )}
                <div className="lf-actions">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <input type="checkbox" checked={selected.has(lead.id)} disabled={!lead.email}
                      onChange={() => toggle(lead.id)} />
                    {lead.email ? 'Add to Outreach' : 'Needs an email to add'}
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
