import type { Picture } from '@/lib/ask/types'

// The pictures an answer can have (md_files/ASK_PLAN.md). Grey by default; blue marks the one that matters.

export default function AskPicture({ p }: { p: Picture }) {
  if (p.kind === 'list') {
    return (
      <div className="ask-list">
        {p.rows.map((r, i) => <div key={i} className="ask-li"><b>{r.name}</b><span>{r.note}</span></div>)}
      </div>
    )
  }
  if (p.kind === 'bars') {
    const max = Math.max(1, ...p.rows.map(r => r.value))
    return (
      <div className="ask-bars">
        {p.rows.map((r, i) => (
          <div key={i} className="ask-barrow">
            <span className="ask-bar-l">{r.label}</span>
            <span className="ask-bar-v">{r.value.toLocaleString('en')}</span>
            <span className="ask-bar-t"><span className={r.strong ? 'is-strong' : ''} style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%` }} /></span>
          </div>
        ))}
      </div>
    )
  }
  if (p.kind === 'tiles') {
    return (
      <div className="ask-tiles">
        {p.items.map((t, i) => <div key={i} className={`ask-tile${t.missing ? ' is-missing' : ''}`}><b>{t.value}</b><span>{t.label}</span></div>)}
      </div>
    )
  }
  // line
  const W = 640, H = 180, L = 34, B = 22
  const vals = p.points.map(x => x.value)
  const max = Math.max(1, ...vals)
  const x = (i: number) => L + (i * (W - L - 8)) / Math.max(1, p.points.length - 1)
  const y = (v: number) => H - B - (v / max) * (H - B - 10)
  const ticks = [0, Math.round(max / 2), max]
  const labelAt = new Set([0, Math.floor((p.points.length - 1) / 2), p.points.length - 1])
  return (
    <svg className="ask-line" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={p.points.map(q => `${q.label}: ${q.value}`).join(', ')}>
      {ticks.map(t => (
        <g key={t}>
          <line x1={L} x2={W} y1={y(t)} y2={y(t)} stroke="var(--ask-line)" />
          <text x={L - 8} y={y(t) + 4} textAnchor="end">{t}</text>
        </g>
      ))}
      {p.points.map((q, i) => (labelAt.has(i) ? <text key={i} x={x(i)} y={H - 4} textAnchor="middle">{q.label}</text> : null))}
      <polyline points={p.points.map((q, i) => `${x(i)},${y(q.value)}`).join(' ')} fill="none" stroke="var(--ask-blue)" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
