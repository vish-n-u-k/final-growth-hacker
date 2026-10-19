'use client'

import { Fragment, useState, useCallback, useEffect, useRef, useMemo, JSX } from 'react'
import ArrowIcon from '@/components/ArrowIcon'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRoadmap } from '@/components/RoadmapContext'
import { progressColor as ringColor, GROWTH_PHASES } from '@/lib/modules/roadmap'
import Link from 'next/link'
import { type ModuleDefinition, type ModuleCategoryDefinition, type ModuleItemDefinition, type DBItemFull, type DynamicModuleCategoryDefinition, isNotChecked, isDynamicIdea } from '@/lib/modules/types'
import ExportPrepModal from '@/components/ExportPrepModal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import ComingSoon from '@/components/ComingSoon'
import { type DBItemState } from './ModuleDashboard'
import SocialProfilesOverview from './SocialProfilesOverview'
import BrandBasisOverview from './BrandBasisOverview'
import ContentPagesOverview from './ContentPagesOverview'
import { CONTENT_SUMMARY_SLUG, type ContentOverview } from '@/lib/modules/content-audit/summary'
import { BRAND_SUMMARY_SLUG, type BrandBasis } from '@/lib/modules/brand-audit/summary'
import { SOCIAL_SUMMARY_SLUG, type SocialProfileSummary } from '@/lib/modules/social-media/summary'
import { INTEGRATION_MAP, type IntegrationDefinition } from '@/lib/integrations/registry'
import { PLAYBOOK_SECTIONS } from '@/lib/playbook/fields'
import { CONFLICT_GROUPS, SLUG_TOPIC } from '@/lib/modules/conflict-map'
import GmailOutreachProspects from '@/components/GmailOutreachProspects'
import NotesDrawer from '@/components/NotesDrawer'
import { useClaudeHandoff, repoLine } from '@/components/useClaudeHandoff'
import { JOURNEY_PHASES } from '@/lib/journey'
import ElementEvidence, { isElementEvidence, describeElements } from '@/components/ElementEvidence'
import PagePreview from '@/components/PagePreview'
import { isPagePreview } from '@/lib/audit/page-preview'
import { connectUrl } from '@/lib/integrations/connect-url'
import { Spinner } from '@/components/ui/spinner'

function renderMdStep(step: string): React.ReactNode {
  const parts = step.split(/(\[[^\]]+\]\([^)]+\))/g)
  if (parts.length === 1) return step
  return parts.map((part, i) => {
    const m = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (m) return <a key={i} href={m[2]} target="_blank" rel="noopener noreferrer" className="st-guide-link">{m[1]}</a>
    return part
  })
}

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

// Result of an analysis — returned by POST /api/modules/analyze (sync) and by its GET poll once done.
interface AnalysisPayload {
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
    exportType: string | null; choiceOptions: string[] | null; userChoice: string | null
  }>
  categories: Array<{ id: string; slug: string }>
  pageVerdicts?: ModuleData['pageVerdicts']
}

interface Props {
  brand: { id: string; name: string; keywords?: string; websiteUrl?: string; logoUrl?: string; themeColor?: string; playbook?: Record<string, string> | null }
  allModulesData: ModuleData[]
  pendingModuleIds?: string[]
  userEmail: string
  isAdmin?: boolean // GrowJin team: shows internal tools like Notes
  githubConnected: boolean
  githubRepo?: string | null
  mcpLastUsedAt?: string | null
  connectedIntegrations: Record<string, boolean>
  socialLinks: Record<string, string>
  conflictLinks?: { itemIdA: string; itemIdB: string }[]
  // Free/Pro (lib/billing/plan.ts). Billing off → { enabled: false, pro: true, planLocked: [] }.
  billing?: { enabled: boolean; pro: boolean; planLocked: string[] }
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never analysed'
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return 'Just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// A check counts once it has been run: checks added to a module after its last analysis don't
// lower the score until the next one (a module never analysed has no states, so everything counts).
// Checks that couldn't run this time ("Couldn't check…") count as neither passed nor failed.
const counts = (slug: string, states: Record<string, DBItemState>) => (!!states[slug] || Object.keys(states).length === 0) && !isNotChecked(states[slug]?.aiDetail)

function getCatStats(cat: ModuleCategoryDefinition, states: Record<string, DBItemState>) {
  const allItems = cat.subCategories.flatMap((s) => s.items)
  // Insights (ideas, not pass/fail checks) never count toward scores or issue counts
  const items = allItems.filter((i) => !i.insight && !states[i.slug]?.userSkipped && counts(i.slug, states))
  const totalWeight = items.reduce((sum, i) => sum + i.weight, 0)
  const aiWeight = items.filter((i) => states[i.slug]?.aiVerified).reduce((sum, i) => sum + i.weight, 0)
  const doneWeight = items.filter((i) => states[i.slug]?.aiVerified || states[i.slug]?.userChecked).reduce((sum, i) => sum + i.weight, 0)
  const done = items.filter((i) => states[i.slug]?.aiVerified || states[i.slug]?.userChecked).length
  return { total: items.length, done, totalWeight, doneWeight, aiWeight, pct: totalWeight ? Math.round((doneWeight / totalWeight) * 100) : 0 }
}

function getOverall(def: ModuleDefinition, states: Record<string, DBItemState>) {
  const allItems = (def.categories as ModuleCategoryDefinition[]).flatMap((c) => c.subCategories.flatMap((s) => s.items))
  const items = allItems.filter((i) => !i.insight && !states[i.slug]?.userSkipped && counts(i.slug, states))
  const totalWeight = items.reduce((sum, i) => sum + i.weight, 0)
  const doneWeight = items.filter((i) => states[i.slug]?.aiVerified || states[i.slug]?.userChecked).reduce((sum, i) => sum + i.weight, 0)
  return { pct: totalWeight ? Math.round((doneWeight / totalWeight) * 100) : 0 }
}

// Dynamic modules: items that count as checks (not ideas, not "Couldn't check")
const dynCounts = (def: ModuleDefinition, i: DBItemFull) => !isDynamicIdea(def, i.categorySlug) && !isNotChecked(i.aiDetail)

function computeLiveScore(modData: ModuleData, states: Record<string, DBItemState>, dynItems: DBItemFull[]): number {
  if (modData.definition.dynamic) {
    const active = dynItems.filter(i => !i.userSkipped && dynCounts(modData.definition, i))
    const totalWeight = active.reduce((s, i) => s + i.weight, 0)
    const doneWeight = active.filter(i => i.aiVerified || i.userChecked).reduce((s, i) => s + i.weight, 0)
    return totalWeight ? Math.round((doneWeight / totalWeight) * 100) : 0
  }
  return getOverall(modData.definition, states).pct
}

function getDynamicCatStats(def: ModuleDefinition, categorySlug: string, items: DBItemFull[]) {
  const catItems = items.filter((i) => i.categorySlug === categorySlug && !i.userSkipped && dynCounts(def, i))
  const totalWeight = catItems.reduce((s, i) => s + i.weight, 0)
  const aiWeight = catItems.filter((i) => i.aiVerified).reduce((s, i) => s + i.weight, 0)
  const doneWeight = catItems.filter((i) => i.aiVerified || i.userChecked).reduce((s, i) => s + i.weight, 0)
  const done = catItems.filter((i) => i.aiVerified || i.userChecked).length
  return { total: catItems.length, done, totalWeight, doneWeight, aiWeight, pct: totalWeight ? Math.round((doneWeight / totalWeight) * 100) : 0 }
}

// One audit category as the list and the detail panel need it.
type CatRow = {
  slug: string
  label: string
  stats: { total: number; done: number; pct: number }
  ideas: number // insight items with results (shown as ideas, not counted as checks)
  soon: boolean
  body: React.ReactNode
}

// A category "needs attention" while it still has open items; otherwise it is passing.
function catNeedsAttention(stats: { total: number; done: number }) {
  return stats.total > 0 && stats.done < stats.total
}

// Summary for the module header: which areas still need work, how many pass, and the single
// open item worth doing first (highest weight). Read-only: it only looks at the data the cards already use.
function summarizeCats(def: ModuleDefinition, states: Record<string, DBItemState>, dynItems: DBItemFull[]) {
  let needs = 0
  let pass = 0
  let openItems = 0
  // label: what the item shows as its title (the finding, e.g. "No customer quotes"); action: its first step
  let first: { catSlug: string; catLabel: string; catPct: number; itemSlug: string; label: string; action: string; weight: number } | null = null
  for (const cat of def.categories as (ModuleCategoryDefinition | DynamicModuleCategoryDefinition)[]) {
    if (cat.slug === 'next-campaign' || (cat as DynamicModuleCategoryDefinition).comingSoon) continue
    let open: { slug: string; label: string; action: string; weight: number }[]
    let stats: { total: number; done: number; pct: number }
    if (def.dynamic) {
      stats = getDynamicCatStats(def, cat.slug, dynItems)
      open = dynItems
        .filter(i => i.categorySlug === cat.slug && dynCounts(def, i) && !i.userSkipped && !i.aiVerified && !i.userChecked)
        .map(i => ({ slug: i.slug, label: i.aiHighlight || i.label, action: i.aiAction ?? '', weight: i.weight }))
    } else {
      stats = getCatStats(cat as ModuleCategoryDefinition, states)
      open = (cat as ModuleCategoryDefinition).subCategories
        .flatMap(sub => sub.items)
        .filter(i => !i.insight && counts(i.slug, states) && !states[i.slug]?.userSkipped && !states[i.slug]?.aiVerified && !states[i.slug]?.userChecked)
        .map(i => ({ slug: i.slug, label: states[i.slug]?.aiHighlight || i.label, action: states[i.slug]?.aiAction ?? '', weight: i.weight }))
    }
    if (catNeedsAttention(stats)) needs++
    else if (stats.total > 0) pass++
    openItems += open.length
    for (const it of open) {
      if (!first || it.weight > first.weight) first = { catSlug: cat.slug, catLabel: cat.label, catPct: stats.pct, itemSlug: it.slug, label: it.label, action: it.action, weight: it.weight }
    }
  }
  return { needs, pass, openItems, first }
}

/** "Add 2–3 quotes… Then link…" → "Add 2–3 quotes…", without markdown bold. */
function firstSentence(text: string): string {
  const plain = text.replace(/\*\*/g, '').trim()
  const m = /^.+?[.!?](?=\s+[A-Z"“(]|$)/.exec(plain) // "e.g. how" doesn't end the sentence
  const one = (m ? m[0] : plain)
  return one.length > 160 ? `${one.slice(0, 157).replace(/\s+\S*$/, '')}…` : one
}

function renderMd(text: string, color: string) {
  const lines = text.split('\n')
  const out: React.ReactNode[] = []

  function inlineFormat(s: string): React.ReactNode[] {
    const parts: React.ReactNode[] = []
    let rest = s
    let key = 0
    while (rest.length) {
      const bold = rest.match(/\*\*(.+?)\*\*/)
      const italic = rest.match(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/)
      const candidates = [bold, italic].filter(Boolean) as RegExpMatchArray[]
      if (!candidates.length) { parts.push(rest); break }
      const first = candidates.reduce((a, b) => (a.index! <= b.index! ? a : b))
      if (first.index! > 0) parts.push(rest.slice(0, first.index))
      if (first === bold) parts.push(<strong key={key++} style={{ color, fontWeight: 700 }}>{first[1]}</strong>)
      else parts.push(<em key={key++}>{first[1]}</em>)
      rest = rest.slice(first.index! + first[0].length)
    }
    return parts
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()
    if (!line) { i++; continue }

    // Numbered list block
    if (/^\d+\./.test(line)) {
      const items: React.ReactNode[] = []
      while (i < lines.length && /^\d+\./.test(lines[i].trim())) {
        const content = lines[i].trim().replace(/^\d+\.\s*/, '')
        items.push(<li key={i} style={{ marginBottom: '6px' }}>{inlineFormat(content)}</li>)
        i++
      }
      out.push(<ol key={i} style={{ paddingLeft: '18px', margin: '8px 0', color }}>{items}</ol>)
      continue
    }

    // Bullet list block
    if (/^[-•]/.test(line)) {
      const items: React.ReactNode[] = []
      while (i < lines.length && /^[-•]/.test(lines[i].trim())) {
        const content = lines[i].trim().replace(/^[-•]\s*/, '')
        items.push(<li key={i} style={{ marginBottom: '6px' }}>{inlineFormat(content)}</li>)
        i++
      }
      out.push(<ul key={i} style={{ paddingLeft: '18px', margin: '8px 0', color }}>{items}</ul>)
      continue
    }

    out.push(<p key={i} style={{ margin: '0 0 10px', color, lineHeight: 1.8 }}>{inlineFormat(line)}</p>)
    i++
  }
  return <div style={{ fontSize: '14.5px' }}>{out}</div>
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
        {saving ? <><Spinner />Connecting…</> : `Connect ${intDef.name}`}
      </button>
    </form>
  )
}


function SparkleIcon({ size = 12, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ display: 'inline-block', verticalAlign: 'middle', ...style }}>
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    </svg>
  )
}

function LevelRing({ score, pending = false }: { score: number; pending?: boolean }) {
  const r = 20
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - Math.max(score, 0) / 100)
  const color = pending ? 'var(--text-faint)' : ringColor(score)
  return (
    <svg width="100%" height="100%" viewBox="0 0 46 46" style={{ display: 'block' }}>
      <circle
        cx="23" cy="23" r={r} fill="none"
        strokeWidth="4" strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={score === 0 ? circ : offset}
        style={{ stroke: color, transform: 'rotate(-90deg)', transformOrigin: '23px 23px', transition: 'stroke-dashoffset .5s ease' }}
      />
      <text
        x="23" y="23" textAnchor="middle" dominantBaseline="central"
        style={{ fill: color, fontSize: '12px', fontWeight: 800, fontFamily: 'inherit', letterSpacing: '-0.5px' }}
      >
        {pending ? '—' : `${score}%`}
      </text>
    </svg>
  )
}

const BILLING_OFF = { enabled: false, pro: true, planLocked: [] as string[] }

export default function AllModulesDashboard({ brand, allModulesData, pendingModuleIds = [], isAdmin = false, githubConnected, githubRepo = null, mcpLastUsedAt = null, connectedIntegrations, conflictLinks = [], billing = BILLING_OFF }: Props) {
  const isPlanLocked = (m: Pick<ModuleData, 'type'>) => billing.planLocked.includes(m.type)
  const [notesOpen, setNotesOpen] = useState(false)
  const [statesMap, setStatesMap] = useState<Record<string, Record<string, DBItemState>>>(() =>
    Object.fromEntries(allModulesData.map(m => [m.id, m.itemStates]))
  )
  const [dynItemsMap, setDynItemsMap] = useState<Record<string, DBItemFull[]>>(() =>
    Object.fromEntries(allModulesData.map(m => [m.id, m.fullItems]))
  )

  // itemId → module info (for resolving conflict link IDs back to module+slug context)
  const itemIdInfoMap = useMemo(() => {
    const map = new Map<string, { moduleId: string; moduleType: string; moduleName: string; slug: string }>()
    for (const mod of allModulesData) {
      if (mod.definition.dynamic) {
        for (const item of mod.fullItems) {
          map.set(item.id, { moduleId: mod.id, moduleType: mod.type, moduleName: mod.name, slug: item.slug })
        }
      } else {
        for (const [slug, state] of Object.entries(mod.itemStates)) {
          if (state.id) map.set(state.id, { moduleId: mod.id, moduleType: mod.type, moduleName: mod.name, slug })
        }
      }
    }
    return map
  }, [allModulesData])

  const searchParams = useSearchParams()
  const roadmap = useRoadmap()
  const [openModules, setOpenModules] = useState<Set<string>>(() => {
    // Linked from the sidebar roadmap while on another page: open that module.
    const wanted = searchParams.get('module')
    const linked = wanted ? allModulesData.find(m => m.type === wanted) : undefined
    if (linked) return new Set([linked.id])
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
    Object.fromEntries(allModulesData.map(m => [m.id, new Set<string>()]))
  )
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())
  // Phones and tablets show the category list as an accordion and fold the 'Passing' group away.
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1000px)')
    const update = () => setNarrow(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  const [passOpenMap, setPassOpenMap] = useState<Record<string, boolean>>({})
  const [verifyingItems, setVerifyingItems] = useState<Set<string>>(new Set())
  const [applyingFix, setApplyingFix] = useState<Set<string>>(new Set())
  const [reanalyzingMap, setReanalyzingMap] = useState<Record<string, boolean>>({})
  const [requestedMap, setRequestedMap] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(pendingModuleIds.map(id => [id, true]))
  )
  const [showRequestedModal, setShowRequestedModal] = useState(false)
  const [lastAnalyzedAtMap, setLastAnalyzedAtMap] = useState<Record<string, string | null>>({})
  const [pageVerdictsMap, setPageVerdictsMap] = useState<Record<string, ModuleData['pageVerdicts']>>(() =>
    Object.fromEntries(allModulesData.map(m => [m.id, m.pageVerdicts]))
  )
  const [reqValuesMap, setReqValuesMap] = useState<Record<string, Record<string, string>>>(() => {
    const map = Object.fromEntries(allModulesData.map(m => [m.id, m.requirements]))
    return map
  })

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
  const [conflictModal, setConflictModal] = useState<{
    modId: string; slug: string; itemId: string; isDynamic: boolean; itemLabel: string
    conflicts: { topic: string; moduleName: string; aiActions: string[] }[]
  } | null>(null)

  // Playbook state (Foundation module only)
  const [playbookData, setPlaybookData] = useState<Record<string, string> | null>(brand.playbook ?? null)
  const [playbookOpen, setPlaybookOpen] = useState(false)
  // Pick up a playbook generated after load (Foundation's first run refreshes server props)
  useEffect(() => {
    if (brand.playbook && !playbookData) setPlaybookData(brand.playbook)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand.playbook])
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
  const handoff = useClaudeHandoff({ mcpLastUsedAt, githubRepo })
  const [prUrlMap, setPrUrlMap] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(allModulesData.map(m => [m.id, m.agentPrUrl]))
  )
  const [userCount, setUserCount] = useState(0)
  const [posthogLoading, setPosthogLoading] = useState(false)
  const [posthogDataStartDate, setPosthogDataStartDate] = useState<string | null>(null)
  const [stageModalOpen, setStageModalOpen] = useState(false)
  const [stageModalTab, setStageModalTab] = useState(0)
  const [competitorPanelOpen, setCompetitorPanelOpen] = useState(false)
  const [exportPrepOpen, setExportPrepOpen] = useState(false)
  const [exportPrepModuleId, setExportPrepModuleId] = useState<string | null>(null)
  // When set, the export covers just this one issue (its slug) instead of the whole module.
  const [exportPrepSlug, setExportPrepSlug] = useState<string | null>(null)
  const [exportingMap, setExportingMap] = useState<Record<string, boolean>>({})
  const [resolvedBsModId, setResolvedBsModId] = useState<string | null>(
    () => allModulesData.find((m) => m.type === 'business-stage')?.id ?? null,
  )
  const [ensuringBs, setEnsuringBs] = useState(false)
  const autoAnalysisTriggered = useRef(false)

  useEffect(() => {
    if (!connectedIntegrations['posthog']) {
      // PostHog not connected — use manually entered count from localStorage
      try {
        const saved = localStorage.getItem('gh_user_count')
        if (saved) setUserCount(parseInt(saved, 10))
      } catch {}
      return
    }
    // Seed from cache immediately so we never flash 0 while loading
    const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
    let skipFetch = false
    try {
      const cached = localStorage.getItem('gh_posthog_count_cache')
      const cachedTs = localStorage.getItem('gh_posthog_count_cache_ts')
      if (cached) {
        setUserCount(parseInt(cached, 10))
        if (cachedTs && Date.now() - parseInt(cachedTs, 10) < CACHE_TTL) {
          skipFetch = true
        }
      }
    } catch {}

    if (skipFetch) return

    setPosthogLoading(true)
    fetch('/api/posthog/user-count')
      .then((r) => r.json())
      .then((d: { count?: number; dataStartDate?: string | null }) => {
        // Only trust a non-zero live count — if PostHog returns 0 keep the cache
        if (d.count) {
          setUserCount(d.count)
          try {
            localStorage.setItem('gh_posthog_count_cache', String(d.count))
            localStorage.setItem('gh_posthog_count_cache_ts', String(Date.now()))
          } catch {}
        }
        if (d.dataStartDate) setPosthogDataStartDate(d.dataStartDate)
      })
      .catch(() => {})
      .finally(() => setPosthogLoading(false))
  }, [])

  const router = useRouter()

  // Compute lock state dynamically: a module is locked if its previous module (by order) scored < 80%.
  // Foundation (order 0) is always unlocked. This works for all users regardless of DB status.
  const sortedByOrder = [...allModulesData].filter(m => m.status !== 'not-applicable').sort((a, b) => {
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
    const prev = [...sortedByOrder].reverse().find(p => p.order < modData.order && !p.definition?.comingSoon)
    return !prev || liveScores[prev.id] < 80
  }


  // Growth Path layout: one module shown at a time, picked from the step rail.
  const railModules = sortedByOrder.filter(m => m.type !== 'business-stage')
  const currentStep = railModules.find(m => !isModuleLocked(m) && (liveScores[m.id] ?? 0) < 80) ?? railModules[railModules.length - 1]
  const selectedModule = railModules.find(m => openModules.has(m.id)) ?? currentStep
  const selectedIdx = selectedModule ? railModules.indexOf(selectedModule) : -1
  const isStepDone = (m: ModuleData) => !isModuleLocked(m) && !m.definition.comingSoon && (liveScores[m.id] ?? 0) >= 80
  const railDoneCount = railModules.filter(isStepDone).length

  // The sidebar roadmap picks a module through the shared context, and shows this page's live scores.
  const pickedModule = roadmap.pick
  useEffect(() => {
    if (!pickedModule) return
    const m = allModulesData.find(x => x.type === pickedModule.type)
    if (m) setOpenModules(new Set([m.id]))
  }, [pickedModule]) // eslint-disable-line react-hooks/exhaustive-deps
  const liveScoresKey = JSON.stringify(allModulesData.map(m => [m.type, liveScores[m.id]]))
  const setRoadmapLive = roadmap.setLive
  useEffect(() => {
    setRoadmapLive({
      selectedType: selectedModule?.type ?? null,
      scores: Object.fromEntries(allModulesData.map(m => [m.type, liveScores[m.id] ?? 0])),
      // The sidebar's lock icons follow this page, so ticking a module past 80% unlocks the next one there too.
      locked: allModulesData.filter(m => !m.definition?.comingSoon && isModuleLocked(m)).map(m => m.type),
    })
  }, [selectedModule?.type, liveScoresKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const currentPhaseIdx = Math.max(0, JOURNEY_PHASES.findIndex(p => userCount < p.max))
  const nextPhase = JOURNEY_PHASES[currentPhaseIdx + 1] ?? null

  const bsItemsAll = resolvedBsModId ? (dynItemsMap[resolvedBsModId] ?? []) : []
  const bsClassItem = bsItemsAll.find(i => i.categorySlug === 'classification')
    ?? bsItemsAll.find(i => i.categorySlug === 'business-classification')
  const bsConcernItem = bsItemsAll.find(i => i.categorySlug === 'concern')
    ?? bsItemsAll.find(i => i.categorySlug === 'stage-challenges')

  const toggleModule = (modId: string) => setOpenModules(new Set([modId]))

  // The category list picks one category at a time; its items show in the detail panel beside it.
  // On narrow screens tapping the open category closes it (stored as an empty slug), and opening one
  // scrolls it to the top so its items are in view.
  const selectCat = (modId: string, slug: string, currentSlug?: string) => {
    const closing = narrow && currentSlug === slug
    setOpenCatsMap(prev => ({ ...prev, [modId]: new Set([closing ? '' : slug]) }))
    if (narrow && !closing) {
      const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      window.setTimeout(() => {
        document.getElementById(`gp-cat-${modId}-${slug}`)?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' })
      }, 60)
    }
  }

  const toggleExpand = (modId: string, slug: string, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.md-cb')) return
    const key = `${modId}:${slug}`
    setExpandedItems(prev => prev.has(key) ? new Set() : new Set([key]))
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
            ...(prev[modId]?.[slug] ?? { id: itemId, aiDetail: null, aiHighlight: null, aiNarrative: null, aiAction: null, aiVerified: false, completedBy: null, fixable: false, fixInputKey: null, fixIntegrationProvider: null, userSkipped: false, userSkipReason: null, exportType: null, choiceOptions: null, userChoice: null }),
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
    const modType = allModulesData.find(m => m.id === modId)?.type
    if (modType && billing.planLocked.includes(modType)) { router.push('/pricing'); return }

    setSetupErrorMap(prev => ({ ...prev, [modId]: null }))
    setReanalyzingMap(prev => ({ ...prev, [modId]: true }))

    if (process.env.NEXT_PUBLIC_APP_ENV === 'production' && modType !== 'foundation') {
      const modName = allModulesData.find(m => m.id === modId)?.name ?? modId
      try {
        const res = await fetch('/api/request-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moduleId: modId, moduleName: modName }),
        })
        if (res.ok) {
          setRequestedMap(prev => ({ ...prev, [modId]: true }))
          setShowRequestedModal(true)
        } else {
          const data = await res.json().catch(() => ({}))
          setSetupErrorMap(prev => ({ ...prev, [modId]: (data as { error?: string }).error ?? 'Request failed. Please try again.' }))
        }
      } finally {
        setReanalyzingMap(prev => ({ ...prev, [modId]: false }))
      }
      return
    }

    try {
    const body: Record<string, unknown> = { moduleId: modId, background: true }
    const reqs = overrideReqs ?? reqValues
    const nonEmpty = Object.fromEntries(Object.entries(reqs).filter(([, v]) => typeof v === 'string' && (v as string).trim()))
    if (Object.keys(nonEmpty).length > 0) body.requirements = nonEmpty
    const res = await fetch('/api/modules/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.status === 202) {
      // Runs server-side in the background; poll until it lands (also joins a run already in flight).
      const { runId } = await res.json() as { runId: string | null }
      await pollAnalysis(modId, runId)
    } else if (res.ok) {
      applyAnalysisResult(modId, await res.json() as AnalysisPayload)
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

  // Polls a background analysis until it finishes, fails, or we give up. Network blips are
  // retried (phones drop requests when locked), and a tab coming back to the foreground
  // checks immediately instead of waiting out the interval.
  const pollingRef = useRef<Set<string>>(new Set())
  // Progress of running analyses, from the poll: server stage + when the run started.
  const [runInfoMap, setRunInfoMap] = useState<Record<string, { stage: string | null; startedAt: number }>>({})
  const [clock, setClock] = useState(() => Date.now())
  // "Foundation is ready" notice after a run finishes (also shown in the tab title).
  const [readyNotice, setReadyNotice] = useState<{ modId: string; name: string } | null>(null)
  const [focusModId, setFocusModId] = useState<string | null>(null)
  useEffect(() => {
    if (!readyNotice) return
    const t = setTimeout(() => setReadyNotice(null), 10_000)
    // The refresh after a finished run makes Next re-apply the page title; keep ours while the notice shows.
    const keep = setInterval(() => { document.title = `✓ ${readyNotice.name} is ready – GrowJin` }, 1000)
    return () => { clearTimeout(t); clearInterval(keep) }
  }, [readyNotice])
  const anyRunning = Object.values(reanalyzingMap).some(Boolean)
  useEffect(() => {
    if (!anyRunning) return
    const t = setInterval(() => setClock(Date.now()), 1000)
    return () => clearInterval(t)
  }, [anyRunning])
  // Start a local timer for any run the poll hasn't reported yet, and drop finished ones.
  useEffect(() => {
    setRunInfoMap(prev => {
      let changed = false
      const next = { ...prev }
      for (const [id, on] of Object.entries(reanalyzingMap)) {
        if (on && !next[id]) { next[id] = { stage: null, startedAt: Date.now() }; changed = true }
        if (!on && next[id]) { delete next[id]; changed = true }
      }
      return changed ? next : prev
    })
  }, [reanalyzingMap])
  const pollAnalysis = async (modId: string, runId: string | null) => {
    if (pollingRef.current.has(modId)) return
    pollingRef.current.add(modId)
    setReanalyzingMap(prev => ({ ...prev, [modId]: true }))
    const deadline = Date.now() + 7 * 60_000 // server marks a run dead after 5.5 min
    const waitOrWake = (ms: number) => new Promise<void>(resolve => {
      const done = () => { clearTimeout(t); document.removeEventListener('visibilitychange', onVis); resolve() }
      const onVis = () => { if (document.visibilityState === 'visible') done() }
      const t = setTimeout(done, ms)
      document.addEventListener('visibilitychange', onVis)
    })
    try {
      for (let attempt = 0; ; attempt++) {
        await waitOrWake(attempt === 0 ? 1500 : 3000)
        let data: (AnalysisPayload & { state?: string; error?: string }) | null = null
        try {
          const qs = new URLSearchParams({ moduleId: modId, ...(runId ? { runId } : {}) })
          const res = await fetch(`/api/modules/analyze?${qs}`, { cache: 'no-store' })
          if (res.ok) data = await res.json()
        } catch { /* transient — retry */ }
        if (data?.state === 'running') {
          const info = data as { stage?: string | null; startedAt?: string }
          setRunInfoMap(prev => ({ ...prev, [modId]: { stage: info.stage ?? null, startedAt: info.startedAt ? Date.parse(info.startedAt) : prev[modId]?.startedAt ?? Date.now() } }))
        }
        if (data?.state === 'done') {
          applyAnalysisResult(modId, data)
          setReadyNotice({ modId, name: allModulesData.find(m => m.id === modId)?.name ?? 'Your analysis' })
          return
        }
        if (data?.state === 'failed') {
          setSetupErrorMap(prev => ({ ...prev, [modId]: data?.error ?? 'Analysis failed. Please try again.' }))
          return
        }
        if (data?.state === 'idle') return
        if (Date.now() > deadline) {
          setSetupErrorMap(prev => ({ ...prev, [modId]: 'This is taking longer than usual. Refresh in a minute to see the results.' }))
          return
        }
      }
    } finally {
      pollingRef.current.delete(modId)
      setReanalyzingMap(prev => ({ ...prev, [modId]: false }))
      setRunInfoMap(prev => { const next = { ...prev }; delete next[modId]; return next })
    }
  }

  const applyAnalysisResult = (modId: string, data: AnalysisPayload) => {
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
        exportType: item.exportType ?? null,
        choiceOptions: item.choiceOptions ?? null,
        userChoice: item.userChoice ?? null,
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
          exportType: item.exportType ?? null,
          choiceOptions: item.choiceOptions ?? null,
          userChoice: item.userChoice ?? null,
          aiData: item.aiData ?? null,
        }
      }
      setStatesMap(prev => ({ ...prev, [modId]: itemStates }))
    }

    if (data.pageVerdicts) {
      setPageVerdictsMap(prev => ({ ...prev, [modId]: data.pageVerdicts! }))
    }

    setReanalyzingMap(prev => ({ ...prev, [modId]: false }))
    setSetupErrorMap(prev => ({ ...prev, [modId]: null }))
    // Foundation also saves the playbook, logo, theme colour and social links on the brand —
    // refresh server props so they show without a reload (client item state is kept).
    if (allModulesData.find(m => m.id === modId)?.type === 'foundation') router.refresh()
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
      await handleReanalyze(moduleId, { user_count: String(userCount) })
    } catch {
      setSetupErrorMap(prev => ({ ...prev, ['bs-ensure']: 'Network error. Please try again.' }))
    } finally {
      setEnsuringBs(false)
    }
  }

  // On load: auto-start Foundation for a brand that has never been analysed, and re-attach to
  // any analysis already running (started in another tab/device or before a reload). Starting
  // Foundation is safe to repeat — the server joins an in-flight run instead of starting another.
  useEffect(() => {
    if (autoAnalysisTriggered.current) return
    autoAnalysisTriggered.current = true
    const foundation = allModulesData.find(m => m.type === 'foundation')
    if (foundation && !foundation.lastAnalyzedAt && !isPlanLocked(foundation)) {
      handleReanalyze(foundation.id, foundation.requirements)
    }
    for (const m of allModulesData) {
      const startedAbove = m.id === foundation?.id && !foundation.lastAnalyzedAt
      if (m.status === 'analyzing' && !startedAbove) pollAnalysis(m.id, null)
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
          [slug]: { ...(prev[modId]?.[slug] ?? { id: itemId, aiDetail: null, aiHighlight: null, aiNarrative: null, aiAction: null, aiVerified: false, userChecked: false, completedBy: null, fixable: false, fixInputKey: null, fixIntegrationProvider: null, userSkipped: false, userSkipReason: null, exportType: null, choiceOptions: null, userChoice: null }), userSkipped: skipped, userSkipReason: skipped ? reason || null : null },
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

  // "Copy fix prompt": the finding and the steps as one message to paste into an AI assistant.
  const buildFixPrompt = (p: { label: string; found?: string | null; why?: string | null; action?: string | null; steps?: string[]; data?: unknown }) => {
    const clean = (t: string) => t.replace(/\*\*/g, '')
    const lines = [`Please fix this issue${brand.websiteUrl ? ` on ${brand.websiteUrl}` : ' on my website'}.`, repoLine(githubRepo), '', `Issue: ${clean(p.label)}`]
    if (p.found) lines.push(`What was found: ${clean(p.found)}`)
    if (p.why) lines.push(`Why it matters: ${clean(p.why)}`)
    if (p.action) lines.push(`What to do: ${clean(p.action)}`)
    if (isElementEvidence(p.data)) lines.push('', 'The elements (from Google Lighthouse, phone view):', ...describeElements(p.data))
    if (p.steps?.length) lines.push('', 'Steps:', ...p.steps.map((st, i) => `${i + 1}. ${clean(st).replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')}`))
    lines.push('', 'Make the change, then tell me exactly what you changed.')
    return lines.join('\n')
  }
  // "Fix with Claude": the GrowJin MCP route first (Claude fixes the check and ticks it off here)
  // or Claude Code with the plain prompt; see components/useClaudeHandoff.tsx.
  const buildMcpPrompt = (p: { modId: string; itemId?: string | null; slug: string; label: string; action?: string | null }) => {
    const mod = allModulesData.find(m => m.id === p.modId)
    const clean = (t: string) => t.replace(/\*\*/g, '')
    return [
      `Use the GrowJin connector to fix one check for ${brand.name}${brand.websiteUrl ? ` (${brand.websiteUrl})` : ''}.`,
      repoLine(githubRepo),
      '',
      `1. Call get_module_detail with module_type "${mod?.type ?? ''}" and find the check "${clean(p.label)}" (slug ${p.slug}).`,
      `2. Fix it.${p.action ? ` Suggested fix: ${clean(p.action)}` : ''} If it needs a change to my website code, make it, or give me the exact change to apply.`,
      `3. When it's fixed, call toggle_item with item_id "${p.itemId ?? ''}" and checked true so GrowJin marks it done.`,
    ].join('\n')
  }
  const fixWithClaude = (key: string, plain: string, ctx: { modId: string; itemId?: string | null; slug: string; label: string; action?: string | null }) => {
    handoff.start({ key, label: ctx.label.replace(/\*\*/g, ''), plain, mcp: buildMcpPrompt(ctx) })
  }

  // Jump to one open item: opens its category and expands it.
  const focusItem = (modId: string, catSlug: string, itemSlug: string) => {
    setOpenCatsMap(prev => ({ ...prev, [modId]: new Set([catSlug]) }))
    setExpandedItems(new Set([`${modId}:${itemSlug}`]))
    window.setTimeout(() => {
      document.querySelector('.gp-col .gp-detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 60)
  }

  // Linked to one check (?module=seo&item=title.length, e.g. from Today): open its category and expand it
  useEffect(() => {
    const itemSlug = searchParams.get('item')
    const mod = itemSlug ? allModulesData.find(m => m.type === searchParams.get('module')) : undefined
    if (!itemSlug || !mod) return
    const catSlug = mod.definition.dynamic
      ? mod.fullItems.find(i => i.slug === itemSlug)?.categorySlug
      : (mod.definition.categories as ModuleCategoryDefinition[]).find(c => c.subCategories.some(sc => sc.items.some(i => i.slug === itemSlug)))?.slug
    if (!catSlug) return
    focusItem(mod.id, catSlug, itemSlug)
    // Then bring the check itself into view once it has rendered expanded
    window.setTimeout(() => document.querySelector('.sm-item-expanded')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── Export Prep helpers ───────────────────────────────────────────────────────

  // Derive export type from a static item definition (mirrors server-side logic)
  const deriveExportType = (item: ModuleItemDefinition): 'auto' | 'needs_choice' | 'external' | null => {
    if (item.exportType) return item.exportType
    if (item.fixType === 'template') return 'auto'
    if (item.fixType === 'value' || item.fixType === 'patch') return 'needs_choice'
    if (item.fixable) return 'auto'
    if (item.assistedInput) return 'external'
    return null
  }

  const buildClaudeCodePrompt = (modData: ModuleData, skippedIds: Set<string> = new Set(), overrideClassifications?: Record<string, { exportType: 'auto' | 'needs_choice' | 'skip' }>): string => {
    const classifications = overrideClassifications ?? {}
    const states = statesMap[modData.id] ?? {}
    const dynItems = dynItemsMap[modData.id] ?? []
    const brandUrl = brand.websiteUrl ?? 'your website'

    // Part 1: structural/technical auto-fixes (no external data needed)
    const part1Items: { label: string; aiDetail: string; aiAction: string; fixGuide?: string[] }[] = []
    // Part 2: items requiring a real stat, citation, or external claim — Claude asks one at a time
    const part2Items: { label: string; aiDetail: string; aiAction: string }[] = []
    // Part 3 (skip): manual tasks the user does outside of code
    const skipItems: { label: string; aiAction: string }[] = []

    if (modData.definition.dynamic) {
      dynItems.filter(i => dynCounts(modData.definition, i) && !i.aiVerified && !i.userChecked && !i.userSkipped && (i.aiAction || i.aiDetail)).forEach(item => {
        if (skippedIds.has(item.id)) return
        const et = classifications[item.slug]?.exportType
        if (et === 'skip') {
          skipItems.push({ label: item.label, aiAction: item.aiAction ?? '' })
        } else if (et === 'needs_choice') {
          part2Items.push({ label: item.label, aiDetail: item.aiDetail ?? '', aiAction: item.aiAction ?? '' })
        } else if (item.aiAction) {
          part1Items.push({ label: item.label, aiDetail: item.aiDetail ?? '', aiAction: item.aiAction })
        }
      })
    } else {
      const allDefItems = (modData.definition.categories as ModuleCategoryDefinition[]).flatMap(c => c.subCategories.flatMap(s => s.items))
      allDefItems.forEach(defItem => {
        const s = states[defItem.slug]
        if (s?.aiVerified || s?.userChecked || s?.userSkipped) return
        if (!s?.aiAction && !s?.aiDetail) return
        if (s?.id && skippedIds.has(s.id)) return
        const et = classifications[defItem.slug]?.exportType
        if (et === 'skip') {
          skipItems.push({ label: defItem.label, aiAction: s?.aiAction ?? '' })
        } else if (et === 'needs_choice') {
          part2Items.push({ label: defItem.label, aiDetail: s?.aiDetail ?? '', aiAction: s?.aiAction ?? '' })
        } else if (s?.aiAction) {
          part1Items.push({ label: defItem.label, aiDetail: s?.aiDetail ?? '', aiAction: s?.aiAction, fixGuide: defItem.fixGuide })
        }
      })
    }

    const lines: string[] = []
    const slugName = brand.name.toLowerCase().replace(/\s+/g, '-')

    // YAML frontmatter
    lines.push('---')
    lines.push(`description: ${brand.name} growth fixes — structural auto-fixes, then Q&A for stats/citations, then a user checklist`)
    lines.push('argument-hint: (none)')
    lines.push('allowed-tools: Read, Edit, Write, Grep, Glob, Bash(git:*)')
    lines.push('---')
    lines.push('')

    // Title + Step 0 environment check
    lines.push(`# ${brand.name} — Growth fixes`)
    lines.push(`Website: ${brandUrl}`)
    lines.push('')
    const totalIssues = part1Items.length + part2Items.length + skipItems.length
    const fixableCount = part1Items.length + part2Items.length
    const fixSummary = fixableCount > 0 && skipItems.length > 0
      ? `${fixableCount} fixable directly in the codebase, ${skipItems.length} requiring off-page/off-code action`
      : fixableCount > 0
      ? `all ${totalIssues} fixable directly in the codebase`
      : `all ${totalIssues} requiring off-page/off-code action`
    lines.push('---')
    lines.push('')
    lines.push('## Step 0 — Environment check (do this first, silently, before anything else)')
    lines.push('')
    lines.push('Determine whether you currently have **working file-system and code tools** available (e.g. Read, Edit, Write, Grep, Glob, Bash or equivalent) **and** access to an actual local repository/codebase you can act on.')
    lines.push('')
    lines.push('**If YES** — you\'re running as an agentic coding assistant (e.g. Claude Code, Cursor, Windsurf) with real tool access and a repo is present:')
    lines.push('→ Proceed to Part 1 below and work through this file normally, one item at a time, exactly as written.')
    lines.push('')
    lines.push(`**If NO** — you\'re a conversational assistant in a chat interface with no file/code tools, or no repository is present, or you\'re otherwise unable to actually read/write files in a ${brand.name} codebase:`)
    lines.push('→ Do **not** attempt to implement any fixes, do not run the Part 1/2 questions, and do not claim any change was made. Instead, give a concise executive-style summary — not a step-by-step walkthrough — using this exact shape:')
    lines.push('')
    lines.push(`1. **One-line framing**: state that this is an action script meant to run inside an agentic coding tool (Claude Code, Cursor, Windsurf) connected to the real ${brand.name} repo, not something to execute in plain chat.`)
    lines.push(`2. **Executive summary** (2–3 sentences): GrowJin audited **${brand.name}** (${brandUrl}) and found **${totalIssues} issue${totalIssues === 1 ? '' : 's'}** worth fixing — ${fixSummary} — organized into sequential parts meant to be run one step at a time with user approval at each step.`)
    lines.push('3. **Grouped breakdown**, one line per item, short headers only — do not restate the full Issue/Fix prose:')
    if (part1Items.length > 0) lines.push(`   - Part 1 — ${part1Items.length} technical/structural fix${part1Items.length === 1 ? '' : 'es'} (in-code, yes/no approval per item): ${part1Items.map(i => i.label).join(', ')}`)
    if (part2Items.length > 0) lines.push(`   - Part 2 — ${part2Items.length} item${part2Items.length === 1 ? '' : 's'} needing real user-supplied data before writing (in-code, never invented): ${part2Items.map(i => i.label).join(', ')}`)
    lines.push('   - Part 3 — Skipped-items log (auto-generated if anything was skipped)')
    if (skipItems.length > 0) lines.push(`   - Part 4 — ${skipItems.length} off-page task${skipItems.length === 1 ? '' : 's'} for the user (can\'t be done in code): ${skipItems.map(i => i.label).join(', ')}`)
    lines.push('4. **Closing line**: one sentence pointing them to an agentic coding environment connected to the real repo if they want the fixes applied.')
    lines.push('5. Stop there — do not proceed to Parts 1–4. Keep the whole summary under ~200 words.')
    lines.push('')
    lines.push('**Example of what your output should look like:**')
    lines.push('')
    lines.push('---')
    lines.push('')
    lines.push(`*This file is a growth fix script built for Claude Code — it\'s not meant to be executed in a chat interface.*`)
    lines.push('')
    lines.push(`GrowJin audited **${brand.name}** (${brandUrl}) and found **${totalIssues} issue${totalIssues === 1 ? '' : 's'}** worth addressing.${fixableCount > 0 ? ` ${fixableCount} can be fixed directly in the codebase${skipItems.length > 0 ? ` and ${skipItems.length} require off-page action` : ''}.` : ` All require off-page action.`} The fixes are organized into sequential parts and run one at a time — nothing changes without your approval.`)
    lines.push('')
    lines.push('**What\'s in this file:**')
    if (part1Items.length > 0) lines.push(`- **Part 1** — ${part1Items.length} technical fix${part1Items.length === 1 ? '' : 'es'} (in-code, you approve each one): ${part1Items.map(i => i.label).join(' · ')}`)
    if (part2Items.length > 0) lines.push(`- **Part 2** — ${part2Items.length} item${part2Items.length === 1 ? '' : 's'} that need real data from you before anything is written: ${part2Items.map(i => i.label).join(' · ')}`)
    lines.push('- **Part 3** — Skipped-items log (auto-created if you skip anything)')
    if (skipItems.length > 0) lines.push(`- **Part 4** — ${skipItems.length} task${skipItems.length === 1 ? '' : 's'} to do outside of code: ${skipItems.map(i => i.label).join(' · ')}`)
    lines.push('')
    lines.push(`*To apply these fixes, drop this file into Claude Code, Cursor, or Windsurf connected to the ${brand.name} codebase.*`)
    lines.push('')
    lines.push('---')
    lines.push('')
    lines.push('*(End of example — your actual output should follow this structure exactly.)*')
    lines.push('')
    lines.push('---')
    lines.push('')
    lines.push('**Tone:** plain English, friendly, short sentences — no jargon, no dumping a wall of changes at once.')
    lines.push('')
    lines.push('First explore the repo to find the relevant files (schema, meta tags, content files, landing pages) before changing anything.')
    lines.push('')

    // Part 1: structural/technical fixes — ask Yes/No before each
    if (part1Items.length > 0) {
      lines.push('---')
      lines.push('')
      lines.push('## Part 1 — Confirm each fix before implementing')
      lines.push('*(Only reached if Step 0 confirmed real tool + repo access.)*')
      lines.push('')
      lines.push('These are structural or technical fixes that can be done in code. Go through them one at a time.')
      lines.push('')
      lines.push('Rules:')
      lines.push('- For each item, briefly describe the fix in one sentence, then ask as a multiple-choice question with exactly these options: [Yes, implement this] / [No, skip]. This triggers the structured options UI — do not ask in plain prose.')
      lines.push('- Wait for the answer before doing anything.')
      lines.push('- If Yes: implement the fix, confirm in one sentence, then move to the next.')
      lines.push('- If No: skip it and log it in Part 3.')
      lines.push('- One item at a time — never batch.')
      lines.push('')
      part1Items.forEach((item, i) => {
        lines.push(`### ${i + 1}. ${item.label}`)
        if (item.aiDetail) lines.push(`Issue: ${item.aiDetail}`)
        if (item.aiAction) lines.push(`Fix: ${item.aiAction}`)
        if (item.fixGuide?.length) {
          item.fixGuide.forEach((step, si) => lines.push(`${si + 1}. ${step}`))
        }
        lines.push('')
      })
    }

    // Part 2: items requiring external data — one question at a time
    if (part2Items.length > 0) {
      lines.push('---')
      lines.push('')
      lines.push('## Part 2 — Ask before changing (one at a time)')
      lines.push('*(Only reached if Step 0 confirmed real tool + repo access.)*')
      lines.push('')
      lines.push('Each item below needs a real statistic, citation, or claim the user must supply. Never invent a number or attribute a claim to a real company or study.')
      lines.push('')
      lines.push('Rules:')
      lines.push('- Ask ONE question at a time. Wait for the answer before doing anything.')
      lines.push('- Ask each question as a multiple-choice question with exactly these options: [Provide it now] / [Skip for now]. This triggers the structured options UI — do not ask in plain prose.')
      lines.push('- Apply the change, confirm in one sentence, then move to the next.')
      lines.push('- If the user skips or has no answer: do not add anything. Log it in Part 3.')
      lines.push('')
      part2Items.forEach((item, i) => {
        lines.push(`### ${i + 1}. ${item.label}`)
        if (item.aiDetail) lines.push(`Issue: ${item.aiDetail}`)
        const actionLower = item.aiAction ? item.aiAction.charAt(0).toLowerCase() + item.aiAction.slice(1) : 'add this to the site'
        lines.push(`Ask as a multiple-choice question with options [Provide it now] / [Skip for now]: "Got a real number, study, or source I can use to ${actionLower}?"`)
        lines.push(`- If they choose "Provide it now": ask them to share it, then add it exactly as they provided — no paraphrasing, no invented gaps.`)
        lines.push(`- If they choose "Skip for now": do not add anything. Record this in Part 3.`)
        lines.push('')
      })
      if (part2Items.length >= 3) {
        lines.push(`After the first 2–3 questions, offer: "I have ${part2Items.length} questions total. Want to keep going one by one, or shall I handle the rest on my own using what you've told me so far?"`)
        lines.push('- If they want to continue one by one: keep going.')
        lines.push('- If they want auto: apply what you have, skip the rest, log skipped items in Part 3.')
        lines.push('')
      }
      lines.push('After all questions: give a one-sentence summary of what was added.')
      lines.push('')
    }

    // Part 3: skipped items log
    lines.push('---')
    lines.push('')
    lines.push('## Part 3 — Log what was skipped')
    lines.push('*(Only reached if Step 0 confirmed real tool + repo access.)*')
    lines.push('')
    lines.push('If anything was skipped in Part 1 or Part 2:')
    lines.push(`- Write a file called \`${slugName}-skipped-items.md\` — list each skipped item, what it was for, and one line on what's still needed to complete it.`)
    lines.push('- Tell the user in plain English that this file was created and where to find it.')
    lines.push('')
    lines.push('If nothing was skipped, skip this step and say so briefly.')
    lines.push('')

    // Part 4: manual checklist (external tasks only)
    if (skipItems.length > 0) {
      lines.push('---')
      lines.push('')
      lines.push('## Part 4 — Checklist for the user')
      lines.push('*(Only reached if Step 0 confirmed real tool + repo access.)*')
      lines.push('')
      lines.push("These can't be done in code. Show this as a simple checklist after Parts 1–3 are done:")
      lines.push('')
      skipItems.forEach(item => {
        lines.push(`- [ ] **${item.label}**: ${item.aiAction}`)
      })
      lines.push('')
    }

    // Closing
    lines.push('---')
    lines.push('')
    const hasPart2 = part2Items.length > 0
    const hasPart4 = skipItems.length > 0
    if (!hasPart2 && !hasPart4) {
      lines.push('When Parts 1 and 3 are complete, send the user a friendly summary of everything that was fixed.')
    } else if (hasPart4) {
      lines.push('When Parts 1–3 are complete, show the Part 4 checklist.')
    } else {
      lines.push('When Parts 1–3 are complete, send the user a friendly summary of everything that was fixed.')
    }

    return lines.join('\n')
  }

  const performDownload = async (modData: ModuleData, onlySlug?: string) => {
    setExportingMap(prev => ({ ...prev, [modData.id]: true }))
    const states = statesMap[modData.id] ?? {}
    const dynItems = dynItemsMap[modData.id] ?? []

    // Build failing items list for classification
    let failingItems: { slug: string; label: string; aiDetail: string | null; aiAction: string | null }[] = []
    if (modData.definition.dynamic) {
      failingItems = dynItems
        .filter(i => dynCounts(modData.definition, i) && !i.aiVerified && !i.userChecked && !i.userSkipped && (i.aiDetail || i.aiAction))
        .map(i => ({ slug: i.slug, label: i.label, aiDetail: i.aiDetail, aiAction: i.aiAction }))
    } else {
      const allDefItems = (modData.definition.categories as ModuleCategoryDefinition[]).flatMap(c => c.subCategories.flatMap(s => s.items))
      failingItems = allDefItems
        .filter(defItem => { const s = states[defItem.slug]; return s && !s.aiVerified && !s.userChecked && !s.userSkipped && (s.aiDetail || s.aiAction) })
        .map(defItem => { const s = states[defItem.slug]!; return { slug: defItem.slug, label: defItem.label, aiDetail: s.aiDetail, aiAction: s.aiAction } })
    }

    // One issue only: keep just that one for classification and leave every other item out of the file.
    const skipIds = new Set<string>()
    if (onlySlug) {
      failingItems = failingItems.filter(i => i.slug === onlySlug)
      if (modData.definition.dynamic) dynItems.forEach(i => { if (i.slug !== onlySlug) skipIds.add(i.id) })
      else Object.entries(states).forEach(([slug, st]) => { if (slug !== onlySlug && st.id) skipIds.add(st.id) })
    }

    const classifications: Record<string, { exportType: 'auto' | 'needs_choice' | 'skip'; choiceOptions?: string[] }> = {}
    if (failingItems.length > 0) {
      try {
        const classRes = await fetch('/api/items/classify-export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moduleId: modData.id, items: failingItems }),
        })
        if (classRes.ok) {
          const { classifications: result } = await classRes.json() as { classifications: { slug: string; exportType: 'auto' | 'needs_choice' | 'skip'; choiceOptions?: string[] }[] }
          for (const c of result) classifications[c.slug] = { exportType: c.exportType, choiceOptions: c.choiceOptions }
        }
      } catch { /* non-fatal */ }
    }

    const prompt = buildClaudeCodePrompt(modData, skipIds, classifications)
    const blob = new Blob([prompt], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = onlySlug
      ? `${brand.name}-${(failingItems[0]?.label ?? onlySlug).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}-Fix-Growjin.md`
      : `${brand.name}-${modData.name.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('-')}-Report-Growjin.md`
    a.click()
    URL.revokeObjectURL(url)
    setExportingMap(prev => ({ ...prev, [modData.id]: false }))
  }

  const handleTopExport = (modData: ModuleData, onlySlug?: string) => {
    const mcpConnected = typeof window !== 'undefined' && localStorage.getItem('growjin_mcp_connected') === 'true'
    if (mcpConnected) {
      performDownload(modData, onlySlug)
      return
    }
    setExportPrepModuleId(modData.id)
    setExportPrepSlug(onlySlug ?? null)
    setExportPrepOpen(true)
  }

  // ── Cross-module conflict awareness ──────────────────────────────────────────
  // Primary: uses AI-detected item_links from the DB (covers all related slugs, not just entry points).
  // Fallback: static CONFLICT_GROUPS for entry-point slugs when DB links haven't been written yet.
  const getConflictsForItem = (modId: string, slug: string, itemId?: string) => {
    // Grouped result type: one entry per module, with all its actions collected
    type ConflictResult = { topic: string; moduleName: string; aiActions: string[] }
    const byModule = new Map<string, ConflictResult>()

    // Only show suggestions from modules that come BEFORE the current one in the sequence
    const currentMod = allModulesData.find(m => m.id === modId)
    const currentOrder = currentMod?.order ?? 0

    // Primary path — DB-backed links
    if (itemId && conflictLinks.length > 0) {
      const myLinks = conflictLinks.filter(l => l.itemIdA === itemId || l.itemIdB === itemId)
      if (myLinks.length > 0) {
        const seenOtherId = new Set<string>()
        for (const link of myLinks) {
          const otherId = link.itemIdA === itemId ? link.itemIdB : link.itemIdA
          if (seenOtherId.has(otherId)) continue
          seenOtherId.add(otherId)
          const info = itemIdInfoMap.get(otherId)
          if (!info || info.moduleId === modId) continue
          const otherMod = allModulesData.find(m => m.id === info.moduleId)
          if (!otherMod || otherMod.order >= currentOrder) continue
          const aiAction = otherMod.definition.dynamic
            ? (dynItemsMap[info.moduleId]?.find(i => i.id === otherId)?.aiAction ?? null)
            : (statesMap[info.moduleId]?.[info.slug]?.aiAction ?? null)
          const topic = SLUG_TOPIC[info.slug] ?? SLUG_TOPIC[slug] ?? 'Shared Element'
          const existing = byModule.get(info.moduleId)
          if (existing) {
            if (aiAction && !existing.aiActions.includes(aiAction)) existing.aiActions.push(aiAction)
          } else {
            byModule.set(info.moduleId, { topic, moduleName: otherMod.name, aiActions: aiAction ? [aiAction] : [] })
          }
        }
        const results = [...byModule.values()].filter(r => r.aiActions.length > 0)
        if (results.length > 0) return results
      }
    }

    // Fallback — static map (shows entry-point slugs before DB links exist)
    const moduleType = currentMod?.type
    if (!moduleType) return null
    for (const group of CONFLICT_GROUPS) {
      if (!group.entries.some(e => e.moduleType === moduleType && e.slug === slug)) continue
      for (const entry of group.entries) {
        if (entry.moduleType === moduleType) continue
        const otherMod = allModulesData.find(m => m.type === entry.moduleType)
        if (!otherMod || otherMod.order >= currentOrder) continue
        const aiAction = otherMod.definition.dynamic
          ? (dynItemsMap[otherMod.id]?.find(i => i.slug === entry.slug)?.aiAction ?? null)
          : (statesMap[otherMod.id]?.[entry.slug]?.aiAction ?? null)
        const existing = byModule.get(otherMod.id)
        if (existing) {
          if (aiAction && !existing.aiActions.includes(aiAction)) existing.aiActions.push(aiAction)
        } else {
          byModule.set(otherMod.id, { topic: group.topic, moduleName: otherMod.name, aiActions: aiAction ? [aiAction] : [] })
        }
      }
    }
    const fallbackResults = [...byModule.values()].filter(r => r.aiActions.length > 0)
    return fallbackResults.length > 0 ? fallbackResults : null
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
    // Ideas (e.g. post suggestions) aren't checks: no checkbox, impact badges, done or skip
    const idea = isDynamicIdea(allModulesData.find(m => m.id === modId)?.definition, item.categorySlug)
    const done = !idea && (aiV || userC)
    const notChecked = !idea && !done && isNotChecked(item.aiDetail)
    const needsAttention = !idea && !notChecked && !aiV && !userC && !skipped
    const itemKey = `${modId}:${item.slug}`
    const isExpanded = expandedItems.has(itemKey)
    const hasDetail = !skipped && !!(item.aiDetail || item.aiHighlight || item.aiNarrative || item.aiAction)
    const isSkipPrompting = skipPrompting.has(itemKey)
    // Social Media post suggestions: the label is the post itself, the action its opening line
    const postIdea = item.categorySlug === 'post-suggestions'

    return (
      <div
        key={item.slug}
        className={`md-item sm-item${!done && !skipped && item.weight === 3 ? ' md-item-critical' : ''}${done ? ' md-item-done' : ''}${skipped ? ' md-item-skipped' : ''}${needsAttention ? ' md-item-flagged' : ''}${isExpanded ? ' sm-item-expanded' : ''}`}
        onClick={(e) => {
          if (!hasDetail) return
          toggleExpand(modId, item.slug, e)
        }}
        style={{ cursor: hasDetail ? 'pointer' : 'default' }}
      >
        {idea ? (
          <span className="md-cb md-cb-idea" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
        ) : (
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
        )}
        <div className="md-item-body">
          <div className="md-item-top">
            <span className="md-item-lbl">{postIdea ? item.label : item.aiHighlight || item.label}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
              {skipped ? (
                <>
                  <span className="md-tag" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-faint)', border: '1px solid rgba(255,255,255,0.1)', fontSize: '10px', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>Skipped</span>
                  <button className="md-skip-unskip" onClick={(e) => { e.stopPropagation(); handleSkip(modId, true, item.id, item.slug, false, '') }}>Unskip</button>
                </>
              ) : (
                <>
                  {idea && <span className="md-tag md-tag-idea">Idea</span>}
                  {notChecked && <span className="md-tag md-tag-unchecked">Not checked</span>}
                  {!done && !idea && !notChecked && item.weight === 3 && (
                    <span className="md-priority-icon md-priority-critical">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                        <line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
                        <line x1="12" y1="17" x2="12.01" y2="17" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                      </svg>
                      <span className="md-priority-label">High impact</span>
                    </span>
                  )}
                  {!done && !idea && !notChecked && item.weight === 2 && (
                    <span className="md-priority-icon md-priority-important">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.2"/>
                        <line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
                        <line x1="12" y1="16" x2="12.01" y2="16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                      </svg>
                      <span className="md-priority-label">Medium</span>
                    </span>
                  )}
                  {aiV && <Badge className="md-tag md-tag-ai" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>AI <SparkleIcon size={11} style={{ color: '#178a4c' }} /></Badge>}
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
          {!skipped && !done && !idea && !hasDetail && (
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
              {item.aiDetail && (
                <div className="sm-current-box">
                  <span className="sm-current-label">{idea ? 'The idea' : 'Current state'}</span>
                  <p className="sm-current-text">{parseBold(item.aiDetail)}</p>
                </div>
              )}
              {item.aiNarrative && <p className="sm-narrative">{parseBold(item.aiNarrative)}</p>}
              {item.aiAction && (
                <div className="sm-action-box">
                  <span className="sm-action-label">{postIdea ? 'Opening line' : 'What to do'}</span>
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
                        {generatingDraft.has(itemKey) ? <><Spinner />Regenerating…</> : 'Regenerate'}
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
              {!done && !idea && (
                <div className="sm-actions">
                  <button
                    type="button"
                    className="sm-act-primary"
                    onClick={(e) => { e.stopPropagation(); fixWithClaude(itemKey, buildFixPrompt({ label: item.aiHighlight || item.label, found: item.aiDetail, why: item.aiNarrative, action: item.aiAction }), { modId, itemId: item.id, slug: item.slug, label: item.label, action: item.aiAction }) }}
                  >
                    Fix with Claude
                  </button>
                  {item.aiAction && (
                    <button
                      type="button"
                      className="sm-act-secondary sm-act-export"
                      disabled={!!exportingMap[modId]}
                      onClick={(e) => { e.stopPropagation(); const m = allModulesData.find(x => x.id === modId); if (m) handleTopExport(m, item.slug) }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      {exportingMap[modId] ? <><Spinner />Exporting…</> : 'Export'}
                    </button>
                  )}
                  <button type="button" className="sm-act-secondary" onClick={(e) => toggleItem(modId, true, item.id, item.slug, userC, e)}>Mark as done</button>
                </div>
              )}
              {handoff.hint(itemKey)}
              {/* Skip section — at bottom of expanded body */}
              {!done && !idea && (
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
    // An insight is an idea, not a check: no checkbox, impact badges, done or skip
    const idea = !!item.insight
    const done = !idea && (aiV || userC)
    const notChecked = !idea && !done && isNotChecked(s?.aiDetail)
    const needsAttention = s && !idea && !notChecked && !aiV && !userC && !skipped
    const itemKey = `${modId}:${item.slug}`
    const isExpanded = expandedItems.has(itemKey)
    const hasDetail = !skipped && !!(s?.aiDetail || s?.aiHighlight || s?.aiNarrative || s?.aiAction || item.fixGuide?.length)
    const isVerifying = verifyingItems.has(itemKey)
    const isSkipPrompting = skipPrompting.has(itemKey)

    return (
      <div
        key={item.slug}
        className={`md-item sm-item${!done && !skipped && item.weight === 3 ? ' md-item-critical' : ''}${done ? ' md-item-done' : ''}${skipped ? ' md-item-skipped' : ''}${needsAttention ? ' md-item-flagged' : ''}${isExpanded ? ' sm-item-expanded' : ''}`}
        onClick={(e) => {
          if (!hasDetail) return
          toggleExpand(modId, item.slug, e)
        }}
        style={{ cursor: hasDetail ? 'pointer' : 'default' }}
      >
        {idea ? (
          <span className="md-cb md-cb-idea" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
        ) : (
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
        )}
        <div className="md-item-body">
          <div className="md-item-top">
            <span className="md-item-lbl">{s?.aiHighlight || item.label}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
              {skipped ? (
                <>
                  <span className="md-tag" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-faint)', border: '1px solid rgba(255,255,255,0.1)', fontSize: '10px', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>Skipped</span>
                  <button className="md-skip-unskip" onClick={(e) => { e.stopPropagation(); handleSkip(modId, false, s?.id ?? '', item.slug, false, '') }}>Unskip</button>
                </>
              ) : (
                <>
                  {idea && <span className="md-tag md-tag-idea">Idea</span>}
                  {notChecked && <span className="md-tag md-tag-unchecked">Not checked</span>}
                  {!done && !idea && !notChecked && item.weight === 3 && (
                    <span className="md-priority-icon md-priority-critical">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                        <line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
                        <line x1="12" y1="17" x2="12.01" y2="17" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                      </svg>
                      <span className="md-priority-label">High impact</span>
                    </span>
                  )}
                  {!done && !idea && !notChecked && item.weight === 2 && (
                    <span className="md-priority-icon md-priority-important">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.2"/>
                        <line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
                        <line x1="12" y1="16" x2="12.01" y2="16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                      </svg>
                      <span className="md-priority-label">Medium</span>
                    </span>
                  )}
                  {aiV && <span className="md-tag md-tag-ai" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>AI <SparkleIcon size={11} style={{ color: '#178a4c' }} /></span>}
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
          {!skipped && !done && !idea && !hasDetail && (
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
              {s?.aiDetail && (
                <div className="sm-current-box">
                  <span className="sm-current-label">{idea ? 'What we found' : 'Current state'}</span>
                  <p className="sm-current-text">{parseBold(s.aiDetail)}</p>
                </div>
              )}
              {!done && <ElementEvidence data={s?.aiData} brandId={brand.id} pageUrl={brand.websiteUrl} />}
              {!done && <PagePreview data={s?.aiData} options={s?.choiceOptions} slug={item.slug} />}
              {s?.aiNarrative && <p className="sm-narrative">{parseBold(s.aiNarrative)}</p>}
              {s?.aiAction && (
                <div className="sm-action-box">
                  <span className="sm-action-label">What to do</span>
                  {/* The suggestions are already tabs in the Google preview above: don't list them twice */}
                  <p className="sm-action-text">{!done && isPagePreview(s.aiData) && s.aiData.show === 'google' && (s.choiceOptions?.length ?? 0) > 0
                    ? 'Pick a suggestion above to see it as Google would show it, then copy the one you like into your page.'
                    : parseBold(s.aiAction)}</p>
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
                          <span>{renderMdStep(step)}</span>
                        </li>
                      ))}
                    </ol>
                    <InlineIntegrationForm intDef={intDef} onConnected={() => router.refresh()} />
                  </div>
                )
              })()}
              {item.fixGuide?.length && !done && (
                // Steps stay folded when there's already a "What to do" line, to keep the card short.
                <details className="sm-fix-guide" open={!s?.aiAction}>
                  <summary className="sm-fix-guide-hd" onClick={(e) => e.stopPropagation()}>Step-by-step ({item.fixGuide.length})</summary>
                  <ol className="sm-fix-guide-steps">
                    {item.fixGuide.map((step, i) => (
                      <li key={i} className="sm-fix-guide-step">
                        <span className="sm-fix-guide-num">{i + 1}</span>
                        <span style={{ whiteSpace: 'pre-wrap' }}>{renderMdStep(step)}</span>
                      </li>
                    ))}
                  </ol>
                  {item.slug === 'posthog-installed' && (
                    <a
                      href="/downloads/posthog-setup.md"
                      download="posthog-setup.md"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        marginTop: '14px',
                        padding: '7px 16px',
                        borderRadius: '6px',
                        border: '1px solid var(--green)',
                        color: 'var(--green-bright)',
                        fontSize: '12px',
                        fontWeight: 600,
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
                </details>
              )}
              {!done && (
                <div className="sm-actions">
                  <button
                    type="button"
                    className="sm-act-primary"
                    onClick={(e) => { e.stopPropagation(); fixWithClaude(itemKey, buildFixPrompt({ label: s?.aiHighlight || item.label, found: s?.aiDetail, why: s?.aiNarrative, action: s?.aiAction, steps: item.fixGuide, data: s?.aiData }), { modId, itemId: s?.id, slug: item.slug, label: item.label, action: s?.aiAction }) }}
                  >
                    Fix with Claude
                  </button>
                  {s?.aiAction && (
                    <button
                      type="button"
                      className="sm-act-secondary sm-act-export"
                      disabled={!!exportingMap[modId]}
                      onClick={(e) => { e.stopPropagation(); const m = allModulesData.find(x => x.id === modId); if (m) handleTopExport(m, item.slug) }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      {exportingMap[modId] ? <><Spinner />Exporting…</> : 'Export'}
                    </button>
                  )}
                  {!idea && <button type="button" className="sm-act-secondary" onClick={(e) => toggleItem(modId, false, s?.id ?? '', item.slug, userC, e)}>Mark as done</button>}
                </div>
              )}
              {handoff.hint(itemKey)}
              {/* Skip section — at bottom of expanded body */}
              {!done && !idea && (
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

  // Where a running analysis is: the server's stage when it reports one, otherwise a guess from elapsed time.
  const runProgress = (m: ModuleData) => {
    const info = runInfoMap[m.id]
    const elapsed = Math.max(0, Math.floor((clock - (info?.startedAt ?? clock)) / 1000))
    const checks = m.definition.dynamic ? 0 : (m.definition.categories as ModuleCategoryDefinition[]).reduce((n, c) => n + c.subCategories.reduce((k, sc) => k + sc.items.length, 0), 0)
    const steps = [
      { key: 'fetch', label: 'Reading your site' },
      { key: 'analyse', label: checks ? `Checking ${checks} things` : 'Checking your site' },
      { key: 'save', label: 'Saving your checklist' },
    ]
    const idx = info?.stage ? Math.max(0, steps.findIndex(st => st.key === info.stage)) : elapsed < 15 ? 0 : 1
    // Bar: follows the real step; inside the long middle step it eases toward ~88% (never claims done).
    const pct = idx === 0 ? Math.min(20, 5 + elapsed) : idx === 1 ? Math.round(25 + 63 * (1 - Math.exp(-Math.max(0, elapsed - 10) / 70))) : 95
    return { steps, idx, pct, slow: elapsed > 180 }
  }

  // The analysis in flight (if any) takes over the top of the page.
  const liveMod = railModules.find(x => reanalyzingMap[x.id] && !isPlanLocked(x)) ?? null
  const liveRun = liveMod ? runProgress(liveMod) : null
  const liveRef = useRef<HTMLElement | null>(null)
  const [liveOnScreen, setLiveOnScreen] = useState(true)
  useEffect(() => {
    const el = liveRef.current
    if (!liveMod || !el) { setLiveOnScreen(true); return }
    // Counts as on screen while at least half of the panel is visible.
    const io = new IntersectionObserver(([e]) => setLiveOnScreen(e.intersectionRatio >= 0.5), { threshold: [0, 0.5, 1] })
    io.observe(el)
    return () => io.disconnect()
  }, [liveMod?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const baseTitleRef = useRef<string | null>(null)
  // Tab title: "Analysing …" while a run is going, "✓ ready" for a moment after, then back to normal.
  useEffect(() => {
    if (baseTitleRef.current === null) baseTitleRef.current = document.title
    document.title = liveMod ? `Analysing ${liveMod.name}… – GrowJin`
      : readyNotice ? `✓ ${readyNotice.name} is ready – GrowJin`
      : baseTitleRef.current
  }, [liveMod?.id, readyNotice]) // eslint-disable-line react-hooks/exhaustive-deps

  // Once a step has results, the checklist is the page: the next-step box only shows before the
  // first analysis, or when the next step needs Pro.
  const hasAnyAnalysis = railModules.some(m => !!(lastAnalyzedAtMap[m.id] !== undefined ? lastAnalyzedAtMap[m.id] : m.lastAnalyzedAt))

  // Items still to fix in a module (not done, not skipped).
  const openItemCount = (m: ModuleData) => {
    if (m.definition.dynamic) return (dynItemsMap[m.id] ?? []).filter(i => dynCounts(m.definition, i) && !i.aiVerified && !i.userChecked && !(i as { userSkipped?: boolean }).userSkipped).length
    const st = statesMap[m.id] ?? {}
    return (m.definition.categories as ModuleCategoryDefinition[])
      .flatMap(c => c.subCategories.flatMap(sc => sc.items))
      .filter(i => !st[i.slug]?.aiVerified && !st[i.slug]?.userChecked && !st[i.slug]?.userSkipped).length
  }

  // A run just finished: bring that module's checklist into focus, with its weakest section open.
  useEffect(() => {
    if (!readyNotice) return
    const m = allModulesData.find(x => x.id === readyNotice.modId)
    if (!m) return
    setOpenModules(new Set([m.id]))
    if (!m.definition.dynamic) {
      const worst = (m.definition.categories as ModuleCategoryDefinition[])
        .map(c => ({ c, st: getCatStats(c, statesMap[m.id] ?? {}) }))
        .filter(x => x.st.total > 0 && x.st.done < x.st.total)
        .sort((a, b) => a.st.pct - b.st.pct)[0]
      if (worst) setOpenCatsMap(prev => ({ ...prev, [m.id]: new Set([worst.c.slug]) }))
    }
    setFocusModId(m.id)
    const t = setTimeout(() => setFocusModId(null), 2200)
    requestAnimationFrame(() => {
      const card = document.getElementById('gp-module')
      // Only move the page if the user is still up top; don't yank someone who's reading the checklist.
      if (card && window.scrollY < 200 && card.getBoundingClientRect().top > 80) card.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => clearTimeout(t)
  }, [readyNotice?.modId]) // eslint-disable-line react-hooks/exhaustive-deps

  // "Your next step": one plain-language instruction so a new user knows what to do first.

  const freeTotal = railModules.filter(x => !x.definition.comingSoon && !isPlanLocked(x)).length
  const freeDone = railModules.filter(x => !isPlanLocked(x) && isStepDone(x)).length
  const proStepCount = railModules.filter(x => !x.definition.comingSoon && isPlanLocked(x)).length
  // The stage playbook card lives on Foundation only, and waits until the user has a result or
  // finished a step: on day one it's one thing too many.
  const showStageCard = selectedModule?.type === 'foundation' && (bsItemsAll.length > 0 || railDoneCount > 0)
  const stageCardEl = showStageCard ? (
    <aside className="gp-stage">
          <span className="gp-stage-tag">Why this matters now</span>
          <h4 className="gp-stage-title">{bsClassItem?.label ?? 'Your stage playbook'}</h4>
          <p className="gp-stage-text">
            {bsConcernItem?.aiDetail
              ?? bsClassItem?.aiDetail
              ?? 'Tactics matched to where you are on the road to 500 users — what to focus on, what to skip, and the red flag to fix first.'}
          </p>
          <button className="gp-stage-cta" onClick={() => { setStageModalTab(0); setStageModalOpen(true) }}>
            {bsItemsAll.length > 0 ? 'Read the full playbook' : 'Get your playbook'} →
          </button>
        </aside>
  ) : null

  // The result summary shows once a module is set up and analysed; the growth-stage note then sits inside it.
  const bandSummary = (m: ModuleData | undefined) => {
    if (!m || m.definition.comingSoon || m.type === 'business-stage' || m.type === 'gmail-outreach') return null
    if (isModuleLocked(m)) return null
    const def = m.definition
    const reqValues = reqValuesMap[m.id] ?? {}
    const dynItems = dynItemsMap[m.id] ?? []
    const missing = def.requirements.filter(r => r.required !== false && !reqValues[r.key]?.trim())
    const needsSetup = missing.length > 0 || (!!def.dynamic && dynItems.length === 0 && def.requirements.length > 0)
    const analysed = lastAnalyzedAtMap[m.id] !== undefined ? lastAnalyzedAtMap[m.id] : m.lastAnalyzedAt
    if (needsSetup || !analysed) return null
    const sum = summarizeCats(def, statesMap[m.id] ?? {}, dynItems)
    return sum.needs + sum.pass > 0 ? sum : null
  }
  const nextStep = (() => {
    const m = railModules.find(x => !x.definition.comingSoon && !isModuleLocked(x) && (liveScores[x.id] ?? 0) < 80)
    const progress = `${freeDone} of ${freeTotal} ${proStepCount > 0 ? 'free ' : ''}steps done`
    if (!m) return { label: 'All caught up', title: 'Every step is at 80% or more', text: 'Re-analyse a step after you change your site.', progress, busy: false, cta: null as null | { label: string; run: () => void } }
    if (isPlanLocked(m)) {
      return {
        label: 'Free steps done', progress, busy: false,
        title: 'You’ve finished the free steps',
        text: `Pro unlocks ${m.name} and the rest of your path.`,
        cta: { label: 'See Pro plans', run: () => router.push('/pricing') },
      }
    }
    const analysed = lastAnalyzedAtMap[m.id] !== undefined ? lastAnalyzedAtMap[m.id] : m.lastAnalyzedAt
    const score = liveScores[m.id] ?? 0
    if (reanalyzingMap[m.id]) {
      const rp = runProgress(m)
      return {
        label: 'Next step', progress, busy: true,
        title: `Checking your ${m.name.toLowerCase()}…`,
        text: `Step ${rp.idx + 1} of 3: ${rp.steps[rp.idx].label}. ${rp.slow ? 'Taking longer than usual, but still working.' : 'Usually 1–3 minutes.'} You can leave this page.`,
        cta: null,
      }
    }
    if (!analysed) {
      return {
        label: 'Next step', progress, busy: false,
        title: `Run ${m.name}`,
        text: 'GrowJin checks your site and gives you a checklist of fixes.',
        cta: null,
      }
    }
    return {
      label: 'Next step', progress, busy: false,
      title: `Get ${m.name} to 80%`,
      // The card right below already shows the score and the 80% bar; only a first-timer needs the how-to.
      text: railDoneCount === 0 ? 'Fix what’s flagged below, then tick it off.' : '',
      cta: null,
    }
  })()

  // Progress toward 80% for the selected step, shown inside its module card.
  const unlockEl = !selectedModule || selectedModule.definition.comingSoon ? null : (() => {
    const score = liveScores[selectedModule.id] ?? 0
    if (isPlanLocked(selectedModule)) return null // the module card's upgrade panel covers it
    if (isModuleLocked(selectedModule)) {
      const prev = [...railModules.slice(0, selectedIdx)].reverse().find(p => !p.definition.comingSoon)
      if (!prev) return null
      const prevScore = liveScores[prev.id] ?? 0
      return (
        <div className="gp-unlock gp-unlock--locked">
          <div className="gp-unlock-row">
            <span>Unlocks at <b>80%</b> on {prev.name}</span>
            <b className="gp-unlock-num">{prevScore}%</b>
          </div>
          <div className="gp-unlock-track"><div className="gp-unlock-fill" style={{ width: `${Math.min(prevScore / 80, 1) * 100}%` }} /></div>
        </div>
      )
    }
    const analysedYet = lastAnalyzedAtMap[selectedModule.id] !== undefined ? lastAnalyzedAtMap[selectedModule.id] : selectedModule.lastAnalyzedAt
    if (!analysedYet) return null // nothing to measure until the first analysis lands
    const next = railModules.slice(selectedIdx + 1).find(p => !p.definition.comingSoon)
    // Mirrors isModuleLocked: the first three modules never gate each other.
    const unlocksNext = !!next && next.order > 3
    if (score >= 80) {
      return (
        <div className="gp-unlock gp-unlock--done">
          <div className="gp-unlock-row">
            <span>{unlocksNext && isPlanLocked(next) ? <>Done · <b>{next.name}</b> is next with <Link href="/pricing">Pro</Link></> : unlocksNext ? <>Done · <b>{next.name}</b> unlocked</> : <>Done</>}</span>
            <b className="gp-unlock-num">{score}%</b>
          </div>
        </div>
      )
    }
    return (
      <div className="gp-unlock">
        <div className="gp-unlock-row">
          <span>Goal <b>80%</b>{unlocksNext ? <> · unlocks {next.name}</> : null}</span>
        </div>
        <div className="gp-unlock-track"><div className="gp-unlock-fill" style={{ width: `${Math.min(score / 80, 1) * 100}%` }} /></div>
      </div>
    )
  })()

  return (
    <>
      {/* Analysis Requested Modal */}
      {showRequestedModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowRequestedModal(false)}>
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
            <Button onClick={() => setShowRequestedModal(false)} style={{ minWidth: 100 }}>Got it</Button>
          </div>
        </div>
      )}

      {/* Cross-module conflict modal */}
      {conflictModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
          onClick={() => setConflictModal(null)}
        >
          <div
            style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '32px 36px', maxWidth: 520, width: '100%' }}
            onClick={e => e.stopPropagation()}
          >
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
              Heads up — this was already looked at
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.65 }}>
              An earlier module already reviewed <strong style={{ color: 'var(--text)' }}>{conflictModal.itemLabel}</strong> and left a suggestion. Here&apos;s what it said:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
              {conflictModal.conflicts.map((c, i) => (
                <div key={i} style={{ background: 'rgba(231,200,115,0.07)', border: '1px solid rgba(231,200,115,0.2)', borderRadius: 8, padding: '12px 16px' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{c.moduleName}</div>
                  {c.aiActions.length === 1 ? (
                    <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, margin: 0 }}>{c.aiActions[0]}</p>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {c.aiActions.map((a, j) => <li key={j} style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>{a}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 24, lineHeight: 1.6 }}>
              If you&apos;ve already acted on this, you can skip it here to keep your checklist clean. Or tap &quot;Review anyway&quot; if you want to see what this module has to say about it.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  handleSkip(conflictModal.modId, conflictModal.isDynamic, conflictModal.itemId, conflictModal.slug, true, 'Already covered in an earlier module')
                  setConflictModal(null)
                }}
                style={{ padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', border: '1px solid var(--line)', background: 'transparent', color: 'var(--text-dim)' }}
              >
                Skip this check
              </button>
              <button
                onClick={() => {
                  const { modId, slug } = conflictModal
                  setConflictModal(null)
                  setExpandedItems(new Set([`${modId}:${slug}`]))
                }}
                style={{ padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', background: 'var(--green)', color: '#fff' }}
              >
                Review anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Growth Path topbar */}
      <div className="gp-topbar">
        <div>
          <h1 className="sr-only">Growth Path</h1>
          <nav className="gp-crumbs" aria-label="Breadcrumb">
            <span>Roadmap</span>
            {selectedModule && (() => {
              const pi = GROWTH_PHASES.findIndex(g => selectedModule.order <= g.maxOrder)
              return pi >= 0 ? <><span aria-hidden="true">›</span><span>{pi + 1} · {GROWTH_PHASES[pi].name}</span></> : null
            })()}
            {selectedModule && <><span aria-hidden="true">›</span><b>{selectedModule.name}</b></>}
          </nav>
        </div>
        <div className="gp-top-actions">
          {/* Live users from PostHog. Connected: the count, which opens Road to 500; until then, one small prompt. */}
          {connectedIntegrations['posthog'] ? (
            <div
              className="gp-users-chip is-live"
              title={nextPhase ? `Next milestone: ${nextPhase.min} users (${Math.max(nextPhase.min - userCount, 0).toLocaleString()} to go)` : 'Road to 500 users'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
              <span className="gp-users-chip-main">
                <span className="gp-users-chip-line">
                  <b className="gp-users-chip-count">{posthogLoading ? '…' : userCount.toLocaleString()}</b>
                  {nextPhase && <span className="gp-users-chip-of">/ {nextPhase.min.toLocaleString()}</span>}
                  <span className="gp-users-chip-label">users</span>
                </span>
                {nextPhase && !posthogLoading && (
                  <span className="gp-users-chip-bar" aria-hidden="true"><i style={{ width: `${Math.min(userCount / nextPhase.min, 1) * 100}%` }} /></span>
                )}
              </span>
            </div>
          ) : (
            <Link href={connectUrl('posthog')} className="gp-users-chip" title="Connect PostHog (read-only) to track your live user count">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
              <span className="gp-users-chip-label">Live users</span>
              <b>—</b>
              <span className="gp-users-chip-cta">Connect PostHog</span>
            </Link>
          )}
          {isAdmin && <button className="gp-icon-btn" onClick={() => setNotesOpen(true)} title="Notes (team only)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          </button>}
        </div>
      </div>

      <div className="wrap gp-wrap">
          {liveMod && liveRun ? (
            // A re-check (results already there) gets the compact version; a first run gets the full panel.
            <section className={`gp-live${lastAnalyzedAtMap[liveMod.id] ?? liveMod.lastAnalyzedAt ? ' gp-live--compact' : ''}`} ref={liveRef} role="status" aria-live="polite">
              <div className="gp-live-top">
                <span className="gp-live-pulse" aria-hidden="true" />
                <span className="gp-live-label">Analysing now</span>
              </div>
              <h2 className="gp-live-title">{lastAnalyzedAtMap[liveMod.id] ?? liveMod.lastAnalyzedAt ? 'Re-checking' : 'Checking'} your {liveMod.name.toLowerCase()}</h2>
              <div className="gp-live-barrow">
                <div className="gp-live-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={liveRun.pct} aria-label="Estimated progress"><i style={{ width: `${liveRun.pct}%` }} /></div>
                <span className="gp-live-pct" title="Estimated from the current step and time so far">~{liveRun.pct}%</span>
              </div>
              {/* One-line step status: replaces the step list in the compact version and on phones. */}
              <p className="gp-live-sub">Step {liveRun.idx + 1} of 3 · {liveRun.steps[liveRun.idx].label}{liveRun.slow ? ' · taking longer than usual' : ''}</p>
              <ol className="gp-live-steps">
                {liveRun.steps.map((st, i) => (
                  <li key={st.key} className={i < liveRun.idx ? 'is-done' : i === liveRun.idx ? 'is-now' : ''}>
                    <span className="gp-progress-dot" aria-hidden="true">{i < liveRun.idx ? '✓' : ''}</span>
                    <span>{st.label}</span>
                  </li>
                ))}
              </ol>
              <p className="gp-live-note">{liveRun.slow ? 'Taking longer than usual, but still working. ' : 'Usually 1–3 minutes. '}You can leave this page; it keeps going.</p>
            </section>
          ) : (!hasAnyAnalysis || nextStep.cta) && (
          <section className={`gp-next${nextStep.busy ? ' gp-next--busy' : ''}`} aria-live="polite">
            <div className="gp-next-body">
              <div className="gp-next-label">
                {nextStep.busy && <span className="gp-next-spin" aria-hidden="true" />}
                {nextStep.label}<span className="gp-next-progress"> · {nextStep.progress}</span>
              </div>
              <h2 className="gp-next-title">{nextStep.title}</h2>
              {nextStep.text && <p className="gp-next-text">{nextStep.text}</p>}
            </div>
            {nextStep.cta && <button className="gp-next-cta" onClick={nextStep.cta.run}>{nextStep.cta.label} <ArrowIcon /></button>}
          </section>
          )}

          {/* Finished: a toast that sits over the page (takes no space) while the checklist comes into focus. */}
          {readyNotice && !liveMod && (() => {
            const m = allModulesData.find(x => x.id === readyNotice.modId)
            const left = m ? openItemCount(m) : 0
            return (
              <div className="gp-toast" role="status">
                <span className="gp-toast-check" aria-hidden="true">✓</span>
                <span>{readyNotice.name} updated{left > 0 ? ` · ${left} thing${left === 1 ? '' : 's'} to fix` : ' · all done'}</span>
                <button type="button" className="gp-toast-x" onClick={() => setReadyNotice(null)} aria-label="Dismiss">×</button>
              </div>
            )
          })()}

          {/* Scrolled past the panel: keep the run visible as a floating pill. */}
          {liveMod && liveRun && !liveOnScreen && (
            <button className="gp-live-pill" onClick={() => liveRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              <span className="gp-live-pulse" aria-hidden="true" />
              <span className="gp-live-pill-text">Analysing {liveMod.name} · ~{liveRun.pct}%</span>
              <span className="gp-live-pill-bar" aria-hidden="true"><i style={{ width: `${liveRun.pct}%` }} /></span>
            </button>
          )}

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
              className="gp-sm-overlay"
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
                      onClick={() => resolvedBsModId ? handleReanalyze(resolvedBsModId, { user_count: String(userCount) }) : handleEnsureAndReanalyze()}
                      disabled={bsBusy}
                      style={{
                        fontSize: '12px', fontWeight: 600, padding: '5px 14px', borderRadius: '20px', cursor: bsBusy ? 'default' : 'pointer',
                        border: '1px solid var(--green)', color: 'var(--green-bright)', background: 'transparent',
                        fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '5px', opacity: bsBusy ? 0.6 : 1, whiteSpace: 'nowrap', flexShrink: 0,
                      }}
                    >
                      {bsBusy ? <><svg width="10" height="10" viewBox="0 0 24 24" fill="none" style={{animation:'md-spin .7s linear infinite',flexShrink:0,verticalAlign:'middle'}}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.35"/><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>{ensuringBs ? 'Setting up…' : 'Analysing…'}</> : 'Re-analyse'}
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
                <div className="gp-sm-tabs" style={{ display: 'flex', gap: '0', padding: '16px 24px 0', borderBottom: '1px solid var(--line)', flexShrink: 0, overflowX: 'auto', scrollbarWidth: 'none' }}>
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
                        display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', flexShrink: 0,
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
                    renderMd(activeItem.aiNarrative ?? activeItem.aiDetail ?? '', isRedFlag ? '' : 'var(--text-dim)')
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

        <div className={`gp-main${showStageCard ? '' : ' gp-main--solo'}`}>
        <div className="gp-col">

        {/* Selected module (one at a time) */}
        <div className="levels" id="gp-module">
          {(() => {
            const filtered = railModules.filter(m => m.id === selectedModule?.id)
            // Single-module view: the "locked below" separator has nothing to sit between.
            let separatorPlaced = true
            return filtered.map((modData) => {
            const isOpen = true
            const isLocked = isModuleLocked(modData)
            const planLocked = isPlanLocked(modData)
            const liveScore = liveScores[modData.id] ?? 0
            const isDone = !isLocked && liveScore >= 80
            const stateClass = isLocked ? 'locked' : 'active'
            const reanalyzing = reanalyzingMap[modData.id] ?? false
            const reqValues = reqValuesMap[modData.id] ?? {}
            const setupError = setupErrorMap[modData.id] ?? null
            const requested = requestedMap[modData.id] ?? false
            // Foundation (and everything outside production) analyses directly; other modules go through an admin request
            const runsDirect = process.env.NEXT_PUBLIC_APP_ENV !== 'production' || modData.type === 'foundation'
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

            // Categories for the list and the detail panel (not for modules that have their own layout).
            const hasCatList = !def.comingSoon && modData.type !== 'business-stage' && modData.type !== 'gmail-outreach'
            const catRows: CatRow[] = !hasCatList ? [] : def.dynamic
              // (once analysed, a section with nothing this run isn't shown: an ideas section with no ideas,
              // or checks that don't apply to this kind of site; coming-soon areas stay listed)
              ? [...def.categories].filter(cat => cat.slug !== 'next-campaign' && !(effectiveLastAnalyzedAt && dynItems.length > 0 && !(cat as DynamicModuleCategoryDefinition).comingSoon && !dynItems.some(i => i.categorySlug === cat.slug))).map((cat): CatRow => {
                  const stats = getDynamicCatStats(def, cat.slug, dynItems)
                  const soon = !!(cat as DynamicModuleCategoryDefinition).comingSoon
                  const ideaCat = isDynamicIdea(def, cat.slug)
                  const catItems = [...dynItems.filter(i => i.categorySlug === cat.slug)].sort((a, b) => {
                    const aKey = a.userSkipped ? 2 : (a.aiVerified || a.userChecked) ? 1 : 0
                    const bKey = b.userSkipped ? 2 : (b.aiVerified || b.userChecked) ? 1 : 0
                    if (aKey !== bKey) return aKey - bKey
                    return b.weight - a.weight
                  })
                  return {
                    slug: cat.slug, label: cat.label, stats, soon,
                    ideas: ideaCat ? dynItems.filter(i => i.categorySlug === cat.slug).length : 0,
                    body: soon ? (
                      <ComingSoon title={cat.label} note={(cat as DynamicModuleCategoryDefinition).comingSoonNote} />
                    ) : catItems.length === 0 ? (
                      <p className="gp-detail-empty">No issues found in this category.</p>
                    ) : (
                      <div className="md-sub">
                        <div className="md-items">
                          {catItems.map(item => renderDynamicItem(modData.id, prUrl, item))}
                        </div>
                      </div>
                    ),
                  }
                })
              : (def.categories as ModuleCategoryDefinition[]).map((cat): CatRow => ({
                  slug: cat.slug, label: cat.label, stats: getCatStats(cat, states), soon: false,
                  ideas: cat.subCategories.flatMap(sub => sub.items).filter(i => i.insight && states[i.slug]?.aiDetail).length,
                  body: (<>
                    {cat.subCategories.map((sub, si) => {
                                      const subChecks = sub.items.filter(i => !i.insight && !isNotChecked(states[i.slug]?.aiDetail))
                                      const subDone = subChecks.filter(i => states[i.slug]?.aiVerified || states[i.slug]?.userChecked).length
                                      return (
                                        <div key={sub.slug} className={`md-sub${si > 0 ? ' md-sub-border' : ''}`}>
                                          <div className="md-sub-hd">
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                                              <span className="md-sub-name">{sub.label}</span>
                                              {sub.requires && sub.requires.filter((p) => !connectedIntegrations[p]).map((p) => (
                                                <Link
                                                  key={p}
                                                  href={connectUrl(p)}
                                                  title={`Connect ${INTEGRATION_MAP[p]?.name ?? p} for full data`}
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
                                                    textDecoration: 'none',
                                                  }}
                                                >
                                                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                                                    <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2"/>
                                                    <path d="M8 11V7a4 4 0 1 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                                  </svg>
                                                  {p === 'gsc_api' ? 'Needs GSC API' : p === 'serpapi' ? 'Needs SerpAPI' : `Needs ${INTEGRATION_MAP[p]?.name ?? p}`}
                                                </Link>
                                              ))}
                                            </span>
                                            <span className="md-sub-count">{subChecks.length > 0 ? `${subDone}/${subChecks.length}` : `${sub.items.length} ${sub.items.length === 1 ? 'idea' : 'ideas'}`}</span>
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
                  </>),
                }))
            // Once analysed, areas that still need work come first, then the ones that pass.
            const catsOrdered = [...catRows].sort((a, b) =>
              (Number(a.soon) - Number(b.soon)) ||
              (effectiveLastAnalyzedAt ? Number(!catNeedsAttention(a.stats)) - Number(!catNeedsAttention(b.stats)) : 0))
            const needRows = effectiveLastAnalyzedAt ? catsOrdered.filter(r => !r.soon && catNeedsAttention(r.stats)) : []
            // Fixed-checklist areas whose checks were all added after the last analysis: not run yet, so not "passing".
            // Areas made only of ideas (e.g. Keyword Research) are their own group, never "passing".
            const ideasOnly = (r: CatRow) => r.stats.total === 0 && r.ideas > 0
            const unrun = (r: CatRow) => !def.dynamic && r.stats.total === 0 && r.ideas === 0
            // Dynamic areas where nothing could be checked this time (every item "Couldn't check")
            const uncheckedOnly = (r: CatRow) => !!def.dynamic && r.stats.total === 0 && r.ideas === 0 && dynItems.some(i => i.categorySlug === r.slug)
            const passRows = effectiveLastAnalyzedAt ? catsOrdered.filter(r => !r.soon && !catNeedsAttention(r.stats) && !unrun(r) && !ideasOnly(r) && !uncheckedOnly(r)) : []
            const uncheckedRows = effectiveLastAnalyzedAt ? catsOrdered.filter(r => !r.soon && uncheckedOnly(r)) : []
            const ideaRows = effectiveLastAnalyzedAt ? catsOrdered.filter(r => !r.soon && ideasOnly(r)) : []
            const unrunRows = effectiveLastAnalyzedAt ? catsOrdered.filter(r => !r.soon && unrun(r)) : []
            const otherRows = effectiveLastAnalyzedAt ? catsOrdered.filter(r => r.soon) : catsOrdered
            const wantedCat = [...openCats][0]
            // On narrow screens every category can be closed; on wide screens one is always shown.
            const allClosed = wantedCat === '' && narrow
            const selCat = allClosed ? undefined : (catsOrdered.find(r => r.slug === wantedCat && !r.soon)
              ?? needRows[0] ?? catsOrdered.find(r => !r.soon) ?? catsOrdered[0])
            const passShown = !!passOpenMap[modData.id] || passRows.some(r => r.slug === selCat?.slug)
            const catBtn = (r: CatRow, passing: boolean) => {
              const open = r.stats.total - r.stats.done
              return (
                <button
                  type="button"
                  id={`gp-cat-${modData.id}-${r.slug}`}
                  role="tab"
                  aria-selected={r.slug === selCat?.slug}
                  aria-expanded={narrow ? r.slug === selCat?.slug : undefined}
                  disabled={r.soon}
                  className={`gp-cat${passing ? ' gp-cat--pass' : ''}${r.slug === selCat?.slug ? ' is-selected' : ''}`}
                  onClick={() => selectCat(modData.id, r.slug, selCat?.slug)}
                >
                  <span className="gp-cat-l1">
                    <b>{r.label}</b>
                    {r.soon ? <span className="cs-badge">Coming Soon</span>
                      : effectiveLastAnalyzedAt && r.stats.total === 0 && r.ideas > 0 ? <span className="gp-cat-count">{r.ideas} {r.ideas === 1 ? 'idea' : 'ideas'}</span>
                      : effectiveLastAnalyzedAt && !passing && open > 0 ? <span className="gp-cat-chip">{open} {open === 1 ? 'issue' : 'issues'}</span>
                      : effectiveLastAnalyzedAt && passing ? <span className="gp-cat-tick" aria-hidden="true">✓</span>
                      : effectiveLastAnalyzedAt && uncheckedOnly(r) ? <span className="gp-cat-count">Not checked</span>
                      : <span className="gp-cat-count">{r.stats.done}/{r.stats.total}</span>}
                    {!r.soon && !(r.stats.total === 0 && r.ideas > 0) && !(effectiveLastAnalyzedAt && uncheckedOnly(r)) && <span className="gp-cat-pct">{effectiveLastAnalyzedAt ? `${r.stats.pct}%` : '—'}</span>}
                    {!r.soon && (
                      <svg className="gp-cat-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  {effectiveLastAnalyzedAt && !passing && !r.soon && r.stats.total > 0 && (
                    <span className="gp-cat-bar"><i style={{ width: `${r.stats.pct}%`, background: ringColor(r.stats.pct) }} /></span>
                  )}
                </button>
              )
            }

            // The detail panel is rendered inside the selected category's group: beside the list on wide
            // screens (CSS grid) and directly under the category on narrow ones.
            const detailEl = selCat ? (
              <div className="gp-detail" role="tabpanel" aria-labelledby={`gp-cat-${modData.id}-${selCat.slug}`}>
                <div className="gp-detail-hd">
                  <h3 className="gp-detail-title">{selCat.label}</h3>
                  {!selCat.soon && effectiveLastAnalyzedAt && selCat.stats.total === 0 && selCat.ideas > 0 && (
                    <span className="gp-detail-pill is-ok">Ideas · not scored</span>
                  )}
                  {!selCat.soon && effectiveLastAnalyzedAt && uncheckedOnly(selCat) && (
                    <span className="gp-detail-pill is-muted">Not checked</span>
                  )}
                  {!selCat.soon && effectiveLastAnalyzedAt && selCat.stats.total > 0 && (
                    <span className={`gp-detail-pill${catNeedsAttention(selCat.stats) ? '' : ' is-ok'}`}>
                      {selCat.stats.done}/{selCat.stats.total} passed{catNeedsAttention(selCat.stats) ? ` · ${selCat.stats.total - selCat.stats.done} to fix` : ''}
                    </span>
                  )}
                </div>
                {!selCat.soon && (
                  <p className="gp-detail-sub">
                    {selCat.stats.total === 0 && selCat.ideas > 0 ? 'Ideas written for your business. They don\'t affect your score.' : catNeedsAttention(selCat.stats) ? 'Open an issue to see exactly what to change.' : effectiveLastAnalyzedAt && uncheckedOnly(selCat) ? 'We couldn\'t check these this time. Each one says why and how to fix it. They don\'t count toward your score.' : effectiveLastAnalyzedAt ? 'Nothing to fix here. These checks all passed.' : 'These checks run when you analyse.'}
                  </p>
                )}
                {selCat.body}
              </div>
            ) : null
            const catGroup = (r: CatRow, passing: boolean) => (
              <div className="gp-catgroup" key={r.slug}>
                {catBtn(r, passing)}
                {r.slug === selCat?.slug && detailEl}
              </div>
            )

            const showSeparator = isLocked && !separatorPlaced
            if (showSeparator) separatorPlaced = true

            return (
              <div key={modData.id}>
                {showSeparator && (
                  <div className="levels-lock-separator">
                    <div className="levels-lock-separator-line" />
                    <div className="levels-lock-separator-text">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
                        <path d="M8 11V7a4 4 0 1 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                      Hit <strong>80%</strong> on the modules above to <strong>unlock</strong> these
                    </div>
                    <div className="levels-lock-separator-line" />
                  </div>
                )}
              <div className={`level ${stateClass}${isDone ? ' done' : ''}${isOpen ? ' open' : ''}${planLocked ? ' pro-locked' : ''}${focusModId === modData.id ? ' gp-focus' : ''}`}>

                {/* Level head */}
                <div className="level-head" onClick={() => toggleModule(modData.id)}>
                  <div
                    className="level-badge"
                    style={!isLocked && modData.type !== 'gmail-outreach' ? {
                      background: 'transparent',
                      border: 'none',
                    } : undefined}
                  >
                    {isLocked ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src="/lock-gold.svg" alt="" width={36} height={36} style={{ objectFit: 'contain' }} />
                    ) : modData.type === 'gmail-outreach' ? (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                        <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.7"/>
                        <path d="M2 7l10 7 10-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    ) : (
                      <LevelRing score={liveScore} pending={!effectiveLastAnalyzedAt} />
                    )}
                  </div>

                  <div className="level-info">
                    <div className="name">
                      {modData.name}
                      {def.tagline && <span className="level-name-tagline"> — {def.tagline}</span>}
                      {isLocked && <span className="pill soon">Locked</span>}
                      {!isLocked && def.comingSoon && <span className="pill soon">Coming Soon</span>}
                    </div>
                    {isLocked
                      ? (() => {
                          const prev = [...sortedByOrder].reverse().find(p => p.order < modData.order)
                          return (
                            <>
                              {def.description && <div className="focus">{def.description}</div>}
                            </>
                          )
                        })()
                      : !isOpen && <div className="focus">{def.description}</div>
                    }
                    {!isLocked && effectiveLastAnalyzedAt && (
                      <div className="level-meta">
                        {brand.websiteUrl ? `${brand.websiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')} · ` : ''}Analysed {timeAgo(effectiveLastAnalyzedAt)}
                      </div>
                    )}
                  </div>

                  {!isLocked && (
                    <div className="level-prog" style={{ display: 'none' }}>
                      <div className="mini-track">
                        <div className="mini-fill" style={{ width: `${liveScore}%` }} />
                      </div>
                      {liveScore}%
                    </div>
                  )}

                  {!isLocked && !planLocked && !def.comingSoon && !(modData.type === 'gmail-outreach' && !connectedIntegrations['gmail']) && (
                    <div className="level-actions" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={e => e.stopPropagation()}>
                      {!!effectiveLastAnalyzedAt && modData.type !== 'community-finder' && (
                        <span className="md-info-wrap" style={{ display: 'inline-flex' }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); if (liveScore < 100) handleTopExport(modData) }}
                            disabled={liveScore >= 100}
                            className="level-export-btn"
                            style={liveScore >= 100 ? { opacity: 0.4, cursor: 'not-allowed', pointerEvents: 'none' } : undefined}
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            <span className="level-export-label">Export</span>
                          </button>
                          {liveScore >= 100 && (
                            <span className="md-tooltip" style={{ width: 180, zIndex: 1000, bottom: 'auto', top: 'calc(100% + 6px)' }}>All items complete — nothing left to export</span>
                          )}
                        </span>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); if (!requested) handleReanalyze(modData.id, reqValues) }}
                        disabled={reanalyzing || requested}
                        className={`level-reanalyze-btn${reanalyzing ? ' btn-analysing' : ''}${requested ? ' btn-requested' : ''}`}
                        title={requested ? 'Analysis request sent — pending admin review' : effectiveLastAnalyzedAt ? 'Re-analyse' : 'Analyse'}
                        style={requested ? { opacity: 1, color: 'var(--gold)', borderColor: 'var(--gold)', cursor: 'default' } : undefined}
                      >
                        {reanalyzing ? (
                          <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" style={{animation:'md-spin .7s linear infinite',flexShrink:0,verticalAlign:'middle'}}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.35"/><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg><span className="level-reanalyze-label">{runsDirect ? 'Analysing…' : 'Requesting…'}</span></>
                        ) : requested ? (
                          <>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                              <path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                            <span className="level-reanalyze-label">Requested</span>
                          </>
                        ) : (
                          <>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M3 3v5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M16 16h5v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <span className="level-reanalyze-label">{effectiveLastAnalyzedAt ? 'Re-analyse' : 'Analyse'}</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  <svg className="chev" width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>

                {unlockEl}

                {/* Level body */}
                <div className="level-body" style={{ maxHeight: isOpen ? '9999px' : undefined }}>
                  {planLocked && (
                    <div className="gp-pro-panel">
                      <div>
                        <div className="gp-pro-panel-title"><span className="pro-badge">Pro</span> Unlock {modData.name}</div>
                        <p className="gp-pro-panel-text">{def.description ? `${def.description} ` : ''}Analyse it, get fixes and track it with GrowJin Pro.</p>
                      </div>
                      <Link href="/pricing" className="gp-pro-panel-cta">See Pro plans</Link>
                    </div>
                  )}
                  {isLocked ? (
                    <div className="md-cats" style={{ pointerEvents: 'none', opacity: 0.6 }}>
                      {def.categories.map((cat) => (
                        <div key={cat.slug} className="md-cat">
                          <div className="md-cat-hd" style={{ cursor: 'default' }}>
                            <div className="md-cat-hd-left">
                              <span className="md-cat-hd-name">{cat.label}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (<>

                    {/* Requirements setup */}
                    {!def.comingSoon && needsSetup && (
                      <div className="md-setup-card" style={{ margin: '20px 28px 0' }}>
                        <div className="md-setup-title">Set up {def.name}</div>
                        <p className="md-setup-desc">Provide the information below before running the analysis.</p>
                        <div className="md-setup-fields">
                          {def.requirements.map((req) => {
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
                          disabled={reanalyzing || requested || missingReqs.length > 0}
                          onClick={() => { if (!requested) handleReanalyze(modData.id, reqValues, reqValues) }}
                          className={`mt-3 gap-1.5 font-semibold${reanalyzing ? ' btn-analysing' : ''}`}
                          style={requested
                            ? { background: 'transparent', border: '1px solid var(--gold)', color: 'var(--gold)', cursor: 'default' }
                            : { background: 'var(--green)', color: '#ffffff' }}
                        >
                          {reanalyzing ? (
                            <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{animation:'md-spin .7s linear infinite',flexShrink:0,verticalAlign:'middle'}}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.35"/><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>{runsDirect ? 'Analysing…' : 'Requesting…'}</>
                          ) : requested ? (
                            <>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                                <path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              </svg>
                              Analysis Requested
                            </>
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
                      <div className="gp-inset-panel" style={{ margin: '16px 28px 0', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10 }}>
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
                                <><svg width="10" height="10" viewBox="0 0 24 24" fill="none" style={{animation:'md-spin .7s linear infinite',flexShrink:0,verticalAlign:'middle'}}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.35"/><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>Running…</>
                              ) : 'Save & Re-analyse'}
                            </button>
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
                              This module identifies potential clients from your website and lets you generate and send cold emails directly from GrowJin.
                            </div>
                          </div>
                          <a
                            href="/api/gmail/connect"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 22px', borderRadius: 10, background: 'var(--green)', border: 'none', fontSize: 13.5, fontWeight: 700, color: '#ffffff', textDecoration: 'none', transition: '.15s' }}
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

                    {/* Outside the setup form so it's visible for modules that never show one (e.g. Foundation) */}
                    {setupError && !needsSetup && <p className="md-setup-error gp-run-msg" role="alert">{setupError}</p>}
                    {/* The top panel + floating pill already show the main run; this covers any other run going at the same time. */}
                    {reanalyzing && runsDirect && !setupError && liveMod?.id !== modData.id && (() => {
                      const rp = runProgress(modData)
                      return (
                        <div className="gp-progress" role="status" aria-live="polite">
                          <div className="gp-progress-hd">
                            <span>{effectiveLastAnalyzedAt ? 'Re-analysing' : 'Analysing'} your site</span>
                          </div>
                          <ol className="gp-progress-steps">
                            {rp.steps.map((st, i) => (
                              <li key={st.key} className={i < rp.idx ? 'is-done' : i === rp.idx ? 'is-now' : ''}>
                                <span className="gp-progress-dot" aria-hidden="true">{i < rp.idx ? '✓' : ''}</span>
                                {st.label}
                              </li>
                            ))}
                          </ol>
                          <p className="gp-progress-note">{rp.slow ? 'Taking longer than usual, but still working. ' : 'Usually 1–3 minutes. '}You can leave this page; results will be here when you come back.</p>
                        </div>
                      )
                    })()}

                    {/* Result summary and the one item to start with. */}
                    {!def.comingSoon && !needsSetup && !!effectiveLastAnalyzedAt && (() => {
                      const sum = bandSummary(modData)
                      if (!sum) return null
                      return (
                        <>
                          <div className={`gp-sum${stageCardEl ? '' : ' gp-sum--solo'}`}>
                            <div className="gp-sum-result">
                              <div className="gp-sum-eyebrow">Result</div>
                              <div className="gp-sum-score">
                                <div className="gp-sum-ring" role="img" aria-label={`Score ${liveScore} percent`}><LevelRing score={liveScore} /></div>
                                <div className="gp-sum-text">
                                  <b className="gp-sum-head">
                                    {sum.needs === 0
                                      ? 'Everything here is done'
                                      : `${sum.needs} ${sum.needs === 1 ? 'area needs' : 'areas need'} attention, ${sum.pass} ${sum.pass === 1 ? 'is' : 'are'} passing`}
                                  </b>
                                  <span className="gp-sum-sub">
                                    {sum.openItems > 0 ? `${sum.openItems} ${sum.openItems === 1 ? 'thing' : 'things'} to fix` : 'Nothing left to fix'}
                                  </span>
                                </div>
                              </div>
                            </div>
                            {stageCardEl}
                          </div>
                          {sum.first && (
                            <div className="gp-fix">
                              <div className="gp-fix-body">
                                <div className="gp-sum-eyebrow">Fix this first</div>
                                <b className="gp-fix-title">{sum.first.label}</b>
                                {/* The first step, in one sentence (the full steps open with "Show me how") */}
                                {sum.first.action && <span className="gp-fix-step">{firstSentence(sum.first.action)}</span>}
                                <span className="gp-sum-sub">{sum.first.catLabel} · lifts it from {sum.first.catPct}% toward 100%</span>
                              </div>
                              <button type="button" className="gp-fix-cta" onClick={() => focusItem(modData.id, sum.first!.catSlug, sum.first!.itemSlug)}>Show me how</button>
                            </div>
                          )}
                        </>
                      )
                    })()}

                    {/* Playbook — Foundation module only: the deliverable the analysis produces, below the summary. */}
                    {modData.type === 'foundation' && (
                      <section className={`gp-pb${playbookOpen ? ' is-open' : ''}`} aria-label="Sales playbook">
                        <div
                          className="gp-pb-hd"
                          role="button"
                          tabIndex={0}
                          aria-expanded={playbookOpen}
                          onClick={() => { if (!playbookEditing) setPlaybookOpen(v => !v) }}
                          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !playbookEditing && setPlaybookOpen(v => !v)}
                        >
                          <span className="gp-pb-icon" aria-hidden="true">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </span>
                          <span className="gp-pb-title">
                            <b>Sales playbook</b>
                            <span>ICP, email templates, call scripts and objection handlers</span>
                          </span>
                          <span className="gp-pb-actions">
                            {playbookData
                              ? <span className="gp-pb-chip">Generated{playbookData.generatedAt ? ` · ${new Date(playbookData.generatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}</span>
                              : reanalyzing
                                ? <span className="gp-pb-chip is-busy"><Spinner size={10} />Generating…</span>
                                : <span className="gp-pb-chip is-empty">Not generated yet</span>}
                            {playbookData && !playbookEditing && (
                              <button
                                type="button"
                                className="gp-pb-btn"
                                onClick={(e) => { e.stopPropagation(); setPlaybookDraft({ ...playbookData }); setPlaybookEditing(true); setPlaybookOpen(true) }}
                              >
                                Edit
                              </button>
                            )}
                            {!playbookEditing && (
                              <span className="gp-pb-toggle">
                                {playbookOpen ? 'Hide' : 'View'}
                                <svg className="gp-pb-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                  <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              </span>
                            )}
                          </span>
                        </div>
                        {playbookOpen && (
                          <div className="gp-pb-body playbook-scroll">
                            {!playbookData ? (
                              <p className="gp-pb-empty">
                                The AI will read your website and generate your full Sales Playbook — email templates, call scripts, objection handlers, and more — when you run Foundation analysis.
                              </p>
                            ) : playbookEditing ? (
                              <div className="gp-pb-sections">
                                {PLAYBOOK_SECTIONS.map((section) => (
                                  <div key={section.id} className="gp-pb-sec">
                                    <h4 className="gp-pb-sec-title">{section.label}</h4>
                                    <div className="gp-pb-fields">
                                      {section.fields.map((field) => (
                                        <div key={field.key} className="gp-pb-field">
                                          <label htmlFor={`pb-${field.key}`}>{field.label}</label>
                                          <textarea
                                            id={`pb-${field.key}`}
                                            value={playbookDraft[field.key] ?? ''}
                                            onChange={(e) => setPlaybookDraft(prev => ({ ...prev, [field.key]: e.target.value }))}
                                            placeholder={field.placeholder}
                                            rows={field.rows}
                                          />
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="gp-pb-sections">
                                {PLAYBOOK_SECTIONS.map((section) => (
                                  <div key={section.id} className="gp-pb-sec">
                                    <h4 className="gp-pb-sec-title">{section.label}</h4>
                                    <div className="gp-pb-fields">
                                      {section.fields.map((field) => (
                                        <div key={field.key} className="gp-pb-field">
                                          <div className="gp-pb-field-label">{field.label}</div>
                                          <div className="gp-pb-field-text">
                                            {playbookData[field.key] || <span className="gp-pb-none">Not generated</span>}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {playbookOpen && playbookEditing && (
                          <div className="gp-pb-foot">
                            <button type="button" onClick={handlePlaybookSave} disabled={playbookSaving} className="gp-pb-save">
                              {playbookSaving ? <><Spinner />Saving…</> : playbookSaved ? 'Saved ✓' : 'Save changes'}
                            </button>
                            <button type="button" onClick={() => setPlaybookEditing(false)} className="gp-pb-btn">Cancel</button>
                          </div>
                        )}
                      </section>
                    )}

                    {modData.type === 'social-media' && effectiveLastAnalyzedAt && !needsSetup && (() => {
                      const profiles = (dynItems.find(i => i.slug === SOCIAL_SUMMARY_SLUG)?.aiData as { profiles?: SocialProfileSummary[] } | null)?.profiles
                      return profiles?.length ? <SocialProfilesOverview profiles={profiles} /> : null
                    })()}
                    {modData.type === 'content-audit' && effectiveLastAnalyzedAt && !needsSetup && (() => {
                      const overview = (dynItems.find(i => i.slug === CONTENT_SUMMARY_SLUG)?.aiData as { overview?: ContentOverview } | null)?.overview ?? null
                      const verdicts = pageVerdictsMap[modData.id] ?? []
                      return overview || verdicts.length ? <ContentPagesOverview overview={overview} verdicts={verdicts} /> : null
                    })()}
                    {modData.type === 'brand-audit' && effectiveLastAnalyzedAt && !needsSetup && (() => {
                      const basis = (dynItems.find(i => i.slug === BRAND_SUMMARY_SLUG)?.aiData as { basis?: BrandBasis } | null)?.basis
                      return basis ? <BrandBasisOverview basis={basis} /> : null
                    })()}

                    <div className={`md-cats${reanalyzing && !effectiveLastAnalyzedAt ? ' gp-cats--loading' : ''}`} style={(modData.type === 'business-stage' || modData.type === 'gmail-outreach') ? { display: 'none' } : needsSetup ? { opacity: 0.4, pointerEvents: 'none' } : {}}>
                      {def.comingSoon ? (
                        <ComingSoon
                          variant="module"
                          title={def.name}
                          note={def.comingSoonNote ?? 'This module is in active development and will be available in an upcoming update.'}
                        />
                      ) : hasCatList && catsOrdered.length > 0 && (
                        <div className="gp-md" role="tablist" aria-label="Categories">
                          {needRows.length > 0 && <div className="gp-catlabel">Needs attention</div>}
                          {needRows.map(r => catGroup(r, false))}
                          {passRows.length > 0 && (narrow ? (
                            <button
                              type="button"
                              className="gp-catlabel gp-catlabel--toggle"
                              aria-expanded={passShown}
                              onClick={() => setPassOpenMap(prev => ({ ...prev, [modData.id]: !passShown }))}
                            >
                              <span>Passing ({passRows.length})</span>
                              <svg className="gp-cat-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                          ) : <div className="gp-catlabel">Passing ({passRows.length})</div>)}
                          {(!narrow || passShown) && passRows.map(r => catGroup(r, true))}
                          {!effectiveLastAnalyzedAt && otherRows.length > 0 && <div className="gp-catlabel">Checks</div>}
                          {!effectiveLastAnalyzedAt && otherRows.map(r => catGroup(r, false))}
                          {ideaRows.length > 0 && (
                            <>
                              <div className="gp-catlabel">Ideas · not scored</div>
                              {ideaRows.map(r => catGroup(r, false))}
                            </>
                          )}
                          {uncheckedRows.length > 0 && (
                            <>
                              <div className="gp-catlabel">Not checked this time</div>
                              {uncheckedRows.map(r => catGroup(r, false))}
                            </>
                          )}
                          {unrunRows.length > 0 && (
                            <>
                              <div className="gp-catlabel">New checks · re-analyse to run them</div>
                              {unrunRows.map(r => catGroup(r, false))}
                            </>
                          )}
                          {effectiveLastAnalyzedAt && otherRows.length > 0 && (narrow ? (
                            <p className="gp-soon-note">{otherRows.length} more {otherRows.length === 1 ? 'area' : 'areas'} coming soon</p>
                          ) : (
                            <>
                              <div className="gp-catlabel">Coming soon</div>
                              {otherRows.map(r => catGroup(r, false))}
                            </>
                          ))}
                        </div>
                      )}
                      {hasCatList && modData.type === 'meta-ads' && (
                        <a
                          href="/dashboard/meta-ads/blueprint"
                          className="ncb-cta-row"
                        >
                          <span className="ncb-cta-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                            </svg>
                          </span>
                          <span className="ncb-cta-text">
                            <span className="ncb-cta-label">Next Campaign Blueprint</span>
                            <span className="ncb-cta-sub">AI-generated plan for your next Meta ad campaign</span>
                          </span>
                          <svg className="ncb-cta-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 12.5h14M12 5l7 7-7 7"/>
                          </svg>
                        </a>
                      )}
                    </div>

                  </>)}
                </div>
              </div>
            </div>
            )
          })
        })()}
        </div>
        </div>

        {/* Growth stage note: inside the result summary once a module is analysed, otherwise above the module. */}
        {!bandSummary(selectedModule) && stageCardEl}
        </div>

      </div>

      {/* Export Prep Modal */}
      {exportPrepOpen && exportPrepModuleId && (() => {
        const modData = allModulesData.find(m => m.id === exportPrepModuleId)
        if (!modData) return null
        return (
          <ExportPrepModal
            moduleName={modData.name}
            singleIssue={!!exportPrepSlug}
            onDownload={async () => {
              await performDownload(modData, exportPrepSlug ?? undefined)
              setExportPrepOpen(false)
              setExportPrepSlug(null)
            }}
            onSkip={() => { setExportPrepOpen(false); setExportPrepSlug(null) }}
            onMarkConnected={() => {
              if (typeof window !== 'undefined') localStorage.setItem('growjin_mcp_connected', 'true')
            }}
          />
        )
      })()}
      {handoff.modal}
      {isAdmin && <NotesDrawer open={notesOpen} onClose={() => setNotesOpen(false)} />}
    </>
  )
}
