'use client'

import { useState } from 'react'
import type { ComparisonTable } from '@/lib/modules/competitor-analysis/summary'
import { Spinner } from '@/components/ui/spinner'

// Competitor Analysis: you and up to 3 competitors side by side (what each homepage shows), and
// the list itself — which competitors, whether GrowJin picked them — with a way to change it.

const host = (u: string) => { try { return new URL(u.startsWith('http') ? u : `https://${u}`).hostname.replace(/^www\./, '') } catch { return u.trim() } }

export default function CompetitorsOverview({ table, busy, onSave }: { table: ComparisonTable; busy: boolean; onSave: (urls: string[]) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string[]>(() => [...table.competitorUrls.map(host), '', '', ''].slice(0, 3))
  const suggested = table.sites.some(s => s.suggested)
  const comps = table.sites.filter(s => !s.you)
  const achievable = table.achievable ?? []
  // Already comparing against exactly these: no need to offer it
  const comparingAchievable = achievable.length > 0 && achievable.every(a => comps.some(c => host(c.url) === host(a.url)))

  const save = () => {
    const urls = [...new Set(draft.map(d => d.trim()).filter(Boolean))]
    if (urls.length === 0) return
    onSave(urls)
    setEditing(false)
  }

  return (
    <section className="spo cmo" aria-label="Competitors we compared">
      <div className="spo-hd">
        <div>
          <h3 className="spo-title">Competitors we compared</h3>
          <p className="spo-sub">
            {comps.length === 0
              ? 'No competitor sites could be read this time. Add the ones you lose customers to.'
              : suggested
                ? 'GrowJin picked these. If they aren\'t who you really compete with, change them.'
                : 'Your competitors, side by side with you, from what each homepage shows.'}
          </p>
        </div>
        {!editing && <button type="button" className="spo-edit" onClick={() => setEditing(true)} disabled={busy}>{comps.length ? 'Change competitors' : 'Add competitors'}</button>}
      </div>

      {editing && (
        <div className="cmo-edit">
          {draft.map((d, i) => (
            <input key={i} type="text" inputMode="url" className="cmo-input" placeholder={`competitor${i + 1}.com`} value={d}
              aria-label={`Competitor ${i + 1}`} onChange={e => setDraft(list => list.map((x, j) => (j === i ? e.target.value : x)))}
              onKeyDown={e => { if (e.key === 'Enter') save() }} />
          ))}
          <div className="cmo-edit-actions">
            <button type="button" className="cmo-save" onClick={save} disabled={busy || !draft.some(d => d.trim())}>{busy ? <><Spinner />Analysing…</> : 'Save and re-analyse'}</button>
            <button type="button" className="cmo-cancel" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}

      {comps.length > 0 && (
        <div className="cmo-scroll">
          <table className="cmo-table">
            <thead>
              <tr>
                <th scope="col"><span className="sr-only">Check</span></th>
                {table.sites.map(s => (
                  <th key={s.url} scope="col" className={s.you ? 'is-you' : ''}>
                    {s.you ? <span>You</span> : <a href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a>}
                    {s.suggested && <span className="cmo-tag">suggested</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map(row => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {row.cells.map((c, i) => (
                    <td key={i} className={table.sites[i].you ? 'is-you' : ''} title={c.text || undefined}>
                      {c.ok === null
                        ? <span className="cmo-num">{c.text}</span>
                        : c.ok
                          ? <span className="cmo-yes" aria-label="Yes">✓</span>
                          : <span className="cmo-no" aria-label="No">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {achievable.length > 0 && (
        <div className="cmo-catch">
          <div className="cmo-catch-hd">
            <div>
              <h4 className="cmo-catch-title">Competitors you can realistically catch</h4>
              <p className="cmo-catch-sub">Similar-size businesses selling to the same customers — not the market leaders.</p>
            </div>
            {!comparingAchievable && (
              <button type="button" className="spo-edit" disabled={busy} onClick={() => onSave(achievable.map(a => a.url))}>{busy ? <><Spinner />Analysing…</> : 'Compare with these'}</button>
            )}
          </div>
          <ul className="cmo-catch-list">
            {achievable.map(a => (
              <li key={a.url}>
                <a href={a.url} target="_blank" rel="noopener noreferrer">{a.name || host(a.url)}</a>
                <span className="cmo-catch-host">{host(a.url)}</span>
                {a.why && <span className="cmo-catch-why">{a.why}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {table.unreachable.length > 0 && (
        <p className="cmo-note">Couldn&apos;t read {table.unreachable.map(host).join(', ')} (blocked, down, or built with JavaScript), so {table.unreachable.length > 1 ? 'they\'re' : 'it\'s'} left out.</p>
      )}
    </section>
  )
}
