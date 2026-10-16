'use client'

import { useEffect, useState } from 'react'
import { MRR_CURRENCIES, formatMoney, projectMrr, type MrrSettings } from '@/lib/mrr-shared'
import { Spinner } from '@/components/ui/spinner'

interface Props {
  /** Live user count. Omit to have the card fetch it from PostHog itself. */
  userCount?: number
  loading?: boolean
  /** Saved price from the server. Omit to have the card fetch it. */
  initial?: MrrSettings | null
  onSaved?: (settings: MrrSettings | null) => void
}

// The next round goal past the current count: the Road to 500, then every 1,000 after it.
function goalFor(users: number): number {
  return users < 500 ? 500 : (Math.floor(users / 1000) + 1) * 1000
}

export default function ProjectedMrr({ userCount, loading = false, initial, onSaved }: Props) {
  const [settings, setSettings] = useState<MrrSettings | null>(initial ?? null)
  const [settingsReady, setSettingsReady] = useState(initial !== undefined)
  const [fetchedCount, setFetchedCount] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [payingPct, setPayingPct] = useState('100')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (initial !== undefined) return
    fetch('/api/settings/mrr')
      .then(r => r.ok ? r.json() : null)
      .then((d: { settings?: MrrSettings | null } | null) => setSettings(d?.settings ?? null))
      .catch(() => {})
      .finally(() => setSettingsReady(true))
  }, [initial])

  useEffect(() => {
    if (userCount !== undefined) return
    fetch('/api/posthog/user-count')
      .then(r => r.ok ? r.json() : null)
      .then((d: { count?: number } | null) => setFetchedCount(d?.count ?? 0))
      .catch(() => setFetchedCount(0))
  }, [userCount])

  const users = userCount ?? fetchedCount
  const countLoading = loading || users === null

  function startEdit() {
    setPrice(settings ? String(settings.price) : '')
    setCurrency(settings?.currency ?? 'USD')
    setPayingPct(String(settings?.payingPct ?? 100))
    setError('')
    setEditing(true)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/settings/mrr', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price: Number(price), currency, payingPct: Number(payingPct || 100) }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error ?? "Couldn't save. Please try again."); return }
      setSettings(d.settings)
      onSaved?.(d.settings)
      setEditing(false)
    } catch {
      setError("Couldn't save. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  if (!settingsReady) return null

  if (editing) {
    return (
      <form className="pmrr pmrr--edit" onSubmit={save}>
        <span className="pmrr-eyebrow">Projected MRR</span>
        <div className="pmrr-fields">
          <label className="pmrr-field">
            <span>Price per paying customer</span>
            <span className="pmrr-price">
              <select value={currency} onChange={e => setCurrency(e.target.value)} aria-label="Currency">
                {MRR_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input type="number" inputMode="decimal" min="0.01" step="0.01" required autoFocus
                value={price} onChange={e => setPrice(e.target.value)} placeholder="19" aria-label="Monthly price" />
              <em>/mo</em>
            </span>
          </label>
          <label className="pmrr-field">
            <span>Users who pay</span>
            <span className="pmrr-price">
              <input type="number" inputMode="numeric" min="1" max="100" step="1"
                value={payingPct} onChange={e => setPayingPct(e.target.value)} aria-label="Percent of users who pay" />
              <em>%</em>
            </span>
          </label>
        </div>
        {error && <p className="pmrr-error">{error}</p>}
        <div className="pmrr-actions">
          <button type="submit" className="pmrr-btn pmrr-btn--primary" disabled={saving}>{saving ? <><Spinner />Saving…</> : 'Save'}</button>
          <button type="button" className="pmrr-btn" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </form>
    )
  }

  if (!settings) {
    return (
      <div className="pmrr pmrr--empty">
        <div>
          <span className="pmrr-eyebrow">Projected MRR</span>
          <p className="pmrr-sub">Add your monthly price to see what your users are worth each month.</p>
        </div>
        <button type="button" className="pmrr-btn pmrr-btn--primary" onClick={startEdit}>Add price</button>
      </div>
    )
  }

  const n = users ?? 0
  const goal = goalFor(n)
  const paying = settings.payingPct < 100 ? ` × ${settings.payingPct}% paying` : ''

  return (
    <div className="pmrr">
      <div className="pmrr-main">
        <span className="pmrr-eyebrow">Projected MRR</span>
        <span className="pmrr-value">
          {countLoading ? '…' : formatMoney(projectMrr(n, settings), settings.currency)}<small>/mo</small>
        </span>
        <span className="pmrr-sub">
          {countLoading ? <><Spinner />Counting users…</> : `${n.toLocaleString()} users${paying} × ${formatMoney(settings.price, settings.currency)}`}
        </span>
      </div>
      <div className="pmrr-side">
        <span className="pmrr-goal">
          At {goal.toLocaleString()} users: <b>{formatMoney(projectMrr(goal, settings), settings.currency)}/mo</b>
        </span>
        <button type="button" className="pmrr-link" onClick={startEdit}>Edit price</button>
      </div>
    </div>
  )
}
