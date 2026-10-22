'use client'

import { useEffect, useState } from 'react'
import { Spinner } from '@/components/ui/spinner'

// "Updated 3 h ago · today 10:42" for data that may come from a cache, so it's clear when
// numbers are old. Turns amber once older than `staleAfterHours`. Rendered after hydration:
// the time and the viewer's locale would otherwise differ between server and browser.

export function stampOf(iso: string): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const day = new Date(); day.setHours(0, 0, 0, 0)
  const diffDays = Math.floor((day.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000)
  if (diffDays === 0) return `today ${time}`
  if (diffDays === 1) return `yesterday ${time}`
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`
}

function agoOf(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}

export default function LastRefreshed({ at, prefix = 'Updated', staleAfterHours = 24, onRefresh, refreshing, className = '' }: {
  at: string | null | undefined
  prefix?: string
  staleAfterHours?: number
  onRefresh?: () => void
  refreshing?: boolean
  className?: string
}) {
  const [, setTick] = useState(0)
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
    const t = setInterval(() => setTick(x => x + 1), 60_000) // keep "x min ago" current
    return () => clearInterval(t)
  }, [])

  const valid = !!at && !Number.isNaN(Date.parse(at))
  const stale = valid && Date.now() - Date.parse(at!) > staleAfterHours * 3_600_000
  return (
    <span className={`last-refreshed${stale ? ' last-refreshed--stale' : ''} ${className}`.trim()} title={valid && mounted ? new Date(at!).toLocaleString() : undefined}>
      <span className="last-refreshed-dot" aria-hidden="true" />
      <span>
        {!mounted ? ' ' : valid ? `${prefix} ${agoOf(at!)} · ${stampOf(at!)}${stale ? ' · may be out of date' : ''}` : `${prefix}: not yet`}
      </span>
      {onRefresh && (
        <button type="button" className="last-refreshed-btn" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? <><Spinner size={11} />Refreshing…</> : 'Refresh'}
        </button>
      )}
    </span>
  )
}
