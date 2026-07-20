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
import { PLAYBOOK_SECTIONS } from '@/lib/playbook/fields'
import GmailOutreachProspects from '@/components/GmailOutreachProspects'

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
  brand: { id: string; name: string; keywords?: string; websiteUrl?: string; logoUrl?: string; themeColor?: string; playbook?: Record<string, string> | null }
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
    const active = dynItems.filter(i => !i.userSkipped)
    const totalWeight = active.reduce((s, i) => s + i.weight, 0)
    const doneWeight = active.filter(i => i.aiVerified || i.userChecked).reduce((s, i) => s + i.weight, 0)
    return totalWeight ? Math.round((doneWeight / totalWeight) * 100) : 0
  }
  return getOverall(modData.definition, states).pct
}

function getDynamicCatStats(categorySlug: string, items: DBItemFull[]) {
  const catItems = items.filter((i) => i.categorySlug === categorySlug && !i.userSkipped)
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
      <circle
        cx="23" cy="23" r={r} fill="none"
        stroke={color} strokeWidth="4" strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={score === 0 ? circ : offset}
        style={{ transform: 'rotate(-90deg)', transformOrigin: '23px 23px', transition: 'stroke-dashoffset .5s ease', filter: `drop-shadow(0 0 4px ${color}90)` }}
      />
      <text
        x="23" y="23" textAnchor="middle" dominantBaseline="central"
        fill={color}
        style={{ fontSize: '11px', fontWeight: 800, fontFamily: 'Outfit, sans-serif', letterSpacing: '-0.5px' }}
      >
        {score}%
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

  // Apply brand theme color to root CSS variable
  useEffect(() => {
    const color = brand.themeColor?.trim()
    if (color) {
      document.documentElement.style.setProperty('--brand', color)
    }
    return () => { document.documentElement.style.removeProperty('--brand') }
  }, [brand.themeColor])

  const [setupErrorMap, setSetupErrorMap] = useState<Record<string, string | null>>({})
  const [generatingDraft, setGeneratingDraft] = useState<Set<string>>(new Set())
  const [skipPrompting, setSkipPrompting] = useState<Set<string>>(new Set())
  const [skipReasonDraft, setSkipReasonDraft] = useState<Record<string, string>>({})

  // Playbook state (Foundation module only)
  const [playbookData, setPlaybookData] = useState<Record<string, string> | null>(brand.playbook ?? null)
  const [playbookOpen, setPlaybookOpen] = useState(false)
  const [playbookEditing, setPlaybookEditing] = useState(false)
  const [playbookDraft, setPlaybookDraft] = useState<Record<string, string>>({})
  const [playbookSaving, setPlaybookSaving] = useState(false)
  const [playbookSaved, setPlaybookSaved] = useState(false)

  const handlePlaybookSave = async () => {
    setPlaybookSaving(true)
    const res = await fetch('/api/settings/playbook', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...playbookDraft, generatedAt: playbookData?.generatedAt ?? new Date().toISOString() }),
    })
    if (res.ok) {
      setPlaybookData({ ...playbookDraft, generatedAt: playbookData?.generatedAt ?? new Date().toISOString() })
      setPlaybookEditing(false)
      setPlaybookSaved(true)
      setTimeout(() => setPlaybookSaved(false), 2500)
    }
    setPlaybookSaving(false)
  }

  const [copiedSlug, setCopiedSlug] = useState<string | null>(null)
  const [prUrlMap, setPrUrlMap] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(allModulesData.map(m => [m.id, m.agentPrUrl]))
  )
  const [userCount, setUserCount] = useState(0)
  const [editingCount, setEditingCount] = useState(false)
  const [posthogLoading, setPosthogLoading] = useState(false)
  const [posthogDataStartDate, setPosthogDataStartDate] = useState<string | null>(null)
  const [stageModalOpen, setStageModalOpen] = useState(false)
  const [stageModalTab, setStageModalTab] = useState(0)
  const [competitorPanelOpen, setCompetitorPanelOpen] = useState(false)
  const [resolvedBsModId, setResolvedBsModId] = useState<string | null>(
    () => allModulesData.find((m) => m.type === 'business-stage')?.id ?? null,
  )
  const [ensuringBs, setEnsuringBs] = useState(false)
  const autoAnalysisTriggered = useRef(false)

  useEffect(() => {
    if (!connectedIntegrations['posthog']) return
    setPosthogLoading(true)
    fetch('/api/posthog/user-count')
      .then((r) => r.json())
      .then((d: { count?: number; dataStartDate?: string | null }) => {
        if (d.count != null) setUserCount(d.count)
        if (d.dataStartDate) setPosthogDataStartDate(d.dataStartDate)
      })
      .catch(() => {})
      .finally(() => setPosthogLoading(false))
  }, [])

  const router = useRouter()

  // Compute lock state dynamically: a module is locked if its previous module (by order) scored < 80%.
  // Foundation (order 0) is always unlocked. This works for all users regardless of DB status.
  const sortedByOrder = [...allModulesData].sort((a, b) => {
    const aCs = a.definition?.comingSoon ? 1 : 0
    const bCs = b.definition?.comingSoon ? 1 : 0
    if (aCs !== bCs) return aCs - bCs
    return a.order - b.order
  })

  // Live scores derived from client state — updates instantly on self-check without needing re-analyse
  const liveScores = Object.fromEntries(
    allModulesData.map(m => [m.id, computeLiveScore(m, statesMap[m.id] ?? {}, dynItemsMap[m.id] ?? [])])
  )

  const isModuleLocked = (modData: ModuleData): boolean => {
    if (process.env.NEXT_PUBLIC_APP_ENV !== 'production') return false
    if (modData.order <= 3) return false  // Foundation, Website Audit, SEO always unlocked
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
    try {
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
        dynamic: boolean
        score: number
        lastAnalyzedAt: string
        items: Array<{
          id: string; slug: string; label: string; weight: number; categoryId: string
          aiDetail: string | null; aiHighlight: string | null; aiNarrative: string | null; aiAction: string | null
          aiDraft: string | null; aiData: unknown | null
          aiVerified: boolean; userChecked: boolean; completedBy: string | null
          fixable: boolean; fixInputKey: string | null; fixIntegrationProvider: string | null
          userSkipped: boolean; userSkipReason: string | null
        }>
        categories: Array<{ id: string; slug: string }>
        pageVerdicts?: ModuleData['pageVerdicts']
      }

      setLastAnalyzedAtMap(prev => ({ ...prev, [modId]: data.lastAnalyzedAt }))

      const isDynamic = data.dynamic ?? allModulesData.find(m => m.id === modId)?.definition.dynamic
      const catIdToSlug = new Map(data.categories.map(c => [c.id, c.slug]))

      if (isDynamic) {
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
          userSkipped: item.userSkipped ?? false,
          userSkipReason: item.userSkipReason ?? null,
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
            userSkipped: item.userSkipped ?? false,
            userSkipReason: item.userSkipReason ?? null,
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
    } catch {
      setReanalyzingMap(prev => ({ ...prev, [modId]: false }))
      setSetupErrorMap(prev => ({ ...prev, [modId]: 'Network error. Please try again.' }))
    }
  }

  // Ensures the business-stage module exists (creates it if missing), then runs analysis.
  const handleEnsureAndReanalyze = async () => {
    setEnsuringBs(true)
    try {
      const res = await fetch('/api/modules/ensure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'business-stage' }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setSetupErrorMap(prev => ({ ...prev, ['bs-ensure']: (d as { error?: string }).error ?? 'Setup failed.' }))
        return
      }
      const { moduleId } = await res.json() as { moduleId: string }
      setResolvedBsModId(moduleId)
      await handleReanalyze(moduleId, {})
    } catch {
      setSetupErrorMap(prev => ({ ...prev, ['bs-ensure']: 'Network error. Please try again.' }))
    } finally {
      setEnsuringBs(false)
    }
  }

  // Auto-trigger Foundation analysis when user arrives from onboarding (never analyzed yet)
  useEffect(() => {
    if (autoAnalysisTriggered.current) return
    const foundation = allModulesData.find(m => m.type === 'foundation')
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

  const handleSkip = useCallback(async (modId: string, isDynamic: boolean, itemId: string, slug: string, skipped: boolean, reason: string) => {
    const itemKey = `${modId}:${slug}`
    setSkipPrompting((prev) => { const n = new Set(prev); n.delete(itemKey); return n })
    if (isDynamic) {
      setDynItemsMap((prev) => ({
        ...prev,
        [modId]: (prev[modId] ?? []).map((i) =>
          i.id === itemId ? { ...i, userSkipped: skipped, userSkipReason: skipped ? reason || null : null } : i,
        ),
      }))
    } else {
      setStatesMap((prev) => ({
        ...prev,
        [modId]: {
          ...(prev[modId] ?? {}),
          [slug]: { ...(prev[modId]?.[slug] ?? { id: itemId, aiDetail: null, aiHighlight: null, aiNarrative: null, aiAction: null, aiVerified: false, userChecked: false, completedBy: null, fixable: false, fixInputKey: null, fixIntegrationProvider: null, userSkipped: false, userSkipReason: null }), userSkipped: skipped, userSkipReason: skipped ? reason || null : null },
        },
      }))
    }
    await fetch('/api/items/skip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId, skipped, reason: skipped ? reason || null : null }),
    })
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
    const score = computeLiveScore(modData, states, dynItems)
    lines.push(`# ${modData.name} — Action Items`)
    lines.push(`> ${brand.name}${brand.websiteUrl ? ` — ${brand.websiteUrl}` : ''}`)
    lines.push(`> Score: ${score}%`)
    lines.push(`> Generated: ${new Date().toLocaleDateString()}`)
    lines.push('')
    if (modData.definition.dynamic) {
      const incomplete = dynItems.filter(i => !i.aiVerified && !i.userChecked && !!(i.aiNarrative || i.aiAction))
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
          const incomplete = sub.items.filter(item => { const s = states[item.slug]; return !s?.aiVerified && !s?.userChecked && !!(s?.aiNarrative || s?.aiAction) })
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
    const incomplete = items.filter(item => !item.aiVerified && !item.userChecked && !!(item.aiNarrative || item.aiAction))
    if (incomplete.length === 0) return
    const lines: string[] = []
    lines.push(`# ${cat.label} — Action Items`)
    lines.push(`> ${modName} — ${brand.name}${brand.websiteUrl ? ` — ${brand.websiteUrl}` : ''}`)
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
    lines.push(`> ${modName} — ${brand.name}${brand.websiteUrl ? ` — ${brand.websiteUrl}` : ''}`)
    lines.push(`> Generated: ${new Date().toLocaleDateString()}`)
    lines.push('')
    let itemNum = 0
    cat.subCategories.forEach(sub => {
      const incomplete = sub.items.filter(item => { const s = states[item.slug]; return !s?.aiVerified && !s?.userChecked && !!(s?.aiNarrative || s?.aiAction) })
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
    const skipped = item.userSkipped
    const done = aiV || userC
    const needsAttention = !aiV && !userC && !skipped
    const itemKey = `${modId}:${item.slug}`
    const isExpanded = expandedItems.has(itemKey)
    const hasDetail = !skipped && !!(item.aiHighlight || item.aiNarrative || item.aiAction)
    const isSkipPrompting = skipPrompting.has(itemKey)

    return (
      <div
        key={item.slug}
        className={`md-item sm-item${!done && !skipped && item.weight === 3 ? ' md-item-critical' : ''}${done ? ' md-item-done' : ''}${skipped ? ' md-item-skipped' : ''}${needsAttention ? ' md-item-flagged' : ''}${isExpanded ? ' sm-item-expanded' : ''}`}
        onClick={(e) => hasDetail && toggleExpand(modId, item.slug, e)}
        style={{ cursor: hasDetail ? 'pointer' : 'default' }}
      >
        <span
          className={`md-cb${aiV ? ' md-cb-ai' : userC ? ' md-cb-self' : ''}`}
          onClick={(e) => !skipped && toggleItem(modId, true, item.id, item.slug, userC, e)}
          style={{ cursor: skipped ? 'default' : 'pointer' }}
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
              {skipped ? (
                <>
                  <span className="md-tag" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-faint)', border: '1px solid rgba(255,255,255,0.1)', fontSize: '10px', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>Skipped</span>
                  <button className="md-skip-unskip" onClick={(e) => { e.stopPropagation(); handleSkip(modId, true, item.id, item.slug, false, '') }}>Unskip</button>
                </>
              ) : (
                <>
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
                </>
              )}
            </div>
          </div>
          {skipped && item.userSkipReason && (
            <p className="md-item-detail" style={{ color: 'var(--text-faint)', fontStyle: 'italic' }}>{item.userSkipReason}</p>
          )}
          {!skipped && item.aiDetail && <p className="md-item-detail" style={isExpanded ? { display: 'block', overflow: 'visible', WebkitLineClamp: 'unset' } : {}}>{parseBold(item.aiDetail)}</p>}
          {/* Fallback skip button for items with no expandable content */}
          {!skipped && !done && !hasDetail && (
            <div className="md-skip-control" onClick={(e) => e.stopPropagation()}>
              {isSkipPrompting ? (
                <div className="md-skip-form">
                  <input type="text" placeholder="Reason for skipping (optional)" className="md-skip-input"
                    value={skipReasonDraft[itemKey] ?? ''}
                    onChange={(e) => setSkipReasonDraft((prev) => ({ ...prev, [itemKey]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSkip(modId, true, item.id, item.slug, true, skipReasonDraft[itemKey] ?? '')
                      if (e.key === 'Escape') setSkipPrompting((prev) => { const n = new Set(prev); n.delete(itemKey); return n })
                    }}
                    autoFocus
                  />
                  <button className="md-skip-confirm" onClick={() => handleSkip(modId, true, item.id, item.slug, true, skipReasonDraft[itemKey] ?? '')}>Confirm skip</button>
                  <button className="md-skip-cancel" onClick={() => setSkipPrompting((prev) => { const n = new Set(prev); n.delete(itemKey); return n })}>Cancel</button>
                </div>
              ) : (
                <button className="md-skip-btn" onClick={() => setSkipPrompting((prev) => new Set(prev).add(itemKey))}>Not relevant — skip</button>
              )}
            </div>
          )}
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
              {/* Skip section — at bottom of expanded body */}
              {!done && (
                <div className="md-skip-section">
                  <span className="md-skip-section-label">Skip this check</span>
                  {isSkipPrompting ? (
                    <div className="md-skip-form">
                      <input type="text" placeholder="Reason for skipping (optional)" className="md-skip-input"
                        value={skipReasonDraft[itemKey] ?? ''}
                        onChange={(e) => setSkipReasonDraft((prev) => ({ ...prev, [itemKey]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSkip(modId, true, item.id, item.slug, true, skipReasonDraft[itemKey] ?? '')
                          if (e.key === 'Escape') setSkipPrompting((prev) => { const n = new Set(prev); n.delete(itemKey); return n })
                        }}
                        autoFocus
                      />
                      <button className="md-skip-confirm" onClick={() => handleSkip(modId, true, item.id, item.slug, true, skipReasonDraft[itemKey] ?? '')}>Confirm skip</button>
                      <button className="md-skip-cancel" onClick={() => setSkipPrompting((prev) => { const n = new Set(prev); n.delete(itemKey); return n })}>Cancel</button>
                    </div>
                  ) : (
                    <button className="md-skip-btn" onClick={() => setSkipPrompting((prev) => new Set(prev).add(itemKey))}>
                      Not relevant to my business
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
    const skipped = s?.userSkipped ?? false
    const done = aiV || userC
    const needsAttention = s && !aiV && !userC && !skipped
    const itemKey = `${modId}:${item.slug}`
    const isExpanded = expandedItems.has(itemKey)
    const hasDetail = !skipped && !!(s?.aiHighlight || s?.aiNarrative || s?.aiAction || item.fixGuide?.length)
    const isVerifying = verifyingItems.has(itemKey)
    const isSkipPrompting = skipPrompting.has(itemKey)

    return (
      <div
        key={item.slug}
        className={`md-item sm-item${!done && !skipped && item.weight === 3 ? ' md-item-critical' : ''}${done ? ' md-item-done' : ''}${skipped ? ' md-item-skipped' : ''}${needsAttention ? ' md-item-flagged' : ''}${isExpanded ? ' sm-item-expanded' : ''}`}
        onClick={(e) => hasDetail && toggleExpand(modId, item.slug, e)}
        style={{ cursor: hasDetail ? 'pointer' : 'default' }}
      >
        <span
          className={`md-cb${aiV ? ' md-cb-ai' : userC ? ' md-cb-self' : ''}`}
          onClick={(e) => !skipped && toggleItem(modId, false, s?.id ?? '', item.slug, userC, e)}
          style={{ cursor: skipped ? 'default' : 'pointer' }}
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
              {skipped ? (
                <>
                  <span className="md-tag" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-faint)', border: '1px solid rgba(255,255,255,0.1)', fontSize: '10px', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>Skipped</span>
                  <button className="md-skip-unskip" onClick={(e) => { e.stopPropagation(); handleSkip(modId, false, s?.id ?? '', item.slug, false, '') }}>Unskip</button>
                </>
              ) : (
                <>
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
                </>
              )}
            </div>
          </div>
          {skipped && s?.userSkipReason && (
            <p className="md-item-detail" style={{ color: 'var(--text-faint)', fontStyle: 'italic' }}>{s.userSkipReason}</p>
          )}
          {!skipped && s?.aiDetail && <p className="md-item-detail" style={isExpanded ? { display: 'block', overflow: 'visible', WebkitLineClamp: 'unset' } : {}}>{parseBold(s.aiDetail)}</p>}
          {/* Fallback skip for items with no expandable content */}
          {!skipped && !done && !hasDetail && (
            <div className="md-skip-control" onClick={(e) => e.stopPropagation()}>
              {isSkipPrompting ? (
                <div className="md-skip-form">
                  <input type="text" placeholder="Reason for skipping (optional)" className="md-skip-input"
                    value={skipReasonDraft[itemKey] ?? ''}
                    onChange={(e) => setSkipReasonDraft((prev) => ({ ...prev, [itemKey]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSkip(modId, false, s?.id ?? '', item.slug, true, skipReasonDraft[itemKey] ?? '')
                      if (e.key === 'Escape') setSkipPrompting((prev) => { const n = new Set(prev); n.delete(itemKey); return n })
                    }}
                    autoFocus
                  />
                  <button className="md-skip-confirm" onClick={() => handleSkip(modId, false, s?.id ?? '', item.slug, true, skipReasonDraft[itemKey] ?? '')}>Confirm skip</button>
                  <button className="md-skip-cancel" onClick={() => setSkipPrompting((prev) => { const n = new Set(prev); n.delete(itemKey); return n })}>Cancel</button>
                </div>
              ) : (
                <button className="md-skip-btn" onClick={() => setSkipPrompting((prev) => new Set(prev).add(itemKey))}>Not relevant — skip</button>
              )}
            </div>
          )}
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
              {/* Skip section — at bottom of expanded body */}
              {!done && (
                <div className="md-skip-section">
                  <span className="md-skip-section-label">Skip this check</span>
                  {isSkipPrompting ? (
                    <div className="md-skip-form">
                      <input type="text" placeholder="Reason for skipping (optional)" className="md-skip-input"
                        value={skipReasonDraft[itemKey] ?? ''}
                        onChange={(e) => setSkipReasonDraft((prev) => ({ ...prev, [itemKey]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSkip(modId, false, s?.id ?? '', item.slug, true, skipReasonDraft[itemKey] ?? '')
                          if (e.key === 'Escape') setSkipPrompting((prev) => { const n = new Set(prev); n.delete(itemKey); return n })
                        }}
                        autoFocus
                      />
                      <button className="md-skip-confirm" onClick={() => handleSkip(modId, false, s?.id ?? '', item.slug, true, skipReasonDraft[itemKey] ?? '')}>Confirm skip</button>
                      <button className="md-skip-cancel" onClick={() => setSkipPrompting((prev) => { const n = new Set(prev); n.delete(itemKey); return n })}>Cancel</button>
                    </div>
                  ) : (
                    <button className="md-skip-btn" onClick={() => setSkipPrompting((prev) => new Set(prev).add(itemKey))}>
                      Not relevant to my business
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
          <div className="hero-brand">
            {brand.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={brand.logoUrl}
                alt=""
                className="hero-favicon"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            )}
            <h1><span className="hero-brand-name">{brand.name}</span>&apos;s road to 500 users</h1>
          </div>
          <p>One module at a time. Clear each gate before you level up — don't skip ahead.</p>
        </div>

        {/* Overview */}
        <div className={`overview${!connectedIntegrations['posthog'] ? ' overview--disconnected' : ''}`}>
          {!connectedIntegrations['posthog'] ? (
            <>
              {/* Header row */}
              <div className="overview-dis-header">
                <span className="overview-dis-badge">
                  <span className="overview-dis-badge-dot" />
                  Not connected
                </span>
              </div>
              {/* Body */}
              <div className="overview-dis-body">
                {/* Left: dimmed number */}
                <div className="overview-dis-left">
                  <div className="overview-dis-num">
                    <span className="overview-dis-dash">—</span>
                    <span className="overview-dis-slash">/500</span>
                  </div>
                  <div className="overview-dis-lock-label">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    Live user count locked
                  </div>
                </div>
                {/* Right: CTA */}
                <div className="overview-dis-right">
                  <div className="overview-dis-title">Connect PostHog to start counting</div>
                  <p className="overview-dis-desc">Growth Hacker reads your active users straight from PostHog to place you on the road and match tactics to your current phase. Connect it once and your count updates on its own.</p>
                  <div className="overview-dis-bar">
                    <div className="overview-dis-track" />
                    <div className="overview-dis-labels">
                      <span>0</span><span>10</span><span>50</span><span>100</span><span>500</span>
                    </div>
                  </div>
                  <div className="overview-dis-actions">
                    <button className="overview-dis-btn-primary" onClick={() => router.push('/settings')}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
                      Connect PostHog
                    </button>
                    <button className="overview-dis-btn-secondary" onClick={() => { setStageModalTab(0); setStageModalOpen(true) }}>See what we track</button>
                  </div>
                  <p className="overview-dis-disclaimer">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                    Read-only access. Takes about a minute — you&apos;ll need your PostHog project API key.
                  </p>
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <div className="big-num" style={{ cursor: 'default' }}>
                  {posthogLoading ? <span className="count-loading"><span /><span /><span /></span> : userCount.toLocaleString()}
                  <span>/500</span>
                </div>
              </div>
              <div className="meta">
                <div className="lvl">
                  {posthogDataStartDate
                    ? `Since ${new Date(posthogDataStartDate + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`
                    : posthogLoading ? '…' : `Level ${currentLevel}`}
                </div>
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
            </>
          )}
        </div>

        {/* Business Stage Modal */}
        {stageModalOpen && (() => {
          const bsItems = resolvedBsModId ? (dynItemsMap[resolvedBsModId] ?? []) : []
          const classItem = bsItems.find(i => i.categorySlug === 'classification')
            ?? bsItems.find(i => i.categorySlug === 'business-classification')
          const bsReanalyzing = resolvedBsModId ? (reanalyzingMap[resolvedBsModId] ?? false) : false
          const bsBusy = ensuringBs || bsReanalyzing
          const bsError = resolvedBsModId ? setupErrorMap[resolvedBsModId] : setupErrorMap['bs-ensure']

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
                    {bsError && (
                      <span style={{ fontSize: '11px', color: '#ff8080', maxWidth: '200px', lineHeight: 1.3 }}>
                        {bsError}
                      </span>
                    )}
                    <button
                      onClick={() => resolvedBsModId ? handleReanalyze(resolvedBsModId, {}) : handleEnsureAndReanalyze()}
                      disabled={bsBusy}
                      style={{
                        fontSize: '12px', fontWeight: 600, padding: '5px 14px', borderRadius: '20px', cursor: bsBusy ? 'default' : 'pointer',
                        border: '1px solid var(--green)', color: 'var(--green-bright)', background: 'transparent',
                        fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '5px', opacity: bsBusy ? 0.6 : 1,
                      }}
                    >
                      {bsBusy ? <><span className="md-spin" style={{ width: '10px', height: '10px', borderWidth: '1.5px' }} />{ensuringBs ? 'Setting up…' : 'Analysing…'}</> : 'Re-analyse'}
                    </button>
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
                  {!connectedIntegrations['posthog'] && (
                    <div style={{ marginBottom: '18px', padding: '12px 15px', background: 'rgba(231,200,115,0.08)', border: '1px solid rgba(231,200,115,0.3)', borderRadius: '10px', fontSize: '13px', color: 'var(--gold)', lineHeight: 1.6 }}>
                      Connect PostHog in <b style={{ color: 'var(--gold)' }}>Settings → Integrations</b> to track your live user count automatically.
                    </div>
                  )}
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
                    style={!isLocked && modData.type !== 'gmail-outreach' ? {
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
                    ) : modData.type === 'gmail-outreach' ? (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                        <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.7"/>
                        <path d="M2 7l10 7 10-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
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
                    <div className="level-prog" style={{ display: 'none' }}>
                      <div className="mini-track">
                        <div className="mini-fill" style={{ width: `${liveScore}%` }} />
                      </div>
                      {liveScore}%
                    </div>
                  )}

                  {!isLocked && !def.comingSoon && !(modData.type === 'gmail-outreach' && !connectedIntegrations['gmail']) && (
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
                        className={`level-reanalyze-btn${reanalyzing ? ' btn-analysing' : ''}`}
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
                          className={`mt-3 gap-1.5 bg-[var(--green)] text-[#06140c] hover:bg-[var(--green-bright)] font-semibold${reanalyzing ? ' btn-analysing' : ''}`}
                        >
                          {reanalyzing ? (
                            <><span className="md-spin" style={{ borderTopColor: '#06140c', borderColor: 'rgba(6,20,12,0.2)' }} />Analysing…</>
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

                    {/* Competitor URLs panel — outreach-targets only */}
                    {modData.type === 'outreach-targets' && !needsSetup && (
                      <div style={{ margin: '16px 28px 0', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10 }}>
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => setCompetitorPanelOpen((p) => !p)}
                          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setCompetitorPanelOpen((p) => !p)}
                          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', cursor: 'pointer' }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--green)', flexShrink: 0 }}>
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2" />
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Competitor URLs</span>
                          <span style={{ fontSize: 12, color: reqValues['competitor_urls'] ? 'var(--green)' : 'var(--text-faint)', fontWeight: 400, marginLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>
                            {reqValues['competitor_urls'] ? reqValues['competitor_urls'] : 'Click to add or edit competitors'}
                          </span>
                          <svg style={{ marginLeft: 'auto', flexShrink: 0, transform: competitorPanelOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s' }} width="14" height="14" viewBox="0 0 24 24" fill="none">
                            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                        </div>
                        {competitorPanelOpen && (
                          <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--line)' }}>
                            <p style={{ margin: '12px 0 8px', fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                              Enter competitor URLs, one per line or comma-separated. Up to 5 are crawled per run.
                            </p>
                            <textarea
                              className="md-setup-input md-setup-textarea"
                              placeholder="https://competitor1.com, https://competitor2.com"
                              value={reqValues['competitor_urls'] ?? ''}
                              onChange={(e) => setReqValuesMap((prev) => ({ ...prev, [modData.id]: { ...prev[modData.id], competitor_urls: e.target.value } }))}
                              rows={3}
                              style={{ width: '100%', marginBottom: 8 }}
                            />
                            <button
                              disabled={reanalyzing || !reqValues['competitor_urls']?.trim()}
                              onClick={() => { setCompetitorPanelOpen(false); handleReanalyze(modData.id, reqValues) }}
                              className="level-reanalyze-btn"
                              style={{ fontSize: 12, padding: '6px 14px' }}
                            >
                              {reanalyzing ? (
                                <><span className="md-spin" style={{ width: 10, height: 10, borderWidth: '1.5px' }} />Running…</>
                              ) : 'Save & Re-analyse'}
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Playbook — Foundation module only */}
                    {modData.type === 'foundation' && (
                      <div style={{ margin: '16px 28px 0', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10 }}>
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => { if (!playbookEditing) setPlaybookOpen(v => !v) }}
                          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !playbookEditing && setPlaybookOpen(v => !v)}
                          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', cursor: playbookEditing ? 'default' : 'pointer', userSelect: 'none' }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--green)', flexShrink: 0 }}>
                            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Playbook</span>
                          {playbookData
                            ? <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 500, marginLeft: 2 }}>Generated</span>
                            : <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 2 }}>Run analysis to generate</span>
                          }
                          {playbookData && !playbookEditing && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setPlaybookDraft({ ...playbookData }); setPlaybookEditing(true); setPlaybookOpen(true) }}
                              style={{ marginLeft: 'auto', fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '1px solid var(--line)', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer' }}
                            >
                              Edit
                            </button>
                          )}
                          {!playbookEditing && (
                            <svg style={{ marginLeft: playbookData ? 6 : 'auto', flexShrink: 0, transform: playbookOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s' }} width="14" height="14" viewBox="0 0 24 24" fill="none">
                              <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                            </svg>
                          )}
                        </div>
                        {playbookOpen && (
                          <div style={{ borderTop: '1px solid var(--line)', padding: '16px' }}>
                            {!playbookData ? (
                              <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6, margin: 0 }}>
                                The AI will read your website and generate your full Sales Playbook — email templates, call scripts, objection handlers, and more — when you run Foundation analysis.
                              </p>
                            ) : playbookEditing ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                                {PLAYBOOK_SECTIONS.map((section) => (
                                  <div key={section.id}>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>{section.label}</div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                      {section.fields.map((field) => (
                                        <div key={field.key}>
                                          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>{field.label}</label>
                                          <textarea
                                            value={playbookDraft[field.key] ?? ''}
                                            onChange={(e) => setPlaybookDraft(prev => ({ ...prev, [field.key]: e.target.value }))}
                                            placeholder={field.placeholder}
                                            rows={field.rows}
                                            style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', fontSize: 13, color: 'var(--text)', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6, boxSizing: 'border-box', whiteSpace: 'pre-wrap' }}
                                          />
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                                <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
                                  <button onClick={handlePlaybookSave} disabled={playbookSaving} className="level-reanalyze-btn" style={{ fontSize: 12, padding: '6px 16px' }}>
                                    {playbookSaving ? 'Saving…' : playbookSaved ? 'Saved ✓' : 'Save'}
                                  </button>
                                  <button onClick={() => setPlaybookEditing(false)} style={{ fontSize: 12, padding: '6px 12px', borderRadius: 6, border: '1px solid var(--line)', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer' }}>
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                                {PLAYBOOK_SECTIONS.map((section) => (
                                  <div key={section.id}>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>{section.label}</div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                                      {section.fields.map((field) => (
                                        <div key={field.key}>
                                          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 5 }}>{field.label}</div>
                                          <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                                            {playbookData[field.key] || <span style={{ color: 'var(--text-faint)', fontStyle: 'italic' }}>Not generated</span>}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                                {playbookData.generatedAt && (
                                  <div style={{ fontSize: 11, color: 'var(--text-dim)', borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                                    Generated {new Date(playbookData.generatedAt).toLocaleDateString()}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
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
                    {/* Gmail Outreach — gate on Gmail connection */}
                    {modData.type === 'gmail-outreach' && (
                      connectedIntegrations['gmail'] ? (
                        <GmailOutreachProspects
                          items={dynItems}
                          gmailConnected={true}
                        />
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '48px 28px 52px', textAlign: 'center' }}>
                          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--accent)', border: '1px solid var(--line)', display: 'grid', placeItems: 'center', color: 'var(--green-bright)' }}>
                            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                              <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.7"/>
                              <path d="M2 7l10 7 10-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </div>
                          <div>
                            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>Connect Gmail to use this module</div>
                            <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6, maxWidth: 360 }}>
                              This module identifies potential clients from your website and lets you generate and send cold emails directly from Growth Hacker.
                            </div>
                          </div>
                          <a
                            href="/api/gmail/connect"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 22px', borderRadius: 10, background: 'var(--green)', border: 'none', fontSize: 13.5, fontWeight: 700, color: '#06140c', textDecoration: 'none', transition: '.15s' }}
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                              <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.8"/>
                              <path d="M2 7l10 7 10-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            Connect Gmail
                          </a>
                          <p style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: 0 }}>
                            Read-only + compose access · No emails sent without your confirmation
                          </p>
                        </div>
                      )
                    )}

                    <div className="md-cats" style={(modData.type === 'business-stage' || modData.type === 'gmail-outreach') ? { display: 'none' } : needsSetup ? { opacity: 0.4, pointerEvents: 'none' } : {}}>
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
                              const aKey = a.userSkipped ? 2 : (a.aiVerified || a.userChecked) ? 1 : 0
                              const bKey = b.userSkipped ? 2 : (b.aiVerified || b.userChecked) ? 1 : 0
                              if (aKey !== bKey) return aKey - bKey
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
                                                const aKey = states[a.slug]?.userSkipped ? 2 : (states[a.slug]?.aiVerified || states[a.slug]?.userChecked) ? 1 : 0
                                                const bKey = states[b.slug]?.userSkipped ? 2 : (states[b.slug]?.aiVerified || states[b.slug]?.userChecked) ? 1 : 0
                                                if (aKey !== bKey) return aKey - bKey
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

                    {/* Smart Scheduler — hidden */}
                    {false && modData.type === 'social-media' && (
                      <SmartScheduler
                        moduleId={modData.id}
                        brandId={brand.id}
                        connected={!!connectedIntegrations['frekto']}
                      />
                    )}

                    {/* Content Scheduler — Social Media module only */}
                    {modData.type === 'social-media' && (
                      <ContentScheduler
                        moduleId={modData.id}
                        brandId={brand.id}
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

// ── Content Scheduler ──────────────────────────────────────────────────────────

const SERIES_PLATFORMS = ['instagram', 'linkedin', 'twitter', 'facebook', 'youtube', 'tiktok'] as const
type SeriesPlatform = typeof SERIES_PLATFORMS[number]

const SERIES_PLATFORM_META: Record<SeriesPlatform, { label: string; color: string }> = {
  instagram: { label: 'Instagram',   color: '#E1306C' },
  linkedin:  { label: 'LinkedIn',    color: '#0A66C2' },
  twitter:   { label: 'X / Twitter', color: '#1DA1F2' },
  facebook:  { label: 'Facebook',    color: '#1877F2' },
  youtube:   { label: 'YouTube',     color: '#FF0000' },
  tiktok:    { label: 'TikTok',      color: '#69C9D0' },
}

function SeriesPlatformIcon({ platform, size = 20, color }: { platform: string; size?: number; color: string }) {
  if (platform === 'instagram') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
      <circle cx="12" cy="12" r="5"/>
      <circle cx="17.5" cy="6.5" r="1.5" fill={color} stroke="none"/>
    </svg>
  )
  if (platform === 'linkedin') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/>
      <rect x="2" y="9" width="4" height="12"/>
      <circle cx="4" cy="4" r="2"/>
    </svg>
  )
  if (platform === 'facebook') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  )
  if (platform === 'youtube') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
    </svg>
  )
  if (platform === 'tiktok') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>
    </svg>
  )
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.742l7.733-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/>
    </svg>
  )
}

const CADENCE_OPTIONS = [
  { value: 'mwf',      label: 'Mon / Wed / Fri' },
  { value: 'linkedin', label: 'Tue / Wed / Thu' },
  { value: 'weekdays', label: 'Every weekday' },
  { value: 'daily',    label: 'Every day' },
]

interface SeriesBrief {
  platform: string
  shouldPost: boolean
  instruction: string
  count: number
  cadence: string
  format: string
  outputFormat: string
  startDate: string
  reason: string | string[]
}

interface SeriesCardStatus {
  scheduling: boolean
  scheduled: boolean
  posts: { topic: string; scheduledAt: string; outputUrl: string | null }[]
  error: string | null
}

interface HistoryPost {
  id: string
  platform: string
  topic: string
  postType: string
  scheduledAt: string | null
  status: string
  outputUrl: string | null
}

const PLATFORM_ORDER = ['instagram', 'linkedin', 'twitter', 'facebook', 'youtube', 'tiktok']

function ContentScheduler({ moduleId, brandId, connected }: { moduleId: string; brandId: string; connected: boolean }) {
  const [generating, setGenerating]       = useState(false)
  const [genError, setGenError]           = useState<string | null>(null)
  const [hasGenerated, setHasGenerated]   = useState(false)
  const [briefs, setBriefs]               = useState<Record<string, SeriesBrief>>({})
  const [statuses, setStatuses]           = useState<Record<string, SeriesCardStatus>>({})
  const [history, setHistory]             = useState<HistoryPost[]>([])
  const [openPlatform, setOpenPlatform]   = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/frekto/schedule?brandId=${brandId}`)
      .then(r => r.json())
      .then((d: { allPosts?: HistoryPost[] }) => { if (d.allPosts?.length) setHistory(d.allPosts) })
      .catch(() => {})
  }, [brandId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenPlatform(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const updateBrief = (platform: string, patch: Partial<SeriesBrief>) =>
    setBriefs(prev => ({ ...prev, [platform]: { ...prev[platform], ...patch } }))

  const handleGenerate = async () => {
    setGenerating(true); setGenError(null)
    try {
      const res = await fetch('/api/frekto/series-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleId }),
      })
      const data = await res.json() as { suggestions?: SeriesBrief[]; error?: string }
      if (!res.ok || data.error) { setGenError(data.error ?? 'Failed to generate briefs.'); return }
      const newBriefs: Record<string, SeriesBrief> = {}
      const newStatuses: Record<string, SeriesCardStatus> = {}
      const fallbackDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
      for (const s of data.suggestions ?? []) {
        if (!s.platform) continue
        newBriefs[s.platform] = {
          platform: s.platform,
          shouldPost: s.shouldPost !== false,
          instruction: s.instruction ?? '',
          count: s.count ?? 3,
          cadence: s.cadence ?? 'mwf',
          format: s.format ?? '1:1',
          outputFormat: s.outputFormat ?? 'png',
          startDate: s.startDate ?? fallbackDate,
          reason: s.reason ?? '',
        }
        newStatuses[s.platform] = { scheduling: false, scheduled: false, posts: [], error: null }
      }
      setBriefs(newBriefs); setStatuses(newStatuses); setHasGenerated(true)
    } catch (e) { console.error('[ContentScheduler] handleGenerate error:', e); setGenError('Network error — please try again.') }
    finally { setGenerating(false) }
  }

  const refreshHistory = () => {
    fetch(`/api/frekto/schedule?brandId=${brandId}`)
      .then(r => r.json())
      .then((d: { allPosts?: HistoryPost[] }) => { if (d.allPosts) setHistory(d.allPosts) })
      .catch(() => {})
  }

  const handleSchedule = async (platform: string) => {
    const brief = briefs[platform]; if (!brief) return
    setStatuses(prev => ({ ...prev, [platform]: { ...prev[platform], scheduling: true, error: null } }))
    try {
      const res = await fetch('/api/frekto/series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId, ...brief }),
      })
      const data = await res.json() as { seriesId?: string; posts?: SeriesCardStatus['posts']; error?: string }
      if (!res.ok || data.error) {
        setStatuses(prev => ({ ...prev, [platform]: { ...prev[platform], scheduling: false, error: data.error ?? 'Failed.' } }))
        return
      }
      setStatuses(prev => ({ ...prev, [platform]: { scheduling: false, scheduled: true, posts: data.posts ?? [], error: null } }))
      refreshHistory()
    } catch (e) {
      console.error('[ContentScheduler] handleSchedule error:', e)
      setStatuses(prev => ({ ...prev, [platform]: { ...prev[platform], scheduling: false, error: 'Network error.' } }))
    }
  }

  // Modal data
  const mp     = openPlatform
  const mBrief = mp ? briefs[mp] : null
  const mSt    = mp ? statuses[mp] : null
  const mMeta  = mp ? SERIES_PLATFORM_META[mp as SeriesPlatform] : null
  const mHistory = mp ? history.filter(p => p.platform === mp) : []

  return (
    <div style={{ padding: '24px 28px', borderTop: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>Content Scheduler</span>
        {!connected && <a href="/settings" style={{ fontSize: '12px', padding: '3px 10px', borderRadius: '5px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--line)', color: 'var(--gold)', textDecoration: 'none' }}>Connect Frekto to unlock</a>}
      </div>
      <p style={{ fontSize: '14px', color: 'var(--text-faint)', marginBottom: '20px', lineHeight: 1.55 }}>
        Generates a full content series for Instagram, LinkedIn, and X — AI plans the posts, Frekto renders and auto-schedules them.
      </p>

      {!connected ? (
        <a href="/settings" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '9px 18px', borderRadius: '8px', border: '1px solid var(--green)', color: 'var(--green-bright)', fontSize: '14px', fontWeight: 600, textDecoration: 'none' }}>
          Go to Settings → Integrations
        </a>
      ) : (
        <>
          {/* Platform cards — compact, click + to open popup */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
            {SERIES_PLATFORMS.map(platform => {
              const brief = briefs[platform]
              const st = statuses[platform]
              const { label, color } = SERIES_PLATFORM_META[platform]
              const isJustScheduled = !!st?.scheduled
              const recentPosts = history.filter(p => p.platform === platform)
              const mostRecent = recentPosts[0]
              const hasBrief = !!brief && brief.shouldPost !== false
              const notRecommended = hasGenerated && !!brief && brief.shouldPost === false

              return (
                <div key={platform} style={{ width: '200px', borderRadius: '12px', border: `1px solid ${isJustScheduled ? 'rgba(47,191,113,0.4)' : notRecommended ? 'var(--line)' : hasBrief ? color + '55' : color + '28'}`, background: 'var(--card)', overflow: 'hidden', opacity: notRecommended ? 0.5 : 1 }}>
                  {/* Card header */}
                  <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: notRecommended ? 'rgba(255,255,255,0.02)' : color + '0d', borderBottom: '1px solid var(--line)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <SeriesPlatformIcon platform={platform} size={18} color={notRecommended ? 'var(--text-faint)' : color} />
                      <span style={{ fontSize: '14px', fontWeight: 700, color: notRecommended ? 'var(--text-faint)' : 'var(--text)' }}>{label}</span>
                    </div>
                    {/* + / open button — hidden if not recommended */}
                    {!notRecommended && (
                      <button
                        onClick={() => setOpenPlatform(platform)}
                        title={hasBrief ? 'View & schedule' : 'Open'}
                        style={{ width: '26px', height: '26px', borderRadius: '50%', border: `1.5px solid ${hasBrief ? color : 'var(--line)'}`, background: hasBrief ? color + '22' : 'transparent', color: hasBrief ? color : 'var(--text-faint)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}
                      >
                        {isJustScheduled ? (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        ) : (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        )}
                      </button>
                    )}
                  </div>

                  <div style={{ padding: '10px 14px' }}>
                    {notRecommended ? (
                      <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: 0, fontStyle: 'italic' }}>Not suited for your brand</p>
                    ) : hasBrief && !isJustScheduled ? (
                      <p style={{ fontSize: '12px', color: color, fontWeight: 600, margin: 0 }}>Brief ready — click + to schedule</p>
                    ) : isJustScheduled ? (
                      <p style={{ fontSize: '12px', color: 'var(--green)', fontWeight: 600, margin: 0 }}>{st!.posts.length} post{st!.posts.length !== 1 ? 's' : ''} queued</p>
                    ) : (
                      <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: 0, fontStyle: 'italic' }}>Nothing scheduled yet</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={generating}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 22px', borderRadius: '8px', fontSize: '15px', fontWeight: 600, cursor: generating ? 'not-allowed' : 'pointer', border: 'none', background: generating ? 'rgba(47,191,113,0.2)' : 'var(--green)', color: generating ? 'var(--text-dim)' : 'var(--bg)' }}
          >
            {generating ? (
              <><span className="md-spin" style={{ borderTopColor: 'var(--green)', borderColor: 'rgba(47,191,113,0.2)' }} />Analyzing brand…</>
            ) : hasGenerated ? (
              <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>Refresh briefs</>
            ) : (
              <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>Generate series briefs</>
            )}
          </button>

          {genError && <p style={{ fontSize: '14px', color: '#ef4444', marginTop: '12px' }}>{genError}</p>}

          {/* Scheduled posts list */}
          {history.length > 0 && (
            <div style={{ marginTop: '24px', borderTop: '1px solid var(--line)', paddingTop: '18px' }}>
              <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-faint)', letterSpacing: '0.04em', margin: '0 0 12px' }}>SCHEDULED POSTS</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[...history].sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? '')).map(post => {
                  const meta = SERIES_PLATFORM_META[post.platform as SeriesPlatform]
                  const color = meta?.color ?? '#888'
                  return (
                    <div key={post.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', borderRadius: '10px', background: 'var(--card)', border: '1px solid var(--line)' }}>
                      <SeriesPlatformIcon platform={post.platform} size={16} color={color} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: '13px', color: 'var(--text)', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.4 }}>{post.topic}</p>
                        <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: 0 }}>
                          {post.scheduledAt
                            ? new Date(post.scheduledAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
                            + ' · ' + new Date(post.scheduledAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
                            : '—'}
                        </p>
                      </div>
                      <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', flexShrink: 0, background: post.status === 'scheduled' ? 'rgba(47,191,113,0.12)' : 'rgba(255,255,255,0.06)', color: post.status === 'scheduled' ? 'var(--green)' : 'var(--text-faint)', border: `1px solid ${post.status === 'scheduled' ? 'rgba(47,191,113,0.25)' : 'var(--line)'}` }}>
                        {post.status}
                      </span>
                      {post.outputUrl && (
                        <a href={post.outputUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', fontWeight: 600, color, textDecoration: 'none', flexShrink: 0 }}>View</a>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Schedule / history modal */}
          {mp && mMeta && (
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)' }}
              onClick={() => setOpenPlatform(null)}
            >
              <div
                style={{ width: '480px', maxWidth: '95vw', maxHeight: '88vh', overflowY: 'auto', borderRadius: '16px', background: 'var(--card)', border: `1px solid ${mMeta.color}44`, boxShadow: `0 32px 80px rgba(0,0,0,0.6)` }}
                onClick={e => e.stopPropagation()}
              >
                {/* Modal header */}
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: mMeta.color + '0d', borderRadius: '16px 16px 0 0', position: 'sticky', top: 0, zIndex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <SeriesPlatformIcon platform={mp} size={20} color={mMeta.color} />
                    <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)' }}>{mMeta.label}</span>
                  </div>
                  <button onClick={() => setOpenPlatform(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: '4px', display: 'flex', alignItems: 'center', borderRadius: '6px' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>

                <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {mSt?.scheduled ? (
                    /* Output preview after scheduling */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--green)', margin: 0 }}>
                        {mSt.posts.length} post{mSt.posts.length !== 1 ? 's' : ''} queued
                      </p>
                      {mBrief && (
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '12px', fontWeight: 600, padding: '3px 9px', borderRadius: '20px', background: mMeta.color + '1a', color: mMeta.color, border: `1px solid ${mMeta.color}33` }}>{mBrief.format}</span>
                          <span style={{ fontSize: '12px', fontWeight: 600, padding: '3px 9px', borderRadius: '20px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-faint)', border: '1px solid var(--line)', textTransform: 'uppercase' }}>{mBrief.outputFormat}</span>
                          <span style={{ fontSize: '12px', fontWeight: 600, padding: '3px 9px', borderRadius: '20px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-faint)', border: '1px solid var(--line)' }}>{mBrief.count} posts · {CADENCE_OPTIONS.find(o => o.value === mBrief.cadence)?.label ?? mBrief.cadence}</span>
                        </div>
                      )}
                      {mSt.posts.map((p, i) => (
                        <div key={i} style={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid rgba(47,191,113,0.2)', background: 'rgba(47,191,113,0.04)' }}>
                          {p.outputUrl && mBrief?.outputFormat !== 'mp4' && (
                            <img
                              src={p.outputUrl}
                              alt={`Post ${i + 1}`}
                              style={{ width: '100%', display: 'block', objectFit: 'cover' }}
                              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                            />
                          )}
                          <div style={{ padding: '10px 12px' }}>
                            <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--green-bright)', margin: '0 0 3px' }}>
                              Post {i + 1} · {new Date(p.scheduledAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                            </p>
                            {p.topic && <p style={{ fontSize: '13px', color: 'var(--text-dim)', margin: '0 0 6px', lineHeight: 1.4 }}>{p.topic}</p>}
                            {p.outputUrl ? (
                              <a href={p.outputUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', fontWeight: 600, color: mMeta.color, textDecoration: 'none' }}>
                                {mBrief?.outputFormat === 'mp4' ? 'Watch video →' : 'View full image →'}
                              </a>
                            ) : (
                              <span style={{ fontSize: '12px', color: 'var(--text-faint)' }}>Rendering…</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : mBrief ? (
                    /* Brief form + schedule */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      {mBrief.reason && (Array.isArray(mBrief.reason) ? mBrief.reason.length > 0 : mBrief.reason) && (
                        <div style={{ padding: '11px 13px', borderRadius: '9px', background: mMeta.color + '0e', border: `1px solid ${mMeta.color}33` }}>
                          <p style={{ fontSize: '11px', fontWeight: 700, color: mMeta.color, margin: '0 0 10px', letterSpacing: '0.05em' }}>WHY THIS</p>
                          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '7px' }}>
                            {(Array.isArray(mBrief.reason) ? mBrief.reason : [mBrief.reason]).slice(0, 6).map((point, i) => {
                              // parse **bold**: rest
                              const match = point.match(/^\*\*(.+?)\*\*[:：]?\s*(.*)$/)
                              return (
                                <li key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '13px', color: 'var(--text-dim)', lineHeight: 1.55 }}>
                                  <span style={{ color: mMeta.color, flexShrink: 0, marginTop: '2px' }}>•</span>
                                  <span>
                                    {match ? (
                                      <><strong style={{ color: 'var(--text)', fontWeight: 700 }}>{match[1]}:</strong>{' '}{match[2]}</>
                                    ) : point}
                                  </span>
                                </li>
                              )
                            })}
                          </ul>
                        </div>
                      )}
                      {/* Format badges */}
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '12px', fontWeight: 600, padding: '3px 9px', borderRadius: '20px', background: mMeta.color + '1a', color: mMeta.color, border: `1px solid ${mMeta.color}33` }}>{mBrief.format}</span>
                        <span style={{ fontSize: '12px', fontWeight: 600, padding: '3px 9px', borderRadius: '20px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-faint)', border: '1px solid var(--line)', textTransform: 'uppercase' }}>{mBrief.outputFormat}</span>
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', color: 'var(--text-faint)', fontWeight: 600, letterSpacing: '0.04em', display: 'block', marginBottom: '6px' }}>SERIES BRIEF</label>
                        <textarea
                          value={mBrief.instruction}
                          onChange={e => updateBrief(mp, { instruction: e.target.value })}
                          rows={4} maxLength={400}
                          style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--input)', color: 'var(--text)', fontSize: '14px', resize: 'vertical', outline: 'none', lineHeight: 1.55, boxSizing: 'border-box', fontFamily: 'inherit' }}
                        />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '10px' }}>
                        <div>
                          <label style={{ fontSize: '12px', color: 'var(--text-faint)', fontWeight: 600, letterSpacing: '0.04em', display: 'block', marginBottom: '6px' }}>POSTS</label>
                          <select value={mBrief.count} onChange={e => updateBrief(mp, { count: Number(e.target.value) })} style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--input)', color: 'var(--text)', fontSize: '14px', outline: 'none' }}>
                            {[2, 3, 4, 5].map(n => <option key={n} value={n}>{n} posts</option>)}
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: '12px', color: 'var(--text-faint)', fontWeight: 600, letterSpacing: '0.04em', display: 'block', marginBottom: '6px' }}>CADENCE</label>
                          <select value={mBrief.cadence} onChange={e => updateBrief(mp, { cadence: e.target.value })} style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--input)', color: 'var(--text)', fontSize: '14px', outline: 'none' }}>
                            {CADENCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', color: 'var(--text-faint)', fontWeight: 600, letterSpacing: '0.04em', display: 'block', marginBottom: '6px' }}>START DATE</label>
                        <input type="date" value={mBrief.startDate} onChange={e => updateBrief(mp, { startDate: e.target.value })} style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--input)', color: 'var(--text)', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }} />
                      </div>
                      {mSt?.error && <p style={{ fontSize: '13px', color: '#ef4444', margin: 0 }}>{mSt.error}</p>}
                      <button
                        disabled={mSt?.scheduling || !mBrief.instruction.trim()}
                        onClick={() => handleSchedule(mp)}
                        style={{ padding: '12px 0', borderRadius: '9px', fontSize: '15px', fontWeight: 700, cursor: mSt?.scheduling || !mBrief.instruction.trim() ? 'not-allowed' : 'pointer', border: 'none', background: mSt?.scheduling || !mBrief.instruction.trim() ? 'rgba(255,255,255,0.06)' : mMeta.color, color: mSt?.scheduling || !mBrief.instruction.trim() ? 'var(--text-dim)' : '#fff', width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                      >
                        {mSt?.scheduling ? (
                          <><span className="md-spin" style={{ borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.25)' }} />Generating & scheduling…</>
                        ) : (
                          <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>Schedule Series</>
                        )}
                      </button>
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '20px 0' }}>
                      <p style={{ fontSize: '14px', color: 'var(--text-faint)', margin: '0 0 14px' }}>No brief yet — generate one first.</p>
                      <button onClick={() => { setOpenPlatform(null); handleGenerate() }} style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '9px 18px', borderRadius: '8px', border: 'none', background: 'var(--green)', color: 'var(--bg)', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>
                        Generate briefs
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Smart Scheduler ────────────────────────────────────────────────────────────

const SCHED_PLATFORMS = [
  { key: 'instagram', label: 'Instagram', color: '#E1306C' },
  { key: 'linkedin',  label: 'LinkedIn',  color: '#0A66C2' },
  { key: 'twitter',   label: 'X / Twitter', color: '#1DA1F2' },
  { key: 'facebook',  label: 'Facebook',  color: '#1877F2' },
  { key: 'youtube',   label: 'YouTube',   color: '#FF0000' },
  { key: 'tiktok',    label: 'TikTok',    color: '#69C9D0' },
]

const PLATFORM_INTERVAL_DAYS: Record<string, number> = {
  instagram: 2, linkedin: 2, twitter: 1, facebook: 1, youtube: 7, tiktok: 1,
}

function getNextDue(scheduledAt: string, platform: string): string {
  const d = new Date(scheduledAt)
  d.setDate(d.getDate() + (PLATFORM_INTERVAL_DAYS[platform] ?? 3))
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function toDatetimeLocal(iso: string): string { return iso.slice(0, 16) }

interface SchedSuggestion { platform: string; shouldPost: boolean; topic: string; postType: 'image' | 'video'; scheduledAt: string; reason: string }
interface SchedEdit { topic: string; postType: 'image' | 'video'; scheduledAt: string; reason: string; shouldPost: boolean }
interface SchedStatus { scheduling: boolean; scheduled: boolean; outputUrl: string | null; error: string | null }
interface LastPost { scheduledAt: string; status: string; outputUrl: string | null }

function SmartScheduler({ moduleId, brandId, connected }: { moduleId: string; brandId: string; connected: boolean }) {
  const [generating, setGenerating]       = useState(false)
  const [genError, setGenError]           = useState<string | null>(null)
  const [edits, setEdits]                 = useState<Record<string, SchedEdit>>({})
  const [statuses, setStatuses]           = useState<Record<string, SchedStatus>>({})
  const [lastPosts, setLastPosts]         = useState<Record<string, LastPost>>({})
  const [hasGenerated, setHasGenerated]   = useState(false)

  useEffect(() => {
    fetch(`/api/frekto/schedule?brandId=${brandId}`)
      .then(r => r.json())
      .then((d: { lastByPlatform?: Record<string, LastPost> }) => { if (d.lastByPlatform) setLastPosts(d.lastByPlatform) })
      .catch(() => {})
  }, [brandId])

  const handleGenerate = async () => {
    setGenerating(true); setGenError(null)
    try {
      const res = await fetch('/api/frekto/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ moduleId }) })
      const data = await res.json() as { suggestions?: SchedSuggestion[]; error?: string }
      if (!res.ok || data.error) { setGenError(data.error ?? 'Failed to generate suggestions.'); return }
      const newEdits: Record<string, SchedEdit> = {}
      const newStatuses: Record<string, SchedStatus> = {}
      for (const s of data.suggestions ?? []) {
        newEdits[s.platform] = { topic: s.topic ?? '', postType: s.postType ?? 'image', scheduledAt: s.scheduledAt ? toDatetimeLocal(s.scheduledAt) : toDatetimeLocal(new Date(Date.now() + 86400000).toISOString()), reason: s.reason ?? '', shouldPost: s.shouldPost }
        newStatuses[s.platform] = { scheduling: false, scheduled: false, outputUrl: null, error: null }
      }
      setEdits(newEdits); setStatuses(newStatuses); setHasGenerated(true)
    } catch (e) { console.error('[SmartScheduler] handleGenerate error:', e); setGenError('Network error — please try again.') }
    finally { setGenerating(false) }
  }

  const handleSchedule = async (platform: string) => {
    const edit = edits[platform]; if (!edit) return
    setStatuses(prev => ({ ...prev, [platform]: { ...prev[platform], scheduling: true, error: null } }))
    try {
      const res = await fetch('/api/frekto/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brandId, platform, topic: edit.topic, postType: edit.postType, scheduledAt: new Date(edit.scheduledAt).toISOString() }) })
      const data = await res.json() as { outputUrl?: string; error?: string }
      if (!res.ok || data.error) { setStatuses(prev => ({ ...prev, [platform]: { ...prev[platform], scheduling: false, error: data.error ?? 'Failed.' } })); return }
      const scheduledAt = new Date(edit.scheduledAt).toISOString()
      setStatuses(prev => ({ ...prev, [platform]: { scheduling: false, scheduled: true, outputUrl: data.outputUrl ?? null, error: null } }))
      setLastPosts(prev => ({ ...prev, [platform]: { scheduledAt, status: 'scheduled', outputUrl: data.outputUrl ?? null } }))
    } catch { setStatuses(prev => ({ ...prev, [platform]: { ...prev[platform], scheduling: false, error: 'Network error.' } })) }
  }

  const updateEdit = (platform: string, patch: Partial<SchedEdit>) =>
    setEdits(prev => ({ ...prev, [platform]: { ...prev[platform], ...patch } }))

  return (
    <div style={{ padding: '20px 28px', borderTop: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>Smart Scheduler</span>
        {!connected && <a href="/settings" style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--line)', color: 'var(--gold)', textDecoration: 'none' }}>Connect Frekto to unlock</a>}
      </div>
      <p style={{ fontSize: '12px', color: 'var(--text-faint)', marginBottom: '16px', lineHeight: 1.5 }}>
        Analyzes your brand and audit findings to suggest what to post, where, and when — then generates and schedules content via Frekto.
      </p>
      {!connected ? (
        <a href="/settings" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 16px', borderRadius: '7px', border: '1px solid var(--green)', color: 'var(--green-bright)', fontSize: '12px', fontWeight: 600, textDecoration: 'none' }}>Go to Settings → Integrations</a>
      ) : (
        <>
          <button onClick={handleGenerate} disabled={generating} style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '8px 20px', borderRadius: '7px', fontSize: '12.5px', fontWeight: 600, cursor: generating ? 'not-allowed' : 'pointer', border: 'none', background: generating ? 'rgba(47,191,113,0.25)' : 'var(--green)', color: generating ? 'var(--text-dim)' : '#06140c', marginBottom: '16px' }}>
            {generating ? <><span className="md-spin" style={{ borderTopColor: 'var(--green)', borderColor: 'rgba(47,191,113,0.2)' }} />Analyzing brand…</> : hasGenerated ? 'Regenerate ideas' : 'Generate post ideas'}
          </button>
          {genError && <p style={{ fontSize: '12px', color: '#ef4444', marginBottom: '12px' }}>{genError}</p>}
          {hasGenerated && (
            <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '8px' }}>
              {SCHED_PLATFORMS.map(({ key, label, color }) => {
                const edit = edits[key]; const status = statuses[key]; const last = lastPosts[key]
                if (!edit) return null
                const isDimmed = !edit.shouldPost && !status?.scheduled
                return (
                  <div key={key} style={{ minWidth: '260px', maxWidth: '260px', background: 'var(--card)', border: `1px solid ${isDimmed ? 'var(--line)' : color + '44'}`, borderRadius: '10px', padding: '14px', opacity: isDimmed ? 0.6 : 1, flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 700, color, letterSpacing: '0.02em' }}>{label}</span>
                      {!edit.shouldPost && !status?.scheduled && <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-faint)' }}>Not recommended</span>}
                      {status?.scheduled && <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(47,191,113,0.15)', color: 'var(--green)', border: '1px solid rgba(47,191,113,0.3)' }}>Scheduled</span>}
                    </div>
                    {last && <p style={{ fontSize: '10px', color: 'var(--text-faint)', marginBottom: '8px' }}>Last: {new Date(last.scheduledAt).toLocaleDateString()} · Next due: {getNextDue(last.scheduledAt, key)}</p>}
                    <p style={{ fontSize: '11px', color: 'var(--text-faint)', marginBottom: '10px', lineHeight: 1.45, fontStyle: 'italic' }}>{edit.reason}</p>
                    {status?.scheduled ? (
                      <div>
                        {status.outputUrl && (edit.postType === 'video'
                          ? <video src={status.outputUrl} controls style={{ width: '100%', borderRadius: '6px', maxHeight: '160px', marginBottom: '8px' }} />
                          : <img src={status.outputUrl} alt="Generated" style={{ width: '100%', borderRadius: '6px', maxHeight: '160px', objectFit: 'cover', marginBottom: '8px' }} />)}
                        {status.outputUrl && <a href={status.outputUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '11px', color: 'var(--green)', textDecoration: 'none' }}>Download</a>}
                      </div>
                    ) : (
                      <>
                        <textarea value={edit.topic} onChange={e => updateEdit(key, { topic: e.target.value.slice(0, 300) })} rows={3} style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--input)', color: 'var(--text)', fontSize: '11.5px', lineHeight: 1.5, resize: 'vertical', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '8px' }} />
                        <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
                          {(['image', 'video'] as const).map(pt => (
                            <button key={pt} onClick={() => updateEdit(key, { postType: pt })} style={{ padding: '3px 10px', borderRadius: '5px', fontSize: '11px', fontWeight: 500, cursor: 'pointer', border: '1px solid', borderColor: edit.postType === pt ? color : 'var(--line)', background: edit.postType === pt ? color + '22' : 'transparent', color: edit.postType === pt ? color : 'var(--text-dim)' }}>
                              {pt.charAt(0).toUpperCase() + pt.slice(1)}
                            </button>
                          ))}
                        </div>
                        <input type="datetime-local" value={edit.scheduledAt} onChange={e => updateEdit(key, { scheduledAt: e.target.value })} style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--input)', color: 'var(--text)', fontSize: '11px', outline: 'none', boxSizing: 'border-box', marginBottom: '10px' }} />
                        {status?.error && <p style={{ fontSize: '11px', color: '#ef4444', marginBottom: '8px' }}>{status.error}</p>}
                        <button onClick={() => handleSchedule(key)} disabled={status?.scheduling || !edit.topic?.trim()} style={{ width: '100%', padding: '7px 0', borderRadius: '6px', fontSize: '11.5px', fontWeight: 600, cursor: status?.scheduling || !edit.topic.trim() ? 'not-allowed' : 'pointer', border: `1px solid ${color}`, background: status?.scheduling ? 'transparent' : color + '22', color: status?.scheduling ? 'var(--text-dim)' : color }}>
                          {status?.scheduling ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}><span className="md-spin" style={{ borderTopColor: color, borderColor: color + '33', width: '10px', height: '10px' }} />Scheduling…</span> : 'Schedule via Frekto'}
                        </button>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
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
