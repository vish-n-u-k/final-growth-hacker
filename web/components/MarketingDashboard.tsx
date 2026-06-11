'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { WEBSITE_SKELETON, getAllItems, type SkeletonCategory } from '@/lib/data/skeleton'

export interface DBItemState {
  aiDetail: string | null
  aiVerified: boolean
  userChecked: boolean
}

interface Props {
  brand: { id: string; name: string }
  channel: { id: string; url: string; lastAnalyzedAt: string | null }
  itemStates: Record<string, DBItemState>
  userEmail: string
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never analysed'
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return 'Just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function getCatStats(cat: SkeletonCategory, states: Record<string, DBItemState>) {
  const items = cat.subCategories.flatMap((s) => s.items)
  const total = items.length
  const aiVerified = items.filter((i) => states[i.slug]?.aiVerified).length
  const selfOnly = items.filter((i) => !states[i.slug]?.aiVerified && states[i.slug]?.userChecked).length
  const done = aiVerified + selfOnly
  const totalWeight = items.reduce((sum, i) => sum + i.weight, 0)
  const doneWeight = items.filter((i) => states[i.slug]?.aiVerified || states[i.slug]?.userChecked).reduce((sum, i) => sum + i.weight, 0)
  const aiWeight = items.filter((i) => states[i.slug]?.aiVerified).reduce((sum, i) => sum + i.weight, 0)
  return { total, aiVerified, selfOnly, done, totalWeight, doneWeight, aiWeight, pct: totalWeight ? Math.round((doneWeight / totalWeight) * 100) : 0 }
}

function getOverall(states: Record<string, DBItemState>) {
  const items = getAllItems(WEBSITE_SKELETON)
  const total = items.length
  const aiVerified = items.filter((i) => states[i.slug]?.aiVerified).length
  const selfOnly = items.filter((i) => !states[i.slug]?.aiVerified && states[i.slug]?.userChecked).length
  const done = aiVerified + selfOnly
  const totalWeight = items.reduce((sum, i) => sum + i.weight, 0)
  const doneWeight = items.filter((i) => states[i.slug]?.aiVerified || states[i.slug]?.userChecked).reduce((sum, i) => sum + i.weight, 0)
  const aiWeight = items.filter((i) => states[i.slug]?.aiVerified).reduce((sum, i) => sum + i.weight, 0)
  return { total, aiVerified, selfOnly, open: total - done, done, totalWeight, doneWeight, aiWeight, pct: totalWeight ? Math.round((doneWeight / totalWeight) * 100) : 0 }
}

export default function MarketingDashboard({ brand, channel, itemStates: initial, userEmail }: Props) {
  const [states, setStates] = useState(initial)
  const [openCats, setOpenCats] = useState<Set<string>>(
    () => new Set([WEBSITE_SKELETON.categories[0].slug]),
  )
  const [reanalyzing, setReanalyzing] = useState(false)
  const router = useRouter()

  const overall = getOverall(states)
  const displayUrl = channel.url.replace(/^https?:\/\//, '').replace(/\/$/, '')

  const toggleCat = (slug: string) =>
    setOpenCats((prev) => {
      const next = new Set(prev)
      next.has(slug) ? next.delete(slug) : next.add(slug)
      return next
    })

  const toggleItem = useCallback(
    async (slug: string, current: boolean) => {
      const next = !current
      setStates((prev) => ({
        ...prev,
        [slug]: { ...(prev[slug] ?? { aiDetail: null, aiVerified: false }), userChecked: next },
      }))
      await fetch('/api/items/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: channel.id, itemSlug: slug, checked: next }),
      })
    },
    [channel.id],
  )

  const handleReanalyze = async () => {
    setReanalyzing(true)
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId: channel.id }),
    })
    if (res.ok) router.refresh()
    setReanalyzing(false)
  }

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <>
      {/* Header */}
      <header>
        <div className="wrap md-header-inner">
          <div className="logo">
            <span className="mark">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M5 12h4l2-6 3 12 2-6h3" stroke="#06140c" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            {brand.name}
          </div>
          <div className="md-header-actions">
            <button onClick={handleReanalyze} disabled={reanalyzing} className="md-btn-reanalyze">
              {reanalyzing ? (
                <>
                  <span className="md-spin" />
                  Re-analysing…
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                    <path d="M4 4v6h6M20 20v-6h-6M4.06 15a9 9 0 1 0 .94-6.93" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Re-analyse
                </>
              )}
            </button>
            <button onClick={handleLogout} className="logout-btn">{userEmail} · Sign out</button>
          </div>
        </div>
      </header>

      <div className="wrap">
        {/* Overview */}
        <div className="md-overview">
          <div className="md-ov-top">
            <div>
              <div className="md-ov-label">Website SEO</div>
              <div className="md-ov-url">{displayUrl}</div>
            </div>
            <div className="md-ov-meta">
              <span className="md-ov-time">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                  <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                {timeAgo(channel.lastAnalyzedAt)}
              </span>
            </div>
          </div>

          <div className="md-ov-score-row">
            <span className="md-ov-pct">{overall.pct}<span>%</span></span>
            <div className="md-ov-bar-wrap">
              <div className="md-ov-bar">
                <div className="md-ov-bar-self" style={{ width: `${Math.round((overall.doneWeight / overall.totalWeight) * 100)}%` }} />
                <div className="md-ov-bar-ai" style={{ width: `${Math.round((overall.aiWeight / overall.totalWeight) * 100)}%` }} />
              </div>
              <div className="md-ov-legend">
                <span className="md-leg-ai" />AI verified
                <span className="md-leg-self" />Self-reported
              </div>
            </div>
          </div>

          <div className="md-ov-stats">
            <div className="md-ov-stat">
              <span className="md-ov-stat-num md-ov-stat-num-ai">{overall.aiVerified}</span>
              <span className="md-ov-stat-lbl">AI verified</span>
            </div>
            <div className="md-ov-divider" />
            <div className="md-ov-stat">
              <span className="md-ov-stat-num md-ov-stat-num-self">{overall.selfOnly}</span>
              <span className="md-ov-stat-lbl">Self-reported</span>
            </div>
            <div className="md-ov-divider" />
            <div className="md-ov-stat">
              <span className="md-ov-stat-num">{overall.open}</span>
              <span className="md-ov-stat-lbl">Open</span>
            </div>
            <div className="md-ov-divider" />
            <div className="md-ov-stat">
              <span className="md-ov-stat-num">{overall.total}</span>
              <span className="md-ov-stat-lbl">Total checks</span>
            </div>
          </div>
        </div>

        {/* Categories */}
        <div className="md-cats">
          {WEBSITE_SKELETON.categories.map((cat) => {
            const stats = getCatStats(cat, states)
            const isOpen = openCats.has(cat.slug)

            return (
              <div key={cat.slug} className={`md-cat${isOpen ? ' md-cat-open' : ''}`}>
                {/* Category header */}
                <button className="md-cat-hd" onClick={() => toggleCat(cat.slug)}>
                  <div className="md-cat-hd-left">
                    <span className="md-cat-hd-name">{cat.label}</span>
                    <span className="md-cat-hd-count">{stats.done}/{stats.total}</span>
                  </div>
                  <div className="md-cat-hd-right">
                    <div className="md-cat-mini-bar">
                      <div className="md-cat-mini-self" style={{ width: `${Math.round((stats.doneWeight / stats.totalWeight) * 100)}%` }} />
                      <div className="md-cat-mini-ai" style={{ width: `${Math.round((stats.aiWeight / stats.totalWeight) * 100)}%` }} />
                    </div>
                    <span className="md-cat-pct">{stats.pct}%</span>
                    <svg className={`md-chev${isOpen ? ' md-chev-open' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </div>
                </button>

                {/* Category body */}
                {isOpen && (
                  <div className="md-cat-body">
                    {cat.subCategories.map((sub, si) => {
                      const subDone = sub.items.filter(
                        (i) => states[i.slug]?.aiVerified || states[i.slug]?.userChecked,
                      ).length
                      return (
                        <div key={sub.slug} className={`md-sub${si > 0 ? ' md-sub-border' : ''}`}>
                          <div className="md-sub-hd">
                            <span className="md-sub-name">{sub.label}</span>
                            <span className="md-sub-count">{subDone}/{sub.items.length}</span>
                          </div>
                          <div className="md-items">
                            {[...sub.items].sort((a, b) => {
                              const aDone = (states[a.slug]?.aiVerified || states[a.slug]?.userChecked) ? 1 : 0
                              const bDone = (states[b.slug]?.aiVerified || states[b.slug]?.userChecked) ? 1 : 0
                              if (aDone !== bDone) return aDone - bDone
                              return b.weight - a.weight // within same done-state, higher weight first
                            }).map((item) => {
                              const s = states[item.slug]
                              const aiV = s?.aiVerified ?? false
                              const userC = s?.userChecked ?? false
                              const done = aiV || userC
                              const needsAttention = s && !aiV && !userC

                              return (
                                <div
                                  key={item.slug}
                                  className={`md-item${done ? ' md-item-done' : ''}${needsAttention ? ' md-item-flagged' : ''}`}
                                  onClick={() => toggleItem(item.slug, userC)}
                                >
                                  <span className={`md-cb${aiV ? ' md-cb-ai' : userC ? ' md-cb-self' : ''}`}>
                                    {(aiV || userC) && (
                                      <svg viewBox="0 0 24 24" fill="none">
                                        <path d="M5 13l4 4L19 7" stroke={aiV ? '#06140c' : 'var(--lime)'} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                    )}
                                  </span>
                                  <div className="md-item-body">
                                    <div className="md-item-top">
                                      <span className="md-item-lbl">{item.label}</span>
                                      {!done && item.weight === 3 && <span className="md-tag md-tag-critical">Critical</span>}
                                      {!done && item.weight === 2 && <span className="md-tag md-tag-important">Important</span>}
                                      {aiV && <span className="md-tag md-tag-ai">AI ✓</span>}
                                      {!aiV && userC && <span className="md-tag md-tag-self">Self</span>}
                                    </div>
                                    {s?.aiDetail && (
                                      <p className="md-item-detail">{s.aiDetail}</p>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <p className="foot-note" style={{ marginTop: '16px' }}>
          AI verified = confirmed live on your site · Self-reported = marked by you, verified on next re-analyse
        </p>
      </div>
    </>
  )
}
