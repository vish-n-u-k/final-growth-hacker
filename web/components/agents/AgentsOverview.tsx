import Link from 'next/link'
import type { AgentUsage } from '@/lib/agents/store'
import { DemoBanner, LeadIcon, SearchIcon } from './shared'
import type { ServiceStatus } from '@/lib/agents/services'

export interface AgentSummary {
  enabled: boolean
  setUp: boolean
  lastRunAt: string | null
  stats: [string, string][]
}
export interface Approval { tag: string; tone: string; title: string; detail: string; href: string; cta: string }

function ago(iso: string | null): string {
  if (!iso) return 'not run yet'
  const h = Math.round((Date.now() - Date.parse(iso)) / 3_600_000)
  return h < 1 ? 'last run just now' : h < 24 ? `last run ${h} h ago` : `last run ${Math.round(h / 24)} d ago`
}

function AgentCard({ name, when, desc, icon, s, href }: { name: string; when: string; desc: string; icon: React.ReactNode; s: AgentSummary; href: string }) {
  return (
    <section className="ag-card">
      <div className="ag-agent-hd">
        <div className="ag-agent-icon">{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="ag-agent-name">{name}</h2>
          <div className="ag-agent-when">{when}</div>
        </div>
        <span className={`ag-pill ${s.enabled ? 'ag-pill-on' : ''}`}>{s.enabled ? 'On' : s.setUp ? 'Paused' : 'Not set up'}</span>
      </div>
      <p className="ag-desc">{desc}</p>
      {s.setUp && (
        <div className="ag-stats">
          {s.stats.map(([n, label]) => <div key={label} className="ag-stat"><b>{n}</b><span>{label}</span></div>)}
        </div>
      )}
      <div className="ag-row-actions">
        <Link className="ag-btn ag-btn-primary" href={href}>{s.setUp ? 'Open agent' : 'Set up'}</Link>
        <span className="ag-meta ag-meta-right">{ago(s.lastRunAt)}</span>
      </div>
    </section>
  )
}

function ServicesCard({ s }: { s: ServiceStatus }) {
  const d = s.dataforseo, h = s.hunter
  const row = (state: 'on' | 'off' | 'bad', name: string, text: string) => (
    <div className="ag-svc">
      <span className={`ag-svc-dot ag-svc-dot--${state}`} aria-hidden="true" />
      <b>{name}</b>
      <span className="ag-meta">{text}</span>
    </div>
  )
  return (
    <section className="ag-card">
      <div className="ag-row-actions">
        <h2>Data services</h2>
        <span className={`ag-pill ${s.demo ? 'ag-pill-warn' : 'ag-pill-on'}`}>{s.demo ? 'Demo data' : 'Real data'}</span>
      </div>
      {!d.configured
        ? row('off', 'DataForSEO', 'Not set up (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD), so search data is made up.')
        : d.ok
          ? row('on', 'DataForSEO', `Connected${d.balance !== null ? ` · balance $${d.balance.toFixed(2)}` : ''}. Google results, keywords, rankings, AI answers and backlinks are real.`)
          : row('bad', 'DataForSEO', `Keys set but not working: ${d.error ?? 'unknown error'}. Check the API login and API password (not your account password).`)}
      {!h.configured
        ? row('off', 'Hunter', s.demo ? 'Not set up. In demo mode found emails are made up.' : 'Not set up (HUNTER_API_KEY). Emails are only found on websites\' own contact pages.')
        : h.ok
          ? row('on', 'Hunter', `Connected${h.plan ? ` · ${h.plan} plan` : ''}${h.left !== null ? ` · ${h.left}${h.total !== null ? ` of ${h.total}` : ''} credits left` : ''}.${s.demo ? ' Not used until DataForSEO is set up (demo mode).' : ''}`)
          : row('bad', 'Hunter', `Key set but not working: ${h.error ?? 'unknown error'}.`)}
    </section>
  )
}

export default function AgentsOverview({ search, lead, approvals, funnel, usage, demo, services }: {
  search: AgentSummary
  lead: AgentSummary
  approvals: Approval[]
  funnel: [string, number][]
  usage: AgentUsage
  demo: boolean
  services: ServiceStatus
}) {
  const top = Math.max(1, funnel[0]?.[1] ?? 1)
  return (
    <div className="wrap ag-page">
      <div className="st-page-hd">
        <h1 className="st-page-title">AI Agents</h1>
        <p className="st-page-sub">Two agents that work for you on a schedule. Nothing is published or sent until you approve it.</p>
      </div>
      {demo && <DemoBanner />}
      <ServicesCard s={services} />

      <div className="ag-grid2">
        <AgentCard
          name="Search Agent" when="Google + AI answers · weekly" href="/agents/search" s={search} icon={<SearchIcon />}
          desc="Picks keywords you can win, writes posts that beat the #1 result, finds sites that link to your competitors but not you, and tracks your Google rank and whether ChatGPT, Perplexity and Gemini recommend you."
        />
        <AgentCard
          name="Lead Agent" when="Finds, emails and follows up · daily" href="/agents/leads" s={lead} icon={<LeadIcon />}
          desc="Finds people asking for what you sell and unhappy competitor customers, gets a verified email, drafts a personal note, sends from your Gmail and follows up."
        />
      </div>

      <section className="ag-card">
        <div className="ag-row-actions">
          <h2>Needs your OK</h2>
          <span className={`ag-pill ${approvals.length ? 'ag-pill-warn' : ''}`}>{approvals.length} waiting</span>
        </div>
        {approvals.length === 0 && <p className="ag-meta">All clear. Drafts and tasks from your agents show up here.</p>}
        <div className="ag-list">
          {approvals.map(a => (
            <div key={a.title} className="ag-item">
              <span className={`ag-pill ag-item-tag ${a.tone}`}>{a.tag}</span>
              <div className="ag-item-main">
                <div className="ag-item-title">{a.title}</div>
                <div className="ag-item-detail">{a.detail}</div>
              </div>
              <Link className="ag-btn" href={a.href}>{a.cta}</Link>
            </div>
          ))}
        </div>
      </section>

      <div className="ag-grid2">
        <section className="ag-card">
          <h2>Leads so far</h2>
          {funnel.map(([label, n]) => (
            <div key={label} className="ag-bar-row ag-bar-me">
              <div className="ag-bar-label">{label}</div>
              <div className="ag-bar" aria-hidden="true"><div style={{ width: `${Math.round(n / top * 100)}%` }} /></div>
              <div className="ag-bar-num">{n}</div>
            </div>
          ))}
        </section>
        <section className="ag-card">
          <h2>Data used this month</h2>
          <div className="ag-list">
            <div className="ag-item"><div className="ag-item-main"><div className="ag-item-title">Google and AI data (DataForSEO)</div></div><span>${usage.dataforseoUsd.toFixed(2)}</span></div>
            <div className="ag-item"><div className="ag-item-main"><div className="ag-item-title">Email lookups (Hunter)</div></div><span>{usage.hunterLookups}</span></div>
            <div className="ag-item"><div className="ag-item-main"><div className="ag-item-title">AI writing and scoring</div></div><span>${usage.aiUsd.toFixed(2)}</span></div>
          </div>
        </section>
      </div>
    </div>
  )
}
