'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Spinner } from '@/components/ui/spinner'
import { bars } from './model'

// Lead Finder, LinkedIn source: find the people who could buy, by job title, industry, company size,
// website technology and country (Apify, through /api/lead-finder/linkedin). The form starts filled in
// from what GrowJin knows about the brand's website (/api/lead-finder/linkedin/suggest). Each person is
// scored for fit and shown with their company's website. The ones picked go to "Your list", which checks
// repeats and opt-outs, writes one email for everyone and sends within the daily limit.

interface Lead {
  id: string
  name: string
  title: string | null
  email: string | null
  emailShared: boolean
  linkedinUrl: string | null
  company: string | null
  domain: string | null
  website: string | null
  companyDescription: string | null
  companySize: number | null
  industry: string | null
  location: string | null
  fitScore: number | null
  fitReason: string | null
}

interface Suggested { jobTitles: string[]; industries: string[]; keywords: string[]; countries: string[]; sizes: string[]; technologies: string[]; why: string }

type Phase = 'idle' | 'running' | 'done' | 'failed'
type Detect = 'detecting' | 'done' | 'none'

const GOOD = 6
const SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000']
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?'
const csv = (l: string[]) => l.join(', ')

export default function LinkedInPanel({ ready, brandName, onAdd }: {
  ready: boolean                                        // APIFY_API_TOKEN is set on the server
  brandName: string
  onAdd: (people: { email: string; name: string }[]) => void
}) {
  const [titles, setTitles] = useState('')
  const [industries, setIndustries] = useState('')
  const [keywords, setKeywords] = useState('')
  const [technologies, setTechnologies] = useState('')
  const [countries, setCountries] = useState('')
  const [sizes, setSizes] = useState<string[]>([])
  const [count, setCount] = useState(25)
  const [why, setWhy] = useState('')
  const [detect, setDetect] = useState<Detect>('detecting')
  const [detectNote, setDetectNote] = useState('')
  const touched = useRef(false)                         // the user typed before the detection finished

  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)

  const detectNow = useCallback(async (force: boolean) => {
    setDetect('detecting'); setDetectNote('')
    try {
      const res = await fetch('/api/lead-finder/linkedin/suggest')
      const j = await res.json().catch(() => ({})) as { filters?: Suggested; error?: string }
      if (!res.ok || !j.filters) throw new Error(j.error ?? 'We could not work out who to look for. Fill the search in by hand.')
      if (force || !touched.current) {
        const f = j.filters
        setTitles(csv(f.jobTitles)); setIndustries(csv(f.industries)); setKeywords(csv(f.keywords))
        setTechnologies(csv(f.technologies)); setCountries(csv(f.countries)); setSizes(f.sizes); setWhy(f.why)
      }
      setDetect('done')
    } catch (e) {
      setDetectNote(e instanceof Error ? e.message : 'We could not work out who to look for. Fill the search in by hand.')
      setDetect('none')
    }
  }, [])

  useEffect(() => { if (ready) detectNow(false); else setDetect('none') }, [ready, detectNow])

  const edit = (set: (v: string) => void) => (v: string) => { touched.current = true; set(v) }
  const canSearch = ready && !!(titles.trim() || industries.trim() || keywords.trim() || technologies.trim())

  async function search() {
    if (!canSearch || phase === 'running') return
    setPhase('running'); setError(''); setLeads([]); setPicked(new Set()); setOpen(null)
    try {
      const res = await fetch('/api/lead-finder/linkedin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobTitles: titles, industries, keywords, technologies, countries, sizes, count }),
      })
      const j = await res.json().catch(() => ({})) as { leads?: Lead[]; error?: string; upgrade?: boolean }
      if (!res.ok) throw new Error(j.upgrade ? 'LinkedIn search is part of GrowJin Pro.' : j.error ?? 'The search did not work. Try again.')
      const found = j.leads ?? []
      setLeads(found)
      // Tick people with their own email who look like buyers (or weren't scored)
      setPicked(new Set(found.filter(l => l.email && !l.emailShared && (l.fitScore === null || l.fitScore >= GOOD)).map(l => l.id)))
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The search did not work. Try again.')
      setPhase('failed')
    }
  }

  const toggle = (id: string) => setPicked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const toggleSize = (s: string) => { touched.current = true; setSizes(prev => (prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])) }
  const chosen = leads.filter(l => picked.has(l.id) && l.email)

  const field = (label: string, value: string, set: (v: string) => void, placeholder: string) => (
    <label className="lfh-field lfh-li-f">{label}
      <input value={value} onChange={e => edit(set)(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} placeholder={placeholder} disabled={detect === 'detecting'} />
    </label>
  )

  return <>
    <section className="lfh-hero lfh-li">
      <div className="lfh-grow lfh-col">
        <p className="lfh-bigline">People who could buy from {brandName}</p>
        <div className="lfh-meta">
          {detect === 'detecting' && <><Spinner />Reading what we know about your website to fill this in…</>}
          {detect === 'done' && <>{why || 'Filled in from your website.'} <button type="button" className="th-link lfh-linklike" onClick={() => detectNow(true)}>Fill in again</button></>}
          {detect === 'none' && ready && <>{detectNote} <button type="button" className="th-link lfh-linklike" onClick={() => detectNow(true)}>Try again</button></>}
        </div>
        <div className="lfh-li-grid">
          {field('Job titles', titles, setTitles, 'Founder, Head of Marketing')}
          {field('Industries', industries, setIndustries, 'Retail, Apparel & Fashion')}
          {field('Website runs on', technologies, setTechnologies, 'Shopify')}
          {field('Company keywords', keywords, setKeywords, 'sportswear, handmade')}
          {field('Country (optional)', countries, setCountries, 'United States, Toronto')}
        </div>
        <div className="lfh-li-sizes" role="group" aria-label="Company size">
          <span className="lfh-lab">Company size</span>
          {SIZES.map(s => (
            <button key={s} type="button" className="lfh-chip" aria-pressed={sizes.includes(s)} onClick={() => toggleSize(s)} disabled={detect === 'detecting'}>{s}</button>
          ))}
        </div>
        <div className="lfh-meta">Separate several with commas. Every person comes with a work email checked by the data provider. Only contact people you have a real business reason to write to.</div>
        {!ready && <div className="lfh-meta lfh-warn">LinkedIn search needs GrowJin&apos;s Apify account, which isn&apos;t set up yet.</div>}
      </div>
      <div className="lfh-actbox">
        <button type="button" className="lfh-act" disabled={!canSearch || phase === 'running' || detect === 'detecting'} onClick={search}>
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
      <div className="lfh-empty">Nobody matched with a checked email. Try fewer filters: drop the country or the company size, or use broader job titles.</div>
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
                </button>
                {l.website && <a className="lfh-li-site" href={l.website} target="_blank" rel="noopener noreferrer" title={`Open ${l.domain}`}>{l.domain} ↗</a>}
                <span className="lfh-right">
                  {!l.email && <span className="lfh-meta">No email</span>}
                  {l.email && l.emailShared && <span className="lfh-meta" title="A shared inbox, not the person's own address">Shared inbox</span>}
                  {l.fitScore !== null && (
                    <span className="lfh-fit" title={`Fit ${l.fitScore} of 10`} aria-label={`Fit ${l.fitScore} of 10`}>
                      {[1, 2, 3, 4].map(i => <i key={i} className={i <= bars(l.fitScore!) ? 'on' : ''} />)}
                    </span>
                  )}
                </span>
                {isOpen && (
                  <div className="lfh-li-more">
                    {l.fitReason && <p><b>Why:</b> {l.fitReason}</p>}
                    {l.companyDescription && <p>{l.companyDescription}</p>}
                    <div className="lfh-meta">
                      {l.email && <span>{l.email}</span>}
                      {l.companySize && <span>{l.companySize} {l.companySize === 1 ? 'person' : 'people'}</span>}
                      {[l.industry, l.location].filter(Boolean).length > 0 && <span>{[l.industry, l.location].filter(Boolean).join(' · ')}</span>}
                      {l.linkedinUrl && <a href={l.linkedinUrl} target="_blank" rel="noopener noreferrer">LinkedIn ↗</a>}
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
