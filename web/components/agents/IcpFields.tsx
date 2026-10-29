'use client'

// The ideal-customer card in the Lead Agent's and Lead Finder's Settings: who the buyers are, how
// they market today, signs of fit and who is NOT a fit, plus a few example customers. "Describe
// them for me" drafts it (op icp_draft); Save keeps it, and a changed card starts the search afresh.

import { useState } from 'react'
import { Spinner } from '@/components/ui/loading'
import type { Icp, IcpKind, LeadSettings } from '@/lib/agents/store'

const KINDS: [IcpKind, string][] = [
  ['saas', 'Software or app founders'],
  ['ecommerce', 'Online stores'],
  ['local', 'Local businesses'],
  ['creator', 'Creators and freelancers'],
  ['other', 'Something else'],
]

const fromLines = (x: string) => x.split('\n').map(v => v.trim()).filter(Boolean)

/** A one-per-line list that keeps what is being typed (blank lines too) until it's saved. */
function Lines({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [text, setText] = useState(value.join('\n'))
  return <textarea rows={3} value={text} onChange={e => { setText(e.target.value); onChange(fromLines(e.target.value)) }} placeholder={placeholder} />
}

export function IcpFields({ s, onChange, label = 'tu-full', quietDefault = false }: {
  s: LeadSettings
  onChange: (patch: Partial<LeadSettings>) => void
  label?: string                 // class for each field (the two Settings forms lay out differently)
  quietDefault?: boolean         // what "not posting lately is a good sign" is when the card doesn't say (from the brand)
}) {
  const icp = s.icp ?? null
  const [examples, setExamples] = useState((icp?.examples ?? []).join(', '))
  const [busy, setBusy] = useState(false)
  const [version, setVersion] = useState(0)    // a new draft resets the lists being typed
  const [err, setErr] = useState('')
  const sites = examples.split(/[\s,]+/).map(v => v.trim()).filter(v => v.includes('.')).slice(0, 5)
  // Any edit makes the card the user's; the plain customer line follows "who"
  const edit = (patch: Partial<Icp>) => {
    const base: Icp = icp ?? { kind: 'other', who: s.customer, marketing: '', fit: [], notFit: [], examples: sites, by: 'user' }
    const next = { ...base, ...patch, by: 'user' as const }
    onChange({ icp: next, customer: next.who })
  }

  async function draft() {
    setBusy(true); setErr('')
    try {
      const res = await fetch('/api/agents/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'icp_draft', examples: sites }) })
      const j = await res.json().catch(() => ({})) as { icp?: Icp; companyQuery?: string; error?: string }
      if (!j.icp) { setErr(j.error ?? 'Couldn’t describe them right now. Try again.'); return }
      onChange({ icp: j.icp, customer: j.icp.who, ...(j.companyQuery ? { companyQuery: j.companyQuery } : {}) })
      setVersion(v => v + 1)
    } catch {
      setErr('Network error. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return <>
    <div className={`${label} icp-head`}>
      <span>Your ideal customer<small>{err || (icp?.by === 'ai' ? 'Filled in by AI from your brand. Change anything.' : sites.length ? `AI uses your brand and ${sites.length === 1 ? 'that site' : `those ${sites.length} sites`}.` : 'Let AI fill the whole card from your brand, then change anything.')}</small></span>
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={draft}>
        {busy ? <><Spinner />Filling in…</> : icp ? 'Fill in again with AI' : 'Fill in with AI'}
      </button>
    </div>
    <label className={`tu-chk ${label} icp-brand`}>
      <input type="checkbox" checked={s.useBrand !== false} onChange={e => onChange({ useBrand: e.target.checked })} />
      <span>Also use my brand profile<small>{s.useBrand !== false
        ? 'Your brand’s audience, keywords and notes help pick who to look for. Where they differ from this card, the card wins.'
        : 'Off: only this card says who to look for. Your brand still tells the AI what you sell, to judge fit and write the emails.'}</small></span>
    </label>
    <label className={`tu-chk ${label} icp-brand`}>
      <input type="checkbox" checked={icp?.quietSocial ?? quietDefault} onChange={e => edit({ quietSocial: e.target.checked })} />
      <span>Not posting on social lately is a good sign<small>Leads whose Instagram or Facebook has been quiet for 3 months, or who have none, move up the list. Checked only for leads that pass the other checks.</small></span>
    </label>
    <label className={label}>Who is your customer?
      <textarea rows={2} value={icp?.who ?? s.customer} onChange={e => (icp ? edit({ who: e.target.value }) : onChange({ customer: e.target.value }))}
        placeholder="e.g. Founders of small SaaS products who do their own marketing" />
    </label>
    <label className={label}>They are
      <select value={icp?.kind ?? 'other'} onChange={e => edit({ kind: e.target.value as IcpKind })}>
        {KINDS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
      </select>
    </label>
    <label className={label}>How they market today
      <input value={icp?.marketing ?? ''} onChange={e => edit({ marketing: e.target.value })} placeholder="e.g. The founder posts on X and LinkedIn themselves" />
    </label>
    <label className={label}>Good fit when… <small>One per line</small>
      <Lines key={`f${version}`} value={icp?.fit ?? []} onChange={fit => edit({ fit })} placeholder="Launched in the last year" />
    </label>
    <label className={label}>Not a fit when… <small>One per line. These are never kept.</small>
      <Lines key={`n${version}`} value={icp?.notFit ?? []} onChange={notFit => edit({ notFit })} placeholder={'Has a marketing team or agency\nHires influencers or creators'} />
    </label>
    <label className={label}>Customers you’d love <small>Optional: 2-5 websites. “Fill in with AI” then finds what they have in common.</small>
      <input value={examples} onChange={e => { setExamples(e.target.value); if (icp) edit({ examples: e.target.value.split(/[\s,]+/).filter(v => v.includes('.')).slice(0, 5) }) }}
        placeholder="e.g. tool-one.com, tool-two.io" />
    </label>
    <p className={`${label} icp-note`}>Saving a changed card starts the search afresh.</p>
  </>
}
