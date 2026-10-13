'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { TodayActivity as Activity } from '@/app/api/today/activity/route'

// "What happened" on Today: visitors, new signups (and where each came from), returning users
// and top sources for the last 24 hours or 7 days. Data: /api/today/activity (PostHog).

function ago(iso: string): string {
  const min = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000))
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

function Delta({ current, prior }: { current: number; prior: number }) {
  if (prior <= 0 || current === prior) return null
  const pct = Math.round(((current - prior) / prior) * 100)
  return <span className={`ta-delta ${pct > 0 ? 'ta-delta--up' : 'ta-delta--dn'}`}>{pct > 0 ? '↑' : '↓'}{Math.abs(pct)}%</span>
}

export default function TodayActivity() {
  const [days, setDays] = useState<1 | 7>(1)
  const [data, setData] = useState<Activity | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch(`/api/today/activity?days=${days}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: Activity | null) => { if (alive) setData(d) })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [days])

  if (!loading && !data) return null

  if (data && !data.connected) {
    return (
      <section className="ta ta--connect">
        <div>
          <div className="ta-title">What happened</div>
          <p className="ta-muted">See who visits, who signs up and where they come from.</p>
        </div>
        <Link href="/settings?tab=integrations" className="ta-connect">Connect PostHog →</Link>
      </section>
    )
  }

  const period = days === 1 ? 'the last 24 hours' : 'the last 7 days'
  const quiet = data && data.visitors.current === 0 && data.signups.count === 0

  return (
    <section className="ta" aria-busy={loading}>
      <div className="ta-head">
        <div className="ta-title">What happened</div>
        <div className="ta-toggle" role="tablist" aria-label="Period">
          <button type="button" role="tab" aria-selected={days === 1} className={days === 1 ? 'is-on' : ''} onClick={() => setDays(1)}>24 hours</button>
          <button type="button" role="tab" aria-selected={days === 7} className={days === 7 ? 'is-on' : ''} onClick={() => setDays(7)}>7 days</button>
        </div>
      </div>

      {loading && !data ? (
        <div className="ta-stats">
          {[0, 1, 2].map(i => <div key={i} className="ta-stat ta-stat--skel" />)}
        </div>
      ) : data && quiet ? (
        <p className="ta-muted ta-quiet">Quiet {days === 1 ? 'day' : 'week'}: no visitors in {period}.</p>
      ) : data && (
        <div className={loading ? 'ta-dim' : undefined}>
          <div className="ta-stats">
            <div className="ta-stat">
              <span className="ta-num">{data.visitors.current.toLocaleString()} <Delta current={data.visitors.current} prior={data.visitors.prior} /></span>
              <span className="ta-label">visitors</span>
            </div>
            <div className="ta-stat">
              <span className="ta-num">{data.signups.count.toLocaleString()} <Delta current={data.signups.count} prior={data.signups.prior} /></span>
              <span className="ta-label">new signups</span>
            </div>
            <div className="ta-stat">
              <span className="ta-num">{data.returning.toLocaleString()}</span>
              <span className="ta-label">came back</span>
            </div>
          </div>

          {data.signups.people.length > 0 && (
            <div className="ta-block">
              <div className="ta-sub">New signups</div>
              <ul className="ta-people">
                {data.signups.people.map((p, i) => (
                  <li key={i} className="ta-person">
                    <span className="ta-avatar" aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span>
                    <span className="ta-person-main">
                      <b>{p.name}</b>
                      <span className="ta-muted">
                        from {p.source}{p.country ? ` · ${p.country}` : ''}{p.landing && p.landing !== '/' ? ` · landed on ${p.landing}` : ''}
                      </span>
                    </span>
                    <span className="ta-time">{ago(p.at)}</span>
                  </li>
                ))}
              </ul>
              {data.signups.count > data.signups.people.length && (
                <p className="ta-muted ta-more">+{data.signups.count - data.signups.people.length} more</p>
              )}
            </div>
          )}

          {data.channels.length > 0 && (
            <div className="ta-block">
              <div className="ta-sub">Where visitors came from</div>
              <ul className="ta-bars">
                {data.channels.map(c => (
                  <li key={c.name}>
                    <span className="ta-bar-name">{c.name}</span>
                    <span className="ta-bar"><i style={{ width: `${Math.max(4, (c.visitors / Math.max(...data.channels.map(x => x.visitors))) * 100)}%` }} /></span>
                    <span className="ta-bar-num">{c.visitors}</span>
                  </li>
                ))}
              </ul>
              {data.referrers.length > 0 && (
                <div className="ta-chips">
                  {data.referrers.map(r => <span key={r.domain} className="ta-chip">{r.domain} <b>{r.visitors}</b></span>)}
                </div>
              )}
            </div>
          )}

          {data.pages.length > 0 && (
            <div className="ta-block">
              <div className="ta-sub">Most viewed pages</div>
              <div className="ta-chips">
                {data.pages.map(p => <span key={p.path} className="ta-chip">{p.path} <b>{p.visitors}</b></span>)}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
