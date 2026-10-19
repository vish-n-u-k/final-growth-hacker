'use client'

import { useState } from 'react'
import type { ContentOverview } from '@/lib/modules/content-audit/summary'

// Content Audit: what the last run read (pages, articles, freshness, typical length) and a verdict
// for each content page — Keep, Refresh, Consolidate or Remove — with the reason and what to do.

export interface PageVerdictRow { url: string; title: string | null; wordCount: number; verdict: string; urgency: string; reason: string | null; action: string | null }

const VERDICT_CLASS: Record<string, string> = { Keep: 'is-ok', Refresh: 'is-warn', Consolidate: 'is-warn', Remove: 'is-bad', Repurpose: 'is-ok' }
const pathOf = (url: string) => { try { return new URL(url).pathname } catch { return url } }
const ago = (iso: string) => {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 60 ? `${d} days ago` : `${Math.round(d / 30)} months ago`
}

const ORDER: Record<string, number> = { Consolidate: 0, Remove: 1, Refresh: 2, Repurpose: 3, Keep: 4 }
const URGENCY: Record<string, number> = { High: 0, Medium: 1, Low: 2 }

export default function ContentPagesOverview({ overview, verdicts: unsorted }: { overview: ContentOverview | null; verdicts: PageVerdictRow[] }) {
  // Pages to act on first: merges and removals, then refreshes by urgency, then keeps
  const verdicts = [...unsorted].sort((a, b) => (ORDER[a.verdict] ?? 9) - (ORDER[b.verdict] ?? 9) || (URGENCY[a.urgency] ?? 9) - (URGENCY[b.urgency] ?? 9))
  const needsWork = verdicts.filter(v => v.verdict !== 'Keep')
  const [showAll, setShowAll] = useState(false)
  const rows = showAll || needsWork.length === 0 ? verdicts : needsWork

  const stats = overview ? [
    { label: 'Pages read', value: `${overview.pagesRead}`, sub: overview.pagesFound > overview.pagesRead ? `of ${overview.pagesFound} found` : 'all we found' },
    { label: 'Articles', value: `${overview.postsFound}`, sub: overview.postsFound ? 'on your site' : 'none yet' },
    { label: 'Newest article', value: overview.newestPostDate ? ago(overview.newestPostDate) : '—', sub: overview.newestPostDate ? new Date(overview.newestPostDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'no date found' },
    { label: 'Typical article', value: overview.typicalPostWords != null ? `${overview.typicalPostWords.toLocaleString()} words` : '—', sub: overview.typicalPostWords != null ? 'median length' : 'none read' },
  ] : []

  return (
    <section className="spo cpo" aria-label="Your content">
      <div className="spo-hd">
        <div>
          <h3 className="spo-title">Your content</h3>
          <p className="spo-sub">
            {overview?.unreadable
              ? 'Your pages couldn\'t be read this time, so there are no page verdicts. See the checks below for why.'
              : verdicts.length
                ? `${needsWork.length === 0 ? 'Every content page is in good shape.' : `${needsWork.length} of ${verdicts.length} content pages need work.`} Homepage, legal and utility pages aren't judged on length.`
                : 'No content pages to judge yet — only your homepage, legal and utility pages.'}
          </p>
        </div>
      </div>
      {stats.length > 0 && (
        <dl className="cpo-stats">
          {stats.map(s => (
            <div key={s.label} className="cpo-stat">
              <dt>{s.label}</dt>
              <dd><b>{s.value}</b><span>{s.sub}</span></dd>
            </div>
          ))}
        </dl>
      )}
      {verdicts.length > 0 && (
        <>
          <ul className="cpo-list">
            {rows.map(v => (
              <li key={v.url} className="cpo-row">
                <span className={`cpo-verdict ${VERDICT_CLASS[v.verdict] ?? ''}`}>{v.verdict}</span>
                <div className="cpo-main">
                  <a className="cpo-title" href={v.url} target="_blank" rel="noopener noreferrer">{v.title || pathOf(v.url)}</a>
                  <span className="cpo-meta">{pathOf(v.url)} · {v.wordCount.toLocaleString()} words</span>
                  {v.verdict !== 'Keep' && (
                    <span className="cpo-why">{v.reason} {v.action && <b>{v.action}</b>}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {needsWork.length > 0 && needsWork.length < verdicts.length && (
            <button type="button" className="cpo-toggle" onClick={() => setShowAll(v => !v)}>
              {showAll ? `Show only pages that need work (${needsWork.length})` : `Show all ${verdicts.length} pages`}
            </button>
          )}
        </>
      )}
    </section>
  )
}
