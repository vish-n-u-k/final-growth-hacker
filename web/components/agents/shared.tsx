'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Small helpers shared by the AI Agents pages: one API caller that keeps the page's data in
// sync with the server's reply, a toast, and date formatting.

export function useAgentApi<T>(endpoint: string, initial: T) {
  const [data, setData] = useState<T>(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const say = useCallback((msg: string) => {
    setToast(msg)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), 5000)
  }, [])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const call = useCallback(async (op: string, payload: Record<string, unknown> = {}, busyKey = op) => {
    setBusy(busyKey)
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, ...payload }) })
      const j = await res.json().catch(() => ({})) as { data?: T; error?: string; message?: string; result?: { summary?: string; error?: string } }
      if (j.data) setData(j.data)
      if (j.error) say(j.error)
      else if (j.result?.error) say(j.result.error)
      else if (j.message) say(j.message)
      else if (j.result?.summary) say(j.result.summary)
      return j
    } catch {
      say('Network error. Try again.')
      return null
    } finally {
      setBusy(null)
    }
  }, [endpoint, say])

  return { data, setData, busy, call, toast, say }
}

export function Toast({ text }: { text: string | null }) {
  return text ? <div className="ag-toast" role="status" aria-live="polite">{text}</div> : null
}

export function fmtDate(iso: string | undefined | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function fmtAgo(iso: string | undefined | null): string {
  if (!iso) return 'never'
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (mins < 2) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h} h ago`
  return fmtDate(iso)
}

// Dates depend on the viewer's locale and the clock, so they render after hydration
// (server and browser would otherwise disagree).
function useMounted() {
  const [m, setM] = useState(false)
  useEffect(() => setM(true), [])
  return m
}
export function Day({ iso }: { iso: string | undefined | null }) {
  return <>{useMounted() ? fmtDate(iso) : ''}</>
}
export function Ago({ iso }: { iso: string | undefined | null }) {
  return <>{useMounted() ? fmtAgo(iso) : ''}</>
}

export function initials(s: string): string {
  const parts = s.replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase()
}

export function BotIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="8" width="16" height="12" rx="3" /><path d="M12 4v4M9 13v1M15 13v1" /><circle cx="12" cy="3.5" r="1" />
    </svg>
  )
}

export function SearchIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
    </svg>
  )
}

export function LeadIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="4" /><path d="M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7" /><path d="M19 8v6M16 11h6" />
    </svg>
  )
}
