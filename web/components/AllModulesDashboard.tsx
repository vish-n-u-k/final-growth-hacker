'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { type ModuleDefinition, type ModuleCategoryDefinition, type ModuleItemDefinition, type DBItemFull } from '@/lib/modules/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import ThemeToggle from '@/components/ThemeToggle'
import { type DBItemState } from './ModuleDashboard'
import { INTEGRATION_MAP, type IntegrationDefinition } from '@/lib/integrations/registry'

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

function InlineIntegrationForm({ intDef, onConnected }: { intDef: IntegrationDefinition; onConnected: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setSaving(true)
    setError('')
    const res = await fetch('/api/settings/integrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: intDef.provider, fields: values }),
    })
    if (res.ok) {
      onConnected()
    } else {
      const d = await res.json() as { error?: string }
      setError(d.error ?? 'Failed to save')
    }
    setSaving(false)
  }

  return (
    <form className="sm-inline-form" onSubmit={handleSave} onClick={(e) => e.stopPropagation()}>
      {intDef.fields.map((field) => (
        <div key={field.key} className="sm-inline-field">
          <div className="sm-inline-label-row">
            <span className="sm-inline-label" style={{ marginBottom: 0 }}>{field.label}</span>
            {field.optional && <span className="sm-inline-optional">optional</span>}
          </div>
          <input
            className="sm-inline-input"
            type={field.inputType}
            placeholder={field.placeholder}
            value={values[field.key] ?? ''}
            onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
            required={!field.optional}
            autoComplete="off"
          />
          {field.helpText && <p className="sm-inline-hint">{field.helpText}</p>}
        </div>
      ))}
      {error && <p className="sm-inline-error">{error}</p>}
      <button type="submit" disabled={saving} className="sm-inline-btn">
        {saving ? 'Connecting…' : `Connect ${intDef.name}`}
      </button>
    </form>
  )
}

export default function AllModulesDashboard({ brand, allModulesData, userEmail, githubConnected, connectedIntegrations }: Props) {
  const [statesMap, setStatesMap] = useState<Record<string, Record<string, DBItemState>>>(() =>
    Object.fromEntries(allModulesData.map(m => [m.id, m.itemStates]))
  )
  const [dynItemsMap, setDynItemsMap] = useState<Record<string, DBItemFull[]>>(() =>
    Object.fromEntries(allModulesData.map(m => [m.id, m.fullItems]))
  )
  const [openModules, setOpenModules] = useState<Set<string>>(() => {
    // Open the first module that isn't locked (previous scored < 80%)
    const sorted = [...allModulesData].sort((a, b) => a.order - b.order)
    const first = sorted.find(m => {
      if (m.order === 0) return true
      const prev = [...sorted].reverse().find(p => p.order < m.order)
      return prev && prev.score >= 80
    })
    return first ? new Set([first.id]) : new Set([sorted[0]?.id ?? ''])
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
  const [posthogLoading, setPosthogLoading] = useState(false)
  const autoAnalysisTriggered = useRef(false)

  useEffect(() => {
    if (!connectedIntegrations['posthog']) return
    setPosthogLoading(true)
    fetch('/api/posthog/user-count')
      .then((r) => r.json())
      .then((d: { count?: number }) => { if (d.count != null) setUserCount(d.count) })
      .catch(() => {})
      .finally(() => setPosthogLoading(false))
  }, [])

  const router = useRouter()

  // Compute lock state dynamically: a module is locked if its previous module (by order) scored < 80%.
  // Foundation (order 0) is always unlocked. This works for all users regardless of DB status.
  const sortedByOrder = [...allModulesData].sort((a, b) => a.order - b.order)
  const isModuleLocked = (modData: ModuleData): boolean => {
    if (modData.order <= 2) return false  // Foundation, Website Audit, SEO always unlocked
    const prev = [...sortedByOrder].reverse().find(p => p.order < modData.order)
    return !prev || prev.score < 80
  }

  const activeModule = sortedByOrder.find(m => !isModuleLocked(m))
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

  // Auto-trigger Foundation analysis when user arrives from onboarding (never analyzed yet)
  useEffect(() => {
    if (autoAnalysisTriggered.current) return
    const foundation = allModulesData.find(m => m.order === 0)
    if (foundation && !foundation.lastAnalyzedAt) {
      autoAnalysisTriggered.current = true
      handleReanalyze(foundation.id, foundation.requirements)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const downloadModuleMd = (modData: ModuleData, states: Record<string, DBItemState>, dynItems: DBItemFull[]) => {
    const lines: string[] = []
    lines.push(`# ${modData.name} — Action Items`)
    lines.push(`> ${brand.name}`)
    lines.push(`> Generated: ${new Date().toLocaleDateString()}`)
    lines.push('')
    if (modData.definition.dynamic) {
      const incomplete = dynItems.filter(i => !i.aiVerified && !i.userChecked)
      if (incomplete.length === 0) return
      const byCat = new Map<string, DBItemFull[]>()
      incomplete.forEach(i => { const a = byCat.get(i.categorySlug) ?? []; a.push(i); byCat.set(i.categorySlug, a) })
      byCat.forEach((items, catSlug) => {
        const catDef = modData.definition.categories.find(c => c.slug === catSlug)
        lines.push(`## ${catDef?.label ?? catSlug}`); lines.push('')
        items.forEach((item, idx) => {
          lines.push(`### ${idx + 1}. ${item.label}`); lines.push('')
          if (item.aiDetail) { lines.push(`**What:** ${item.aiDetail}`); lines.push('') }
          if (item.aiNarrative) { lines.push(`**Why this matters:**`); lines.push(item.aiNarrative); lines.push('') }
          if (item.aiAction) { lines.push(`**Your action:**`); lines.push(item.aiAction); lines.push('') }
          lines.push('---'); lines.push('')
        })
      })
    } else {
      const cats = modData.definition.categories as ModuleCategoryDefinition[]
      let itemNum = 0
      cats.forEach(cat => {
        const catLines: string[] = []
        cat.subCategories.forEach(sub => {
          const incomplete = sub.items.filter(item => { const s = states[item.slug]; return s && !s.aiVerified && !s.userChecked && (s.aiDetail || s.aiNarrative || s.aiAction) })
          if (incomplete.length === 0) return
          catLines.push(`### ${sub.label}`); catLines.push('')
          incomplete.forEach(item => {
            const s = states[item.slug]!; itemNum++
            catLines.push(`#### ${itemNum}. ${item.label}`); catLines.push('')
            if (s.aiDetail) { catLines.push(`**What:** ${s.aiDetail}`); catLines.push('') }
            if (s.aiNarrative) { catLines.push(`**Why this matters:**`); catLines.push(s.aiNarrative); catLines.push('') }
            if (s.aiAction) { catLines.push(`**Your action:**`); catLines.push(s.aiAction); catLines.push('') }
            catLines.push('---'); catLines.push('')
          })
        })
        if (catLines.length > 0) { lines.push(`## ${cat.label}`); lines.push(''); lines.push(...catLines) }
      })
      if (itemNum === 0) return
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `${modData.type}-todo.md`; a.click()
    URL.revokeObjectURL(url)
  }

  const downloadDynamicCategoryMd = (modName: string, cat: { slug: string; label: string }, items: DBItemFull[]) => {
    const incomplete = items.filter(item => !item.aiVerified && !item.userChecked)
    if (incomplete.length === 0) return
    const lines: string[] = []
    lines.push(`# ${cat.label} — Action Items`)
    lines.push(`> ${modName} — ${brand.name}`)
    lines.push(`> Generated: ${new Date().toLocaleDateString()}`)
    lines.push('')
    incomplete.forEach((item, i) => {
      lines.push(`## ${i + 1}. ${item.label}`)
      lines.push('')
      if (item.aiDetail) { lines.push(`**What:** ${item.aiDetail}`); lines.push('') }
      if (item.aiNarrative) { lines.push(`**Why this matters:**`); lines.push(item.aiNarrative); lines.push('') }
      if (item.aiAction) { lines.push(`**Your action:**`); lines.push(item.aiAction); lines.push('') }
      lines.push('---'); lines.push('')
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${cat.slug}-todo.md`; a.click()
    URL.revokeObjectURL(url)
  }

  const downloadStaticCategoryMd = (modName: string, cat: ModuleCategoryDefinition, states: Record<string, DBItemState>) => {
    const lines: string[] = []
    lines.push(`# ${cat.label} — Action Items`)
    lines.push(`> ${modName} — ${brand.name}`)
    lines.push(`> Generated: ${new Date().toLocaleDateString()}`)
    lines.push('')
    let itemNum = 0
    cat.subCategories.forEach(sub => {
      const incomplete = sub.items.filter(item => {
        const s = states[item.slug]
        return s && !s.aiVerified && !s.userChecked && (s.aiDetail || s.aiNarrative || s.aiAction)
      })
      if (incomplete.length === 0) return
      lines.push(`## ${sub.label}`); lines.push('')
      incomplete.forEach(item => {
        const s = states[item.slug]!
        itemNum++
        lines.push(`### ${itemNum}. ${item.label}`); lines.push('')
        if (s.aiDetail) { lines.push(`**What:** ${s.aiDetail}`); lines.push('') }
        if (s.aiNarrative) { lines.push(`**Why this matters:**`); lines.push(s.aiNarrative); lines.push('') }
        if (s.aiAction) { lines.push(`**Your action:**`); lines.push(s.aiAction); lines.push('') }
        lines.push('---'); lines.push('')
      })
    })
    if (itemNum === 0) return
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${cat.slug}-todo.md`; a.click()
    URL.revokeObjectURL(url)
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
              {!aiV && (
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
              {(() => {
                const provider = item.assistedInput?.integrationProvider
                if (!provider || connectedIntegrations[provider]) return null
                const intDef = INTEGRATION_MAP[provider]
                if (!intDef?.setupSteps?.length) return null
                return (
                  <div className="sm-setup-guide">
                    <div className="sm-setup-guide-hd">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                      </svg>
                      How to set up {intDef.name}
                    </div>
                    <ol className="sm-setup-steps">
                      {intDef.setupSteps.map((step, i) => (
                        <li key={i} className="sm-setup-step">
                          <span className="sm-setup-step-num">{i + 1}</span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                    <InlineIntegrationForm intDef={intDef} onConnected={() => router.refresh()} />
                  </div>
                )
              })()}
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
              className="mob-hide text-[var(--text-faint)] hover:text-[var(--text-dim)] w-54 border border-[var(--line)] hover:border-[var(--green)] text-sm"
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
          <div>
            <div
              className="big-num"
              onClick={connectedIntegrations['posthog'] ? undefined : () => !editingCount && setEditingCount(true)}
              title={connectedIntegrations['posthog'] ? 'Live user count from PostHog' : 'Click to update your user count'}
              style={connectedIntegrations['posthog'] ? { cursor: 'default' } : undefined}
            >
              {connectedIntegrations['posthog'] ? (
                posthogLoading ? '…' : userCount.toLocaleString()
              ) : editingCount ? (
                <input
                  autoFocus
                  type="number"
                  min={0}
                  max={9999}
                  defaultValue={userCount}
                  onBlur={(e) => {
                    const val = Math.max(0, parseInt(e.target.value, 10) || 0)
                    setUserCount(val)
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
            {!connectedIntegrations['posthog'] && (
              <a
                href="/settings"
                style={{ display: 'block', fontSize: '11px', color: 'var(--green)', marginTop: '6px', textDecoration: 'none', fontFamily: 'var(--font-body)', fontWeight: 400 }}
              >
                Connect PostHog to track automatically →
              </a>
            )}
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
          {sortedByOrder.map((modData) => {
            const isOpen = openModules.has(modData.id)
            const isLocked = isModuleLocked(modData)
            const isDone = !isLocked && modData.score >= 80
            const isYouAreHere = !isLocked && !isDone && modData.id === activeModule?.id
            const stateClass = isLocked ? 'locked' : 'active'
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
              <div key={modData.id} className={`level ${stateClass}${isOpen ? ' open' : ''} `}>

                {/* Level head */}
                <div className="level-head" onClick={() => !isLocked && toggleModule(modData.id)}>
                  <div className="level-badge">
                    {isLocked ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
                        <path d="M8 11V7a4 4 0 1 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    ) : (
                      modData.order
                    )}
                  </div>

                  <div className="level-info">
                    <div className="name">
                      {modData.name}
                      {isLocked && <span className="pill soon">Locked</span>}
                    </div>
                    {isLocked
                      ? (() => {
                          const prev = [...sortedByOrder].reverse().find(p => p.order < modData.order)
                          return prev
                            ? <div className="focus">Complete <b>{prev.name}</b> at 80%+ to unlock — currently {prev.score}%</div>
                            : <div className="focus">Complete the previous module at 80%+ to unlock</div>
                        })()
                      : !isOpen && <div className="focus">{def.description}</div>
                    }
                  </div>

                  {!isLocked && (
                    <div className="level-prog">
                      <div className="mini-track">
                        <div className="mini-fill" style={{ width: `${modData.score}%` }} />
                      </div>
                      {modData.score}%
                    </div>
                  )}

                  {!isLocked && !!modData.lastAnalyzedAt && (
                    <button
                      onClick={(e) => { e.stopPropagation(); downloadModuleMd(modData, states, dynItems) }}
                      className="level-export-btn"
                      title="Export incomplete items as a report"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <span className="level-export-label">Export Report</span>
                    </button>
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
                    <div style={{ padding: '18px 28px', borderTop: '1px solid var(--line)', display: 'flex', gap: '12px', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
                      <Button
                        variant="outline"
                        onClick={() => handleReanalyze(modData.id, reqValues)}
                        disabled={reanalyzing}
                        className="gap-2 border-[var(--green)] w-30 px-4 h-9 text-[var(--green-bright)] hover:bg-[var(--accent)] hover:text-[var(--green-bright)] bg-[var(--card)] text-sm font-semibold"
                      >
                        {reanalyzing ? (
                          <><span className="md-spin p-3" />{modData.lastAnalyzedAt ? 'Re-analysing…' : 'Analysing…'}</>
                        ) : (
                          <>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                              <path d="M4 4v6h6M20 20v-6h-6M4.06 15a9 9 0 1 0 .94-6.93" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            {modData.lastAnalyzedAt ? 'Re-analyse' : 'Analyse'}
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
                                <div className="md-cat-hd" role="button" tabIndex={0} onClick={() => toggleCat(modData.id, cat.slug)}>
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
                                </div>
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
                                <div className="md-cat-hd" role="button" tabIndex={0} onClick={() => toggleCat(modData.id, cat.slug)}>
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
                                </div>
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
