'use client'

import { useEffect, useState } from 'react'
import ProjectedMrr from '@/components/ProjectedMrr'
import { JOURNEY_PHASES } from '@/lib/journey'

// The Road to 500 users timeline: your live user count against the five stages, with Projected MRR
// behind a toggle. It reads the count from PostHog itself (cached for 5 minutes), so it can sit on any page.
export default function RoadToFiveHundred({ posthogConnected }: { posthogConnected: boolean }) {
  const [userCount, setUserCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [dataStartDate, setDataStartDate] = useState<string | null>(null)
  const [mrrOpen, setMrrOpen] = useState(false)

  useEffect(() => {
    if (!posthogConnected) {
      // PostHog not connected: use a manually entered count if there is one.
      try {
        const saved = localStorage.getItem('gh_user_count')
        if (saved) setUserCount(parseInt(saved, 10))
      } catch {}
      return
    }
    // Seed from the cache so the count never flashes 0 while loading.
    const CACHE_TTL = 5 * 60 * 1000
    let skipFetch = false
    try {
      const cached = localStorage.getItem('gh_posthog_count_cache')
      const cachedTs = localStorage.getItem('gh_posthog_count_cache_ts')
      if (cached) {
        setUserCount(parseInt(cached, 10))
        if (cachedTs && Date.now() - parseInt(cachedTs, 10) < CACHE_TTL) skipFetch = true
      }
    } catch {}
    if (skipFetch) return

    setLoading(true)
    fetch('/api/posthog/user-count')
      .then((r) => r.json())
      .then((d: { count?: number; dataStartDate?: string | null }) => {
        // Only trust a non-zero live count; if PostHog returns 0 keep the cache.
        if (d.count) {
          setUserCount(d.count)
          try {
            localStorage.setItem('gh_posthog_count_cache', String(d.count))
            localStorage.setItem('gh_posthog_count_cache_ts', String(Date.now()))
          } catch {}
        }
        if (d.dataStartDate) setDataStartDate(d.dataStartDate)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [posthogConnected])

  if (!posthogConnected) return null

  const currentIdx = Math.max(0, JOURNEY_PHASES.findIndex(p => userCount < p.max))
  const current = JOURNEY_PHASES[currentIdx]
  const next = JOURNEY_PHASES[currentIdx + 1] ?? null
  const cap = current.max === Infinity ? 500 : current.max
  const markerPct = Math.min(Math.max((userCount - current.min) / (cap - current.min), 0.04), 0.96) * 100

  return (
    <section className="gp-journey" aria-label="Road to 500 users">
      <div className="gp-journey-top">
        <div className="gp-journey-status">
          <span className="gp-eyebrow">Road to 500 users</span>
          <span className="gp-count">
            {loading ? <span className="count-loading"><span /><span /><span /></span> : userCount.toLocaleString()}
            <span className="gp-count-label">users<span className="gp-wide-only"> · {current.name}</span></span>
          </span>
        </div>
        <div className="gp-journey-note">
          {next
            ? <>{Math.max(next.min - userCount, 0).toLocaleString()} more to reach <strong>{next.min}</strong><span className="gp-wide-only"> · {next.name}</span></>
            : <>Last stage on the road — keep compounding</>}
          {dataStartDate && (
            <span className="gp-tracking">
              {' '}· since {new Date(dataStartDate + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
            </span>
          )}
        </div>
      </div>
      <div className="gp-bands">
        {JOURNEY_PHASES.map((p, i) => {
          const state = i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'locked'
          return (
            <div key={p.range} className={`gp-band gp-band--${state}`} title={`${p.range} users · ${p.name}`}>
              <span className="gp-band-bar">
                {state === 'current' && <i style={{ width: `${markerPct}%` }} />}
              </span>
              <span className="gp-band-range">{p.range}</span>
              {state === 'current' && <span className="gp-band-name">{p.name}</span>}
            </div>
          )
        })}
      </div>
      <button type="button" className="gp-journey-mrr-toggle" aria-expanded={mrrOpen} onClick={() => setMrrOpen(o => !o)}>
        Projected MRR
        <svg className="gp-journey-mrr-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {mrrOpen && <ProjectedMrr userCount={userCount} loading={loading} />}
    </section>
  )
}
