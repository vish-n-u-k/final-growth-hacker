'use client'

import { useEffect, useState } from 'react'
import type { DoneTask } from '@/app/api/today/done/route'

const BY: Record<DoneTask['source'], string> = { claude: 'Claude', agent: 'GrowJin auto-fix', ai: 'AI check', user: 'You' }

function ago(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
}

// Today's "Recently done": finished tasks with the link to the change and what was done,
// so work done by Claude or the auto-fix can be checked. Hidden when there's nothing yet.
export default function RecentlyDone() {
  const [done, setDone] = useState<DoneTask[]>([])
  useEffect(() => {
    let alive = true
    fetch('/api/today/done')
      .then(r => r.ok ? r.json() : null)
      .then((d: { done?: DoneTask[] } | null) => { if (alive) setDone(d?.done ?? []) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  if (done.length === 0) return null
  return (
    <>
      <div className="td-section-label td-section-label--gap">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 13l4 4L19 7" />
        </svg>
        Recently done
      </div>
      <ul className="td-done-list">
        {done.map(t => (
          <li key={t.id} className="td-done-item">
            <div className="td-done-top">
              <span className="td-done-label">{t.label}</span>
              <span className="td-done-meta">{BY[t.source] ?? 'Done'} · {ago(t.at)}</span>
            </div>
            {t.note && <p className="td-done-note">{t.note}</p>}
            {t.url && (
              <a className="td-done-link" href={t.url} target="_blank" rel="noreferrer">
                {t.url.includes('github.com') ? 'View the change' : 'See it live'} ↗
              </a>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}
