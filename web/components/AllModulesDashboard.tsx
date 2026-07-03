'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { type ModuleDefinition, type ModuleCategoryDefinition, type ModuleItemDefinition, type DBItemFull } from '@/lib/modules/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import ThemeToggle from '@/components/ThemeToggle'
import ComingSoon from '@/components/ComingSoon'
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
  brand: { id: string; name: string; keywords?: string }
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

function computeLiveScore(modData: ModuleData, states: Record<string, DBItemState>, dynItems: DBItemFull[]): number {
  if (modData.definition.dynamic) {
    const totalWeight = dynItems.reduce((s, i) => s + i.weight, 0)
    const doneWeight = dynItems.filter(i => i.aiVerified || i.userChecked).reduce((s, i) => s + i.weight, 0)
    return totalWeight ? Math.round((doneWeight / totalWeight) * 100) : 0
  }
  return getOverall(modData.definition, states).pct
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

function ringColor(score: number): string {
  if (score >= 85) return '#4ade80'
  if (score >= 65) return '#fbbf24'
  if (score >= 35) return '#fb923c'
  return '#f43f5e'
}

function LevelRing({ score }: { score: number }) {
  const r = 16
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - Math.max(score, 0) / 100)
  const color = ringColor(score)
  return (
    <svg width="100%" height="100%" viewBox="0 0 46 46" style={{ display: 'block' }}>
      <circle cx="23" cy="23" r={r} fill="none" strokeWidth="4" style={{ stroke: 'var(--line)' }} />
      <circle
        cx="23" cy="23" r={r} fill="none"
        stroke={color} strokeWidth="4" strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={score === 0 ? circ : offset}
        style={{ transform: 'rotate(-90deg)', transformOrigin: '23px 23px', transition: 'stroke-dashoffset .5s ease', filter: `drop-shadow(0 0 3px ${color}90)` }}
      />
      <text
        x="23" y="23" textAnchor="middle" dominantBaseline="central"
        fill={color}
        style={{ fontSize: '11.5px', fontWeight: 800, fontFamily: 'Outfit, sans-serif', letterSpacing: '-0.5px' }}
      >
        {score}
      </text>
    </svg>
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
  const [lastAnalyzedAtMap, setLastAnalyzedAtMap] = useState<Record<string, string | null>>({})
  const [pageVerdictsMap, setPageVerdictsMap] = useState<Record<string, ModuleData['pageVerdicts']>>(() =>
    Object.fromEntries(allModulesData.map(m => [m.id, m.pageVerdicts]))
  )
  const [reqValuesMap, setReqValuesMap] = useState<Record<string, Record<string, string>>>(() => {
    const map = Object.fromEntries(allModulesData.map(m => [m.id, m.requirements]))
    return map
  })

  // Pre-fill Brand Audit social_handles from Social Media module requirements
  useEffect(() => {
    const socialMedia = allModulesData.find(m => m.type === 'social-media')
    const brandAudit = allModulesData.find(m => m.type === 'brand-audit')
    if (!socialMedia || !brandAudit) return
    const socialReqs = reqValuesMap[socialMedia.id] ?? socialMedia.requirements
    const socialUrlKeys = ['instagram_url', 'twitter_url', 'linkedin_url', 'youtube_url', 'facebook_url', 'tiktok_url']
    const handles = socialUrlKeys.map(k => socialReqs[k]).filter(Boolean).join(', ')
    if (handles) {
      setReqValuesMap(prev => ({
        ...prev,
        [brandAudit.id]: { ...prev[brandAudit.id], social_handles: handles },
      }))
    }
  }, [allModulesData]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-fill Community Finder keywords from brand whenever brand changes
  useEffect(() => {
    if (brand.keywords?.trim()) {
      const communityFinder = allModulesData.find(m => m.type === 'community-finder')
      if (communityFinder) {
        setReqValuesMap(prev => ({
          ...prev,
          [communityFinder.id]: {
            ...prev[communityFinder.id],
            brand_keywords: brand.keywords ?? '',
          }
        }))
      }
    }
  }, [brand.keywords, allModulesData])
  const [setupErrorMap, setSetupErrorMap] = useState<Record<string, string | null>>({})
  const [generatingDraft, setGeneratingDraft] = useState<Set<string>>(new Set())
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null)
  const [prUrlMap, setPrUrlMap] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(allModulesData.map(m => [m.id, m.agentPrUrl]))
  )
  const [userCount, setUserCount] = useState(0)
  const [editingCount, setEditingCount] = useState(false)
  const [posthogLoading, setPosthogLoading] = useState(false)
  const [stageModalOpen, setStageModalOpen] = useState(false)
  const [stageModalTab, setStageModalTab] = useState(0)
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

  // Live scores derived from client state — updates instantly on self-check without needing re-analyse
  const liveScores = Object.fromEntries(
    allModulesData.map(m => [m.id, computeLiveScore(m, statesMap[m.id] ?? {}, dynItemsMap[m.id] ?? [])])
  )

  const isModuleLocked = (modData: ModuleData): boolean => {
    if (process.env.NEXT_PUBLIC_APP_ENV !== 'production') return false
    if (modData.order <= 2) return false  // Foundation, Website Audit, SEO always unlocked
    const prev = [...sortedByOrder].reverse().find(p => p.order < modData.order)
    return !prev || liveScores[prev.id] < 80
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
      const data = await res.json() as {
        ok: boolean
        score: number
        lastAnalyzedAt: string
        items: Array<{
          id: string; slug: string; label: string; weight: number; categoryId: string
          aiDetail: string | null; aiHighlight: string | null; aiNarrative: string | null; aiAction: string | null
          aiDraft: string | null; aiData: unknown | null
          aiVerified: boolean; userChecked: boolean; completedBy: string | null
          fixable: boolean; fixInputKey: string | null; fixIntegrationProvider: string | null
        }>
        categories: Array<{ id: string; slug: string }>
        pageVerdicts?: ModuleData['pageVerdicts']
      }

      setLastAnalyzedAtMap(prev => ({ ...prev, [modId]: data.lastAnalyzedAt }))

      const modDef = allModulesData.find(m => m.id === modId)?.definition
      const catIdToSlug = new Map(data.categories.map(c => [c.id, c.slug]))

      if (modDef?.dynamic) {
        const fullItems: DBItemFull[] = data.items.map(item => ({
          id: item.id,
          slug: item.slug,
          label: item.label,
          weight: item.weight,
          categorySlug: catIdToSlug.get(item.categoryId) ?? '',
          aiDetail: item.aiDetail,
          aiHighlight: item.aiHighlight ?? null,
          aiNarrative: item.aiNarrative,
          aiAction: item.aiAction,
          aiDraft: item.aiDraft ?? null,
          aiData: item.aiData ?? null,
          aiVerified: item.aiVerified ?? false,
          userChecked: item.userChecked ?? false,
          completedBy: item.completedBy,
          fixable: item.fixable ?? false,
          fixType: null,
          fixInputKey: item.fixInputKey ?? null,
          fixIntegrationProvider: item.fixIntegrationProvider ?? null,
        }))
        setDynItemsMap(prev => ({ ...prev, [modId]: fullItems }))
      } else {
        const itemStates: Record<string, DBItemState> = {}
        for (const item of data.items) {
          itemStates[item.slug] = {
            id: item.id,
            aiDetail: item.aiDetail,
            aiHighlight: item.aiHighlight ?? null,
            aiNarrative: item.aiNarrative,
            aiAction: item.aiAction,
            aiVerified: item.aiVerified ?? false,
            userChecked: item.userChecked ?? false,
            completedBy: item.completedBy,
            fixable: item.fixable ?? false,
            fixInputKey: item.fixInputKey ?? null,
            fixIntegrationProvider: item.fixIntegrationProvider ?? null,
          }
        }
        setStatesMap(prev => ({ ...prev, [modId]: itemStates }))
      }

      if (data.pageVerdicts) {
        setPageVerdictsMap(prev => ({ ...prev, [modId]: data.pageVerdicts! }))
      }

      setReanalyzingMap(prev => ({ ...prev, [modId]: false }))
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
          const incomplete = sub.items.filter(item => { const s = states[item.slug]; return !s?.aiVerified && !s?.userChecked })
          if (incomplete.length === 0) return
          catLines.push(`### ${sub.label}`); catLines.push('')
          incomplete.forEach(item => {
            const s = states[item.slug]; itemNum++
            catLines.push(`#### ${itemNum}. ${item.label}`); catLines.push('')
            if (s?.aiDetail) { catLines.push(`**What:** ${s.aiDetail}`); catLines.push('') }
            if (s?.aiNarrative) { catLines.push(`**Why this matters:**`); catLines.push(s.aiNarrative); catLines.push('') }
            if (s?.aiAction) { catLines.push(`**Your action:**`); catLines.push(s.aiAction); catLines.push('') }
            if (item.fixGuide?.length) {
              catLines.push(`**How to implement:**`)
              item.fixGuide.forEach((step, i) => catLines.push(`${i + 1}. ${step}`))
              catLines.push('')
            }
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
      const incomplete = sub.items.filter(item => { const s = states[item.slug]; return !s?.aiVerified && !s?.userChecked })
      if (incomplete.length === 0) return
      lines.push(`## ${sub.label}`); lines.push('')
      incomplete.forEach(item => {
        const s = states[item.slug]
        itemNum++
        lines.push(`### ${itemNum}. ${item.label}`); lines.push('')
        if (s?.aiDetail) { lines.push(`**What:** ${s.aiDetail}`); lines.push('') }
        if (s?.aiNarrative) { lines.push(`**Why this matters:**`); lines.push(s.aiNarrative); lines.push('') }
        if (s?.aiAction) { lines.push(`**Your action:**`); lines.push(s.aiAction); lines.push('') }
        if (item.fixGuide?.length) {
          lines.push(`**How to implement:**`)
          item.fixGuide.forEach((step, i) => lines.push(`${i + 1}. ${step}`))
          lines.push('')
        }
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
  // Convert **word** markers to <strong> in any text
  const parseBold = (text: string) =>
    text.split(/\*\*([^*]+)\*\*/).map((part, i) =>
      i % 2 === 1 ? <strong key={i} className="sm-bold">{part}</strong> : part,
    )

  const renderDynamicItem = (modId: string, prUrl: string | null, item: DBItemFull) => {
    const aiV = item.aiVerified
    const userC = item.userChecked
    const done = aiV || userC
    const needsAttention = !aiV && !userC
    const itemKey = `${modId}:${item.slug}`
    const isExpanded = expandedItems.has(itemKey)
    const hasDetail = !!(item.aiHighlight || item.aiNarrative || item.aiAction)

    return (
      <div
        key={item.slug}
        className={`md-item sm-item${!done && item.weight === 3 ? ' md-item-critical' : ''}${done ? ' md-item-done' : ''}${needsAttention ? ' md-item-flagged' : ''}${isExpanded ? ' sm-item-expanded' : ''}`}
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
              {!done && item.weight === 3 && (
                <span className="md-priority-icon md-priority-critical">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                    <line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
                    <line x1="12" y1="17" x2="12.01" y2="17" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                  </svg>
                  <span className="md-priority-label">Critical</span>
                </span>
              )}
              {!done && item.weight === 2 && (
                <span className="md-priority-icon md-priority-important">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.2"/>
                    <line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
                    <line x1="12" y1="16" x2="12.01" y2="16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                  </svg>
                  <span className="md-priority-label">Important</span>
                </span>
              )}
              {aiV && <Badge className="md-tag md-tag-ai">AI ✓</Badge>}
              {!aiV && userC && <Badge className="md-tag md-tag-self">Self</Badge>}
              {hasDetail && <span className="sm-expand-icon">{isExpanded ? '−' : '+'}</span>}
            </div>
          </div>
          {item.aiDetail && <p className="md-item-detail">{parseBold(item.aiDetail)}</p>}
          {isExpanded && hasDetail && (
            <div className="sm-expanded-body" onClick={(e) => e.stopPropagation()}>
              {item.aiHighlight && <p className="sm-highlight">{item.aiHighlight}</p>}
              {item.aiNarrative && <p className="sm-narrative">{parseBold(item.aiNarrative)}</p>}
              {item.aiAction && (
                <div className="sm-action-box">
                  <span className="sm-action-label">Action</span>
                  <p className="sm-action-text">{parseBold(item.aiAction)}</p>
                  {/https?:\/\/(www\.)?(reddit\.com\/r\/|facebook\.com\/groups\/|linkedin\.com\/groups\/)/i.test(item.aiAction ?? '') && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        const linkMatch = item.aiAction?.match(/https?:\/\/[^\s\n]+/)
                        if (linkMatch) {
                          window.open(linkMatch[0], '_blank')
                        }
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        marginTop: '12px',
                        padding: '8px 14px',
                        borderRadius: '8px',
                        border: '1px solid var(--green)',
                        color: 'var(--green-bright)',
                        fontSize: '12px',
                        fontWeight: 600,
                        background: 'rgba(79, 172, 121, 0.1)',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(79, 172, 121, 0.2)';
                        (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--green-bright)';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(79, 172, 121, 0.1)';
                        (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--green)';
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h6M21 5H9M21 5v12M21 5l-12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      Visit Community
                    </button>
                  )}
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
    const hasDetail = !!(s?.aiHighlight || s?.aiNarrative || s?.aiAction || item.fixGuide?.length)
    const isVerifying = verifyingItems.has(itemKey)

    return (
      <div
        key={item.slug}
        className={`md-item sm-item${!done && item.weight === 3 ? ' md-item-critical' : ''}${done ? ' md-item-done' : ''}${needsAttention ? ' md-item-flagged' : ''}${isExpanded ? ' sm-item-expanded' : ''}`}
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
              {!done && item.weight === 3 && (
                <span className="md-priority-icon md-priority-critical">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                    <line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
                    <line x1="12" y1="17" x2="12.01" y2="17" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                  </svg>
                  <span className="md-priority-label">Critical</span>
                </span>
              )}
              {!done && item.weight === 2 && (
                <span className="md-priority-icon md-priority-important">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.2"/>
                    <line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
                    <line x1="12" y1="16" x2="12.01" y2="16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                  </svg>
                  <span className="md-priority-label">Important</span>
                </span>
              )}
              {aiV && <span className="md-tag md-tag-ai">AI ✓</span>}
              {!aiV && userC && <span className="md-tag md-tag-self">Self</span>}
              {hasDetail && <span className="sm-expand-icon">{isExpanded ? '−' : '+'}</span>}
            </div>
          </div>
          {s?.aiDetail && <p className="md-item-detail">{parseBold(s.aiDetail)}</p>}
          {isExpanded && hasDetail && (
            <div className="sm-expanded-body" onClick={(e) => e.stopPropagation()}>
              {s?.aiHighlight && <p className="sm-highlight">{s.aiHighlight}</p>}
              {s?.aiNarrative && <p className="sm-narrative">{parseBold(s.aiNarrative)}</p>}
              {s?.aiAction && (
                <div className="sm-action-box">
                  <span className="sm-action-label">Action</span>
                  <p className="sm-action-text">{parseBold(s.aiAction)}</p>
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
              {item.fixGuide?.length && !done && (
                <div className="sm-fix-guide">
                  <div className="sm-fix-guide-hd">How to implement this</div>
                  <ol className="sm-fix-guide-steps">
                    {item.fixGuide.map((step, i) => (
                      <li key={i} className="sm-fix-guide-step">
                        <span className="sm-fix-guide-num">{i + 1}</span>
                        <span style={{ whiteSpace: 'pre-wrap' }}>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
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
          <h1>{brand.name}&apos;s road to 500 users</h1>
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
                posthogLoading ? <span className="count-loading"><span /><span /><span /></span> : userCount.toLocaleString()
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
          </div>
          <div className="meta">
            <div className="lvl">Level {currentLevel}</div>
            <div className="desc">{activeModule?.definition.description}</div>
            <div className="journey-bar">
              <div style={{ position: 'relative', height: '46px' }}>
                <button
                  onClick={() => { setStageModalTab(0); setStageModalOpen(true) }}
                  title="View your stage analysis"
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: `${barPct}%`,
                    transform: 'translateX(-50%)',
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    background: '#ffffff',
                    border: '1.5px solid #dddddd',
                    display: 'grid',
                    placeItems: 'center',
                    cursor: 'pointer',
                    padding: 0,
                    boxShadow: '0 2px 12px rgba(0,0,0,0.28)',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/bulb (1).png" alt="" style={{ width: '24px', height: '24px', objectFit: 'contain' }} />
                </button>
              </div>
              <div className="journey-track">
                <div className="journey-fill" style={{ width: `${barPct}%` }} />
              </div>
              <div className="journey-labels">
                <span>0</span><span>10</span><span>50</span><span>100</span><span>500</span>
              </div>
            </div>
          </div>
        </div>

        {/* Business Stage Modal */}
        {stageModalOpen && (() => {
          const bsMod = allModulesData.find(m => m.type === 'business-stage')
          const bsItems = bsMod ? (dynItemsMap[bsMod.id] ?? []) : []
          const classItem = bsItems.find(i => i.categorySlug === 'classification')
            ?? bsItems.find(i => i.categorySlug === 'business-classification')
          const bsReanalyzing = bsMod ? (reanalyzingMap[bsMod.id] ?? false) : false

          // Old slug fallbacks for data analyzed before the schema change
          const TABS = [
            { label: 'Concern',  icon: '⚠️', slug: 'concern',  fallback: 'stage-challenges'       },
            { label: 'Insights', icon: '💡', slug: 'insight',  fallback: 'business-classification' },
            { label: 'Actions',  icon: '🚀', slug: 'actions',  fallback: 'growth-actions'          },
            { label: 'Red Flag', icon: '🚩', slug: 'red-flag', fallback: 'red-flags'               },
          ]
          const activeTab = TABS[stageModalTab]
          const activeItem = bsItems.find(i => i.categorySlug === activeTab.slug)
            ?? bsItems.find(i => i.categorySlug === activeTab.fallback)
          const isRedFlag = activeTab.slug === 'red-flag'

          return (
            <div
              style={{ position: 'fixed', inset: 0, background: '#000000bb', backdropFilter: 'blur(4px)', zIndex: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}
              onClick={(e) => { if (e.target === e.currentTarget) setStageModalOpen(false) }}
            >
              <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: '22px', width: '100%', maxWidth: '680px', maxHeight: '86vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 80px #00000080' }}>

                {/* Top row: stage badge + re-analyse + close */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 22px 0', flexShrink: 0 }}>
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: '2px' }}>
                      Current Stage
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--green-bright)', fontFamily: 'var(--font-display)', lineHeight: 1 }}>
                      {userCount.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-dim)' }}>users</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {bsMod && (
                      <button
                        onClick={() => handleReanalyze(bsMod.id, reqValuesMap[bsMod.id] ?? {})}
                        disabled={bsReanalyzing}
                        style={{
                          fontSize: '12px', fontWeight: 600, padding: '5px 14px', borderRadius: '20px', cursor: bsReanalyzing ? 'default' : 'pointer',
                          border: '1px solid var(--green)', color: 'var(--green-bright)', background: 'transparent',
                          fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '5px', opacity: bsReanalyzing ? 0.6 : 1,
                        }}
                      >
                        {bsReanalyzing ? <><span className="md-spin" style={{ width: '10px', height: '10px', borderWidth: '1.5px' }} />Analysing…</> : 'Re-analyse'}
                      </button>
                    )}
                    <button
                      onClick={() => setStageModalOpen(false)}
                      style={{ width: '32px', height: '32px', borderRadius: '10px', border: '1px solid var(--line)', background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer', display: 'grid', placeItems: 'center', fontSize: '16px', flexShrink: 0, fontFamily: 'inherit' }}
                    >&#x2715;</button>
                  </div>
                </div>

                {/* Phase title + goal line */}
                <div style={{ padding: '12px 24px 0', flexShrink: 0,display:"none" }}>
                  <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 600, letterSpacing: '-0.5px', color: 'var(--text)', marginBottom: '6px' }}>
                    {activeItem?.label ?? 'Your Stage Playbook'}
                  </h2>
                  {classItem?.aiDetail && (
                    <p style={{ fontSize: '13.5px', color: 'var(--text-dim)', lineHeight: 1.55 }}>
                      {classItem.aiDetail}
                    </p>
                  )}
                </div>

                {/* Underline tabs */}
                <div style={{ display: 'flex', gap: '0', padding: '16px 24px 0', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
                  {TABS.map((tab, i) => (
                    <button
                      key={tab.slug}
                      onClick={() => setStageModalTab(i)}
                      style={{
                        fontSize: '13px', fontWeight: stageModalTab === i ? 600 : 500,
                        padding: '0 16px 12px',
                        color: stageModalTab === i ? 'var(--text)' : 'var(--text-faint)',
                        background: 'transparent', border: 'none',
                        borderBottom: stageModalTab === i ? '2px solid var(--green-bright)' : '2px solid transparent',
                        cursor: 'pointer', fontFamily: 'inherit',
                        display: 'flex', alignItems: 'center', gap: '6px',
                        marginBottom: '-1px',
                        transition: 'color .15s',
                      }}
                    >
                      <span>{tab.icon}</span>
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Body */}
                <div style={{ overflowY: 'auto', padding: '22px 26px 28px', flex: 1 }}>
                  {bsItems.length === 0 ? (
                    <p style={{ fontSize: '14px', color: 'var(--text-dim)', lineHeight: 1.75 }}>
                      Click <b style={{ color: 'var(--green-bright)' }}>Re-analyse</b> above to generate your personalised stage playbook.
                    </p>
                  ) : activeItem ? (
                    <p style={{ fontSize: '14.5px', color: isRedFlag ? '#ff8080' : 'var(--text-dim)', lineHeight: 1.8 }}>
                      {activeItem.aiNarrative ?? activeItem.aiDetail}
                    </p>
                  ) : (
                    <p style={{ fontSize: '14px', color: 'var(--text-faint)', lineHeight: 1.75 }}>
                      Click <b style={{ color: 'var(--green-bright)' }}>Re-analyse</b> to generate content for this section.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )
        })()}

        {/* Module accordion stack */}
        <div className="levels">
          {sortedByOrder.filter(m => m.type !== 'user-acquisition').map((modData) => {
            const isOpen = openModules.has(modData.id)
            const isLocked = isModuleLocked(modData)
            const liveScore = liveScores[modData.id] ?? 0
            const isDone = !isLocked && liveScore >= 80
            const isYouAreHere = !isLocked && !isDone && modData.id === activeModule?.id
            const stateClass = isLocked ? 'locked' : 'active'
            const reanalyzing = reanalyzingMap[modData.id] ?? false
            const reqValues = reqValuesMap[modData.id] ?? {}
            const setupError = setupErrorMap[modData.id] ?? null
            const prUrl = prUrlMap[modData.id] ?? null
            const def = modData.definition
            const effectiveLastAnalyzedAt = lastAnalyzedAtMap[modData.id] !== undefined ? lastAnalyzedAtMap[modData.id] : modData.lastAnalyzedAt
            const states = statesMap[modData.id] ?? {}
            const dynItems = dynItemsMap[modData.id] ?? []
            const openCats = openCatsMap[modData.id] ?? new Set<string>()
            const missingReqs = def.requirements.filter(r => r.required !== false && !reqValues[r.key]?.trim())
            // For dynamic modules with no findings yet, always show setup form
            const hasNoFindings = def.dynamic && dynItems.length === 0
            const needsSetup = missingReqs.length > 0 || (hasNoFindings && def.requirements.length > 0)

            return (
              <div key={modData.id} className={`level ${stateClass}${isDone ? ' done' : ''}${isOpen ? ' open' : ''}`}>

                {/* Level head */}
                <div className="level-head" onClick={() => !isLocked && toggleModule(modData.id)}>
                  <div
                    className="level-badge"
                    style={!isLocked ? {
                      borderColor: ringColor(liveScore) + '60',
                      background: ringColor(liveScore) + '0d',
                      boxShadow: `0 0 0 1px ${ringColor(liveScore)}25, 0 0 14px ${ringColor(liveScore)}18`,
                    } : undefined}
                  >
                    {isLocked ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
                        <path d="M8 11V7a4 4 0 1 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <LevelRing score={liveScore} />
                    )}
                  </div>

                  <div className="level-info">
                    <div className="name">
                      {modData.name}
                      {isLocked && <span className="pill soon">Locked</span>}
                      {!isLocked && def.comingSoon && <span className="pill soon">Coming Soon</span>}
                    </div>
                    {isLocked
                      ? (() => {
                          const prev = [...sortedByOrder].reverse().find(p => p.order < modData.order)
                          return prev
                            ? <div className="focus">Complete <b>{prev.name}</b> at 80%+ to unlock — currently {liveScores[prev.id] ?? 0}%</div>
                            : <div className="focus">Complete the previous module at 80%+ to unlock</div>
                        })()
                      : !isOpen && <div className="focus">{def.description}</div>
                    }
                  </div>

                  {!isLocked && (
                    <div className="level-prog">
                      <div className="mini-track">
                        <div className="mini-fill" style={{ width: `${liveScore}%` }} />
                      </div>
                      {liveScore}%
                    </div>
                  )}

                  {!isLocked && !def.comingSoon && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={e => e.stopPropagation()}>
                      {!!effectiveLastAnalyzedAt && modData.type !== 'community-finder' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); downloadModuleMd(modData, states, dynItems) }}
                          className="level-export-btn"
                          title="Export incomplete items as a report"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          <span className="level-export-label">Export</span>
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleReanalyze(modData.id, reqValues) }}
                        disabled={reanalyzing}
                        className="level-reanalyze-btn"
                        title={effectiveLastAnalyzedAt ? 'Re-analyse' : 'Analyse'}
                      >
                        {reanalyzing ? (
                          <><span className="md-spin" style={{ width: '10px', height: '10px', borderWidth: '1.5px' }} /><span className="level-reanalyze-label">{effectiveLastAnalyzedAt ? 'Re-analysing…' : 'Analysing…'}</span></>
                        ) : (
                          <>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                              <path d="M4 4v6h6M20 20v-6h-6M4.06 15a9 9 0 1 0 .94-6.93" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <span className="level-reanalyze-label">{effectiveLastAnalyzedAt ? 'Re-analyse' : 'Analyse'}</span>
                          </>
                        )}
                      </button>
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


                    {/* Requirements setup */}
                    {!def.comingSoon && needsSetup && (
                      <div className="md-setup-card" style={{ margin: '20px 28px 0' }}>
                        <div className="md-setup-title">Set up {def.name}</div>
                        <p className="md-setup-desc">Provide the information below before running the analysis.</p>
                        <div className="md-setup-fields">
                          {def.requirements.map((req) => {
                            // Hide social_handles for Brand Audit if Social Media module already has URLs
                            if (req.key === 'social_handles' && modData.type === 'brand-audit') {
                              const socialMedia = allModulesData.find(m => m.type === 'social-media')
                              const socialReqs = socialMedia ? (reqValuesMap[socialMedia.id] ?? socialMedia.requirements) : {}
                              const hasSocialUrls = ['instagram_url', 'twitter_url', 'linkedin_url', 'youtube_url', 'facebook_url', 'tiktok_url'].some(k => socialReqs[k])
                              if (hasSocialUrls) return null
                            }
                            return (
                            <div key={req.key} className="md-setup-field">
                              <label className="md-setup-label">
                                {req.label}
                                {req.required !== false && <span className="md-setup-required"> *</span>}
                              </label>
                              {req.type === 'url_list' || req.type === 'text_list' ? (
                                <>
                                  <textarea
                                    className="md-setup-input md-setup-textarea"
                                    placeholder={req.placeholder}
                                    value={reqValues[req.key] ?? ''}
                                    onChange={(e) => setReqValuesMap(prev => ({ ...prev, [modData.id]: { ...prev[modData.id], [req.key]: e.target.value } }))}
                                    onClick={(e) => e.stopPropagation()}
                                    rows={3}
                                  />
                                  {req.key === 'brand_keywords' && (
                                    <div className="md-setup-hint">Separate multiple keywords with commas (e.g., AI, automation, marketing)</div>
                                  )}
                                </>
                              ) : (
                                <>
                                  <Input
                                    type={req.type === 'url' ? 'url' : 'text'}
                                    placeholder={req.placeholder}
                                    value={reqValues[req.key] ?? ''}
                                    onChange={(e) => setReqValuesMap(prev => ({ ...prev, [modData.id]: { ...prev[modData.id], [req.key]: e.target.value } }))}
                                    onClick={(e) => e.stopPropagation()}
                                    className="md-setup-input"
                                  />
                                  {req.key === 'brand_keywords' && (
                                    <div className="md-setup-hint">Separate multiple keywords with commas (e.g., AI, automation, marketing)</div>
                                  )}
                                </>
                              )}
                            </div>
                          )})}
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
                    {modData.type === 'business-stage' && (
                      <div style={{ padding: '20px 28px 24px' }}>
                        {!connectedIntegrations['posthog'] && (
                          <div style={{ marginBottom: '16px', padding: '12px 15px', background: 'rgba(231,200,115,0.08)', border: '1px solid rgba(231,200,115,0.3)', borderRadius: '10px', fontSize: '13px', color: 'var(--gold)', lineHeight: 1.6 }}>
                            Connect PostHog in <b style={{ color: 'var(--gold)' }}>Settings → Integrations</b> to track your live user count automatically.
                          </div>
                        )}
                        {dynItems.length > 0 ? (
                          <p style={{ fontSize: '14px', color: 'var(--text-dim)', lineHeight: 1.7 }}>
                            Your stage playbook is ready. Click the <b style={{ color: 'var(--text)' }}>bulb indicator</b> on the progress bar above to view your concern, insight, actions and red flag.
                          </p>
                        ) : (
                          <p style={{ fontSize: '14px', color: 'var(--text-dim)', lineHeight: 1.7 }}>
                            Click <b style={{ color: 'var(--text)' }}>Analyse</b> above to generate your personalised stage playbook based on your website signals.
                          </p>
                        )}
                      </div>
                    )}
                    <div className="md-cats" style={modData.type === 'business-stage' ? { display: 'none' } : needsSetup ? { opacity: 0.4, pointerEvents: 'none' } : {}}>
                      {def.comingSoon ? (
                        <ComingSoon
                          variant="module"
                          title={def.name}
                          note={def.comingSoonNote ?? 'This module is in active development and will be available in an upcoming update.'}
                        />
                      ) : def.dynamic
                        ? [...def.categories].sort((a, b) => {
                            const aCs = !!(a as import('@/lib/modules/types').DynamicModuleCategoryDefinition).comingSoon ? 1 : 0
                            const bCs = !!(b as import('@/lib/modules/types').DynamicModuleCategoryDefinition).comingSoon ? 1 : 0
                            return aCs - bCs
                          }).map((cat) => {
                            const stats = getDynamicCatStats(cat.slug, dynItems)
                            const isOpenCat = openCats.has(cat.slug)
                            const catItems = [...dynItems.filter(i => i.categorySlug === cat.slug)].sort((a, b) => {
                              const aDone = (a.aiVerified || a.userChecked) ? 1 : 0
                              const bDone = (b.aiVerified || b.userChecked) ? 1 : 0
                              if (aDone !== bDone) return aDone - bDone
                              return b.weight - a.weight
                            })
                            {
                              const isCatComingSoon = !!(cat as import('@/lib/modules/types').DynamicModuleCategoryDefinition).comingSoon
                              return (
                              <div key={cat.slug} className={`md-cat${isOpenCat ? ' md-cat-open' : ''}${isCatComingSoon ? ' md-cat-coming-soon' : ''}`}>
                                <div className="md-cat-hd" role="button" tabIndex={0} onClick={() => !isCatComingSoon && toggleCat(modData.id, cat.slug)} style={isCatComingSoon ? { cursor: 'default' } : {}}>
                                  <div className="md-cat-hd-left">
                                    <span className="md-cat-hd-name">{cat.label}</span>
                                    {isCatComingSoon
                                      ? <span className="cs-badge" style={{ marginLeft: 4 }}>Coming Soon</span>
                                      : <span className="md-cat-hd-count">{stats.done}/{stats.total}</span>
                                    }
                                  </div>
                                  {!isCatComingSoon && (
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
                                  )}
                                </div>
                                {isOpenCat && (
                                  <div className="md-cat-body">
                                    {(cat as import('@/lib/modules/types').DynamicModuleCategoryDefinition).comingSoon ? (
                                      <ComingSoon
                                        title={cat.label}
                                        note={(cat as import('@/lib/modules/types').DynamicModuleCategoryDefinition).comingSoonNote}
                                      />
                                    ) : catItems.length === 0 ? (
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
                            }
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

                    {/* Frekto Posting — Social Media module only */}
                    {modData.type === 'social-media' && (
                      <FrektoPostingSection
                        moduleId={modData.id}
                        brandName={brand.name}
                        connected={!!connectedIntegrations['frekto']}
                      />
                    )}
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

// ── Frekto Posting Section ────────────────────────────────────────────────────

const FREKTO_PLATFORMS = [
  { key: 'instagram', label: 'Instagram', format: '4:5' },
  { key: 'tiktok',    label: 'TikTok',    format: '9:16' },
  { key: 'linkedin',  label: 'LinkedIn',  format: '1:1' },
  { key: 'twitter',   label: 'X / Twitter', format: '1:1' },
  { key: 'facebook',  label: 'Facebook',  format: '1:1' },
  { key: 'youtube',   label: 'YouTube',   format: '1:1' },
]

const FREKTO_STYLES = [
  { value: '',                       label: 'Auto (AI picks)' },
  { value: 'revelation::cinematic',  label: 'Revelation · Cinematic' },
  { value: 'revelation::statement',  label: 'Revelation · Statement' },
  { value: 'revelation::split',      label: 'Revelation · Split' },
  { value: 'stat::cinematic',        label: 'Stat · Cinematic' },
  { value: 'stat::bold',             label: 'Stat · Bold' },
  { value: 'stat::editorial',        label: 'Stat · Editorial' },
  { value: 'stat::minimal',          label: 'Stat · Minimal' },
  { value: 'stat::split',            label: 'Stat · Split' },
  { value: 'quote::bold',            label: 'Quote · Bold' },
  { value: 'quote::minimal',         label: 'Quote · Minimal' },
  { value: 'quote::attributed',      label: 'Quote · Attributed' },
  { value: 'quote::contrast',        label: 'Quote · Contrast' },
  { value: 'quote::ticker',          label: 'Quote · Ticker' },
  { value: 'contrast::versus',       label: 'Contrast · Versus' },
  { value: 'contrast::split_screen', label: 'Contrast · Split Screen' },
  { value: 'contrast::myth_reality', label: 'Contrast · Myth vs Reality' },
  { value: 'contrast::before_after', label: 'Contrast · Before / After' },
  { value: 'contrast::old_new',      label: 'Contrast · Old vs New' },
  { value: 'question::rhetorical',   label: 'Question · Rhetorical' },
  { value: 'question::poll',         label: 'Question · Poll' },
  { value: 'question::challenge',    label: 'Question · Challenge' },
  { value: 'question::bold',         label: 'Question · Bold' },
  { value: 'question::minimal',      label: 'Question · Minimal' },
  { value: 'myth::bold',             label: 'Myth · Bold' },
  { value: 'myth::stack',            label: 'Myth · Stack' },
  { value: 'myth::minimal',          label: 'Myth · Minimal' },
  { value: 'myth::cinematic',        label: 'Myth · Cinematic' },
  { value: 'myth::split',            label: 'Myth · Split' },
  { value: 'checklist::minimal',     label: 'Checklist · Minimal' },
  { value: 'checklist::bold',        label: 'Checklist · Bold' },
  { value: 'checklist::do_dont',     label: "Checklist · Do / Don't" },
  { value: 'checklist::audit',       label: 'Checklist · Audit' },
  { value: 'checklist::score',       label: 'Checklist · Score' },
  { value: 'trend::rising',          label: 'Trend · Rising' },
  { value: 'trend::declining',       label: 'Trend · Declining' },
  { value: 'trend::watch',           label: 'Trend · Watch' },
  { value: 'trend::editorial',       label: 'Trend · Editorial' },
  { value: 'trend::data',            label: 'Trend · Data' },
  { value: 'prediction::bold_call',  label: 'Prediction · Bold Call' },
  { value: 'prediction::cinematic',  label: 'Prediction · Cinematic' },
  { value: 'prediction::editorial',  label: 'Prediction · Editorial' },
  { value: 'prediction::minimal',    label: 'Prediction · Minimal' },
  { value: 'prediction::three_up',   label: 'Prediction · Three Up' },
  { value: 'framework::ticker',      label: 'Framework · Ticker' },
  { value: 'journey::chapter',       label: 'Journey · Chapter' },
  { value: 'media::overlay',         label: 'Media · Overlay' },
  { value: 'media::framed',          label: 'Media · Framed' },
  { value: 'media::split',           label: 'Media · Split' },
  { value: 'media::caption_bar',     label: 'Media · Caption Bar' },
  { value: 'media::montage',         label: 'Media · Montage' },
  { value: 'media::video_brand_bar', label: 'Media · Video Brand Bar' },
  { value: 'media::video_gradient',  label: 'Media · Video Gradient' },
  { value: 'media::video_cinematic', label: 'Media · Video Cinematic' },
  { value: 'media::video_minimal',   label: 'Media · Video Minimal' },
]

function FrektoPostingSection({ moduleId, brandName, connected }: { moduleId: string; brandName: string; connected: boolean }) {
  const [platform, setPlatform]           = useState('instagram')
  const [format, setFormat]               = useState('4:5')
  const [outputFormat, setOutputFormat]   = useState<'png' | 'mp4'>('png')
  const [style, setStyle]                 = useState('')
  const [topic, setTopic]                 = useState('')
  const [generating, setGenerating]       = useState(false)
  const [resultUrl, setResultUrl]         = useState<string | null>(null)
  const [jobId, setJobId]                 = useState<string | null>(null)
  const [error, setError]                 = useState<string | null>(null)

  const selectPlatform = (p: { key: string; format: string }) => {
    setPlatform(p.key)
    setFormat(p.format)
    setResultUrl(null)
    setError(null)
  }

  const handleGenerate = async () => {
    if (!topic.trim() || generating) return
    setGenerating(true)
    setError(null)
    setResultUrl(null)
    setJobId(null)
    try {
      const res = await fetch('/api/frekto/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleId, topic: topic.trim(), format, outputFormat, style: style || undefined }),
      })
      const data = await res.json() as { outputUrl?: string; jobId?: string; error?: string }
      if (data.outputUrl) {
        setResultUrl(data.outputUrl)
        setJobId(data.jobId ?? null)
      } else {
        setError(data.error ?? 'Generation failed. Please try again.')
      }
    } catch {
      setError('Network error — please try again.')
    } finally {
      setGenerating(false)
    }
  }

  const pill = (active: boolean): React.CSSProperties => ({
    padding: '5px 13px', borderRadius: '6px', fontSize: '12px', fontWeight: 500,
    cursor: 'pointer', border: '1px solid',
    borderColor: active ? 'var(--green)' : 'var(--line)',
    background: active ? 'rgba(47,191,113,0.12)' : 'transparent',
    color: active ? 'var(--green-bright)' : 'var(--text-dim)',
  })

  return (
    <div style={{ padding: '20px 28px', borderTop: '1px solid var(--line)' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
          Frekto Posting
        </span>
        {connected ? (
          <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(47,191,113,0.12)', border: '1px solid rgba(47,191,113,0.3)', color: 'var(--green)' }}>
            Connected
          </span>
        ) : (
          <a href="/settings" style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--line)', color: 'var(--gold)', textDecoration: 'none' }}>
            Connect Frekto in Settings
          </a>
        )}
      </div>

      {!connected && (
        <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: 0 }}>
          Add your Frekto API key in Settings → Integrations to generate platform-ready social media images and videos.
        </p>
      )}

      {connected && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* Platform */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {FREKTO_PLATFORMS.map((p) => (
              <button key={p.key} onClick={() => selectPlatform(p)} style={pill(platform === p.key)}>{p.label}</button>
            ))}
          </div>

          {/* Format + Output + Style */}
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-faint)', marginBottom: '6px', fontWeight: 500 }}>Aspect ratio</div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {['4:5', '9:16', '1:1'].map((f) => (
                  <button key={f} onClick={() => setFormat(f)} style={pill(format === f)}>{f}</button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-faint)', marginBottom: '6px', fontWeight: 500 }}>Output</div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {(['png', 'mp4'] as const).map((f) => (
                  <button key={f} onClick={() => setOutputFormat(f)} style={pill(outputFormat === f)}>{f.toUpperCase()}</button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-faint)', marginBottom: '6px', fontWeight: 500 }}>Style</div>
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--input)', color: 'var(--text)', fontSize: '12px', outline: 'none', cursor: 'pointer' }}
              >
                {FREKTO_STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          {/* Topic */}
          <div>
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value.slice(0, 300))}
              placeholder={`Describe the post for ${FREKTO_PLATFORMS.find(p => p.key === platform)?.label ?? platform}… e.g. "Announce our new product with bold visuals and a clear CTA"`}
              rows={3}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '7px', border: '1px solid var(--line)', background: 'var(--input)', color: 'var(--text)', fontSize: '12.5px', lineHeight: '1.55', resize: 'vertical', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
            <div style={{ textAlign: 'right', fontSize: '11px', color: topic.length >= 280 ? 'var(--gold)' : 'var(--text-faint)', marginTop: '3px' }}>
              {topic.length}/300
            </div>
          </div>

          {error && <p style={{ fontSize: '12px', color: '#ef4444', margin: 0 }}>{error}</p>}

          <button
            disabled={generating || !topic.trim()}
            onClick={handleGenerate}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '9px 20px', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: generating || !topic.trim() ? 'not-allowed' : 'pointer', border: 'none', background: generating || !topic.trim() ? 'rgba(47,191,113,0.2)' : 'var(--green)', color: generating || !topic.trim() ? 'var(--text-dim)' : '#06140c', alignSelf: 'flex-start' }}
          >
            {generating ? (
              <><span className="md-spin" style={{ borderTopColor: 'var(--green)', borderColor: 'rgba(47,191,113,0.2)' }} />Generating… (15–90s)</>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Generate
              </>
            )}
          </button>

          {/* Result */}
          {resultUrl && (
            <div style={{ padding: '14px', borderRadius: '8px', border: '1px solid rgba(47,191,113,0.25)', background: 'rgba(47,191,113,0.04)' }}>
              <div style={{ fontSize: '11px', color: 'var(--green)', fontWeight: 600, marginBottom: '10px', letterSpacing: '0.02em' }}>
                GENERATED {jobId && <span style={{ color: 'var(--text-faint)', fontWeight: 400, marginLeft: '8px', fontFamily: 'monospace' }}>{jobId}</span>}
              </div>
              {outputFormat === 'mp4'
                ? <video src={resultUrl} controls style={{ maxWidth: '100%', maxHeight: '400px', borderRadius: '6px', display: 'block', marginBottom: '10px' }} />
                : <img src={resultUrl} alt="Generated content" style={{ maxWidth: '100%', maxHeight: '400px', objectFit: 'contain', borderRadius: '6px', display: 'block', marginBottom: '10px' }} />
              }
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <a href={resultUrl} download target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '6px 14px', borderRadius: '6px', border: '1px solid var(--green)', color: 'var(--green-bright)', fontSize: '12px', fontWeight: 500, textDecoration: 'none' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Download
                </a>
                <input readOnly value={resultUrl} onClick={(e) => (e.target as HTMLInputElement).select()} style={{ flex: 1, minWidth: '140px', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--input)', color: 'var(--text-dim)', fontSize: '11px', fontFamily: 'monospace', outline: 'none' }} />
                <button onClick={() => { setResultUrl(null); setJobId(null); setError(null) }} style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--line)', color: 'var(--text-dim)', fontSize: '12px', cursor: 'pointer', background: 'transparent' }}>
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
