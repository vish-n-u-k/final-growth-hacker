'use client'

// Settings → Usage & costs: what this account spent this month on outside services (DataForSEO,
// AI, Hunter credits), split by tool, by DataForSEO API and by AI feature, plus past months.

import type { UsageView } from '@/lib/usage'

const usd = (n: number) => (n <= 0 ? '$0' : n < 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`)
const credits = (n: number) => `${n} Hunter credit${n === 1 ? '' : 's'}`
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

function parts(r: { dataforseo: number; ai: number; hunter: number }) {
  return [
    r.dataforseo > 0 ? `DataForSEO ${usd(r.dataforseo)}` : null,
    r.ai > 0 ? `AI ${usd(r.ai)}` : null,
    r.hunter > 0 ? credits(r.hunter) : null,
  ].filter(Boolean).join(' · ')
}

function Rows({ title, rows, note }: { title: string; rows: { name: string; value: string; sub?: string }[]; note?: string }) {
  if (!rows.length) return null
  return (
    <div className="st-card st-usage-card">
      <div className="st-label">{title}</div>
      <div className="st-usage-rows">
        {rows.map(r => (
          <div key={r.name} className="st-usage-row">
            <div className="st-usage-name">
              {r.name}
              {r.sub && <div className="st-usage-sub">{r.sub}</div>}
            </div>
            <div className="st-usage-val">{r.value}</div>
          </div>
        ))}
      </div>
      {note && <p className="st-field-hint">{note}</p>}
    </div>
  )
}

export default function UsageSection({ usage }: { usage: UsageView | null }) {
  return (
    <div className="st-section">
      <div className="st-section-hd">
        <h2 className="st-section-title">Usage &amp; costs</h2>
        <p className="st-section-desc">What GrowJin spent on outside services for this account. Months run from the 1st (UTC).</p>
      </div>

      {!usage ? (
        <div className="st-card"><p className="st-hint">Couldn’t load usage right now. Try again in a minute.</p></div>
      ) : (
        <>
          <div className="st-card st-usage-card">
            <div className="st-label">{monthName(usage.month)}</div>
            <div className="st-usage-total">{usd(usage.total)}</div>
            <div className="st-usage-sub">
              {usage.total > 0 || usage.hunter > 0 ? parts(usage) : 'Nothing spent yet this month.'}
            </div>
          </div>

          <Rows
            title="By tool"
            rows={usage.tools.map(t => ({ name: t.name, value: usd(t.usd), sub: parts(t) }))}
          />

          <Rows
            title="DataForSEO, by API"
            rows={usage.apis.map(a => ({ name: a.name, value: usd(a.usd) }))}
            note={usage.apiSplitMissing ? 'Some of this month’s spend was recorded before costs were split by API, so it shows in the total only.' : undefined}
          />

          <Rows
            title="AI, by feature"
            rows={usage.aiFeatures.map(f => ({ name: f.name, value: usd(f.usd) }))}
          />

          <Rows
            title="Past months"
            rows={usage.past.map(m => ({ name: monthName(m.month), value: usd(m.total), sub: parts(m) || undefined }))}
          />

          {usage.hunterOutAt && (
            <p className="st-hint">Hunter’s credits ran out on {new Date(usage.hunterOutAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, so new leads come without an email until they renew.</p>
          )}
          {usage.hunter > 0 && (
            <p className="st-hint">Hunter is paid with plan credits (1 per email found), so credits are counted, not priced.</p>
          )}
        </>
      )}
    </div>
  )
}
