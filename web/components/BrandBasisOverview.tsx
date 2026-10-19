'use client'

import type { BrandBasis } from '@/lib/modules/brand-audit/summary'

// Brand Audit: what the last run compared the homepage against — the headline it read, and the
// audience, selling point and voice from the brand profile — so a failed check can be traced to
// its cause, and a missing or outdated profile field fixed in one click.

const SETTINGS_BRAND = '/settings?tab=brand'

export default function BrandBasisOverview({ basis }: { basis: BrandBasis }) {
  const rows: { label: string; value: string | null; empty: string; fromSite?: boolean }[] = [
    { label: 'Your headline', value: basis.headline, empty: basis.pageRead ? 'No main headline found' : 'Couldn\'t read your homepage', fromSite: true },
    { label: 'Who it\'s for', value: basis.audience, empty: 'Not set — the audience check is skipped' },
    { label: 'Main selling point', value: basis.usp, empty: 'Not set — the selling point check is skipped' },
    { label: 'Brand voice', value: basis.voice, empty: 'Not set — voice ideas will suggest one' },
  ]
  const missing = rows.filter(r => !r.fromSite && !r.value).length

  return (
    <section className="spo bbo" aria-label="What we checked">
      <div className="spo-hd">
        <div>
          <h3 className="spo-title">What we checked</h3>
          <p className="spo-sub">
            Your homepage, against your brand profile.{missing > 0 ? ` ${missing} of 3 profile fields ${missing === 1 ? 'is' : 'are'} empty.` : ''}
          </p>
        </div>
        <a className="spo-edit" href={SETTINGS_BRAND}>{missing > 0 ? 'Fill in profile' : 'Edit profile'}</a>
      </div>
      <dl className="bbo-grid">
        {rows.map(r => (
          <div key={r.label} className={`bbo-row${r.value ? '' : ' is-empty'}`}>
            <dt>{r.label}<span className="bbo-src">{r.fromSite ? 'from your homepage' : 'from Settings'}</span></dt>
            <dd>{r.value ? (r.fromSite ? `“${r.value}”` : r.value) : r.empty}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
