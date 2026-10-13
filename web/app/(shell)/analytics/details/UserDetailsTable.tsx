'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import PersonPanel from '@/components/PersonPanel'
import { normalizeSource } from '@/lib/posthog/source'

// "View details" for an Analytics card: the full user table (restored from the earlier analytics
// page). Data: /api/analytics/users. Column headers with ▼ can be mapped to any PostHog property,
// saved per brand via /api/analytics/col-fields.

export type DetailType = 'signups' | 'signins' | 'dau' | 'deleted'
type Range = '24h' | '7d' | '30d'
type ColKey = 'name' | 'email' | 'source' | 'location' | 'plan'

interface UserRow {
  name: string | null
  email: string
  userId: string
  timestamp: string
  source: string | null
  location: string | null
  plan: string | null
  referringDomain: string | null
  landingUrl: string | null
  utmSource: string | null
  device: string | null
}

const TITLE: Record<DetailType, string> = {
  signups: 'New signups', signins: 'Sign-ins', dau: 'Active users', deleted: 'Deleted accounts',
}
const TIME_LABEL: Record<DetailType, string> = {
  signups: 'Signed up', signins: 'Signed in', dau: 'Last seen', deleted: 'Deleted',
}
const RANGES: { key: Range; label: string }[] = [
  { key: '24h', label: '24 hours' }, { key: '7d', label: '7 days' }, { key: '30d', label: '30 days' },
]
export const DEFAULT_COL_FIELDS: Record<ColKey, string> = {
  name: '$email', email: '$email', source: '$channel_type', location: '$geoip_country_name', plan: 'plan',
}

function fmtTs(ts: string): string {
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ts
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function landingPath(url: string | null): string | null {
  if (!url) return null
  try { return new URL(url).pathname } catch { return url }
}

function referrerLabel(domain: string | null): string {
  if (!domain || domain === '$direct') return 'Direct'
  return domain.replace(/^www\./, '')
}

function ColumnPicker({ label, value, properties, onChange }: {
  label: string
  value: string
  properties: { name: string }[]
  onChange: (field: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (dropRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <span className="ud-colpick">
      {label}
      <button
        ref={btnRef}
        type="button"
        className="ud-colpick-btn"
        title={`Shows PostHog field: ${value || 'not set'}. Click to change.`}
        onClick={() => {
          const r = btnRef.current?.getBoundingClientRect()
          if (r) setPos({ top: r.bottom + 6, left: r.left })
          setOpen(v => !v)
        }}
      >▾</button>
      {open && (
        <div ref={dropRef} className="ud-colpick-menu" style={{ top: pos.top, left: pos.left }}>
          <div className="ud-colpick-head">PostHog field</div>
          <div className="ud-colpick-list">
            {[{ name: 'distinct_id' }, ...properties].map(p => (
              <button key={p.name} type="button" className={p.name === value ? 'is-on' : ''} onClick={() => { onChange(p.name); setOpen(false) }}>
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </span>
  )
}

export default function UserDetailsTable({ brandId, type, range: initialRange, savedColFields }: {
  brandId: string
  type: DetailType
  range: Range
  savedColFields: Record<string, string> | null
}) {
  const router = useRouter()
  const [range, setRange] = useState<Range>(initialRange)
  const [colFields, setColFields] = useState<Record<string, string>>({ ...DEFAULT_COL_FIELDS, ...(savedColFields ?? {}) })
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [properties, setProperties] = useState<{ name: string }[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/posthog/properties')
      .then(r => r.ok ? r.json() : null)
      .then((d: { properties?: { name: string }[] } | null) => { if (d?.properties?.length) setProperties(d.properties) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({
      brandId, type, range,
      colName: colFields.name, colEmail: colFields.email,
      colSource: colFields.source, colLocation: colFields.location, colPlan: colFields.plan,
    })
    fetch(`/api/analytics/users?${params}`)
      .then(r => r.ok ? r.json() : { users: [] })
      // Source falls back to the first referrer / UTM when the mapped PostHog field is empty.
      .then((d: { users?: UserRow[] }) => setUsers((d.users ?? []).map(u => ({
        ...u,
        source: u.source || (u.referringDomain || u.utmSource ? normalizeSource(u.utmSource ?? '', u.referringDomain ?? '') : null),
      }))))
      .catch(() => setUsers([]))
      .finally(() => setLoading(false))
  }, [brandId, type, range, colFields])

  function changeRange(next: Range) {
    setRange(next)
    router.replace(`/analytics/details?type=${type}&range=${next}`, { scroll: false })
  }

  function changeCol(col: string, field: string) {
    const next = { ...colFields, [col]: field }
    setColFields(next)
    void fetch('/api/analytics/col-fields', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandId, colFields: next }),
    })
  }

  function copy(text: string, msg: string) {
    void navigator.clipboard?.writeText(text)
    setToast(msg)
    window.setTimeout(() => setToast(null), 2000)
  }

  const head = (key: ColKey | null, label: string) =>
    key && properties.length > 0
      ? <ColumnPicker label={label} value={colFields[key] ?? ''} properties={properties} onChange={f => changeCol(key, f)} />
      : label

  const emails = users.map(u => u.email).filter(Boolean)

  return (
    <div className="ud-page">
      {toast && <div className="ud-toast" role="status">{toast}</div>}

      <div className="ud-head">
        <Link href="/analytics" className="ud-back" aria-label="Back to Analytics">←</Link>
        <div>
          <h1 className="ud-title">{TITLE[type]}</h1>
          <p className="ud-count">{loading ? 'Loading…' : `${users.length}${users.length === 100 ? '+' : ''} result${users.length === 1 ? '' : 's'}`}</p>
        </div>
      </div>

      <div className="ud-bar">
        <div className="ta-toggle" role="tablist" aria-label="Period">
          {RANGES.map(r => (
            <button key={r.key} type="button" role="tab" aria-selected={range === r.key} className={range === r.key ? 'is-on' : ''} onClick={() => changeRange(r.key)}>{r.label}</button>
          ))}
        </div>
        <span className="ud-hint">Headers with ▾ can show any PostHog field · click a name to see their journey</span>
        <button type="button" className="ud-copy-all" disabled={loading || emails.length === 0} onClick={() => copy(emails.join(', '), `Copied ${emails.length} email${emails.length === 1 ? '' : 's'}`)}>
          Copy all emails
        </button>
      </div>

      <div className="ud-card">
        {loading ? (
          <p className="ud-empty">Loading users…</p>
        ) : users.length === 0 ? (
          <p className="ud-empty">No users in this time range.</p>
        ) : (
          <>
            {/* Desktop: full table */}
            <div className="ud-table-wrap">
              <table className="ud-table">
                <thead>
                  <tr>
                    <th>{head('name', 'User')}</th>
                    <th>User ID</th>
                    <th>{head('email', 'Email')}</th>
                    <th>{TIME_LABEL[type]}</th>
                    <th>{head('source', 'Source')}</th>
                    <th>{head('location', 'Location')}</th>
                    <th>{head('plan', 'Plan')}</th>
                    <th>Referred from</th>
                    <th>Landing page</th>
                    <th>Device</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u, i) => {
                    const key = `${u.userId}-${i}`
                    const open = openId === key
                    return (
                      <Fragment key={key}>
                        <tr className={open ? 'is-open' : undefined}>
                          <td>
                            <button type="button" className="ud-name" onClick={() => setOpenId(open ? null : key)} aria-expanded={open}>
                              {u.name || u.email || '—'}
                            </button>
                          </td>
                          <td className="ud-id" title={u.userId}>{u.userId}</td>
                          <td>
                            <span className="ud-email">
                              {u.email || '—'}
                              {u.email && <button type="button" className="ud-copy" title="Copy email" onClick={() => copy(u.email, `Copied ${u.email}`)}>⧉</button>}
                            </span>
                          </td>
                          <td>{fmtTs(u.timestamp)}</td>
                          <td>{u.source ? <span className="ud-pill ud-pill--green">{u.source}</span> : <span className="ud-dim">—</span>}</td>
                          <td>{u.location ?? <span className="ud-dim">—</span>}</td>
                          <td>{u.plan ? <span className="ud-pill">{u.plan}</span> : <span className="ud-dim">—</span>}</td>
                          <td>
                            <span className="ud-pill">{referrerLabel(u.referringDomain)}</span>
                            {u.utmSource && <span className="ud-pill ud-pill--green">utm: {u.utmSource}</span>}
                          </td>
                          <td className="ud-path" title={u.landingUrl ?? ''}>{landingPath(u.landingUrl) ?? <span className="ud-dim">—</span>}</td>
                          <td>{u.device ?? <span className="ud-dim">—</span>}</td>
                        </tr>
                        {open && /^[0-9a-f-]{36}$/i.test(u.userId) && (
                          <tr className="ud-journey-row"><td colSpan={10}><PersonPanel id={u.userId} /></td></tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Phones: one card per user */}
            <div className="ud-cards">
              {users.map((u, i) => {
                const key = `${u.userId}-${i}`
                const open = openId === key
                const rows: [string, React.ReactNode][] = [
                  ['Email', u.email ? <span className="ud-email">{u.email}<button type="button" className="ud-copy" title="Copy email" onClick={() => copy(u.email, `Copied ${u.email}`)}>⧉</button></span> : '—'],
                  [TIME_LABEL[type], fmtTs(u.timestamp)],
                  ['Source', u.source ? <span className="ud-pill ud-pill--green">{u.source}</span> : '—'],
                  ['Location', u.location ?? '—'],
                  ['Plan', u.plan ? <span className="ud-pill">{u.plan}</span> : '—'],
                  ['Referred from', <span key="ref"><span className="ud-pill">{referrerLabel(u.referringDomain)}</span>{u.utmSource && <span className="ud-pill ud-pill--green">utm: {u.utmSource}</span>}</span>],
                  ['Landing page', landingPath(u.landingUrl) ?? '—'],
                  ['Device', u.device ?? '—'],
                  ['User ID', <span key="id" className="ud-id">{u.userId}</span>],
                ]
                return (
                  <div key={key} className="ud-mcard">
                    <div className="ud-mcard-name">{u.name || u.email || '—'}</div>
                    <dl>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
                    {/^[0-9a-f-]{36}$/i.test(u.userId) && (
                      <button type="button" className="ud-journey-btn" onClick={() => setOpenId(open ? null : key)} aria-expanded={open}>
                        {open ? 'Hide journey' : 'See journey'}
                      </button>
                    )}
                    {open && <PersonPanel id={u.userId} />}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
