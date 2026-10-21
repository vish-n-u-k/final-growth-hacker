'use client'

import { useEffect, useState } from 'react'
import { LoadingState } from '@/components/ui/spinner'

interface Row { cost: number; calls: number }
interface CostData {
  totals: { day: number; week: number; month: number; calls: number }
  byFeature: (Row & { feature: string })[]
  byBrand: (Row & { brandId: string | null; brandName: string | null; websiteUrl: string | null })[]
  byModel: (Row & { model: string })[]
  byDay: (Row & { day: string })[]
}

const usd = (n: number) => `$${n < 10 ? n.toFixed(3) : n.toFixed(2)}`
const card = { padding: '12px 16px', borderRadius: 8, background: 'var(--card, #122620)', border: '1px solid var(--line, #1e3830)' }
const heading = { fontSize: 14, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'var(--text-dim, #8aa897)', margin: '28px 0 10px' }
const th = { textAlign: 'left' as const, fontWeight: 500, color: 'var(--text-dim, #8aa897)', padding: '6px 8px', borderBottom: '1px solid var(--line, #1e3830)' }
const td = { padding: '6px 8px', borderBottom: '1px solid var(--line, #1e3830)' }
const num = { ...td, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const }

function Table({ rows, label }: { rows: { name: string; cost: number; calls: number }[]; label: string }) {
  if (rows.length === 0) return <p style={{ fontSize: 13, color: 'var(--text-dim, #8aa897)' }}>No calls in the last 30 days.</p>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead><tr><th style={th}>{label}</th><th style={{ ...th, textAlign: 'right' }}>Calls</th><th style={{ ...th, textAlign: 'right' }}>Cost</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.name}><td style={td}>{r.name}</td><td style={num}>{r.calls.toLocaleString()}</td><td style={num}>{usd(r.cost)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// AI spend (estimated from list prices) for the admin page, from /api/admin/costs.
export default function AdminCosts() {
  const [data, setData] = useState<CostData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/costs')
      .then(async r => {
        const d = await r.json().catch(() => ({ error: `Request failed (${r.status})` }))
        if (!r.ok || d.error) setError(d.error ?? `Request failed (${r.status})`)
        else setData(d as CostData)
      })
      .catch(() => setError('Could not reach the server.'))
  }, [])

  if (error) return <p style={{ color: '#f87171', fontSize: 13 }}>{error}</p>
  if (!data) return <LoadingState>Loading costs…</LoadingState>

  const maxDay = Math.max(...data.byDay.map(d => d.cost), 0.0001)
  return (
    <section>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        {[['Last 24 hours', data.totals.day], ['Last 7 days', data.totals.week], ['Last 30 days', data.totals.month]].map(([label, v]) => (
          <div key={label as string} style={card}>
            <div style={{ fontSize: 12, color: 'var(--text-dim, #8aa897)' }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{usd(v as number)}</div>
          </div>
        ))}
        <div style={card}>
          <div style={{ fontSize: 12, color: 'var(--text-dim, #8aa897)' }}>AI calls (30 days)</div>
          <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{data.totals.calls.toLocaleString()}</div>
        </div>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-dim, #8aa897)', marginTop: 8 }}>
        Estimated from Anthropic list prices. Calls made before cost tracking covered every feature are filed under their module or missing.
      </p>

      <h2 style={heading}>Last 14 days</h2>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120, ...card }}>
        {data.byDay.length === 0 && <span style={{ fontSize: 13, color: 'var(--text-dim, #8aa897)' }}>No calls yet.</span>}
        {data.byDay.map(d => (
          <div key={d.day} title={`${d.day}: ${usd(d.cost)} · ${d.calls} calls`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
            <div style={{ height: `${Math.max(2, (d.cost / maxDay) * 100)}%`, background: 'var(--green, #2fbf71)', borderRadius: '3px 3px 0 0' }} />
          </div>
        ))}
      </div>

      <h2 style={heading}>By feature (30 days)</h2>
      <Table label="Feature / module" rows={data.byFeature.map(r => ({ name: r.feature, cost: r.cost, calls: r.calls }))} />

      <h2 style={heading}>By brand (30 days, top 25)</h2>
      <Table label="Brand" rows={data.byBrand.map(r => ({ name: r.brandName ? `${r.brandName}${r.websiteUrl ? ` · ${r.websiteUrl}` : ''}` : 'Not tied to a brand', cost: r.cost, calls: r.calls }))} />

      <h2 style={heading}>By model (30 days)</h2>
      <Table label="Model" rows={data.byModel.map(r => ({ name: r.model, cost: r.cost, calls: r.calls }))} />
    </section>
  )
}
