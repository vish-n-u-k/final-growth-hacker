'use client'

import { useState } from 'react'
import { Spinner } from '@/components/ui/spinner'
import { bars } from './model'

// Lead Finder, LinkedIn source: search people by job title, industry and place (Apify, through
// /api/lead-finder/linkedin), each scored for fit. The ones picked go to "Your list", which checks
// repeats and opt-outs, writes one email for everyone and sends within the daily limit.

interface Lead {
  id: string
  name: string
  title: string | null
  email: string | null
  linkedinUrl: string | null
  company: string | null
  domain: string | null
  industry: string | null
  location: string | null
  fitScore: number | null
  fitReason: string | null
}

type Phase = 'idle' | 'running' | 'done' | 'failed'

const GOOD = 6
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?'

export default function LinkedInPanel({ ready, brandName, onAdd }: {
  ready: boolean                                        // APIFY_API_TOKEN is set on the server
  brandName: string
  onAdd: (people: { email: string; name: string }[]) => void
}) {
  const [titles, setTitles] = useState('')
  const [industries, setIndustries] = useState('')
  const [keywords, setKeywords] = useState('')
  const [places, setPlaces] = useState('')
  const [count, setCount] = useState(25)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)

  const canSearch = ready && !!(titles.trim() || industries.trim() || keywords.trim())

  async function search() {
    if (!canSearch || phase === 'running') return
    setPhase('running'); setError(''); setLeads([]); setPicked(new Set()); setOpen(null)
    try {
      const res = await fetch('/api/lead-finder/linkedin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobTitles: titles, industries, keywords, locations: places, count }),
      })
      const j = await res.json().catch(() => ({})) as { leads?: Lead[]; error?: string; upgrade?: boolean }
      if (!res.ok) throw new Error(j.upgrade ? 'LinkedIn search is part of GrowJin Pro.' : j.error ?? 'The search did not work. Try again.')
      const found = j.leads ?? []
      setLeads(found)
      // Tick the people with an email who look like buyers (or weren't scored)
      setPicked(new Set(found.filter(l => l.email && (l.fitScore === null || l.fitScore >= GOOD)).map(l => l.id)))
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The search did not work. Try again.')
      setPhase('failed')
    }
  }

  const toggle = (id: string) => setPicked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const chosen = leads.filter(l => picked.has(l.id) && l.email)

  const field = (label: string, value: string, set: (v: string) => void, placeholder: string) => (
    <label className="lfh-field lfh-li-f">{label}
      <input value={value} onChange={e => set(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} placeholder={placeholder} />
    </label>
  )

  return <>
    <section className="lfh-hero lfh-li">
      <div className="lfh-grow lfh-col">
        <p className="lfh-bigline">People who could buy from {brandName}</p>
        <div className="lfh-li-grid">
          {field('Job titles', titles, setTitles, 'Head of Marketing, Founder')}
          {field('Industries', industries, setIndustries, 'Retail, Software')}
          {field('Company keywords', keywords, setKeywords, 'ecommerce, saas')}
          {field('Place (optional)', places, setPlaces, 'United States, London')}
        </div>
        <div className="lfh-meta">Separate several with commas. Every person comes with a work email checked by the data provider. Only contact people you have a real business reason to write to.</div>
        {!ready && <div className="lfh-meta lfh-warn">LinkedIn search needs GrowJin&apos;s Apify account, which isn&apos;t set up yet.</div>}
      </div>
      <div className="lfh-actbox">
        <button type="button" className="lfh-act" disabled={!canSearch || phase === 'running'} onClick={search}>
          {phase === 'running' ? <><Spinner />Searching…</> : 'Search LinkedIn'}
        </button>
        <label className="lfh-meta">How many
          <select className="lfh-input lfh-li-n" value={count} onChange={e => setCount(Number(e.target.value))} aria-label="How many people">
            {[10, 25, 50].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
    </section>

    {phase === 'running' && <div className="lfh-checking"><Spinner />Finding people and checking who fits. This can take a minute or two…</div>}
    {phase === 'failed' && <div className="ag-note ag-note-crit">{error}</div>}
    {phase === 'done' && leads.length === 0 && (
      <div className="lfh-empty">Nobody matched with a checked email. Try broader job titles, drop the place, or use fewer keywords.</div>
    )}

    {phase === 'done' && leads.length > 0 && (
      <section className="lfh-li-res">
        <div className="lfh-li-bar">
          <span className="lfh-meta"><b>{leads.length}</b> people found · {chosen.length} picked</span>
          <button type="button" className="btn btn-primary" disabled={chosen.length === 0}
            onClick={() => onAdd(chosen.map(l => ({ email: l.email!, name: l.name })))}>
            Add {chosen.length} to Your list
          </button>
        </div>
        <div className="lfh-li-list">
          {leads.map(l => {
            const isOpen = open === l.id
            return (
              <div key={l.id} className="lfh-tile lfh-li-row">
                <input type="checkbox" checked={picked.has(l.id)} disabled={!l.email} onChange={() => toggle(l.id)} aria-label={`Pick ${l.name}`} />
                <button type="button" className="lfh-li-main" onClick={() => setOpen(isOpen ? null : l.id)} aria-expanded={isOpen}>
                  <span className="lfh-av lfh-av--round">{initials(l.name)}</span>
                  <span className="lfh-tile-t">
                    <span className="lfh-name">{l.name}</span>
                    <span className="lfh-sub">{[l.title, l.company].filter(Boolean).join(' · ') || 'No title listed'}</span>
                  </span>
                  <span className="lfh-right">
                    {!l.email && <span className="lfh-meta">No email</span>}
                    {l.fitScore !== null && (
                      <span className="lfh-fit" title={`Fit ${l.fitScore} of 10`} aria-label={`Fit ${l.fitScore} of 10`}>
                        {[1, 2, 3, 4].map(i => <i key={i} className={i <= bars(l.fitScore!) ? 'on' : ''} />)}
                      </span>
                    )}
                  </span>
                </button>
                {isOpen && (
                  <div className="lfh-li-more">
                    {l.fitReason && <p>{l.fitReason}</p>}
                    <div className="lfh-meta">
                      {l.email && <span>{l.email}</span>}
                      {[l.industry, l.location].filter(Boolean).length > 0 && <span>{[l.industry, l.location].filter(Boolean).join(' · ')}</span>}
                      {l.linkedinUrl && <a href={l.linkedinUrl} target="_blank" rel="noopener noreferrer">LinkedIn ↗</a>}
                      {l.domain && <a href={`https://${l.domain}`} target="_blank" rel="noopener noreferrer">{l.domain} ↗</a>}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>
    )}
  </>
}
