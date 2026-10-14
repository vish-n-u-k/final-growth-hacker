'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { TodayActivity as Activity } from '@/app/api/today/activity/route'
import PersonPanel, { ago } from '@/components/PersonPanel'
import SocialIcon from '@/components/SocialIcon'

// "What happened" on Today: visitors, new signups (and where each came from), returning users
// and top sources for the last 24 hours or 7 days. Data: /api/today/activity (PostHog).

function Delta({ current, prior }: { current: number; prior: number }) {
  if (prior <= 0 || current === prior) return null
  const pct = Math.round(((current - prior) / prior) * 100)
  return <span className={`ta-delta ${pct > 0 ? 'ta-delta--up' : 'ta-delta--dn'}`}>{pct > 0 ? '↑' : '↓'}{Math.abs(pct)}%</span>
}

// Referrer domain → social platform (for its logo); '' when it isn't a social network.
const SOCIAL_DOMAINS: [RegExp, string][] = [
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, 'linkedin'], [/(^|\.)facebook\.com$|^fb\.me$/, 'facebook'], [/(^|\.)instagram\.com$/, 'instagram'],
  [/^(t\.co|x\.com|twitter\.com)$/, 'x'], [/(^|\.)reddit\.com$/, 'reddit'], [/(^|\.)youtube\.com$|^youtu\.be$/, 'youtube'],
  [/(^|\.)pinterest\./, 'pinterest'], [/(^|\.)tiktok\.com$/, 'tiktok'], [/(^|\.)threads\.net$/, 'threads'],
]
const socialFromDomain = (d: string) => SOCIAL_DOMAINS.find(([re]) => re.test(d.replace(/^www\./, '')))?.[1] ?? ''

// Each list shows the latest few; "View all" opens the full table (Analytics › details) for the same period.
const SHOWN = 3

export type JourneyIssue = Activity['journey']

// Plain-English fix steps for a website that isn't joined up with signups (shared with the Claude prompt).
export function journeySteps(j: JourneyIssue): string[] {
  const site = j.websiteHost || 'your website'
  const app = j.appHost || 'your app'
  return j.status === 'website-not-tracked'
    ? [
        `Install PostHog on ${site} with the same project API key as ${app} (PostHog → Settings → Project → Project API key, starts with phc_).`,
        `Use cross_subdomain_cookie: true in posthog.init on both, so a visitor keeps the same ID when they move from ${site} to ${app}.`,
        `In ${app}, call posthog.identify(<permanent user id>) once after signup/login, and posthog.reset() only on logout.`,
      ]
    : [
        `Use the same PostHog project API key on ${site} and ${app}.`,
        `Turn on cross_subdomain_cookie: true in posthog.init on both (they share the root domain), so the visitor keeps one ID across them.`,
        `If they are on different root domains, pass the visitor's ID in signup links (posthog.get_distinct_id()) and bootstrap it in ${app}.`,
        `In ${app}, call posthog.identify(<permanent user id>) once after signup/login, and posthog.reset() only on logout — never on page load.`,
      ]
}

function JourneyNotice({ j, onFix, fixHint }: { j: JourneyIssue; onFix?: () => void; fixHint?: React.ReactNode }) {
  const site = j.websiteHost
  const title = j.status === 'website-not-tracked' ? `${site} isn't sending visits to PostHog` : `Visits to ${site} aren't linked to signups`
  const body = j.status === 'website-not-tracked'
    ? `Your signups are first seen on ${j.appHost || 'your app'} and ${site} sent no pageviews in the last 7 days, so you can't see which page or source brought people in.`
    : `${site} is tracked, but ${j.signupsChecked - j.signupsFromWebsite} of ${j.signupsChecked} recent signups were first seen on ${j.appHost || 'another site'}. PostHog sees the website visit and the signup as different people, so their source and landing page are lost.`
  return (
    <div className="ta-journey" role="note">
      <div className="ta-journey-title">{title}</div>
      <p className="ta-journey-body">{body}</p>
      <details className="ta-journey-steps">
        <summary>How to fix it</summary>
        <ol>{journeySteps(j).map((st, i) => <li key={i}>{st}</li>)}</ol>
      </details>
      {onFix && <button type="button" className="ta-journey-btn" onClick={onFix}>Fix with Claude</button>}
      {fixHint}
    </div>
  )
}

export default function TodayActivity({ onFixJourney, journeyHint }: { onFixJourney?: (j: JourneyIssue) => void; journeyHint?: React.ReactNode } = {}) {
  const [days, setDays] = useState<1 | 7>(1)
  const [data, setData] = useState<Activity | null>(null)
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)

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
      <div className="ta-wrap">
        <div className="ta-head">
          <div className="ta-title"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>What happened</div>
        </div>
        <section className="ta ta--connect">
          <p className="ta-muted">See who visits, who signs up and where they come from.</p>
          <Link href="/settings?tab=integrations" className="ta-connect">Connect PostHog →</Link>
        </section>
      </div>
    )
  }

  const period = days === 1 ? 'the last 24 hours' : 'the last 7 days'
  const range = days === 1 ? '24h' : '7d'
  const quiet = data && data.visitors.current === 0 && data.signups.count === 0

  return (
    <div className="ta-wrap">
    <div className="ta-head">
      <div className="ta-title"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>What happened</div>
      <div className="ta-toggle" role="tablist" aria-label="Period">
        <button type="button" role="tab" aria-selected={days === 1} className={days === 1 ? 'is-on' : ''} onClick={() => setDays(1)}>24h</button>
        <button type="button" role="tab" aria-selected={days === 7} className={days === 7 ? 'is-on' : ''} onClick={() => setDays(7)}>7 days</button>
      </div>
    </div>
    <section className="ta" aria-busy={loading}>

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
              <span className="ta-label">signups</span>
            </div>
            <div className="ta-stat">
              <span className="ta-num">{(data.signins?.count ?? 0).toLocaleString()} <Delta current={data.signins?.count ?? 0} prior={data.signins?.prior ?? 0} /></span>
              <span className="ta-label">signed in</span>
            </div>
            <div className="ta-stat">
              <span className="ta-num">{data.returning.toLocaleString()}</span>
              <span className="ta-label">came back</span>
            </div>
          </div>

          {(data.journey?.status === 'website-not-tracked' || data.journey?.status === 'not-linked') && (
            <JourneyNotice j={data.journey} onFix={onFixJourney ? () => onFixJourney(data.journey) : undefined} fixHint={journeyHint} />
          )}

          {data.signups.people.length > 0 && (
            <div className="ta-block">
              <div className="ta-sub">New signups</div>
              <ul className="ta-people">
                {data.signups.people.slice(0, SHOWN).map(p => {
                  const open = openId === p.id
                  return (
                    <li key={p.id} className={`ta-person-wrap${open ? ' is-open' : ''}`}>
                      <button type="button" className="ta-person" onClick={() => setOpenId(open ? null : p.id)} aria-expanded={open}>
                        <span className="ta-avatar" aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span>
                        <span className="ta-person-main">
                          <b>{p.name}</b>
                          <span className="ta-muted">
                            from {p.source}{p.country ? ` · ${p.country}` : ''}{p.landing && p.landing !== '/' ? ` · landed on ${p.landing}` : ''}
                          </span>
                        </span>
                        <span className="ta-time">{ago(p.at)}</span>
                        <svg className="ta-chev" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 8l5 5 5-5" /></svg>
                      </button>
                      {open && <PersonPanel id={p.id} />}
                    </li>
                  )
                })}
              </ul>
              {data.signups.count > SHOWN && (
                <Link href={`/analytics/details?type=signups&range=${range}`} className="ta-view-all">View all {data.signups.count} signups →</Link>
              )}
            </div>
          )}

          {(data.signins?.people.length ?? 0) > 0 && (
            <div className="ta-block">
              <div className="ta-sub">Signed in</div>
              <ul className="ta-people">
                {data.signins.people.slice(0, SHOWN).map(p => {
                  const key = `in:${p.id}`
                  const open = openId === key
                  const device = p.device ? ` · ${p.device.toLowerCase()}` : ''
                  return (
                    <li key={key} className={`ta-person-wrap${open ? ' is-open' : ''}`}>
                      <button type="button" className="ta-person" onClick={() => setOpenId(open ? null : key)} aria-expanded={open}>
                        <span className="ta-avatar ta-avatar--in" aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span>
                        <span className="ta-person-main">
                          <b>{p.name}</b>
                          <span className="ta-muted">
                            {p.times > 1 ? `signed in ${p.times}×` : 'signed in'}{p.country ? ` · ${p.country}` : ''}{device} · first came from {p.source}
                          </span>
                        </span>
                        <span className="ta-time">{ago(p.at)}</span>
                        <svg className="ta-chev" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 8l5 5 5-5" /></svg>
                      </button>
                      {open && <PersonPanel id={p.id} />}
                    </li>
                  )
                })}
              </ul>
              {data.signins.count > SHOWN && (
                <Link href={`/analytics/details?type=signins&range=${range}`} className="ta-view-all">View all {data.signins.count} sign-ins →</Link>
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
                  {data.referrers.map(r => <span key={r.domain} className="ta-chip"><SocialIcon platform={socialFromDomain(r.domain)} size={13} />{r.domain} <b>{r.visitors}</b></span>)}
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

      {data?.connected && (
        <Link href="/analytics" className="ta-more-link">See full analytics →</Link>
      )}
    </section>
    </div>
  )
}
