'use client'

import { useEffect, useState } from 'react'
import type { PersonDetail } from '@/app/api/today/person/route'

// Everything PostHog knows about one person (how they found you, location, device, activity).
// Used on Today's signups, Analytics card details and Acquisition & Journeys.

export function ago(iso: string): string {
  const t = new Date(iso).getTime()
  if (isNaN(t)) return ''
  const min = Math.max(0, Math.floor((Date.now() - t) / 60_000))
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

function when(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Details for one signup: how they found you, location, device and what they did.
export default function PersonPanel({ id }: { id: string }) {
  const [p, setP] = useState<PersonDetail | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    fetch(`/api/today/person?id=${encodeURIComponent(id)}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setP)
      .catch(() => setFailed(true))
  }, [id])

  if (failed) return <div className="ta-panel"><p className="ta-muted">Couldn&apos;t load this person&apos;s details.</p></div>
  // Placeholder shaped like the details (label / value rows), so opening a person doesn't jump.
  if (!p) return (
    <div className="ta-panel ta-panel--loading" role="status" aria-label="Loading details">
      <dl className="ta-dl">
        {[62, 48, 70, 40, 55].map((w, i) => (
          <div key={i}><dt><span className="skel ta-skel ta-skel--label" /></dt><dd><span className="skel ta-skel" style={{ width: `${w}%` }} /></dd></div>
        ))}
      </dl>
    </div>
  )

  const rows: [string, string][] = [
    ['How they found you', p.foundVia],
    ['Referring page', p.source.referrer],
    ['Campaign', [p.source.utmSource, p.source.utmMedium, p.source.utmCampaign].filter(Boolean).join(' · ')],
    ['First page', p.source.landing],
    ['Location', [p.location.city, p.location.country].filter(Boolean).join(', ')],
    ['Device', [p.device.type, p.device.os, p.device.browser].filter(Boolean).join(' · ')],
    ['Email', p.email],
    ['Signed up', when(p.signedUpAt)],
    ['Activity', `${p.activity.sessions} visit${p.activity.sessions === 1 ? '' : 's'} · ${p.activity.pageviews} page${p.activity.pageviews === 1 ? '' : 's'} viewed`],
    ['Last seen', p.activity.lastSeen ? ago(p.activity.lastSeen) : ''],
  ]

  return (
    <div className="ta-panel">
      <dl className="ta-dl">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
      {p.recent.length > 0 && (
        <>
          <div className="ta-sub ta-sub--panel">Recent activity</div>
          <ol className="ta-timeline">
            {p.recent.map((e, i) => <li key={i}><span>{e.label}</span><time>{ago(e.at)}</time></li>)}
          </ol>
        </>
      )}
    </div>
  )
}
