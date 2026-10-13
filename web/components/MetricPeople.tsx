'use client'

import { useEffect, useState } from 'react'
import PersonPanel, { ago } from '@/components/PersonPanel'
import { normalizeSource } from '@/lib/posthog/source'

// "View details" for an Analytics card: the people behind the number, each one expandable to
// their full journey. Data: /api/analytics/users (PostHog).

export type MetricType = 'signups' | 'signins' | 'dau' | 'deleted'

interface Row {
  name: string | null
  email: string
  userId: string
  timestamp: string
  source: string | null
  location: string | null
  referringDomain: string | null
  utmSource: string | null
  device: string | null
}

const VERB: Record<MetricType, string> = { signups: 'joined', signins: 'signed in', dau: 'last seen', deleted: 'deleted' }

export default function MetricPeople({ brandId, type, range, title, onClose }: {
  brandId: string
  type: MetricType
  range: '24h' | '7d' | '30d'
  title: string
  onClose: () => void
}) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams({ brandId, type, range })
    fetch(`/api/analytics/users?${params}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((d: { users?: Row[] }) => setRows(d.users ?? []))
      .catch(() => setFailed(true))
  }, [brandId, type, range])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  const period = range === '24h' ? 'last 24 hours' : range === '7d' ? 'last 7 days' : 'last 30 days'

  return (
    <div className="mp-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <aside className="mp-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header className="mp-head">
          <div>
            <h2 className="mp-title">{title}</h2>
            <p className="ta-muted">{period}{rows ? ` · ${rows.length}${rows.length === 100 ? '+' : ''} ${rows.length === 1 ? 'person' : 'people'}` : ''}</p>
          </div>
          <button type="button" className="mp-close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="mp-body">
          {failed ? (
            <p className="ta-muted">Couldn&apos;t load the list. Please try again.</p>
          ) : !rows ? (
            <div className="mp-skel">{[0, 1, 2, 3].map(i => <span key={i} />)}</div>
          ) : rows.length === 0 ? (
            <p className="ta-muted">Nobody in the {period}.</p>
          ) : (
            <ul className="aj-people">
              {rows.map((r, i) => {
                const id = r.userId
                const open = openId === `${id}-${i}`
                const display = r.name || r.email || 'Someone'
                const source = r.source || normalizeSource(r.utmSource ?? '', r.referringDomain ?? '')
                const bits = [source && `from ${source}`, r.location, r.device].filter(Boolean).join(' · ')
                return (
                  <li key={`${id}-${i}`} className={`ta-person-wrap${open ? ' is-open' : ''}`}>
                    <button type="button" className="ta-person" onClick={() => setOpenId(open ? null : `${id}-${i}`)} aria-expanded={open}>
                      <span className="ta-avatar" aria-hidden="true">{display.slice(0, 1).toUpperCase()}</span>
                      <span className="ta-person-main">
                        <b>{display}</b>
                        {bits && <span className="ta-muted">{bits}</span>}
                      </span>
                      <span className="ta-time">{r.timestamp ? `${VERB[type]} ${ago(r.timestamp)}` : ''}</span>
                      <svg className="ta-chev" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 8l5 5 5-5" /></svg>
                    </button>
                    {open && /^[0-9a-f-]{36}$/i.test(id) && <PersonPanel id={id} />}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </aside>
    </div>
  )
}
