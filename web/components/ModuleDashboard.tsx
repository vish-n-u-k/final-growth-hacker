'use client'

import { useState, useCallback, useEffect } from 'react'
import type { FixPlan } from '@/lib/modules/seo/fix-agent'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { type ModuleDefinition, type ModuleCategoryDefinition, type ModuleItemDefinition, type DBItemFull } from '@/lib/modules/types'
import { MODULE_MAP } from '@/lib/modules/registry'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import ThemeToggle from '@/components/ThemeToggle'
import ComingSoon from '@/components/ComingSoon'

export interface DBItemState {
  id: string
  aiDetail: string | null
  aiHighlight: string | null
  aiNarrative: string | null
  aiAction: string | null
  aiVerified: boolean
  userChecked: boolean
  completedBy: string | null
  fixable: boolean
  fixInputKey: string | null
  fixIntegrationProvider: string | null
  userSkipped: boolean
  userSkipReason: string | null
  exportType: string | null
  choiceOptions: string[] | null
  userChoice: string | null
}

interface ModuleSummary {
  id: string
  type: string
  name: string
  order: number
  status: string
  score: number
}

interface Props {
  brand: { id: string; name: string }
  module: { id: string; type: string; name: string; status: string; lastAnalyzedAt: string | null; requirements: Record<string, string> }
  definition: ModuleDefinition
  itemStates: Record<string, DBItemState>   // static modules: keyed by slug
  fullItems?: DBItemFull[]                  // dynamic modules: full item rows from DB
  allModules: ModuleSummary[]
  userEmail: string
  githubConnected: boolean
  connectedIntegrations: Record<string, boolean>
  modulePrUrl: string | null
  pageVerdicts?: { url: string; title: string | null; wordCount: number; verdict: string; urgency: string; reason: string | null; action: string | null }[]
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
  const allItems = cat.subCategories.flatMap((s) => s.items)
  const items = allItems.filter((i) => !states[i.slug]?.userSkipped)
  const totalWeight = items.reduce((sum, i) => sum + i.weight, 0)
  const aiWeight = items.filter((i) => states[i.slug]?.aiVerified).reduce((sum, i) => sum + i.weight, 0)
  const doneWeight = items
    .filter((i) => states[i.slug]?.aiVerified || states[i.slug]?.userChecked)
    .reduce((sum, i) => sum + i.weight, 0)
  const done = items.filter((i) => states[i.slug]?.aiVerified || states[i.slug]?.userChecked).length
  return {
    total: items.length,
    done,
    totalWeight,
    doneWeight,
    aiWeight,
    pct: totalWeight ? Math.round((doneWeight / totalWeight) * 100) : 0,
  }
}

function getOverall(def: ModuleDefinition, states: Record<string, DBItemState>) {
  const allItems = (def.categories as ModuleCategoryDefinition[]).flatMap((c) => c.subCategories.flatMap((s) => s.items))
  const items = allItems.filter((i) => !states[i.slug]?.userSkipped)
  const totalWeight = items.reduce((sum, i) => sum + i.weight, 0)
  const aiWeight = items.filter((i) => states[i.slug]?.aiVerified).reduce((sum, i) => sum + i.weight, 0)
  const doneWeight = items
    .filter((i) => states[i.slug]?.aiVerified || states[i.slug]?.userChecked)
    .reduce((sum, i) => sum + i.weight, 0)
  const aiVerified = items.filter((i) => states[i.slug]?.aiVerified).length
  const selfOnly = items.filter((i) => !states[i.slug]?.aiVerified && states[i.slug]?.userChecked).length
  const total = items.length
  const done = aiVerified + selfOnly
  return {
    total, aiVerified, selfOnly, done, open: total - done,
    totalWeight, doneWeight, aiWeight,
    pct: totalWeight ? Math.round((doneWeight / totalWeight) * 100) : 0,
  }
}

// ── Dynamic module helpers (items come from DB, not definition) ───────────────

function getDynamicOverall(items: DBItemFull[]) {
  const active = items.filter((i) => !i.userSkipped)
  const totalWeight = active.reduce((s, i) => s + i.weight, 0)
  const aiWeight = active.filter((i) => i.aiVerified).reduce((s, i) => s + i.weight, 0)
  const doneWeight = active.filter((i) => i.aiVerified || i.userChecked).reduce((s, i) => s + i.weight, 0)
  const aiVerified = active.filter((i) => i.aiVerified).length
  const selfOnly = active.filter((i) => !i.aiVerified && i.userChecked).length
  const total = active.length
  const done = aiVerified + selfOnly
  return {
    total, aiVerified, selfOnly, done, open: total - done,
    totalWeight, doneWeight, aiWeight,
    pct: totalWeight ? Math.round((doneWeight / totalWeight) * 100) : 0,
  }
}

function getDynamicCatStats(categorySlug: string, items: DBItemFull[]) {
  const catItems = items.filter((i) => i.categorySlug === categorySlug && !i.userSkipped)
  const totalWeight = catItems.reduce((s, i) => s + i.weight, 0)
  const aiWeight = catItems.filter((i) => i.aiVerified).reduce((s, i) => s + i.weight, 0)
  const doneWeight = catItems.filter((i) => i.aiVerified || i.userChecked).reduce((s, i) => s + i.weight, 0)
  const done = catItems.filter((i) => i.aiVerified || i.userChecked).length
  return {
    total: catItems.length, done, totalWeight, doneWeight, aiWeight,
    pct: totalWeight ? Math.round((doneWeight / totalWeight) * 100) : 0,
  }
}

function userCountToBarPct(count: number): number {
  return Math.min(Math.max(count / 500, 0), 1) * 100
}

function ringColor(score: number): string {
  if (score >= 85) return '#4ade80'
  if (score >= 65) return '#fbbf24'
  if (score >= 35) return '#fb923c'
  return '#f43f5e'
}

function ModuleRing({ score }: { score: number }) {
  const r = 16
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - Math.max(score, 0) / 100)
  const color = ringColor(score)
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" style={{ flexShrink: 0, display: 'block' }}>
      <circle
        cx="22" cy="22" r={r} fill="none"
        stroke={color} strokeWidth="3" strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={score === 0 ? circ : offset}
        style={{ transform: 'rotate(-90deg)', transformOrigin: '22px 22px', transition: 'stroke-dashoffset .5s ease', filter: `drop-shadow(0 0 3px ${color}80)` }}
      />
      <text
        x="22" y="22" textAnchor="middle" dominantBaseline="central"
        fill={color}
        style={{ fontSize: '9.5px', fontWeight: 800, fontFamily: 'Outfit, sans-serif' }}
      >
        {score}
      </text>
    </svg>
  )
}

export default function ModuleDashboard({ brand, module: mod, definition: def, itemStates: initial, fullItems: initialFullItems, allModules, userEmail, githubConnected, connectedIntegrations, modulePrUrl: initialPrUrl, pageVerdicts }: Props) {
  const [states, setStates] = useState(initial)
  const [dynItems, setDynItems] = useState<DBItemFull[]>(initialFullItems ?? [])
  const [openCats, setOpenCats] = useState<Set<string>>(new Set())
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())
  const [verifyingItems, setVerifyingItems] = useState<Set<string>>(new Set())
  const [applyingFix, setApplyingFix] = useState<Set<string>>(new Set())
  const [prUrl, setPrUrl] = useState<string | null>(initialPrUrl)
  const [fixPlanModal, setFixPlanModal] = useState<{ itemId: string; slug: string; plan: FixPlan } | null>(null)
  const [reanalyzing, setReanalyzing] = useState(false)
  const [requested, setRequested] = useState(false)
  const [reqValues, setReqValues] = useState<Record<string, string>>(mod.requirements ?? {})
  const [setupError, setSetupError] = useState<string | null>(null)
  const [generatingDraft, setGeneratingDraft] = useState<Set<string>>(new Set())
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null)
  const [skipPrompting, setSkipPrompting] = useState<Set<string>>(new Set())
  const [skipReasonDraft, setSkipReasonDraft] = useState<Record<string, string>>({})
  const [userCount, setUserCount] = useState<number>(0)
  useEffect(() => {
    setUserCount( 0)
  }, [])
  const [editingCount, setEditingCount] = useState(false)
  const [autoRunTriggered, setAutoRunTriggered] = useState(false)
  const [funnelPanelOpen, setFunnelPanelOpen] = useState(
    mod.type === 'user-analytics' && !mod.requirements['funnel_steps'],
  )
  const router = useRouter()

  // Whether any required requirement is missing a value
  const missingRequirements = def.requirements.filter(
    (r) => r.required !== false && !reqValues[r.key]?.trim(),
  )
  // Only show form if there are missing REQUIRED fields
  // Optional fields (like competitor_urls with leave empty to auto-discover) should not block
  const needsSetup = missingRequirements.length > 0

  // Auto-run analysis when all required fields are filled and module hasn't been analyzed
  useEffect(() => {
    if (!needsSetup && !mod.lastAnalyzedAt && !reanalyzing && !autoRunTriggered && def.dynamic) {
      setAutoRunTriggered(true)
      handleReanalyze(reqValues)
    }
  }, [needsSetup, mod.lastAnalyzedAt])

  const overall = def.dynamic ? getDynamicOverall(dynItems) : getOverall(def, states)

  const currentLevel = allModules.find((m) => m.id === mod.id)?.order ?? 0
  const barPct = userCountToBarPct(userCount)

  // Compute lock state dynamically: a module is locked if the previous module (by order) scored < 80%
  // Foundation (order 0) is always unlocked. This works for all users regardless of DB status.
  const sortedModules = [...allModules].sort((a, b) => a.order - b.order)
  const isModuleLocked = (m: ModuleSummary) => {
    if (m.order <= 2) return false  // Foundation, Website Audit, SEO always unlocked
    const prev = [...sortedModules].reverse().find((p) => p.order < m.order)
    return !prev || prev.score < 80
  }

  const toggleCat = (slug: string) =>
    setOpenCats((prev) => prev.has(slug) ? new Set() : new Set([slug]))

  const toggleExpand = (slug: string, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.md-cb')) return
    setExpandedItems((prev) => prev.has(slug) ? new Set() : new Set([slug]))
  }

  const toggleItem = useCallback(
    async (itemId: string, slug: string, current: boolean, e: React.MouseEvent) => {
      e.stopPropagation()
      const next = !current

      // Optimistic update
      if (def.dynamic) {
        setDynItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, userChecked: next } : i)))
      } else {
        setStates((prev) => ({
          ...prev,
          [slug]: {
            ...(prev[slug] ?? { id: itemId, aiDetail: null, aiHighlight: null, aiNarrative: null, aiAction: null, aiVerified: false, completedBy: null, fixable: false, fixInputKey: null, fixIntegrationProvider: null, userSkipped: false, userSkipReason: null, exportType: null, choiceOptions: null, userChoice: null }),
            userChecked: next,
          },
        }))
      }

      await fetch('/api/items/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, checked: next }),
      })

      // Step 3: For static (Foundation) items being checked, run verification in background
      if (!def.dynamic && next) {
        setVerifyingItems((prev) => new Set(prev).add(slug))
        try {
          const res = await fetch('/api/items/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemId }),
          })
          const data = await res.json()
          if (data.canVerify && data.aiVerified) {
            setStates((prev) => ({
              ...prev,
              [slug]: { ...prev[slug], aiVerified: true, aiDetail: data.detail ?? prev[slug]?.aiDetail ?? null },
            }))
          }
        } catch {
          // Verification failure is non-fatal — item stays as user_checked
        } finally {
          setVerifyingItems((prev) => {
            const next = new Set(prev)
            next.delete(slug)
            return next
          })
        }
      }
    },
    [def.dynamic],
  )

  const handleReanalyze = async (overrideReqs?: Record<string, string>) => {
    setSetupError(null)

    if (process.env.NEXT_PUBLIC_APP_ENV === 'production' && mod.type !== 'foundation') {
      setReanalyzing(true)
      try {
        const res = await fetch('/api/request-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moduleId: mod.id, moduleName: def.name }),
        })
        if (res.ok) {
          setRequested(true)
        } else {
          const data = await res.json().catch(() => ({}))
          setSetupError((data as { error?: string }).error ?? 'Request failed. Please try again.')
        }
      } finally {
        setReanalyzing(false)
      }
      return
    }

    setReanalyzing(true)
    const body: Record<string, unknown> = { moduleId: mod.id }
    const reqs = overrideReqs ?? reqValues
    const nonEmpty = Object.fromEntries(Object.entries(reqs).filter(([, v]) => typeof v === 'string' && v.trim()))
    if (Object.keys(nonEmpty).length > 0) body.requirements = nonEmpty
    const res = await fetch('/api/modules/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      // Refresh the page data without full reload using Next.js router
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      setSetupError((data as { error?: string }).error ?? 'Analysis failed. Please try again.')
      setReanalyzing(false)
    }
    setReanalyzing(false)
  }

  const applyFixExecute = useCallback(async (itemId: string, slug: string, plan?: FixPlan) => {
    setApplyingFix((prev) => new Set(prev).add(slug))
    setFixPlanModal(null)
    try {
      const body: Record<string, unknown> = { itemId, mode: 'execute' }
      if (plan) body.plan = plan
      const res = await fetch('/api/items/apply-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (res.ok && data.prUrl) {
        setPrUrl(data.prUrl)
        if (def.dynamic) {
          setDynItems((prev) =>
            prev.map((i) => (i.id === itemId ? { ...i, completedBy: 'agent', aiVerified: true } : i)),
          )
        } else {
          setStates((prev) => ({
            ...prev,
            [slug]: { ...prev[slug], completedBy: 'agent', aiVerified: true },
          }))
        }
      } else {
        alert(data.error ?? 'Fix failed — please try again.')
      }
    } catch {
      alert('Fix failed — please check your connection and try again.')
    } finally {
      setApplyingFix((prev) => {
        const next = new Set(prev)
        next.delete(slug)
        return next
      })
    }
  }, [def.dynamic])

  const handleApplyFix = useCallback(async (itemId: string, slug: string) => {
    setApplyingFix((prev) => new Set(prev).add(slug))
    try {
      const res = await fetch('/api/items/apply-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, mode: 'plan' }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error ?? 'Could not build a fix plan — please try again.')
        return
      }
      if (data.plan === null) {
        // Template/value paths — no plan preview, apply directly
        await applyFixExecute(itemId, slug)
      } else {
        // Patch/legacy paths — show plan modal
        setApplyingFix((prev) => { const next = new Set(prev); next.delete(slug); return next })
        setFixPlanModal({ itemId, slug, plan: data.plan as FixPlan })
      }
    } catch {
      alert('Could not reach the server — please check your connection.')
    } finally {
      setApplyingFix((prev) => {
        const next = new Set(prev)
        next.delete(slug)
        return next
      })
    }
  }, [applyFixExecute])

  const handleSkip = useCallback(
    async (itemId: string, slug: string, skipped: boolean, reason: string) => {
      setSkipPrompting((prev) => { const n = new Set(prev); n.delete(slug); return n })
      if (def.dynamic) {
        setDynItems((prev) =>
          prev.map((i) => i.id === itemId ? { ...i, userSkipped: skipped, userSkipReason: skipped ? reason || null : null } : i),
        )
      } else {
        setStates((prev) => ({
          ...prev,
          [slug]: { ...prev[slug], userSkipped: skipped, userSkipReason: skipped ? reason || null : null },
        }))
      }
      await fetch('/api/items/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, skipped, reason: skipped ? reason || null : null }),
      })
    },
    [def.dynamic],
  )

  const handleGenerateDraft = async (itemId: string, slug: string) => {
    setGeneratingDraft((prev) => new Set(prev).add(slug))
    try {
      const res = await fetch('/api/items/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId }),
      })
      const data = await res.json()
      if (data.draft) {
        setDynItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, aiDraft: data.draft } : i)))
      }
    } catch {
      // non-fatal — user can retry
    } finally {
      setGeneratingDraft((prev) => {
        const next = new Set(prev)
        next.delete(slug)
        return next
      })
    }
  }

  const priorityLabel = (weight: number) =>
    weight === 3 ? 'Critical' : weight === 2 ? 'Important' : 'Minor'

  const triggerMdDownload = (lines: string[], filename: string) => {
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const buildMdHeader = (title: string): string[] => [
    `# ${title}`,
    `> ${mod.name} — ${brand.name}`,
    `> Score: ${overall.pct}% complete (${overall.open} item${overall.open === 1 ? '' : 's'} pending)`,
    `> Generated: ${new Date().toLocaleDateString()}`,
    '',
    '---',
    '',
    '> **About this report:** The findings and recommendations in this document are generated by AI based on an automated analysis of your website and publicly available data. The AI strives to provide factual, accurate assessments — each item reflects a real signal detected during analysis. That said, some findings involve judgment calls and should be treated as informed recommendations. Always verify critical issues independently before acting on them.',
    '',
    '---',
    '',
  ]

  const renderDynItem = (lines: string[], item: DBItemFull, num: number) => {
    lines.push(`### ${num}. ${item.label} — ${priorityLabel(item.weight)}`)
    lines.push('')
    if (item.aiDetail) { lines.push(`**What:** ${item.aiDetail}`); lines.push('') }
    if (item.aiNarrative) { lines.push('**Why this matters:**'); lines.push(item.aiNarrative); lines.push('') }
    if (item.aiAction) { lines.push('**Action:**'); lines.push(item.aiAction); lines.push('') }
    lines.push('---')
    lines.push('')
  }

  const appendDynSections = (lines: string[], items: DBItemFull[]) => {
    const fixable = items.filter(i => i.fixable)
    const external = items.filter(i => !i.fixable)
    if (fixable.length > 0) {
      lines.push('## For your developer (code changes)')
      lines.push('')
      fixable.forEach((item, i) => renderDynItem(lines, item, i + 1))
    }
    if (external.length > 0) {
      lines.push('## Requires external action')
      lines.push('')
      external.forEach((item, i) => renderDynItem(lines, item, i + 1))
    }
  }

  const downloadCategoryMd = (cat: { slug: string; label: string }, items: DBItemFull[]) => {
    const incomplete = items
      .filter(item => !item.aiVerified && !item.userChecked && (item.aiDetail || item.aiNarrative || item.aiAction))
      .sort((a, b) => b.weight - a.weight)
    if (incomplete.length === 0) return
    const lines = buildMdHeader(`${cat.label} — Action Items`)
    appendDynSections(lines, incomplete)
    triggerMdDownload(lines, `${cat.slug}-todo.md`)
  }

  const downloadStaticCategoryMd = (cat: ModuleCategoryDefinition) => {
    type StaticEntry = { item: ModuleItemDefinition; s: DBItemState; subLabel: string }
    const fixableEntries: StaticEntry[] = []
    const externalEntries: StaticEntry[] = []

    cat.subCategories.forEach(sub => {
      sub.items.forEach(item => {
        const s = states[item.slug]
        if (!s || s.aiVerified || s.userChecked) return
        if (!s.aiDetail && !s.aiNarrative && !s.aiAction) return
        const entry = { item, s, subLabel: sub.label }
        if (item.fixable) fixableEntries.push(entry)
        else externalEntries.push(entry)
      })
    })

    fixableEntries.sort((a, b) => b.item.weight - a.item.weight)
    externalEntries.sort((a, b) => b.item.weight - a.item.weight)

    if (fixableEntries.length === 0 && externalEntries.length === 0) return

    const lines = buildMdHeader(`${cat.label} — Action Items`)

    const renderStaticEntry = (entry: StaticEntry, num: number) => {
      lines.push(`### ${num}. ${entry.item.label} — ${priorityLabel(entry.item.weight)}`)
      lines.push('')
      if (entry.s.aiDetail) { lines.push(`**What:** ${entry.s.aiDetail}`); lines.push('') }
      if (entry.s.aiNarrative) { lines.push('**Why this matters:**'); lines.push(entry.s.aiNarrative); lines.push('') }
      if (entry.s.aiAction) { lines.push('**Action:**'); lines.push(entry.s.aiAction); lines.push('') }
      lines.push('---')
      lines.push('')
    }

    if (fixableEntries.length > 0) {
      lines.push('## For your developer (code changes)')
      lines.push('')
      fixableEntries.forEach((entry, i) => renderStaticEntry(entry, i + 1))
    }
    if (externalEntries.length > 0) {
      lines.push('## Requires external action')
      lines.push('')
      externalEntries.forEach((entry, i) => renderStaticEntry(entry, i + 1))
    }

    triggerMdDownload(lines, `${cat.slug}-todo.md`)
  }

  const downloadFullModuleMd = () => {
    if (def.dynamic) {
      const incomplete = dynItems
        .filter(item => !item.aiVerified && !item.userChecked && (item.aiDetail || item.aiNarrative || item.aiAction))
        .sort((a, b) => b.weight - a.weight)
      if (incomplete.length === 0) return
      const lines = buildMdHeader(`${mod.name} — Full Action Report`)
      appendDynSections(lines, incomplete)
      triggerMdDownload(lines, `${mod.type}-full-report.md`)
    } else {
      type StaticEntry = { item: ModuleItemDefinition; s: DBItemState; catLabel: string; subLabel: string }
      const fixableEntries: StaticEntry[] = []
      const externalEntries: StaticEntry[] = []

      ;(def.categories as ModuleCategoryDefinition[]).forEach(cat => {
        cat.subCategories.forEach(sub => {
          sub.items.forEach(item => {
            const s = states[item.slug]
            if (!s || s.aiVerified || s.userChecked) return
            if (!s.aiDetail && !s.aiNarrative && !s.aiAction) return
            const entry = { item, s, catLabel: cat.label, subLabel: sub.label }
            if (item.fixable) fixableEntries.push(entry)
            else externalEntries.push(entry)
          })
        })
      })

      fixableEntries.sort((a, b) => b.item.weight - a.item.weight)
      externalEntries.sort((a, b) => b.item.weight - a.item.weight)

      if (fixableEntries.length === 0 && externalEntries.length === 0) return

      const lines = buildMdHeader(`${mod.name} — Full Action Report`)

      const renderStaticEntry = (entry: StaticEntry, num: number) => {
        lines.push(`### ${num}. ${entry.item.label} — ${priorityLabel(entry.item.weight)}`)
        lines.push(`> ${entry.catLabel} / ${entry.subLabel}`)
        lines.push('')
        if (entry.s.aiDetail) { lines.push(`**What:** ${entry.s.aiDetail}`); lines.push('') }
        if (entry.s.aiNarrative) { lines.push('**Why this matters:**'); lines.push(entry.s.aiNarrative); lines.push('') }
        if (entry.s.aiAction) { lines.push('**Action:**'); lines.push(entry.s.aiAction); lines.push('') }
        lines.push('---')
        lines.push('')
      }

      if (fixableEntries.length > 0) {
        lines.push('## For your developer (code changes)')
        lines.push('')
        fixableEntries.forEach((entry, i) => renderStaticEntry(entry, i + 1))
      }
      if (externalEntries.length > 0) {
        lines.push('## Requires external action')
        lines.push('')
        externalEntries.forEach((entry, i) => renderStaticEntry(entry, i + 1))
      }

      triggerMdDownload(lines, `${mod.type}-full-report.md`)
    }
  }

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <>
      {/* Analysis Requested Modal */}
      {requested && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setRequested(false)}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '36px 40px', maxWidth: 420, width: '90%', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(47,191,113,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <path d="M20 6L9 17l-5-5" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 10, color: 'var(--text)' }}>Request sent</h2>
            <p style={{ color: 'var(--text-dim)', fontSize: 14, lineHeight: 1.65, marginBottom: 26 }}>
              Your analysis request has been received. We&apos;ll email you when it&apos;s ready — usually within a few hours.
            </p>
            <Button onClick={() => setRequested(false)} style={{ minWidth: 100 }}>Got it</Button>
          </div>
        </div>
      )}

      {/* Fix Plan Modal */}
      {fixPlanModal && (
        <FixPlanModal
          itemId={fixPlanModal.itemId}
          slug={fixPlanModal.slug}
          initialPlan={fixPlanModal.plan}
          applying={applyingFix.has(fixPlanModal.slug)}
          onCancel={() => setFixPlanModal(null)}
          onConfirm={(plan) => applyFixExecute(fixPlanModal.itemId, fixPlanModal.slug, plan)}
        />
      )}

      {/* Header */}
      <header>
        <div className="wrap md-header-inner">
          <div className="logo" style={{ cursor: 'pointer' }} onClick={() => router.push('/dashboard')}>
            <span className="mark">
              <img src="/growjinlogo.svg" alt="" />
            </span>
            GrowJin
          </div>
          <div className="md-header-actions">
            <Button
              variant="outline"
              onClick={overall.pct >= 100 ? undefined : downloadFullModuleMd}
              disabled={overall.pct >= 100}
              className="gap-2 border-[var(--green)] px-4 h-10 text-[var(--green-bright)] hover:bg-[var(--accent)] hover:text-[var(--green-bright)] bg-[var(--card)] text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
              title={overall.pct >= 100 ? 'Nothing left to export — all items complete' : 'Export all incomplete items as a Markdown action plan'}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Export Incomplete
            </Button>
            <Button
              variant="outline"
              onClick={() => handleReanalyze()}
              disabled={reanalyzing}
              className="gap-2 w-30 border-[var(--green)] px-5 h-10 text-[var(--green-bright)] hover:bg-[var(--accent)] hover:text-[var(--green-bright)] bg-[var(--card)] text-sm font-semibold"
            >
              {reanalyzing ? (
                <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{animation:'md-spin .7s linear infinite',flexShrink:0,verticalAlign:'middle'}}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.35"/><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>Re-analysing…</>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className='px-4'>
                    <path d="M4 4v6h6M20 20v-6h-6M4.06 15a9 9 0 1 0 .94-6.93" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Re-analyse
                </>
              )}
            </Button>
            <ThemeToggle />
            <Button
              variant="outline"
              size="icon"
              onClick={() => router.push('/settings')}
              title="Settings"
              className="w-10 h-10 border-[var(--line)] text-[var(--text-dim)] hover:border-[var(--green)] hover:text-[var(--text)] bg-transparent rounded-[10px]"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Button>
            <Button
              variant="ghost"
              onClick={handleLogout}
              className="text-[var(--text-faint)] hover:text-[var(--text-dim)] w-54 border border-[var(--line)] hover:border-[var(--green)] text-sm"
            >
              {userEmail} · Sign out
            </Button>
          </div>
        </div>
      </header>

      {/* Journey Hero */}
      <div className="wrap">
        <div className="hero">
          <h1>Your road to 500 users</h1>
          <p>One module at a time. Clear each gate before you level up — don't skip ahead.</p>
        </div>
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
            ) : (
              userCount
            )}
            <span>/500</span>
          </div>
          <div className="meta">
            <div className="lvl">Currently · Level {currentLevel}</div>
            <div className="desc">{def.description}</div>
            <div className="journey-bar">
              <div className="journey-track">
                <div className="journey-fill" style={{ width: `${barPct}%` }} />
              </div>
              <div className="journey-labels">
                <span>0</span>
                <span>10</span>
                <span>50</span>
                <span>100</span>
                <span>500</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="md-layout wrap">
        {/* Sidebar */}
        <aside className="md-sidebar">
          <div className="md-sidebar-label">Modules</div>
          {sortedModules.map((m) => {
            const locked = isModuleLocked(m)
            return (
              <button
                key={m.id}
                disabled={locked}
                title={locked ? 'Complete the previous module at 80%+ to unlock' : undefined}
                className={`md-sidebar-item${m.id === mod.id ? ' md-sidebar-item-active' : ''}${locked ? ' md-sidebar-item-locked' : ''}`}
                onClick={() => !locked && router.push(`/dashboard/${m.id}`)}
              >
                <div className="md-sidebar-item-top">
                  <span className="md-sidebar-item-name">
                    {m.name}
                    {MODULE_MAP[m.type]?.tagline && (
                      <span className="md-sidebar-item-tagline"> — {MODULE_MAP[m.type].tagline}</span>
                    )}
                  </span>
                  {locked ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--text-faint)', flexShrink: 0 }}>
                      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
                      <path d="M8 11V7a4 4 0 1 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <ModuleRing score={m.score} />
                  )}
                </div>
              </button>
            )
          })}
        </aside>

        {/* Main content */}
        <div className="md-main">

        {/* Overview — hidden for now */}
        <div className="md-overview" style={{ display: 'none' }}>
          <div className="md-ov-top">
            <div>
              <div className="md-ov-label">{def.name}</div>
              <div className="md-ov-url">{def.description}</div>
            </div>
            <div className="md-ov-meta">
              <span className="md-ov-time">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                  <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                {timeAgo(mod.lastAnalyzedAt)}
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

        {/* Requirements setup — shown only when module has unfilled REQUIRED inputs */}
        {needsSetup && (
          <div className="md-setup-card">
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
                      onChange={(e) => setReqValues((prev) => ({ ...prev, [req.key]: e.target.value }))}
                      rows={3}
                    />
                  ) : (
                    <Input
                      type={req.type === 'url' ? 'url' : 'text'}
                      placeholder={req.placeholder}
                      value={reqValues[req.key] ?? ''}
                      onChange={(e) => setReqValues((prev) => ({ ...prev, [req.key]: e.target.value }))}
                      className="bg-[var(--input)] border-[var(--line)] text-[var(--text)] placeholder:text-[var(--text-faint)] focus-visible:ring-[var(--green)] focus-visible:border-[var(--green)]"
                    />
                  )}
                  {(req.type === 'url_list' || req.type === 'text_list') && (
                    <span className="md-setup-hint">Separate multiple values with commas</span>
                  )}
                </div>
              ))}
            </div>
            {setupError && <p className="md-setup-error">{setupError}</p>}
            <Button
              disabled={reanalyzing || missingRequirements.length > 0}
              onClick={() => handleReanalyze(reqValues)}
              className="mt-3 gap-1.5 bg-[var(--green)] text-white hover:bg-[var(--green-bright)] font-semibold"
            >
              {reanalyzing ? (
                <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{animation:'md-spin .7s linear infinite',flexShrink:0,verticalAlign:'middle'}}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.35"/><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>Analysing…</>
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

        {/* Funnel configuration — user-analytics only */}
        {mod.type === 'user-analytics' && (
          <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, marginBottom: 12 }}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => setFunnelPanelOpen((p) => !p)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setFunnelPanelOpen((p) => !p)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', cursor: 'pointer' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--green)', flexShrink: 0 }}>
                <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Funnel Analysis Setup</span>
              <span style={{ fontSize: 12, color: reqValues['funnel_steps'] ? 'var(--green)' : 'var(--text-faint)', fontWeight: 400, marginLeft: 4 }}>
                {reqValues['funnel_steps'] ? reqValues['funnel_steps'] : 'No steps configured — click to define your funnel'}
              </span>
              <svg className={`md-chev${funnelPanelOpen ? ' md-chev-open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ marginLeft: 'auto', flexShrink: 0 }}>
                <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            {funnelPanelOpen && (
              <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--line)' }}>
                <p style={{ margin: '12px 0 8px', fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                  Enter your PostHog event names in funnel order, comma-separated.{' '}
                  <span style={{ color: 'var(--text-faint)' }}>
                    Example:{' '}
                    <code style={{ fontFamily: 'monospace', background: 'var(--bg)', padding: '1px 4px', borderRadius: 3 }}>
                      $pageview, signup, add_payment, purchase
                    </code>
                  </span>
                </p>
                <textarea
                  className="md-setup-input md-setup-textarea"
                  placeholder="$pageview, signup, add_payment, purchase"
                  value={reqValues['funnel_steps'] ?? ''}
                  onChange={(e) => setReqValues((prev) => ({ ...prev, funnel_steps: e.target.value }))}
                  rows={2}
                  style={{ width: '100%', marginBottom: 8 }}
                />
                <Button
                  size="sm"
                  disabled={reanalyzing}
                  onClick={() => handleReanalyze(reqValues)}
                  className="gap-1.5 bg-[var(--green)] text-white hover:bg-[var(--green-bright)] font-semibold text-xs"
                >
                  {reanalyzing ? (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{animation:'md-spin .7s linear infinite',flexShrink:0,verticalAlign:'middle'}}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.35"/><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>
                      Running…
                    </>
                  ) : (
                    'Save & Re-analyse'
                  )}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Categories */}
        <div className="md-cats" style={needsSetup ? { opacity: 0.4, pointerEvents: 'none' } : {}}>
          {def.comingSoon ? (
            <ComingSoon
              variant="module"
              title={def.name}
              note={def.comingSoonNote ?? 'This module is in active development and will be available in an upcoming update.'}
            />
          ) : def.dynamic
            ? /* ── Dynamic module: items come from DB grouped by category ── */
              def.categories.map((cat) => {
                const stats = getDynamicCatStats(cat.slug, dynItems)
                const isOpen = openCats.has(cat.slug)
                const catItems = [...dynItems.filter((i) => i.categorySlug === cat.slug)].sort((a, b) => {
                  const aKey = a.userSkipped ? 2 : (a.aiVerified || a.userChecked) ? 1 : 0
                  const bKey = b.userSkipped ? 2 : (b.aiVerified || b.userChecked) ? 1 : 0
                  if (aKey !== bKey) return aKey - bKey
                  return b.weight - a.weight
                })

                return (
                  <div key={cat.slug} className={`md-cat${isOpen ? ' md-cat-open' : ''}`}>
                    <div className="md-cat-hd" role="button" tabIndex={0} onClick={() => toggleCat(cat.slug)}>
                      <div className="md-cat-hd-left">
                        <span className="md-cat-hd-name">{cat.label}</span>
                        <span className="md-cat-hd-count">{stats.done}/{stats.total}</span>
                      </div>
                      <div className="md-cat-hd-right">
                        <div className="md-cat-mini-bar">
                          <div className="md-cat-mini-self" style={{ width: `${stats.totalWeight ? Math.round((stats.doneWeight / stats.totalWeight) * 100) : 0}%`, background: ringColor(stats.pct) + '60' }} />
                          <div className="md-cat-mini-ai" style={{ width: `${stats.totalWeight ? Math.round((stats.aiWeight / stats.totalWeight) * 100) : 0}%`, background: ringColor(stats.pct) }} />
                        </div>
                        <span className="md-cat-pct" style={{ color: ringColor(stats.pct) }}>{stats.pct}%</span>
                        <svg className={`md-chev${isOpen ? ' md-chev-open' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </div>
                    </div>

                    {isOpen && (
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
                            {catItems.map((item) => {
                              const aiV = item.aiVerified
                              const userC = item.userChecked
                              const skipped = item.userSkipped
                              const done = aiV || userC
                              const needsAttention = !aiV && !userC && !skipped
                              const isExpanded = expandedItems.has(item.slug)
                              const hasDetail = !skipped && !!(item.aiNarrative || item.aiAction)
                              const isSkipPrompting = skipPrompting.has(item.slug)

                              return (
                                <div
                                  key={item.slug}
                                  className={`md-item sm-item${done ? ' md-item-done' : ''}${skipped ? ' md-item-skipped' : ''}${needsAttention ? ' md-item-flagged' : ''}${isExpanded ? ' sm-item-expanded' : ''}`}
                                  onClick={(e) => hasDetail && toggleExpand(item.slug, e)}
                                  style={{ cursor: hasDetail ? 'pointer' : 'default' }}
                                >
                                  <span
                                    className={`md-cb${aiV ? ' md-cb-ai' : userC ? ' md-cb-self' : ''}`}
                                    onClick={(e) => !skipped && toggleItem(item.id, item.slug, userC, e)}
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
                                            <button
                                              className="md-skip-unskip"
                                              onClick={(e) => { e.stopPropagation(); handleSkip(item.id, item.slug, false, '') }}
                                            >
                                              Unskip
                                            </button>
                                          </>
                                        ) : (
                                          <>
                                            {!done && item.weight === 3 && <Badge className="md-tag md-tag-critical">Critical</Badge>}
                                            {!done && item.weight === 2 && <Badge className="md-tag md-tag-important">Important</Badge>}
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
                                    {!skipped && item.aiDetail && <p className="md-item-detail">{item.aiDetail}</p>}
                                    {!skipped && !done && (
                                      <div className="md-skip-control" onClick={(e) => e.stopPropagation()}>
                                        {isSkipPrompting ? (
                                          <div className="md-skip-form">
                                            <input
                                              type="text"
                                              placeholder="Reason (optional)"
                                              className="md-skip-input"
                                              value={skipReasonDraft[item.slug] ?? ''}
                                              onChange={(e) => setSkipReasonDraft((prev) => ({ ...prev, [item.slug]: e.target.value }))}
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleSkip(item.id, item.slug, true, skipReasonDraft[item.slug] ?? '')
                                                if (e.key === 'Escape') setSkipPrompting((prev) => { const n = new Set(prev); n.delete(item.slug); return n })
                                              }}
                                              autoFocus
                                            />
                                            <button className="md-skip-confirm" onClick={() => handleSkip(item.id, item.slug, true, skipReasonDraft[item.slug] ?? '')}>Confirm</button>
                                            <button className="md-skip-cancel" onClick={() => setSkipPrompting((prev) => { const n = new Set(prev); n.delete(item.slug); return n })}>Cancel</button>
                                          </div>
                                        ) : (
                                          <button className="md-skip-btn" onClick={() => setSkipPrompting((prev) => new Set(prev).add(item.slug))}>Skip</button>
                                        )}
                                      </div>
                                    )}
                                    {isExpanded && hasDetail && (
                                      <div className="sm-expanded-body">
                                        {item.aiNarrative && <p className="sm-narrative">{item.aiNarrative}</p>}
                                        {item.aiAction && (
                                          <div className="sm-action-box">
                                            <span className="sm-action-label">Action</span>
                                            <p className="sm-action-text">{item.aiAction}</p>
                                          </div>
                                        )}
                                        {/* PostHog setup guide download */}
                                        {item.slug === 'posthog-installed' && !item.aiVerified && (
                                          <a
                                            href="/downloads/posthog-setup.md"
                                            download="posthog-setup.md"
                                            onClick={(e) => e.stopPropagation()}
                                            style={{
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: '6px',
                                              marginTop: '10px',
                                              padding: '6px 14px',
                                              borderRadius: '6px',
                                              border: '1px solid var(--green)',
                                              color: 'var(--green-bright)',
                                              fontSize: '12px',
                                              fontWeight: 500,
                                              textDecoration: 'none',
                                              background: 'transparent',
                                            }}
                                          >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                            </svg>
                                            Download Claude Code setup guide
                                          </a>
                                        )}
                                        {/* Calendar CSV download — only for the 30-day content calendar item */}
                                        {item.slug === 'content-calendar-30-day' && !!item.aiData && (
                                          <a
                                            href={`/api/modules/${mod.id}/calendar`}
                                            download
                                            onClick={(e) => e.stopPropagation()}
                                            style={{
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: '6px',
                                              marginTop: '10px',
                                              padding: '6px 14px',
                                              borderRadius: '6px',
                                              border: '1px solid var(--green)',
                                              color: 'var(--green-bright)',
                                              fontSize: '12px',
                                              fontWeight: 500,
                                              textDecoration: 'none',
                                              background: 'transparent',
                                            }}
                                          >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                            </svg>
                                            Download Calendar CSV
                                          </a>
                                        )}
                                        {/* AI Draft — only for failing dynamic module items */}
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
                                                  disabled={generatingDraft.has(item.slug)}
                                                  onClick={(e) => { e.stopPropagation(); handleGenerateDraft(item.id, item.slug) }}
                                                >
                                                  {generatingDraft.has(item.slug) ? 'Regenerating…' : 'Regenerate'}
                                                </button>
                                              </>
                                            ) : (
                                              <button
                                                className="sm-draft-btn"
                                                disabled={generatingDraft.has(item.slug)}
                                                onClick={(e) => { e.stopPropagation(); handleGenerateDraft(item.id, item.slug) }}
                                              >
                                                {generatingDraft.has(item.slug) ? (
                                                  <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{animation:'md-spin .7s linear infinite',flexShrink:0,verticalAlign:'middle'}}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.35"/><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>Generating draft…</>
                                                ) : (
                                                  '✦ Generate AI draft'
                                                )}
                                              </button>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            : /* ── Static module: items come from definition (Foundation) ── */
              (def.categories as ModuleCategoryDefinition[]).map((cat) => {
                const stats = getCatStats(cat, states)
                const isOpen = openCats.has(cat.slug)

                return (
                  <div key={cat.slug} className={`md-cat${isOpen ? ' md-cat-open' : ''}`}>
                    <div className="md-cat-hd" role="button" tabIndex={0} onClick={() => toggleCat(cat.slug)}>
                      <div className="md-cat-hd-left">
                        <span className="md-cat-hd-name">{cat.label}</span>
                        <span className="md-cat-hd-count">{stats.done}/{stats.total}</span>
                      </div>
                      <div className="md-cat-hd-right">
                        <div className="md-cat-mini-bar">
                          <div className="md-cat-mini-self" style={{ width: `${Math.round((stats.doneWeight / stats.totalWeight) * 100)}%`, background: ringColor(stats.pct) + '60' }} />
                          <div className="md-cat-mini-ai" style={{ width: `${Math.round((stats.aiWeight / stats.totalWeight) * 100)}%`, background: ringColor(stats.pct) }} />
                        </div>
                        <span className="md-cat-pct" style={{ color: ringColor(stats.pct) }}>{stats.pct}%</span>
                        <svg className={`md-chev${isOpen ? ' md-chev-open' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="md-cat-body">
                        {cat.subCategories.map((sub, si) => {
                          const subDone = sub.items.filter(
                            (i) => states[i.slug]?.aiVerified || states[i.slug]?.userChecked,
                          ).length
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
                              {sub.description && (
                                <div style={{
                                  padding: '8px 16px',
                                  margin: '0 0 4px 0',
                                  background: 'rgba(47,191,113,0.05)',
                                  borderLeft: '2px solid var(--green)',
                                  fontSize: '11.5px',
                                  color: 'var(--text-dim)',
                                  lineHeight: '1.55',
                                }}>
                                  {sub.description}
                                </div>
                              )}
                              <div className="md-items">
                                {[...sub.items]
                                  .sort((a, b) => {
                                    const aKey = states[a.slug]?.userSkipped ? 2 : (states[a.slug]?.aiVerified || states[a.slug]?.userChecked) ? 1 : 0
                                    const bKey = states[b.slug]?.userSkipped ? 2 : (states[b.slug]?.aiVerified || states[b.slug]?.userChecked) ? 1 : 0
                                    if (aKey !== bKey) return aKey - bKey
                                    return b.weight - a.weight
                                  })
                                  .map((item) => {
                                    const s = states[item.slug]
                                    const aiV = s?.aiVerified ?? false
                                    const userC = s?.userChecked ?? false
                                    const skipped = s?.userSkipped ?? false
                                    const done = aiV || userC
                                    const needsAttention = s && !aiV && !userC && !skipped
                                    const isExpanded = expandedItems.has(item.slug)
                                    const hasDetail = !skipped && !!(s?.aiNarrative || s?.aiAction)
                                    const isVerifying = verifyingItems.has(item.slug)
                                    const isSkipPrompting = skipPrompting.has(item.slug)

                                    return (
                                      <div
                                        key={item.slug}
                                        className={`md-item sm-item${done ? ' md-item-done' : ''}${skipped ? ' md-item-skipped' : ''}${needsAttention ? ' md-item-flagged' : ''}${isExpanded ? ' sm-item-expanded' : ''}`}
                                        onClick={(e) => hasDetail && toggleExpand(item.slug, e)}
                                        style={{ cursor: hasDetail ? 'pointer' : 'default' }}
                                      >
                                        <span
                                          className={`md-cb${aiV ? ' md-cb-ai' : userC ? ' md-cb-self' : ''}`}
                                          onClick={(e) => !skipped && toggleItem(s?.id ?? '', item.slug, userC, e)}
                                          style={{ cursor: skipped ? 'default' : 'pointer' }}
                                        >
                                          {isVerifying ? (
                                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" style={{animation:'md-spin .7s linear infinite',flexShrink:0}}><circle cx="12" cy="12" r="9" stroke="var(--green-bright)" strokeWidth="3" strokeOpacity="0.35"/><path d="M12 3a9 9 0 0 1 9 9" stroke="var(--green-bright)" strokeWidth="3" strokeLinecap="round"/></svg>
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
                                                  <button
                                                    className="md-skip-unskip"
                                                    onClick={(e) => { e.stopPropagation(); handleSkip(s?.id ?? '', item.slug, false, '') }}
                                                  >
                                                    Unskip
                                                  </button>
                                                </>
                                              ) : (
                                                <>
                                                  {!done && item.weight === 3 && <span className="md-tag md-tag-critical">Critical</span>}
                                                  {!done && item.weight === 2 && <span className="md-tag md-tag-important">Important</span>}
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
                                          {!skipped && s?.aiDetail && <p className="md-item-detail">{s.aiDetail}</p>}
                                          {!skipped && !done && (
                                            <div className="md-skip-control" onClick={(e) => e.stopPropagation()}>
                                              {isSkipPrompting ? (
                                                <div className="md-skip-form">
                                                  <input
                                                    type="text"
                                                    placeholder="Reason (optional)"
                                                    className="md-skip-input"
                                                    value={skipReasonDraft[item.slug] ?? ''}
                                                    onChange={(e) => setSkipReasonDraft((prev) => ({ ...prev, [item.slug]: e.target.value }))}
                                                    onKeyDown={(e) => {
                                                      if (e.key === 'Enter') handleSkip(s?.id ?? '', item.slug, true, skipReasonDraft[item.slug] ?? '')
                                                      if (e.key === 'Escape') setSkipPrompting((prev) => { const n = new Set(prev); n.delete(item.slug); return n })
                                                    }}
                                                    autoFocus
                                                  />
                                                  <button className="md-skip-confirm" onClick={() => handleSkip(s?.id ?? '', item.slug, true, skipReasonDraft[item.slug] ?? '')}>Confirm</button>
                                                  <button className="md-skip-cancel" onClick={() => setSkipPrompting((prev) => { const n = new Set(prev); n.delete(item.slug); return n })}>Cancel</button>
                                                </div>
                                              ) : (
                                                <button className="md-skip-btn" onClick={() => setSkipPrompting((prev) => new Set(prev).add(item.slug))}>Skip</button>
                                              )}
                                            </div>
                                          )}
                                          {isExpanded && hasDetail && (
                                            <div className="sm-expanded-body">
                                              {s?.aiNarrative && <p className="sm-narrative">{s.aiNarrative}</p>}
                                              {s?.aiAction && (
                                                <div className="sm-action-box">
                                                  <span className="sm-action-label">Action</span>
                                                  <p className="sm-action-text">{s.aiAction}</p>
                                                </div>
                                              )}
                                              {item.slug === 'posthog-installed' && !s?.aiVerified && (
                                                <a
                                                  href="/downloads/posthog-setup.md"
                                                  download="posthog-setup.md"
                                                  onClick={(e) => e.stopPropagation()}
                                                  style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '6px',
                                                    marginTop: '10px',
                                                    padding: '6px 14px',
                                                    borderRadius: '6px',
                                                    border: '1px solid var(--green)',
                                                    color: 'var(--green-bright)',
                                                    fontSize: '12px',
                                                    fontWeight: 500,
                                                    textDecoration: 'none',
                                                    background: 'transparent',
                                                  }}
                                                >
                                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                                  </svg>
                                                  Download Claude Code setup guide
                                                </a>
                                              )}
                                            </div>
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


        {/* Social profiles panel — Foundation module only */}
        {mod.type === 'foundation' && (
          <SocialProfilesPanel moduleId={mod.id} requirements={mod.requirements} />
        )}

        {/* Frekto Content Studio — Social Media module only */}
        {mod.type === 'social-media' && (
          <FrektoContentStudio
            moduleId={mod.id}
            brandName={brand.name}
            connected={!!connectedIntegrations['frekto']}
          />
        )}

        {/* Smart Scheduler — Social Media module only */}
        {mod.type === 'social-media' && (
          <SmartScheduler
            moduleId={mod.id}
            brandId={brand.id}
            connected={!!connectedIntegrations['frekto']}
          />
        )}

        <p className="foot-note" style={{ marginTop: '16px' }}>
          Click any item to see full analysis and action · AI verified = confirmed by Claude · Self-reported = marked by you
        </p>
        </div> {/* end md-main */}
      </div> {/* end md-layout */}
    </>
  )
}

// ── Social Profiles Panel (Foundation module only) ─────────────────────────────

const SOCIAL_PLATFORMS = [
  { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/yourhandle' },
  { key: 'linkedin', label: 'LinkedIn', placeholder: 'https://linkedin.com/company/yourcompany' },
  { key: 'twitter', label: 'Twitter / X', placeholder: 'https://x.com/yourhandle' },
  { key: 'facebook', label: 'Facebook', placeholder: 'https://facebook.com/yourpage' },
  { key: 'youtube', label: 'YouTube', placeholder: 'https://youtube.com/@yourchannel' },
  { key: 'tiktok', label: 'TikTok', placeholder: 'https://tiktok.com/@yourhandle' },
  { key: 'pinterest', label: 'Pinterest', placeholder: 'https://pinterest.com/yourprofile' },
]

function SocialProfilesPanel({ moduleId, requirements }: { moduleId: string; requirements: Record<string, string> }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(SOCIAL_PLATFORMS.map((p) => [p.key, requirements[`social_${p.key}`] ?? ''])),
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const detectedCount = SOCIAL_PLATFORMS.filter((p) => !!requirements[`social_${p.key}`]).length

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    const reqs: Record<string, string> = {}
    for (const p of SOCIAL_PLATFORMS) reqs[`social_${p.key}`] = values[p.key] ?? ''
    const res = await fetch('/api/modules/requirements', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moduleId, requirements: reqs }),
    })
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } else {
      setError('Failed to save. Please try again.')
    }
    setSaving(false)
  }

  return (
    <div style={{
      marginTop: '24px',
      background: 'var(--card)',
      border: '1px solid var(--line)',
      borderRadius: '12px',
      padding: '20px 24px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
          Social Media Profiles
        </span>
        {detectedCount > 0 ? (
          <span style={{
            fontSize: '11px', padding: '2px 8px', borderRadius: '4px',
            background: 'rgba(47,191,113,0.12)', border: '1px solid rgba(47,191,113,0.3)', color: 'var(--green)',
          }}>
            {detectedCount} detected from your website
          </span>
        ) : (
          <span style={{
            fontSize: '11px', padding: '2px 8px', borderRadius: '4px',
            background: 'rgba(255,255,255,0.04)', border: '1px solid var(--line)', color: 'var(--text-dim)',
          }}>
            None detected on your website
          </span>
        )}
      </div>

      <p style={{ fontSize: '12px', color: 'var(--text-faint)', marginBottom: '16px', lineHeight: '1.5' }}>
        {detectedCount > 0
          ? 'These were detected from your website. Confirm they are correct or update them.'
          : 'No social media links were found on your website. Add your profile URLs below so we can check your presence across platforms.'}
      </p>

      <div style={{ display: 'grid', gap: '10px' }}>
        {SOCIAL_PLATFORMS.map((p) => {
          const wasDetected = !!requirements[`social_${p.key}`]
          return (
            <div key={p.key} style={{ display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '12.5px', color: 'var(--text-dim)', fontWeight: 500 }}>{p.label}</span>
                {wasDetected && (
                  <span style={{
                    fontSize: '9px', padding: '1px 5px', borderRadius: '3px',
                    background: 'rgba(47,191,113,0.1)', color: 'var(--green)',
                    border: '1px solid rgba(47,191,113,0.25)', fontWeight: 600, letterSpacing: '0.03em',
                  }}>
                    AI
                  </span>
                )}
              </div>
              <Input
                type="url"
                placeholder={p.placeholder}
                value={values[p.key] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [p.key]: e.target.value }))}
                className="bg-[var(--input)] border-[var(--line)] text-[var(--text)] placeholder:text-[var(--text-faint)] focus-visible:ring-[var(--green)] focus-visible:border-[var(--green)] h-8 text-xs"
              />
            </div>
          )
        })}
      </div>

      {error && <p style={{ fontSize: '12px', color: '#ef4444', marginTop: '10px' }}>{error}</p>}

      <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          onClick={handleSave}
          disabled={saving}
          style={{
            background: saved ? 'rgba(47,191,113,0.15)' : 'var(--green)',
            color: saved ? 'var(--green)' : '#ffffff',
            border: saved ? '1px solid var(--green)' : 'none',
            fontSize: '12px', fontWeight: 600, height: '32px', padding: '0 16px',
          }}
        >
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save profiles'}
        </Button>
      </div>
    </div>
  )
}

// ── Frekto Content Studio (Social Media module only) ──────────────────────────

const FREKTO_PLATFORMS = [
  { key: 'instagram', label: 'Instagram', format: '4:5' },
  { key: 'tiktok', label: 'TikTok', format: '9:16' },
  { key: 'linkedin', label: 'LinkedIn', format: '1:1' },
  { key: 'twitter', label: 'X / Twitter', format: '1:1' },
  { key: 'facebook', label: 'Facebook', format: '1:1' },
  { key: 'youtube', label: 'YouTube', format: '1:1' },
]

function FrektoContentStudio({
  moduleId,
  brandName,
  connected,
}: {
  moduleId: string
  brandName: string
  connected: boolean
}) {
  const [platform, setPlatform] = useState('instagram')
  const [format, setFormat] = useState('4:5')
  const [outputFormat, setOutputFormat] = useState('png')
  const [topic, setTopic] = useState('')
  const [generating, setGenerating] = useState(false)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
    try {
      const res = await fetch('/api/frekto/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleId, topic: topic.trim(), format, outputFormat }),
      })
      const data = await res.json() as { outputUrl?: string; error?: string }
      if (data.outputUrl) {
        setResultUrl(data.outputUrl)
      } else {
        setError(data.error ?? 'Generation failed. Please try again.')
      }
    } catch {
      setError('Network error — please check your connection and try again.')
    } finally {
      setGenerating(false)
    }
  }

  const cardStyle: React.CSSProperties = {
    marginTop: '24px',
    background: 'var(--card)',
    border: '1px solid var(--line)',
    borderRadius: '12px',
    padding: '20px 24px',
  }

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
          Content Studio
        </span>
        {connected ? (
          <span style={{
            fontSize: '11px', padding: '2px 8px', borderRadius: '4px',
            background: 'rgba(47,191,113,0.12)', border: '1px solid rgba(47,191,113,0.3)', color: 'var(--green)',
          }}>
            Frekto connected
          </span>
        ) : (
          <a
            href="/settings"
            style={{
              fontSize: '11px', padding: '2px 8px', borderRadius: '4px',
              background: 'rgba(255,255,255,0.04)', border: '1px solid var(--line)', color: 'var(--gold)',
              textDecoration: 'none',
            }}
          >
            Connect Frekto in Settings to unlock
          </a>
        )}
      </div>
      <p style={{ fontSize: '12px', color: 'var(--text-faint)', marginBottom: '16px', lineHeight: '1.5' }}>
        {connected
          ? `Generate ready-to-post images and short videos for ${brandName}. Renders take 15–90 seconds.`
          : 'Connect your Frekto account to generate platform-ready social media images and videos directly from your audit findings.'}
      </p>

      {!connected && (
        <a
          href="/settings"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '7px 16px', borderRadius: '7px',
            border: '1px solid var(--green)', color: 'var(--green-bright)',
            fontSize: '12px', fontWeight: 600, textDecoration: 'none',
          }}
        >
          Go to Settings → Integrations
        </a>
      )}

      {connected && (
        <>
          {/* Platform selector */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
            {FREKTO_PLATFORMS.map((p) => (
              <button
                key={p.key}
                onClick={() => selectPlatform(p)}
                style={{
                  padding: '5px 13px', borderRadius: '6px', fontSize: '12px', fontWeight: 500,
                  cursor: 'pointer', border: '1px solid',
                  borderColor: platform === p.key ? 'var(--green)' : 'var(--line)',
                  background: platform === p.key ? 'rgba(47,191,113,0.12)' : 'transparent',
                  color: platform === p.key ? 'var(--green-bright)' : 'var(--text-dim)',
                  transition: 'all 0.15s',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Format controls */}
          <div style={{ display: 'flex', gap: '24px', marginBottom: '14px', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-faint)', marginBottom: '6px', fontWeight: 500 }}>Aspect ratio</div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {['4:5', '9:16', '1:1'].map((f) => (
                  <button
                    key={f}
                    onClick={() => setFormat(f)}
                    style={{
                      padding: '4px 11px', borderRadius: '5px', fontSize: '11px', fontWeight: 500,
                      cursor: 'pointer', border: '1px solid',
                      borderColor: format === f ? 'var(--green)' : 'var(--line)',
                      background: format === f ? 'rgba(47,191,113,0.1)' : 'transparent',
                      color: format === f ? 'var(--green-bright)' : 'var(--text-dim)',
                    }}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-faint)', marginBottom: '6px', fontWeight: 500 }}>Output format</div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {['png', 'mp4'].map((f) => (
                  <button
                    key={f}
                    onClick={() => setOutputFormat(f)}
                    style={{
                      padding: '4px 11px', borderRadius: '5px', fontSize: '11px', fontWeight: 500,
                      cursor: 'pointer', border: '1px solid',
                      borderColor: outputFormat === f ? 'var(--green)' : 'var(--line)',
                      background: outputFormat === f ? 'rgba(47,191,113,0.1)' : 'transparent',
                      color: outputFormat === f ? 'var(--green-bright)' : 'var(--text-dim)',
                    }}
                  >
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Topic input */}
          <div style={{ marginBottom: '12px' }}>
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value.slice(0, 300))}
              placeholder={`Describe the post for ${FREKTO_PLATFORMS.find(p => p.key === platform)?.label ?? platform}… e.g. "Announce our new product with bold visuals and a clear CTA to sign up"`}
              rows={3}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: '7px',
                border: '1px solid var(--line)', background: 'var(--input)',
                color: 'var(--text)', fontSize: '12.5px', lineHeight: '1.55',
                resize: 'vertical', outline: 'none', fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ textAlign: 'right', fontSize: '11px', color: topic.length >= 280 ? 'var(--gold)' : 'var(--text-faint)', marginTop: '3px' }}>
              {topic.length}/300
            </div>
          </div>

          {error && (
            <p style={{ fontSize: '12px', color: '#ef4444', marginBottom: '10px' }}>{error}</p>
          )}

          <button
            disabled={generating || !topic.trim()}
            onClick={handleGenerate}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '7px',
              padding: '8px 20px', borderRadius: '7px', fontSize: '12.5px', fontWeight: 600,
              cursor: generating || !topic.trim() ? 'not-allowed' : 'pointer',
              border: 'none',
              background: generating || !topic.trim() ? 'rgba(47,191,113,0.25)' : 'var(--green)',
              color: generating || !topic.trim() ? 'var(--text-dim)' : '#ffffff',
              transition: 'all 0.15s',
            }}
          >
            {generating ? (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{animation:'md-spin .7s linear infinite',flexShrink:0,verticalAlign:'middle'}}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.35"/><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>
                Generating… (15–90s)
              </>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Generate content
              </>
            )}
          </button>

          {/* Result */}
          {resultUrl && (
            <div style={{
              marginTop: '16px', padding: '16px', borderRadius: '8px',
              border: '1px solid rgba(47,191,113,0.25)', background: 'rgba(47,191,113,0.04)',
            }}>
              <div style={{ fontSize: '11px', color: 'var(--green)', fontWeight: 600, marginBottom: '10px', letterSpacing: '0.02em' }}>
                GENERATED
              </div>
              {outputFormat === 'mp4' ? (
                <video
                  src={resultUrl}
                  controls
                  style={{ maxWidth: '100%', maxHeight: '400px', borderRadius: '6px', display: 'block', marginBottom: '10px' }}
                />
              ) : (
                <img
                  src={resultUrl}
                  alt="Generated social media content"
                  style={{ maxWidth: '100%', maxHeight: '400px', borderRadius: '6px', display: 'block', marginBottom: '10px', objectFit: 'contain' }}
                />
              )}
              <div style={{ display: 'flex', gap: '8px' }}>
                <a
                  href={resultUrl}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '5px',
                    padding: '6px 14px', borderRadius: '6px',
                    border: '1px solid var(--green)', color: 'var(--green-bright)',
                    fontSize: '12px', fontWeight: 500, textDecoration: 'none',
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Download
                </a>
                <button
                  onClick={() => { setResultUrl(null); setError(null) }}
                  style={{
                    padding: '6px 14px', borderRadius: '6px',
                    border: '1px solid var(--line)', color: 'var(--text-dim)',
                    fontSize: '12px', fontWeight: 500, cursor: 'pointer', background: 'transparent',
                  }}
                >
                  Generate another
                </button>
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

function toDatetimeLocal(iso: string): string {
  return iso.slice(0, 16)
}

interface SchedSuggestion {
  platform: string
  shouldPost: boolean
  topic: string
  postType: 'image' | 'video'
  scheduledAt: string
  reason: string
}

interface SchedEdit {
  topic: string
  postType: 'image' | 'video'
  scheduledAt: string
  reason: string
  shouldPost: boolean
}

interface SchedStatus {
  scheduling: boolean
  scheduled: boolean
  outputUrl: string | null
  error: string | null
}

interface LastPost {
  scheduledAt: string
  status: string
  outputUrl: string | null
}

function SmartScheduler({
  moduleId,
  brandId,
  connected,
}: {
  moduleId: string
  brandId: string
  connected: boolean
}) {
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, SchedEdit>>({})
  const [statuses, setStatuses] = useState<Record<string, SchedStatus>>({})
  const [lastPosts, setLastPosts] = useState<Record<string, LastPost>>({})
  const [hasGenerated, setHasGenerated] = useState(false)

  // Load last scheduled posts on mount
  useEffect(() => {
    fetch(`/api/frekto/schedule?brandId=${brandId}`)
      .then(r => r.json())
      .then((d: { lastByPlatform?: Record<string, LastPost> }) => {
        if (d.lastByPlatform) setLastPosts(d.lastByPlatform)
      })
      .catch(() => {})
  }, [brandId])

  const handleGenerate = async () => {
    setGenerating(true)
    setGenError(null)
    try {
      const res = await fetch('/api/frekto/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleId }),
      })
      const data = await res.json() as { suggestions?: SchedSuggestion[]; error?: string }
      if (!res.ok || data.error) {
        setGenError(data.error ?? 'Failed to generate suggestions.')
        return
      }
      const newEdits: Record<string, SchedEdit> = {}
      const newStatuses: Record<string, SchedStatus> = {}
      for (const s of data.suggestions ?? []) {
        newEdits[s.platform] = {
          topic: s.topic,
          postType: s.postType,
          scheduledAt: toDatetimeLocal(s.scheduledAt),
          reason: s.reason,
          shouldPost: s.shouldPost,
        }
        newStatuses[s.platform] = { scheduling: false, scheduled: false, outputUrl: null, error: null }
      }
      setEdits(newEdits)
      setStatuses(newStatuses)
      setHasGenerated(true)
    } catch {
      setGenError('Network error — please check your connection.')
    } finally {
      setGenerating(false)
    }
  }

  const handleSchedule = async (platform: string) => {
    const edit = edits[platform]
    if (!edit) return
    setStatuses(prev => ({ ...prev, [platform]: { ...prev[platform], scheduling: true, error: null } }))
    try {
      const res = await fetch('/api/frekto/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandId,
          platform,
          topic: edit.topic,
          postType: edit.postType,
          scheduledAt: new Date(edit.scheduledAt).toISOString(),
        }),
      })
      const data = await res.json() as { outputUrl?: string; error?: string }
      if (!res.ok || data.error) {
        setStatuses(prev => ({ ...prev, [platform]: { ...prev[platform], scheduling: false, error: data.error ?? 'Failed to schedule.' } }))
        return
      }
      const scheduledAt = new Date(edit.scheduledAt).toISOString()
      setStatuses(prev => ({ ...prev, [platform]: { scheduling: false, scheduled: true, outputUrl: data.outputUrl ?? null, error: null } }))
      setLastPosts(prev => ({ ...prev, [platform]: { scheduledAt, status: 'scheduled', outputUrl: data.outputUrl ?? null } }))
    } catch {
      setStatuses(prev => ({ ...prev, [platform]: { ...prev[platform], scheduling: false, error: 'Network error.' } }))
    }
  }

  const updateEdit = (platform: string, patch: Partial<SchedEdit>) => {
    setEdits(prev => ({ ...prev, [platform]: { ...prev[platform], ...patch } }))
  }

  const cardStyle: React.CSSProperties = {
    marginTop: '24px',
    background: 'var(--card)',
    border: '1px solid var(--line)',
    borderRadius: '12px',
    padding: '20px 24px',
  }

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
          Smart Scheduler
        </span>
        {!connected && (
          <a href="/settings" style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--line)', color: 'var(--gold)', textDecoration: 'none' }}>
            Connect Frekto to schedule
          </a>
        )}
      </div>
      <p style={{ fontSize: '12px', color: 'var(--text-faint)', marginBottom: '16px', lineHeight: 1.5 }}>
        Analyzes your brand and audit findings to suggest what to post, where, and when — then generates and schedules content via Frekto.
      </p>

      {!connected ? (
        <a href="/settings" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 16px', borderRadius: '7px', border: '1px solid var(--green)', color: 'var(--green-bright)', fontSize: '12px', fontWeight: 600, textDecoration: 'none' }}>
          Go to Settings → Integrations
        </a>
      ) : (
        <>
          <button
            onClick={handleGenerate}
            disabled={generating}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '7px',
              padding: '8px 20px', borderRadius: '7px', fontSize: '12.5px', fontWeight: 600,
              cursor: generating ? 'not-allowed' : 'pointer', border: 'none',
              background: generating ? 'rgba(47,191,113,0.25)' : 'var(--green)',
              color: generating ? 'var(--text-dim)' : '#ffffff',
              transition: 'all 0.15s', marginBottom: '16px',
            }}
          >
            {generating ? (
              <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{animation:'md-spin .7s linear infinite',flexShrink:0,verticalAlign:'middle'}}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.35"/><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>Analyzing brand…</>
            ) : (
              <>{hasGenerated ? 'Regenerate ideas' : 'Generate post ideas'}</>
            )}
          </button>

          {genError && <p style={{ fontSize: '12px', color: '#ef4444', marginBottom: '12px' }}>{genError}</p>}

          {hasGenerated && (
            <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '8px' }}>
              {SCHED_PLATFORMS.map(({ key, label, color }) => {
                const edit = edits[key]
                const status = statuses[key]
                const last = lastPosts[key]
                if (!edit) return null

                const isDimmed = !edit.shouldPost && !status?.scheduled

                return (
                  <div
                    key={key}
                    style={{
                      minWidth: '260px', maxWidth: '260px',
                      background: 'var(--bg)', border: `1px solid ${isDimmed ? 'var(--line)' : color + '44'}`,
                      borderRadius: '10px', padding: '14px',
                      opacity: isDimmed ? 0.6 : 1, flexShrink: 0,
                    }}
                  >
                    {/* Platform header */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 700, color, letterSpacing: '0.02em' }}>{label}</span>
                      {!edit.shouldPost && !status?.scheduled && (
                        <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-faint)' }}>
                          Not recommended
                        </span>
                      )}
                      {status?.scheduled && (
                        <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(47,191,113,0.15)', color: 'var(--green)', border: '1px solid rgba(47,191,113,0.3)' }}>
                          Scheduled
                        </span>
                      )}
                    </div>

                    {/* Last post / next due */}
                    {last && (
                      <p style={{ fontSize: '10px', color: 'var(--text-faint)', marginBottom: '10px' }}>
                        Last: {new Date(last.scheduledAt).toLocaleDateString()} · Next due: {getNextDue(last.scheduledAt, key)}
                      </p>
                    )}

                    {/* Reason */}
                    <p style={{ fontSize: '11px', color: 'var(--text-faint)', marginBottom: '10px', lineHeight: 1.45, fontStyle: 'italic' }}>
                      {edit.reason}
                    </p>

                    {status?.scheduled ? (
                      /* Scheduled state */
                      <div>
                        {status.outputUrl && (
                          <div style={{ marginBottom: '8px' }}>
                            {edit.postType === 'video' ? (
                              <video src={status.outputUrl} controls style={{ width: '100%', borderRadius: '6px', maxHeight: '160px' }} />
                            ) : (
                              <img src={status.outputUrl} alt="Generated post" style={{ width: '100%', borderRadius: '6px', maxHeight: '160px', objectFit: 'cover' }} />
                            )}
                          </div>
                        )}
                        <a
                          href={status.outputUrl ?? '#'}
                          target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: '11px', color: 'var(--green)', textDecoration: 'none' }}
                        >
                          Download
                        </a>
                      </div>
                    ) : (
                      /* Editable state */
                      <>
                        {/* Topic */}
                        <textarea
                          value={edit.topic}
                          onChange={e => updateEdit(key, { topic: e.target.value.slice(0, 300) })}
                          rows={3}
                          style={{
                            width: '100%', padding: '8px 10px', borderRadius: '6px',
                            border: '1px solid var(--line)', background: 'var(--input)',
                            color: 'var(--text)', fontSize: '11.5px', lineHeight: 1.5,
                            resize: 'vertical', outline: 'none', fontFamily: 'inherit',
                            boxSizing: 'border-box', marginBottom: '8px',
                          }}
                        />

                        {/* Post type toggle */}
                        <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
                          {(['image', 'video'] as const).map(pt => (
                            <button
                              key={pt}
                              onClick={() => updateEdit(key, { postType: pt })}
                              style={{
                                padding: '3px 10px', borderRadius: '5px', fontSize: '11px', fontWeight: 500,
                                cursor: 'pointer', border: '1px solid',
                                borderColor: edit.postType === pt ? color : 'var(--line)',
                                background: edit.postType === pt ? color + '22' : 'transparent',
                                color: edit.postType === pt ? color : 'var(--text-dim)',
                              }}
                            >
                              {pt.charAt(0).toUpperCase() + pt.slice(1)}
                            </button>
                          ))}
                        </div>

                        {/* Schedule datetime */}
                        <input
                          type="datetime-local"
                          value={edit.scheduledAt}
                          onChange={e => updateEdit(key, { scheduledAt: e.target.value })}
                          style={{
                            width: '100%', padding: '6px 8px', borderRadius: '6px',
                            border: '1px solid var(--line)', background: 'var(--input)',
                            color: 'var(--text)', fontSize: '11px', outline: 'none',
                            boxSizing: 'border-box', marginBottom: '10px',
                          }}
                        />

                        {status?.error && (
                          <p style={{ fontSize: '11px', color: '#ef4444', marginBottom: '8px' }}>{status.error}</p>
                        )}

                        {/* Schedule button */}
                        <button
                          onClick={() => handleSchedule(key)}
                          disabled={status?.scheduling || !edit.topic.trim()}
                          style={{
                            width: '100%', padding: '7px 0', borderRadius: '6px',
                            fontSize: '11.5px', fontWeight: 600, cursor: status?.scheduling || !edit.topic.trim() ? 'not-allowed' : 'pointer',
                            border: `1px solid ${color}`,
                            background: status?.scheduling ? 'transparent' : color + '22',
                            color: status?.scheduling ? 'var(--text-dim)' : color,
                            transition: 'all 0.15s',
                          }}
                        >
                          {status?.scheduling ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" style={{animation:'md-spin .7s linear infinite',flexShrink:0,verticalAlign:'middle'}}><circle cx="12" cy="12" r="9" stroke={color} strokeWidth="3" strokeOpacity="0.35"/><path d="M12 3a9 9 0 0 1 9 9" stroke={color} strokeWidth="3" strokeLinecap="round"/></svg>
                              Scheduling…
                            </span>
                          ) : 'Schedule via Frekto'}
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

// ── Fix Plan Modal ─────────────────────────────────────────────────────────────

function FixPlanModal({
  initialPlan,
  applying,
  onCancel,
  onConfirm,
}: {
  itemId: string
  slug: string
  initialPlan: FixPlan
  applying: boolean
  onCancel: () => void
  onConfirm: (plan: FixPlan) => void
}) {
  const [filesToRead, setFilesToRead] = useState<string[]>(initialPlan.files_to_read)
  const [filesToCreate, setFilesToCreate] = useState<string[]>(initialPlan.files_to_create)
  const [changes, setChanges] = useState<{ path: string; what: string }[]>(initialPlan.changes)

  const updateReadFile = (i: number, val: string) =>
    setFilesToRead((prev) => prev.map((f, idx) => (idx === i ? val : f)))
  const removeReadFile = (i: number) =>
    setFilesToRead((prev) => prev.filter((_, idx) => idx !== i))

  const updateCreateFile = (i: number, val: string) =>
    setFilesToCreate((prev) => prev.map((f, idx) => (idx === i ? val : f)))
  const removeCreateFile = (i: number) =>
    setFilesToCreate((prev) => prev.filter((_, idx) => idx !== i))

  const updateChangeWhat = (i: number, val: string) =>
    setChanges((prev) => prev.map((c, idx) => (idx === i ? { ...c, what: val } : c)))

  const handleConfirm = () => {
    onConfirm({
      files_to_read: filesToRead.filter(Boolean),
      files_to_create: filesToCreate.filter(Boolean),
      changes,
    })
  }

  return (
    <div className="fp-overlay" onClick={onCancel}>
      <div className="fp-modal" onClick={(e) => e.stopPropagation()}>
        <p className="fp-title">Review fix plan</p>
        <p className="fp-subtitle">Claude will make these changes to your repo. Edit before applying.</p>

        <div className="fp-section">
          <span className="fp-section-label">Files to read</span>
          {filesToRead.length === 0 && <span className="fp-empty">none</span>}
          {filesToRead.map((f, i) => (
            <div key={i} className="fp-file-row">
              <input
                className="fp-file-input"
                value={f}
                onChange={(e) => updateReadFile(i, e.target.value)}
              />
              <button className="fp-remove-btn" onClick={() => removeReadFile(i)}>×</button>
            </div>
          ))}
          <button className="fp-add-btn" onClick={() => setFilesToRead((p) => [...p, ''])}>+ Add file</button>
        </div>

        <div className="fp-section">
          <span className="fp-section-label">Files to create</span>
          {filesToCreate.length === 0 && <span className="fp-empty">none</span>}
          {filesToCreate.map((f, i) => (
            <div key={i} className="fp-file-row">
              <input
                className="fp-file-input"
                value={f}
                onChange={(e) => updateCreateFile(i, e.target.value)}
              />
              <button className="fp-remove-btn" onClick={() => removeCreateFile(i)}>×</button>
            </div>
          ))}
          <button className="fp-add-btn" onClick={() => setFilesToCreate((p) => [...p, ''])}>+ Add file</button>
        </div>

        <div className="fp-section">
          <span className="fp-section-label">Changes</span>
          {changes.length === 0 && <span className="fp-empty">none</span>}
          {changes.map((c, i) => (
            <div key={i} className="fp-change-row">
              <span className="fp-change-path">{c.path}</span>
              <input
                className="fp-change-input"
                value={c.what}
                onChange={(e) => updateChangeWhat(i, e.target.value)}
              />
            </div>
          ))}
        </div>

        <div className="fp-actions">
          <button className="fp-btn-cancel" onClick={onCancel}>Cancel</button>
          <button className="fp-btn-apply" disabled={applying} onClick={handleConfirm}>
            {applying ? 'Applying…' : 'Apply Fix'}
          </button>
        </div>
      </div>
    </div>
  )
}
