'use client'

import { useEffect, useState } from 'react'
import { UserPlus } from 'lucide-react'
import { connectUrl } from '@/lib/integrations/connect-url'
import { LoadingState } from '@/components/ui/spinner'

// "New visitors" on the Website view: people PostHog first saw in the period, where they landed,
// how they found you, their browser / device / country, and who signed up.

type Count = { name: string; visitors: number; signedUp: number }
type Visitor = {
  at: string; landing: string; channel: string; from: string
  browser: string; os: string; device: string; country: string; pages: number; signedUp: boolean
}
type Data = {
  connected: boolean
  error?: string
  total: number; signedUp: number; onePage: number
  landing: Count[]; channels: Count[]; sources: Count[]
  browsers: Count[]; os: Count[]; devices: Count[]; countries: Count[]
  recent: Visitor[]
  truncated?: boolean
}

const card: React.CSSProperties = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px', minWidth: 0 }
const h3: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: '0 0 4px' }
const sub: React.CSSProperties = { fontSize: 12, color: 'var(--text-dim)', margin: '0 0 14px' }
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)

function ago(iso: string): string {
  const t = new Date(iso.includes('T') || iso.endsWith('Z') ? iso : iso.replace(' ', 'T') + 'Z').getTime()
  if (!t) return ''
  const m = Math.max(0, Math.round((Date.now() - t) / 60000))
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

/** One list of names with a grey bar, the visitor count and how many of them signed up. */
function Bars({ title, note, rows, total, mono, signups }: { title: string; note: string; rows: Count[]; total: number; mono?: boolean; signups?: boolean }) {
  return (
    <div style={card}>
      <h3 style={h3}>{title}</h3>
      <p style={sub}>{note}</p>
      {rows.length === 0 ? <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>Nothing yet</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map(r => (
            <div key={r.name}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
                <span title={r.name} style={{ fontSize: 12, color: 'var(--text)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: mono ? 'monospace' : undefined }}>{r.name}</span>
                <span style={{ fontSize: 12, color: 'var(--text-dim)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                  {r.visitors}{signups && r.signedUp > 0 && <span style={{ color: 'var(--text-faint)' }}> · {r.signedUp} signed up</span>}
                </span>
              </div>
              <div style={{ height: 4, borderRadius: 99, background: 'var(--line)', overflow: 'hidden' }}>
                <div style={{ height: 4, width: `${pct(r.visitors, total)}%`, background: 'var(--text-faint)', transition: 'width .4s ease' }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function NewVisitorsSection({ brandId, period, periodDesc, nonce }: { brandId: string; period: string; periodDesc: string; nonce: number }) {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/analytics/new-visitors?brandId=${brandId}&period=${period}`)
      .then(r => r.json())
      .then((d: Data) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [brandId, period, nonce])

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      <UserPlus size={13} style={{ color: 'var(--text-faint)' }} />
      <h2 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-faint)', margin: 0 }}>
        New visitors · PostHog
      </h2>
    </div>
  )

  if (!data) {
    return (
      <section style={{ marginBottom: 36 }}>
        {header}
        <div style={{ ...card, textAlign: 'center', padding: '28px 24px' }}>
          {loading ? <LoadingState compact>Loading new visitors from PostHog…</LoadingState>
            : <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0 }}>Couldn’t load new visitors. Try Refresh.</p>}
        </div>
      </section>
    )
  }

  if (!data.connected || data.error) {
    return (
      <section style={{ marginBottom: 36 }}>
        {header}
        <div style={{ ...card, textAlign: 'center', padding: '28px 24px' }}>
          {data.error ? (
            <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0 }}>PostHog didn’t answer. Check the key in Settings → Integrations, then Refresh.</p>
          ) : (<>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: '0 0 4px' }}>Connect PostHog to see your new visitors</p>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0 }}>Which page they landed on, how they found you, their browser and device. <a href={connectUrl('posthog')} style={{ color: 'var(--accent-foreground)', fontWeight: 600, textDecoration: 'none' }}>Connect it in Settings →</a></p>
          </>)}
        </div>
      </section>
    )
  }

  const t = data.total
  const top = data.channels[0]
  const recent = showAll ? data.recent : data.recent.slice(0, 10)

  return (
    <section style={{ marginBottom: 36, opacity: loading ? 0.55 : 1, transition: 'opacity .2s' }}>
      {header}

      {/* Numbers */}
      <div className="an-g3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 14 }}>
        {[
          { label: 'New visitors', value: String(t), note: periodDesc },
          { label: 'Signed up', value: String(data.signedUp), note: t ? `${pct(data.signedUp, t)}% of new visitors` : periodDesc },
          { label: 'Most came from', value: top ? top.name : '—', note: top ? `${pct(top.visitors, t)}% of new visitors` : periodDesc },
        ].map(k => (
          <div key={k.label} style={card}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 8 }}>{k.label}</div>
            <div style={{ fontSize: k.value.length > 8 ? 22 : 34, fontWeight: 700, letterSpacing: '-0.5px', color: 'var(--text)', lineHeight: 1.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.value}</div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>{k.note}</div>
          </div>
        ))}
      </div>

      {t === 0 ? (
        <div style={{ ...card, textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0 }}>No new visitors {periodDesc}. Try a longer range.</p>
        </div>
      ) : (<>
        {/* Landing pages + how they found you */}
        <div className="an-g2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <Bars title="Where they landed" note={`First page of each new visitor · ${periodDesc}`} rows={data.landing} total={t} mono signups />
          <Bars title="How they found you" note={`From their first visit · ${periodDesc}`} rows={data.channels} total={t} signups />
        </div>

        {/* Sites and campaigns */}
        {data.sources.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <Bars title="Sites and campaigns" note="The site that linked to you, or the UTM source · campaign" rows={data.sources} total={t} signups />
          </div>
        )}

        {/* Browser / device / country */}
        <div className="an-g3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 14 }}>
          <Bars title="Browsers" note={periodDesc} rows={data.browsers} total={t} />
          <Bars title="Devices" note={data.os.slice(0, 3).map(o => o.name).join(' · ') || periodDesc} rows={data.devices} total={t} />
          <Bars title="Countries" note={periodDesc} rows={data.countries} total={t} />
        </div>

        {/* Latest new visitors */}
        <div style={card}>
          <h3 style={h3}>Latest new visitors</h3>
          <p style={sub}>One row per person, newest first</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 620 }}>
              <thead>
                <tr style={{ color: 'var(--text-faint)', textAlign: 'left' }}>
                  {['When', 'Landed on', 'Came from', 'Browser · device', 'Country', 'Pages', ''].map(h => (
                    <th key={h} style={{ fontWeight: 600, fontSize: 11, padding: '0 10px 8px 0', borderBottom: '1px solid var(--line)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.map((v, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '8px 10px 8px 0', color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>{ago(v.at)}</td>
                    <td title={v.landing} style={{ padding: '8px 10px 8px 0', color: 'var(--text)', fontFamily: 'monospace', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.landing}</td>
                    <td title={v.from} style={{ padding: '8px 10px 8px 0', color: 'var(--text-dim)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.channel}{v.from !== 'Direct / typed in' && <span style={{ color: 'var(--text-faint)' }}> · {v.from}</span>}</td>
                    <td style={{ padding: '8px 10px 8px 0', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{v.browser} · {v.device}</td>
                    <td style={{ padding: '8px 10px 8px 0', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{v.country}</td>
                    <td style={{ padding: '8px 10px 8px 0', color: 'var(--text-dim)' }}>{v.pages}</td>
                    <td style={{ padding: '8px 0', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{v.signedUp ? 'Signed up' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.recent.length > 10 && (
            <button onClick={() => setShowAll(v => !v)} style={{ marginTop: 12, background: 'none', border: 'none', padding: 0, fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', cursor: 'pointer' }}>
              {showAll ? 'Show fewer' : `Show all ${data.recent.length}`}
            </button>
          )}
        </div>
      </>)}
    </section>
  )
}
