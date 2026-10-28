'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Spinner } from '@/components/ui/spinner'
import { fmtAgo } from '@/components/agents/shared'
import type { SavedLinkedIn } from '@/lib/leads/linkedin-saved'
import { GROUP_HINT, GROUP_LABEL, GROUP_ORDER, PLATFORM_LABEL, type SocialCheck, type SocialGroup } from '@/lib/leads/social-types'
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
  social?: SocialCheck
}

interface Suggested { jobTitles: string[]; excludeTitles: string[]; industries: string[]; keywords: string[]; countries: string[]; sizes: string[]; technologies: string[]; why: string }

type Phase = 'idle' | 'running' | 'done' | 'failed'
type Detect = 'detecting' | 'done' | 'none'

const GOOD = 6
const SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000']
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?'
const csv = (l: string[]) => l.join(', ')
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

// One grey line under a lead once the social check has run
function socialLine(c: SocialCheck): string {
  if (c.site === 'moved') return `Website now points to ${c.movedTo ?? 'another site'}`
  if (c.site === 'down') return 'Website did not load'
  if (!c.accounts.length) return 'No social accounts on their website'
  const names = c.accounts.map(a => PLATFORM_LABEL[a.platform]).join(' · ')
  if (c.lastPostAt) return `${names} · last post ${day(c.lastPostAt)}${c.lastPostOn ? ` on ${PLATFORM_LABEL[c.lastPostOn]}` : ''}`
  return `${names} · ${c.group === 'inactive' ? 'no posts found' : 'activity not checked'}`
}

export default function LinkedInPanel({ ready, brandName, saved = null, onAdd }: {
  ready: boolean                                        // APIFY_API_TOKEN is set on the server
  brandName: string
  saved?: SavedLinkedIn | null                          // the last search, kept on the server
  onAdd: (people: { email: string; name: string }[]) => void
}) {
  const f0 = saved?.filters
  const [titles, setTitles] = useState(f0?.titles ?? '')
  const [excludeTitles, setExcludeTitles] = useState(f0?.excludeTitles ?? '')
  const [industries, setIndustries] = useState(f0?.industries ?? '')
  const [keywords, setKeywords] = useState(f0?.keywords ?? '')
  const [technologies, setTechnologies] = useState(f0?.technologies ?? '')
  const [countries, setCountries] = useState(f0?.countries ?? '')
  const [sizes, setSizes] = useState<string[]>(f0?.sizes ?? [])
  const [count, setCount] = useState(f0?.count ?? 25)
  const [why, setWhy] = useState(f0?.why ?? '')
  const [detect, setDetect] = useState<Detect>(f0 ? 'done' : 'detecting')
  const [detectNote, setDetectNote] = useState('')
  const [edited, setEdited] = useState(false)           // the user changed the filled-in values, so the sentence above no longer describes them
  const touched = useRef(false)                         // the user typed before the detection finished

  const [phase, setPhase] = useState<Phase>(saved?.searchedAt ? 'done' : 'idle')
  const [searchedAt, setSearchedAt] = useState<string | null>(saved?.searchedAt ?? null)
  const [error, setError] = useState('')
  const [leads, setLeads] = useState<Lead[]>((saved?.leads as Lead[] | undefined) ?? [])
  const [picked, setPicked] = useState<Set<string>>(() => new Set(((saved?.leads as Lead[] | undefined) ?? []).filter(l => l.email && !l.emailShared && (l.fitScore === null || l.fitScore >= GOOD)).map(l => l.id)))
  const [open, setOpen] = useState<string | null>(null)

  const detectNow = useCallback(async (force: boolean) => {
    setDetect('detecting'); setDetectNote('')
    try {
      const res = await fetch('/api/lead-finder/linkedin/suggest')
      const j = await res.json().catch(() => ({})) as { filters?: Suggested; error?: string }
      if (!res.ok || !j.filters) throw new Error(j.error ?? 'We could not work out who to look for. Fill the search in by hand.')
      if (force || !touched.current) {
        const f = j.filters
        setTitles(csv(f.jobTitles)); setExcludeTitles(csv(f.excludeTitles ?? [])); setIndustries(csv(f.industries)); setKeywords(csv(f.keywords))
        setTechnologies(csv(f.technologies)); setCountries(csv(f.countries)); setSizes(f.sizes); setWhy(f.why); setEdited(false)
      }
      setDetect('done')
    } catch (e) {
      setDetectNote(e instanceof Error ? e.message : 'We could not work out who to look for. Fill the search in by hand.')
      setDetect('none')
    }
  }, [])

  useEffect(() => { if (!ready) setDetect('none'); else if (!f0) detectNow(false) }, [ready, detectNow]) // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (set: (v: string) => void) => (v: string) => { touched.current = true; setEdited(true); setWhy(''); set(v) }
  const canSearch = ready && !!(titles.trim() || industries.trim() || keywords.trim() || technologies.trim())

  async function search() {
    if (!canSearch || phase === 'running') return
    setPhase('running'); setError(''); setLeads([]); setPicked(new Set()); setOpen(null)
    try {
      const res = await fetch('/api/lead-finder/linkedin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ why, jobTitles: titles, excludeTitles, industries, keywords, technologies, countries, sizes, count }),
      })
      const j = await res.json().catch(() => ({})) as { leads?: Lead[]; error?: string; upgrade?: boolean }
      if (res.status === 401) throw new Error('You have been signed out. Reload the page and sign in again, then search.')
      if (!res.ok) throw new Error(j.upgrade ? 'LinkedIn search is part of GrowJin Pro.' : j.error ?? 'The search did not work. Try again.')
      const found = j.leads ?? []
      setLeads(found)
      // Tick people with their own email who look like buyers (or weren't scored)
      setPicked(new Set(found.filter(l => l.email && !l.emailShared && (l.fitScore === null || l.fitScore >= GOOD)).map(l => l.id)))
      setSearchedAt(new Date().toISOString())
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The search did not work. Try again.')
      setPhase('failed')
    }
  }

  const toggle = (id: string) => setPicked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const toggleSize = (s: string) => { touched.current = true; setEdited(true); setWhy(''); setSizes(prev => (prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])) }
  const chosen = leads.filter(l => picked.has(l.id) && l.email)
  const [copied, setCopied] = useState(false)
  const [socialBusy, setSocialBusy] = useState(false)
  const [socialError, setSocialError] = useState('')
  const checkedCount = leads.filter(l => l.social).length
  const toCheck = leads.filter(l => l.domain && !l.social).length

  // Looks at each lead's website for social accounts and when they last posted (one run for all of them)
  async function checkSocial() {
    if (socialBusy) return
    setSocialBusy(true); setSocialError('')
    try {
      const res = await fetch('/api/lead-finder/linkedin/social', { method: 'POST' })
      if (res.status === 401) throw new Error('You have been signed out. Reload the page and sign in again.')
      const j = await res.json().catch(() => ({})) as { leads?: Lead[]; error?: string }
      if (!res.ok || !j.leads) throw new Error(j.error ?? 'The social check did not work. Try again.')
      setLeads(j.leads)
      // A website that moved or does not load is not worth writing to: untick it
      setPicked(prev => { const n = new Set(prev); for (const l of j.leads!) if (l.social?.group === 'site') n.delete(l.id); return n })
    } catch (e) {
      setSocialError(e instanceof Error ? e.message : 'The social check did not work. Try again.')
    } finally {
      setSocialBusy(false)
    }
  }
  const pickGroup = (ids: string[], on: boolean) => setPicked(prev => { const n = new Set(prev); for (const id of ids) { if (on) n.add(id); else n.delete(id) } return n })
  async function copyEmails() {
    try {
      await navigator.clipboard.writeText(chosen.map(l => `${l.name} <${l.email}>`).join('\n'))
      setCopied(true); setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard blocked: nothing to do */ }
  }

  const field = (label: string, value: string, set: (v: string) => void, placeholder: string) => (
    <label className="lfh-field lfh-li-f">{label}
      <input value={value} onChange={e => edit(set)(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} placeholder={placeholder} disabled={detect === 'detecting'} />
    </label>
  )

  const row = (l: Lead) => {
    const isOpen = open === l.id
    return (
              <div key={l.id} className="lfh-tile lfh-li-row">
                <input type="checkbox" checked={picked.has(l.id)} disabled={!l.email} onChange={() => toggle(l.id)} aria-label={`Pick ${l.name}`} />
                <button type="button" className="lfh-li-main" onClick={() => setOpen(isOpen ? null : l.id)} aria-expanded={isOpen}>
                  <span className="lfh-av lfh-av--round">{initials(l.name)}</span>
                  <span className="lfh-tile-t">
                    <span className="lfh-name">{l.name}</span>
                    <span className="lfh-sub">{[l.title, l.company].filter(Boolean).join(' · ') || 'No title listed'}</span>
                    {l.email && <span className="lfh-sub lfh-li-mail">{l.email}</span>}
                    {l.social && <span className="lfh-sub lfh-li-soc">{socialLine(l.social)}</span>}
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
                      {l.companySize && <span>{l.companySize} {l.companySize === 1 ? 'person' : 'people'}</span>}
                      {[l.industry, l.location].filter(Boolean).length > 0 && <span>{[l.industry, l.location].filter(Boolean).join(' · ')}</span>}
                      {l.linkedinUrl && <a href={l.linkedinUrl} target="_blank" rel="noopener noreferrer">LinkedIn ↗</a>}
                      {l.social?.accounts.map(a => <a key={a.platform} href={a.url} target="_blank" rel="noopener noreferrer">{PLATFORM_LABEL[a.platform]} ↗</a>)}
                    </div>
                  </div>
                )}
              </div>
    )
  }

  return <>
    <section className="lfh-hero lfh-li">
      <div className="lfh-grow lfh-col">
        <p className="lfh-bigline">People who could buy from {brandName}</p>
        <div className="lfh-meta">
          {detect === 'detecting' && <><Spinner />Reading what we know about your website to fill this in…</>}
          {detect === 'done' && <>{why || (edited ? 'Edited by you.' : 'Filled in from your website.')} <button type="button" className="th-link lfh-linklike" onClick={() => detectNow(true)}>Fill in again</button></>}
          {detect === 'none' && ready && <>{detectNote} <button type="button" className="th-link lfh-linklike" onClick={() => detectNow(true)}>Try again</button></>}
        </div>
        <div className="lfh-li-grid">
          {field('Job titles', titles, setTitles, 'Founder, Head of Marketing')}
          {field('Skip these titles', excludeTitles, setExcludeTitles, 'CTO, Engineer')}
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
          {phase === 'running' ? <><Spinner />Searching…</> : searchedAt ? 'Search again' : 'Search LinkedIn'}
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
          <span className="lfh-meta"><b>{leads.length}</b> people found · {chosen.length} picked{searchedAt && <> · searched {fmtAgo(searchedAt)}. Search again for new people; this list stays until then.</>}</span>
          <span className="lfh-li-bar-r">
            <button type="button" className="btn btn-ghost" disabled={socialBusy || toCheck === 0} onClick={checkSocial}
              title="Reads each company's website for social accounts and checks when they last posted on Instagram and Facebook">
              {socialBusy ? <><Spinner />Checking…</> : toCheck === 0 && checkedCount > 0 ? 'Social media checked' : checkedCount > 0 ? `Check ${toCheck} more` : 'Check social media'}
            </button>
            <button type="button" className="btn btn-ghost" disabled={chosen.length === 0} onClick={copyEmails}>
              {copied ? 'Copied' : `Copy ${chosen.length} email${chosen.length === 1 ? '' : 's'}`}
            </button>
            <button type="button" className="btn btn-primary" disabled={chosen.length === 0}
              onClick={() => onAdd(chosen.map(l => ({ email: l.email!, name: l.name })))}>
              Add {chosen.length} to Your list
            </button>
          </span>
        </div>
        {socialError && <div className="ag-note ag-note-crit">{socialError}</div>}
        {toCheck > 0 && checkedCount === 0 && !socialBusy && <div className="lfh-meta">Not checked yet: <button type="button" className="th-link lfh-linklike" onClick={checkSocial}>check their social media</button> before you add them. It groups people by whether they have accounts and whether they still post.</div>}
        {checkedCount === 0 ? <div className="lfh-li-list">{leads.map(row)}</div> : (
          <div className="lfh-li-groups">
            {[...GROUP_ORDER, 'unchecked' as const].map(g => {
              const list = leads.filter(l => (l.social?.group ?? 'unchecked') === g)
              if (!list.length) return null
              const ids = list.filter(l => l.email).map(l => l.id)
              const allOn = ids.length > 0 && ids.every(id => picked.has(id))
              return (
                <div key={g} className="lfh-li-group">
                  <div className="lfh-li-gh" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '4px 2px 10px' }}>
                    <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <b style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{g === 'unchecked' ? 'Not checked yet' : GROUP_LABEL[g as SocialGroup]}</b>
                        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-dim)', background: 'var(--bg-soft)', borderRadius: 99, padding: '1px 9px' }}>{list.length}</span>
                      </div>
                      {g !== 'unchecked' && <div style={{ fontSize: 13, color: 'var(--text-faint)', marginTop: 2 }}>{GROUP_HINT[g as SocialGroup]}</div>}
                    </div>
                    {ids.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => pickGroup(ids, !allOn)}>{allOn ? 'Unpick these' : 'Pick these'}</button>}
                  </div>
                  <div className="lfh-li-list">{list.map(row)}</div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    )}
  </>
}
