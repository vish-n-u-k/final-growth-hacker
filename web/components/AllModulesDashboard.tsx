'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { type ModuleDefinition, type ModuleCategoryDefinition, type ModuleItemDefinition, type DBItemFull } from '@/lib/modules/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import ThemeToggle from '@/components/ThemeToggle'
import { type DBItemState } from './ModuleDashboard'

export interface ModuleData {
  id: string
  type: string
  name: string
  order: number
  status: string
  score: number
  lastAnalyzedAt: string | null
  requirements: Record<string, string>
  agentPrUrl: string | null
  definition: ModuleDefinition
  itemStates: Record<string, DBItemState>
  fullItems: DBItemFull[]
  pageVerdicts: { url: string; title: string | null; wordCount: number; verdict: string; urgency: string; reason: string | null; action: string | null }[]
}

interface Props {
  brand: { id: string; name: string }
  allModulesData: ModuleData[]
  userEmail: string
  githubConnected: boolean
  connectedIntegrations: Record<string, boolean>
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never analysed'
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return 'Just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function getCatStats(cat: ModuleCategoryDefinition, states: Record<string, DBItemState>) {
  const items = cat.subCategories.flatMap((s) => s.items)
  const totalWeight = items.reduce((sum, i) => sum + i.weight, 0)
  const aiWeight = items.filter((i) => states[i.slug]?.aiVerified).reduce((sum, i) => sum + i.weight, 0)
  const doneWeight = items.filter((i) => states[i.slug]?.aiVerified || states[i.slug]?.userChecked).reduce((sum, i) => sum + i.weight, 0)
  const done = items.filter((i) => states[i.slug]?.aiVerified || states[i.slug]?.userChecked).length
  return { total: items.length, done, totalWeight, doneWeight, aiWeight, pct: totalWeight ? Math.round((doneWeight / totalWeight) * 100) : 0 }
}

function getOverall(def: ModuleDefinition, states: Record<string, DBItemState>) {
  const items = (def.categories as ModuleCategoryDefinition[]).flatMap((c) => c.subCategories.flatMap((s) => s.items))
  const totalWeight = items.reduce((sum, i) => sum + i.weight, 0)
  const doneWeight = items.filter((i) => states[i.slug]?.aiVerified || states[i.slug]?.userChecked).reduce((sum, i) => sum + i.weight, 0)
  return { pct: totalWeight ? Math.round((doneWeight / totalWeight) * 100) : 0 }
}

function getDynamicCatStats(categorySlug: string, items: DBItemFull[]) {
  const catItems = items.filter((i) => i.categorySlug === categorySlug)
  const totalWeight = catItems.reduce((s, i) => s + i.weight, 0)
  const aiWeight = catItems.filter((i) => i.aiVerified).reduce((s, i) => s + i.weight, 0)
  const doneWeight = catItems.filter((i) => i.aiVerified || i.userChecked).reduce((s, i) => s + i.weight, 0)
  const done = catItems.filter((i) => i.aiVerified || i.userChecked).length
  return { total: catItems.length, done, totalWeight, doneWeight, aiWeight, pct: totalWeight ? Math.round((doneWeight / totalWeight) * 100) : 0 }
}

function userCountToBarPct(count: number): number {
  if (count <= 0) return 0
  if (count <= 10) return (count / 10) * 25
  if (count <= 50) return 25 + ((count - 10) / 40) * 25
  if (count <= 100) return 50 + ((count - 50) / 50) * 25
  return 75 + Math.min((count - 100) / 400, 1) * 25
}

export default function AllModulesDashboard({ brand, allModulesData, userEmail, githubConnected, connectedIntegrations }: Props) {
  const [statesMap, setStatesMap] = useState<Record<string, Record<string, DBItemState>>>(() =>
    Object.fromEntries(allModulesData.map(m => [m.id, m.itemStates]))
  )
  const [dynItemsMap, setDynItemsMap] = useState<Record<string, DBItemFull[]>>(() =>
    Object.fromEntries(allModulesData.map(m => [m.id, m.fullItems]))
  )
  const [openModules, setOpenModules] = useState<Set<string>>(() => {
    const first = [...allModulesData].sort((a, b) => a.order - b.order).find(m => m.status !== 'locked')
    return first ? new Set([first.id]) : new Set()
  })
  const [openCatsMap, setOpenCatsMap] = useState<Record<string, Set<string>>>(() =>
    Object.fromEntries(allModulesData.map(m => [m.id, new Set([m.definition.categories[0]?.slug ?? ''])]))
  )
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())
  const [verifyingItems, setVerifyingItems] = useState<Set<string>>(new Set())
  const [applyingFix, setApplyingFix] = useState<Set<string>>(new Set())
  const [reanalyzingMap, setReanalyzingMap] = useState<Record<string, boolean>>({})
  const [reqValuesMap, setReqValuesMap] = useState<Record<string, Record<string, string>>>(() =>
    Object.fromEntries(allModulesData.map(m => [m.id, m.requirements]))
  )
  const [setupErrorMap, setSetupErrorMap] = useState<Record<string, string | null>>({})
  const [generatingDraft, setGeneratingDraft] = useState<Set<string>>(new Set())
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null)
  const [prUrlMap, setPrUrlMap] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(allModulesData.map(m => [m.id, m.agentPrUrl]))
  )
  const [userCount, setUserCount] = useState(0)
  const [editingCount, setEditingCount] = useState(false)

  useEffect(() => {
    setUserCount(parseInt(localStorage.getItem('gh_user_count') ?? '0', 10) || 0)
  }, [])

  const router = useRouter()

  const activeModule = [...allModulesData].sort((a, b) => a.order - b.order).find(m => m.status !== 'locked')
  const currentLevel = activeModule?.order ?? 0
  const barPct = userCountToBarPct(userCount)

  const toggleModule = (modId: string) =>
    setOpenModules(prev =>
      prev.has(modId) ? new Set() : new Set([modId])
    )

  const toggleCat = (modId: string, slug: string) =>
    setOpenCatsMap(prev => {
      const cats = new Set(prev[modId] ?? [])
      cats.has(slug) ? cats.delete(slug) : cats.add(slug)
      return { ...prev, [modId]: cats }
    })

  const toggleExpand = (modId: string, slug: string, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.md-cb')) return
    const key = `${modId}:${slug}`
    setExpandedItems(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const toggleItem = useCallback(async (modId: string, isDynamic: boolean, itemId: string, slug: string, current: boolean, e: React.MouseEvent) => {
    e.stopPropagation()
    const next = !current

    if (isDynamic) {
      setDynItemsMap(prev => ({
        ...prev,
        [modId]: (prev[modId] ?? []).map(i => i.id === itemId ? { ...i, userChecked: next } : i),
      }))
    } else {
      setStatesMap(prev => ({
        ...prev,
        [modId]: {
          ...prev[modId],
          [slug]: {
            ...(prev[modId]?.[slug] ?? { id: itemId, aiDetail: null, aiNarrative: null, aiAction: null, aiVerified: false, completedBy: null, fixable: false, fixInputKey: null, fixIntegrationProvider: null }),
            userChecked: next,
          },
        },
      }))
    }

    await fetch('/api/items/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId, checked: next }),
    })

    if (!isDynamic && next) {
      const itemKey = `${modId}:${slug}`
      setVerifyingItems(prev => new Set(prev).add(itemKey))
      try {
        const res = await fetch('/api/items/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId }),
        })
        const data = await res.json()
        if (data.canVerify && data.aiVerified) {
          setStatesMap(prev => ({
            ...prev,
            [modId]: {
              ...prev[modId],
              [slug]: { ...prev[modId]?.[slug], aiVerified: true, aiDetail: data.detail ?? prev[modId]?.[slug]?.aiDetail ?? null },
            },
          }))
        }
      } catch {
        // verification failure is non-fatal
      } finally {
        setVerifyingItems(prev => { const n = new Set(prev); n.delete(`${modId}:${slug}`); return n })
      }
    }
  }, [])

  const handleReanalyze = async (modId: string, reqValues: Record<string, string>, overrideReqs?: Record<string, string>) => {
    setSetupErrorMap(prev => ({ ...prev, [modId]: null }))
    setReanalyzingMap(prev => ({ ...prev, [modId]: true }))
    const body: Record<string, unknown> = { moduleId: modId }
    const reqs = overrideReqs ?? reqValues
    const nonEmpty = Object.fromEntries(Object.entries(reqs).filter(([, v]) => typeof v === 'string' && (v as string).trim()))
    if (Object.keys(nonEmpty).length > 0) body.requirements = nonEmpty
    const res = await fetch('/api/modules/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      window.location.reload()
    } else {
      const data = await res.json().catch(() => ({}))
      setSetupErrorMap(prev => ({ ...prev, [modId]: (data as { error?: string }).error ?? 'Analysis failed. Please try again.' }))
      setReanalyzingMap(prev => ({ ...prev, [modId]: false }))
    }
  }

  const handleApplyFix = useCallback(async (modId: string, isDynamic: boolean, itemId: string, slug: string) => {
    const itemKey = `${modId}:${slug}`
    setApplyingFix(prev => new Set(prev).add(itemKey))
    try {
      const res = await fetch('/api/items/apply-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId }),
      })
      const data = await res.json()
      if (res.ok && data.prUrl) {
        setPrUrlMap(prev => ({ ...prev, [modId]: data.prUrl }))
        if (isDynamic) {
          setDynItemsMap(prev => ({ ...prev, [modId]: (prev[modId] ?? []).map(i => i.id === itemId ? { ...i, completedBy: 'agent', aiVerified: true } : i) }))
        } else {
          setStatesMap(prev => ({ ...prev, [modId]: { ...prev[modId], [slug]: { ...prev[modId]?.[slug], completedBy: 'agent', aiVerified: true } } }))
        }
      } else {
        alert(data.error ?? 'Fix failed — please try again.')
      }
    } catch {
      alert('Fix failed — please check your connection and try again.')
    } finally {
      setApplyingFix(prev => { const n = new Set(prev); n.delete(itemKey); return n })
    }
  }, [])

  const handleGenerateDraft = async (modId: string, itemId: string, slug: string) => {
    const itemKey = `${modId}:${slug}`
    setGeneratingDraft(prev => new Set(prev).add(itemKey))
    try {
      const res = await fetch('/api/items/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId }),
      })
      const data = await res.json()
      if (data.draft) {
        setDynItemsMap(prev => ({ ...prev, [modId]: (prev[modId] ?? []).map(i => i.id === itemId ? { ...i, aiDraft: data.draft } : i) }))
      }
    } catch {
      // non-fatal
    } finally {
      setGeneratingDraft(prev => { const n = new Set(prev); n.delete(itemKey); return n })
    }
  }

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  // ── Dynamic item renderer ────────────────────────────────────────────────────
  const renderDynamicItem = (modId: string, prUrl: string | null, item: DBItemFull) => {
    const aiV = item.aiVerified
    const userC = item.userChecked
    const done = aiV || userC
    const needsAttention = !aiV && !userC
    const itemKey = `${modId}:${item.slug}`
    const isExpanded = expandedItems.has(itemKey)
    const hasDetail = !!(item.aiNarrative || item.aiAction)

    return (
      <div
        key={item.slug}
        className={`md-item sm-item${done ? ' md-item-done' : ''}${needsAttention ? ' md-item-flagged' : ''}${isExpanded ? ' sm-item-expanded' : ''}`}
        onClick={(e) => hasDetail && toggleExpand(modId, item.slug, e)}
        style={{ cursor: hasDetail ? 'pointer' : 'default' }}
      >
        <span
          className={`md-cb${aiV ? ' md-cb-ai' : userC ? ' md-cb-self' : ''}`}
          onClick={(e) => toggleItem(modId, true, item.id, item.slug, userC, e)}
          style={{ cursor: 'pointer' }}
        >
          {(aiV || userC) && (
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M5 13l4 4L19 7" stroke={aiV ? '#06140c' : 'var(--lime)'} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        <div className="md-item-body">
          <div className="md-item-top">
            <span className="md-item-lbl">{item.label}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
              {!done && item.weight === 3 && <Badge className="md-tag md-tag-critical">Critical</Badge>}
              {!done && item.weight === 2 && <Badge className="md-tag md-tag-important">Important</Badge>}
              {aiV && <Badge className="md-tag md-tag-ai">AI ✓</Badge>}
              {!aiV && userC && <Badge className="md-tag md-tag-self">Self</Badge>}
              {item.fixable && !aiV && item.completedBy !== 'agent' && (() => {
                const isAssisted = !!(item.fixInputKey && item.fixIntegrationProvider !== 'brand_assets')
                const badgeLabel = isAssisted ? 'Assisted fix' : 'Auto-fixable'
                const tooltip = isAssisted
                  ? (item.fixInputKey === 'ga4_measurement_id'
                    ? 'Go to analytics.google.com → create a GA4 property → copy your Measurement ID (G-XXXXXXXXXX) → save it in Settings → Integrations → Google Analytics.'
                    : item.fixInputKey === 'gsc_verification_code'
                    ? 'Go to search.google.com/search-console → add property → choose HTML tag verification → copy the content value → save it in Settings → Integrations → Google Search Console.'
                    : 'Save the required value in Settings → Integrations to enable this fix.')
                  : null
                return (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <span className={`md-tag ${githubConnected ? 'md-tag-fix' : 'md-tag-fix-off'}`}>⚡ {badgeLabel}</span>
                    {tooltip && (
                      <span className="md-info-wrap">
                        <svg className="md-info-icon" width="13" height="13" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                          <path d="M12 16v-4M12 8h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                        <span className="md-tooltip">{tooltip}</span>
                      </span>
                    )}
                  </span>
                )
              })()}
              {hasDetail && <span className="sm-expand-icon">{isExpanded ? '−' : '+'}</span>}
            </div>
          </div>
          {item.aiDetail && <p className="md-item-detail">{item.aiDetail}</p>}
          {isExpanded && hasDetail && (
            <div className="sm-expanded-body">
              {item.aiNarrative && <p className="sm-narrative">{item.aiNarrative}</p>}
              {item.aiAction && (
                <div className="sm-action-box">
                  <span className="sm-action-label">Action</span>
                  <p className="sm-action-text">{item.aiAction}</p>
                </div>
              )}
              {item.slug === 'content-calendar-30-day' && !!item.aiData && (
                <a
                  href={`/api/modules/${modId}/calendar`}
                  download
                  onClick={(e) => e.stopPropagation()}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '10px', padding: '6px 14px', borderRadius: '6px', border: '1px solid var(--green)', color: 'var(--green-bright)', fontSize: '12px', fontWeight: 500, textDecoration: 'none', background: 'transparent' }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Download Calendar CSV
                </a>
              )}
              {!aiV && !item.fixable && (
                <div className="sm-draft-section">
                  {item.aiDraft ? (
                    <>
                      <div className="sm-draft-header">
                        <span className="sm-draft-label">AI Draft</span>
                        <button
                          className="sm-draft-copy"
                          onClick={(e) => {
                            e.stopPropagation()
                            navigator.clipboard.writeText(item.aiDraft!)
                            setCopiedSlug(item.slug)
                            setTimeout(() => setCopiedSlug(null), 2000)
                          }}
                        >
                          {copiedSlug === item.slug ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                      <pre className="sm-draft-content">{item.aiDraft}</pre>
                      <button
                        className="sm-draft-regen"
                        disabled={generatingDraft.has(itemKey)}
                        onClick={(e) => { e.stopPropagation(); handleGenerateDraft(modId, item.id, item.slug) }}
                      >
                        {generatingDraft.has(itemKey) ? 'Regenerating…' : 'Regenerate'}
                      </button>
                    </>
                  ) : (
                    <button
                      className="sm-draft-btn"
                      disabled={generatingDraft.has(itemKey)}
                      onClick={(e) => { e.stopPropagation(); handleGenerateDraft(modId, item.id, item.slug) }}
                    >
                      {generatingDraft.has(itemKey) ? <><span className="md-spin" />Generating draft…</> : '✦ Generate AI draft'}
                    </button>
                  )}
                </div>
              )}
              {item.fixable && !aiV && item.completedBy !== 'agent' && (
                <div className="md-fix-row">
                  {(() => {
                    const needsIntegration = !!(item.fixIntegrationProvider && item.fixIntegrationProvider !== 'brand_assets')
                    const integrationReady = !needsIntegration || !!connectedIntegrations[item.fixIntegrationProvider!]
                    if (!githubConnected) return <p className="md-fix-hint">Connect GitHub in <a href="/settings" className="md-fix-hint-link">Settings</a> to apply this fix automatically.</p>
                    if (!integrationReady) return <p className="md-fix-hint">Set up the required integration in <a href="/settings" className="md-fix-hint-link">Settings → Integrations</a> to enable this fix.</p>
                    return applyingFix.has(itemKey) ? (
                      <span className="md-fix-applying"><span className="md-spin" />Applying fix…</span>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 border-[var(--green)] text-[var(--green)] hover:bg-[var(--accent)] hover:text-[var(--green-bright)] hover:border-[var(--green-bright)] bg-transparent text-xs"
                        onClick={(e) => { e.stopPropagation(); handleApplyFix(modId, true, item.id, item.slug) }}
                      >
                        Apply fix via GitHub
                      </Button>
                    )
                  })()}
                </div>
              )}
              {item.completedBy === 'agent' && prUrl && (
                <a href={prUrl} target="_blank" rel="noopener noreferrer" className="md-fix-pr-link" onClick={(e) => e.stopPropagation()}>
                  Applied — view on GitHub
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Static item renderer ─────────────────────────────────────────────────────
  const renderStaticItem = (modId: string, prUrl: string | null, item: ModuleItemDefinition, s: DBItemState | undefined) => {
    const aiV = s?.aiVerified ?? false
    const userC = s?.userChecked ?? false
    const done = aiV || userC
    const needsAttention = s && !aiV && !userC
    const itemKey = `${modId}:${item.slug}`
    const isExpanded = expandedItems.has(itemKey)
    const hasDetail = !!(s?.aiNarrative || s?.aiAction)
    const isVerifying = verifyingItems.has(itemKey)

    return (
      <div
        key={item.slug}
        className={`md-item sm-item${done ? ' md-item-done' : ''}${needsAttention ? ' md-item-flagged' : ''}${isExpanded ? ' sm-item-expanded' : ''}`}
        onClick={(e) => hasDetail && toggleExpand(modId, item.slug, e)}
        style={{ cursor: hasDetail ? 'pointer' : 'default' }}
      >
        <span
          className={`md-cb${aiV ? ' md-cb-ai' : userC ? ' md-cb-self' : ''}`}
          onClick={(e) => toggleItem(modId, false, s?.id ?? '', item.slug, userC, e)}
          style={{ cursor: 'pointer' }}
        >
          {isVerifying ? (
            <span className="md-spin" style={{ width: '10px', height: '10px' }} />
          ) : (aiV || userC) ? (
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M5 13l4 4L19 7" stroke={aiV ? '#06140c' : 'var(--lime)'} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : null}
        </span>
        <div className="md-item-body">
          <div className="md-item-top">
            <span className="md-item-lbl">{item.label}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
              {!done && item.weight === 3 && <span className="md-tag md-tag-critical">Critical</span>}
              {!done && item.weight === 2 && <span className="md-tag md-tag-important">Important</span>}
              {aiV && <span className="md-tag md-tag-ai">AI ✓</span>}
              {!aiV && userC && <span className="md-tag md-tag-self">Self</span>}
              {s?.fixable && !aiV && s.completedBy !== 'agent' && (() => {
                const isAssisted = !!(s.fixInputKey && s.fixIntegrationProvider !== 'brand_assets')
                const isUpgradeable = !!(s.fixInputKey && s.fixIntegrationProvider === 'brand_assets')
                const upgradeReady = isUpgradeable && !!connectedIntegrations['brand_assets']
                const isAlwaysPartial = !!(item.partialFix && !s.fixInputKey)
                const badgeLabel = isAssisted ? 'Assisted fix'
                  : (isUpgradeable && !upgradeReady) || isAlwaysPartial ? 'Partially fixable'
                  : 'Auto-fixable'
                const tooltip = isAssisted
                  ? (s.fixInputKey === 'ga4_measurement_id'
                    ? 'Go to analytics.google.com → create a GA4 property → copy your Measurement ID (G-XXXXXXXXXX) → save it in Settings → Integrations → Google Analytics.'
                    : s.fixInputKey === 'gsc_verification_code'
                    ? 'Go to search.google.com/search-console → add property → choose HTML tag verification → copy the content value → save it in Settings → Integrations → Google Search Console.'
                    : 'Save the required value in Settings → Integrations to enable this fix.')
                  : isUpgradeable && !upgradeReady ? (item.upgradeInput?.setupInstructions ?? 'Save the required asset in Settings → Brand Assets to upgrade to a complete fix.')
                  : isAlwaysPartial ? (item.partialFix ?? null)
                  : null
                return (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <Badge className={`md-tag ${githubConnected ? 'md-tag-fix' : 'md-tag-fix-off'}`}>⚡ {badgeLabel}</Badge>
                    {tooltip && (
                      <span className="md-info-wrap">
                        <svg className="md-info-icon" width="13" height="13" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                          <path d="M12 16v-4M12 8h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                        <span className="md-tooltip">{tooltip}</span>
                      </span>
                    )}
                  </span>
                )
              })()}
              {hasDetail && <span className="sm-expand-icon">{isExpanded ? '−' : '+'}</span>}
            </div>
          </div>
          {s?.aiDetail && <p className="md-item-detail">{s.aiDetail}</p>}
          {isExpanded && hasDetail && (
            <div className="sm-expanded-body">
              {s?.aiNarrative && <p className="sm-narrative">{s.aiNarrative}</p>}
              {s?.aiAction && (
                <div className="sm-action-box">
                  <span className="sm-action-label">Action</span>
                  <p className="sm-action-text">{s.aiAction}</p>
                </div>
              )}
              {s?.fixable && !aiV && s.completedBy !== 'agent' && (
                <div className="md-fix-row">
                  {(() => {
                    const needsIntegration = !!(s.fixIntegrationProvider && s.fixIntegrationProvider !== 'brand_assets')
                    const integrationReady = !needsIntegration || !!connectedIntegrations[s.fixIntegrationProvider!]
                    if (!githubConnected) return <p className="md-fix-hint">Connect GitHub in <a href="/settings" className="md-fix-hint-link">Settings</a> to apply this fix automatically.</p>
                    if (!integrationReady) return <p className="md-fix-hint">Set up the required integration in <a href="/settings" className="md-fix-hint-link">Settings → Integrations</a> to enable this fix.</p>
                    return applyingFix.has(itemKey) ? (
                      <span className="md-fix-applying"><span className="md-spin" />Applying fix…</span>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 border-[var(--green)] text-[var(--green)] hover:bg-[var(--accent)] hover:text-[var(--green-bright)] hover:border-[var(--green-bright)] bg-transparent text-xs"
                        onClick={(e) => { e.stopPropagation(); handleApplyFix(modId, false, s.id, item.slug) }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                          <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        Apply fix via GitHub
                      </Button>
                    )
                  })()}
                </div>
              )}
              {s?.completedBy === 'agent' && prUrl && (
                <a href={prUrl} target="_blank" rel="noopener noreferrer" className="md-fix-pr-link" onClick={(e) => e.stopPropagation()}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <circle cx="18" cy="18" r="3" stroke="currentColor" strokeWidth="2" />
                    <circle cx="6" cy="6" r="3" stroke="currentColor" strokeWidth="2" />
                    <path d="M6 21V9a9 9 0 0 0 9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Applied — view on GitHub
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Header */}
      <header>
        <div className="wrap md-header-inner">
          <div className="logo" style={{ cursor: 'pointer' }} onClick={() => router.push('/dashboard')}>
            <span className="mark">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M5 12h4l2-6 3 12 2-6h3" stroke="#06140c" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            Growth Hacker
          </div>
          <div className="md-header-actions">
            <ThemeToggle />
            <Button
              variant="outline"
              size="icon"
              onClick={() => router.push('/settings')}
              title="Settings"
              className="w-10 h-10 border-[var(--line)] text-[var(--text-dim)] hover:border-[var(--green)] hover:text-[var(--text)] bg-transparent rounded-[10px]"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Button>
            <Button
              variant="ghost"
              onClick={handleLogout}
              className="text-[var(--text-faint)] hover:text-[var(--text-dim)] w-48 border border-[var(--line)] hover:border-[var(--green)] text-sm"
            >
              {userEmail} · Sign out
            </Button>
          </div>
        </div>
      </header>

      <div className="wrap">
        {/* Hero */}
        <div className="hero">
          <h1>Your road to 500 users</h1>
          <p>One level at a time. Clear each gate before you level up — don't skip ahead.</p>
        </div>

        {/* Overview */}
        <div className="overview">
          <div
            className="big-num"
            onClick={() => !editingCount && setEditingCount(true)}
            title="Click to update your user count"
          >
            {editingCount ? (
              <input
                autoFocus
                type="number"
                min={0}
                max={9999}
                defaultValue={userCount}
                onBlur={(e) => {
                  const val = Math.max(0, parseInt(e.target.value, 10) || 0)
                  setUserCount(val)
                  localStorage.setItem('gh_user_count', String(val))
                  setEditingCount(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') setEditingCount(false)
                }}
              />
            ) : userCount}
            <span>/500</span>
          </div>
          <div className="meta">
            <div className="lvl">Currently · Level {currentLevel}</div>
            <div className="desc">{activeModule?.definition.description}</div>
            <div className="journey-bar">
              <div className="journey-track">
                <div className="journey-fill" style={{ width: `${barPct}%` }} />
              </div>
              <div className="journey-labels">
                <span>0</span><span>10</span><span>50</span><span>100</span><span>500</span>
              </div>
            </div>
          </div>
        </div>

        {/* Module accordion stack */}
        <div className="levels">
          {allModulesData.map((modData) => {
            const isOpen = openModules.has(modData.id)
            const isLocked = modData.status === 'locked'
            const isDone = !isLocked && modData.score >= 70
            const isYouAreHere = !isLocked && !isDone && modData.id === activeModule?.id
            const stateClass = isLocked ? 'locked' : isDone ? 'done' : 'active'
            const reanalyzing = reanalyzingMap[modData.id] ?? false
            const reqValues = reqValuesMap[modData.id] ?? {}
            const setupError = setupErrorMap[modData.id] ?? null
            const prUrl = prUrlMap[modData.id] ?? null
            const def = modData.definition
            const states = statesMap[modData.id] ?? {}
            const dynItems = dynItemsMap[modData.id] ?? []
            const openCats = openCatsMap[modData.id] ?? new Set<string>()
            const missingReqs = def.requirements.filter(r => r.required !== false && !reqValues[r.key]?.trim())
            const needsSetup = missingReqs.length > 0

            return (
              <div key={modData.id} className={`level ${stateClass}${isOpen ? ' open' : ''}`}>

                {/* Level head */}
                <div className="level-head" onClick={() => !isLocked && toggleModule(modData.id)}>
                  <div className="level-badge">
                    {isLocked ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
                        <path d="M8 11V7a4 4 0 1 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    ) : isDone ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      modData.order
                    )}
                  </div>

                  <div className="level-info">
                    <div className="name">
                      {modData.name}
                      {isLocked
                        ? <span className="pill soon">Locked</span>
                        : isDone
                        ? <span className="pill clear">Cleared</span>
                        : isYouAreHere
                        ? <span className="pill now">You are here</span>
                        : null}
                    </div>
                    {!isOpen && <div className="focus">{def.description}</div>}
                  </div>

                  {!isLocked && (
                    <div className="level-prog">
                      <div className="mini-track">
                        <div className="mini-fill" style={{ width: `${modData.score}%` }} />
                      </div>
                      {modData.score}%
                    </div>
                  )}

                  {!isLocked && (
                    <svg className="chev" width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  )}
                </div>

                {/* Level body */}
                {!isLocked && (
                  <div className="level-body" style={{ maxHeight: isOpen ? '9999px' : undefined }}>

                    {/* Re-analyze toolbar */}
                    <div style={{ padding: '14px 28px', borderTop: '1px solid var(--line)', display: 'flex', gap: '12px', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
                      <Button
                        variant="outline"
                        onClick={() => handleReanalyze(modData.id, reqValues)}
                        disabled={reanalyzing}
                        className="gap-2 border-[var(--green)] px-4 h-9 text-[var(--green-bright)] hover:bg-[var(--accent)] hover:text-[var(--green-bright)] bg-[var(--card)] text-sm font-semibold"
                      >
                        {reanalyzing ? (
                          <><span className="md-spin" />Re-analysing…</>
                        ) : (
                          <>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                              <path d="M4 4v6h6M20 20v-6h-6M4.06 15a9 9 0 1 0 .94-6.93" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            Re-analyse
                          </>
                        )}
                      </Button>
                      <span style={{ fontSize: '12px', color: 'var(--text-faint)' }}>{timeAgo(modData.lastAnalyzedAt)}</span>
                    </div>

                    {/* Requirements setup */}
                    {needsSetup && (
                      <div className="md-setup-card" style={{ margin: '20px 28px 0' }}>
                        <div className="md-setup-title">Set up {def.name}</div>
                        <p className="md-setup-desc">Provide the information below before running the analysis.</p>
                        <div className="md-setup-fields">
                          {def.requirements.map((req) => (
                            <div key={req.key} className="md-setup-field">
                              <label className="md-setup-label">
                                {req.label}
                                {req.required !== false && <span className="md-setup-required"> *</span>}
                              </label>
                              {req.type === 'url_list' || req.type === 'text_list' ? (
                                <textarea
                                  className="md-setup-input md-setup-textarea"
                                  placeholder={req.placeholder}
                                  value={reqValues[req.key] ?? ''}
                                  onChange={(e) => setReqValuesMap(prev => ({ ...prev, [modData.id]: { ...prev[modData.id], [req.key]: e.target.value } }))}
                                  rows={3}
                                />
                              ) : (
                                <Input
                                  type={req.type === 'url' ? 'url' : 'text'}
                                  placeholder={req.placeholder}
                                  value={reqValues[req.key] ?? ''}
                                  onChange={(e) => setReqValuesMap(prev => ({ ...prev, [modData.id]: { ...prev[modData.id], [req.key]: e.target.value } }))}
                                  className="bg-[var(--input)] border-[var(--line)] text-[var(--text)] placeholder:text-[var(--text-faint)] focus-visible:ring-[var(--green)] focus-visible:border-[var(--green)]"
                                />
                              )}
                            </div>
                          ))}
                        </div>
                        {setupError && <p className="md-setup-error">{setupError}</p>}
                        <Button
                          disabled={reanalyzing || missingReqs.length > 0}
                          onClick={() => handleReanalyze(modData.id, reqValues, reqValues)}
                          className="mt-3 gap-1.5 bg-[var(--green)] text-[#06140c] hover:bg-[var(--green-bright)] font-semibold"
                        >
                          {reanalyzing ? (
                            <><span className="md-spin" style={{ borderTopColor: '#06140c', borderColor: '#06140c40' }} />Analysing…</>
                          ) : (
                            <>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                                <path d="M5 12h4l2-6 3 12 2-6h3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              Run Analysis
                            </>
                          )}
                        </Button>
                      </div>
                    )}

                    {/* Categories */}
                    <div className="md-cats" style={needsSetup ? { opacity: 0.4, pointerEvents: 'none' } : {}}>
                      {def.dynamic
                        ? def.categories.map((cat) => {
                            const stats = getDynamicCatStats(cat.slug, dynItems)
                            const isOpenCat = openCats.has(cat.slug)
                            const catItems = [...dynItems.filter(i => i.categorySlug === cat.slug)].sort((a, b) => {
                              const aDone = (a.aiVerified || a.userChecked) ? 1 : 0
                              const bDone = (b.aiVerified || b.userChecked) ? 1 : 0
                              if (aDone !== bDone) return aDone - bDone
                              return b.weight - a.weight
                            })
                            return (
                              <div key={cat.slug} className={`md-cat${isOpenCat ? ' md-cat-open' : ''}`}>
                                <button className="md-cat-hd" onClick={() => toggleCat(modData.id, cat.slug)}>
                                  <div className="md-cat-hd-left">
                                    <span className="md-cat-hd-name">{cat.label}</span>
                                    <span className="md-cat-hd-count">{stats.done}/{stats.total}</span>
                                  </div>
                                  <div className="md-cat-hd-right">
                                    <div className="md-cat-mini-bar">
                                      <div className="md-cat-mini-self" style={{ width: `${stats.totalWeight ? Math.round((stats.doneWeight / stats.totalWeight) * 100) : 0}%` }} />
                                      <div className="md-cat-mini-ai" style={{ width: `${stats.totalWeight ? Math.round((stats.aiWeight / stats.totalWeight) * 100) : 0}%` }} />
                                    </div>
                                    <span className="md-cat-pct">{stats.pct}%</span>
                                    <svg className={`md-chev${isOpenCat ? ' md-chev-open' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none">
                                      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                    </svg>
                                  </div>
                                </button>
                                {isOpenCat && (
                                  <div className="md-cat-body">
                                    {catItems.length === 0 ? (
                                      <p style={{ padding: '16px 20px', color: 'var(--text-faint)', fontSize: '13px' }}>
                                        No issues found in this category.
                                      </p>
                                    ) : (
                                      <div className="md-sub">
                                        <div className="md-sub-hd" />
                                        <div className="md-items">
                                          {catItems.map(item => renderDynamicItem(modData.id, prUrl, item))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })
                        : (def.categories as ModuleCategoryDefinition[]).map((cat) => {
                            const stats = getCatStats(cat, states)
                            const isOpenCat = openCats.has(cat.slug)
                            return (
                              <div key={cat.slug} className={`md-cat${isOpenCat ? ' md-cat-open' : ''}`}>
                                <button className="md-cat-hd" onClick={() => toggleCat(modData.id, cat.slug)}>
                                  <div className="md-cat-hd-left">
                                    <span className="md-cat-hd-name">{cat.label}</span>
                                    <span className="md-cat-hd-count">{stats.done}/{stats.total}</span>
                                  </div>
                                  <div className="md-cat-hd-right">
                                    <div className="md-cat-mini-bar">
                                      <div className="md-cat-mini-self" style={{ width: `${stats.totalWeight ? Math.round((stats.doneWeight / stats.totalWeight) * 100) : 0}%` }} />
                                      <div className="md-cat-mini-ai" style={{ width: `${stats.totalWeight ? Math.round((stats.aiWeight / stats.totalWeight) * 100) : 0}%` }} />
                                    </div>
                                    <span className="md-cat-pct">{stats.pct}%</span>
                                    <svg className={`md-chev${isOpenCat ? ' md-chev-open' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none">
                                      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                    </svg>
                                  </div>
                                </button>
                                {isOpenCat && (
                                  <div className="md-cat-body">
                                    {cat.subCategories.map((sub, si) => {
                                      const subDone = sub.items.filter(i => states[i.slug]?.aiVerified || states[i.slug]?.userChecked).length
                                      return (
                                        <div key={sub.slug} className={`md-sub${si > 0 ? ' md-sub-border' : ''}`}>
                                          <div className="md-sub-hd">
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                                              <span className="md-sub-name">{sub.label}</span>
                                              {sub.requires && sub.requires.filter((p) => !connectedIntegrations[p]).map((p) => (
                                                <span
                                                  key={p}
                                                  title="Connect this integration in Settings → Integrations for full data"
                                                  style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '3px',
                                                    fontSize: '10px',
                                                    fontWeight: 600,
                                                    padding: '2px 7px',
                                                    borderRadius: '4px',
                                                    background: 'rgba(231,200,115,0.1)',
                                                    border: '1px solid rgba(231,200,115,0.35)',
                                                    color: 'var(--gold)',
                                                    letterSpacing: '0.02em',
                                                    cursor: 'default',
                                                  }}
                                                >
                                                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                                                    <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2"/>
                                                    <path d="M8 11V7a4 4 0 1 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                                  </svg>
                                                  {p === 'gsc_api' ? 'Needs GSC API' : p === 'serpapi' ? 'Needs SerpAPI' : `Needs ${p}`}
                                                </span>
                                              ))}
                                            </span>
                                            <span className="md-sub-count">{subDone}/{sub.items.length}</span>
                                          </div>
                                          <div className="md-items">
                                            {[...sub.items]
                                              .sort((a, b) => {
                                                const aDone = (states[a.slug]?.aiVerified || states[a.slug]?.userChecked) ? 1 : 0
                                                const bDone = (states[b.slug]?.aiVerified || states[b.slug]?.userChecked) ? 1 : 0
                                                if (aDone !== bDone) return aDone - bDone
                                                return b.weight - a.weight
                                              })
                                              .map(item => renderStaticItem(modData.id, prUrl, item, states[item.slug]))}
                                          </div>
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            )
                          })
                      }
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <p className="foot-note">
          Click any item to see full analysis and action · AI verified = confirmed by Claude · Self-reported = marked by you
        </p>
      </div>
    </>
  )
}
