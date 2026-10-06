// ── Today's Tasks ─────────────────────────────────────────────────────────────
// Single source for "what should the user do today". Used by the daily email
// and the MCP (get_today_tasks tool + daily_growth_tasks prompt) so both agree.
//
// Up to 3 slots, filled in this order:
//   1. alert — something broke or changed (DNS, Meta Ads, business stage)
//   2. play  — the action that best fixes the current bottleneck (lib/daily/diagnosis.ts)
//   3. item  — a checklist quick win (concrete one-time fix only), preferring modules
//              that match the bottleneck
// Leftover slots are filled from whatever remains.

import { db } from '@/lib/db'
import { brands, brandIntegrations, modules, moduleItems, moduleCategories } from '@/lib/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { getOpenSignals, getSnapshot } from '@/lib/signals'
import { runDiagnosis, type Diagnosis, type GrowthStage } from '@/lib/daily/diagnosis'
import type { ActionCard, ActionCardType } from '@/lib/daily/signals'
import { MODULE_MAP } from '@/lib/modules/registry'

// How a task gets done:
//   code    — Claude changes the website codebase (GitHub repo)
//   content — Claude creates content (social posts, blog, emails) via connected tools
//   manual  — needs the human (external accounts, ads manager, DNS, real data)
export type TaskRoute = 'code' | 'content' | 'manual'

export interface TodayTask {
  id: string
  key: string // signal key or checklist item slug
  // alert / play → complete with resolve_signal; item → complete with toggle_item
  kind: 'alert' | 'play' | 'item'
  label: string
  priority: 'critical' | 'important' | 'minor'
  route: TaskRoute
  module: string
  moduleType: string
  moduleId: string | null
  category: string
  finding: string | null // why this task, with the numbers behind it
  action: string | null
  needsUserInput: boolean
}

export interface TodayTasks {
  brandName: string
  websiteUrl: string | null
  githubRepo: string | null
  focus: { stage: GrowthStage; summary: string; computedAt: string } | null
  tasks: TodayTask[]
}

const WEIGHT_LABEL: Record<number, TodayTask['priority']> = { 3: 'critical', 2: 'important', 1: 'minor' }

const CODE_MODULES = new Set(['foundation', 'seo', 'geo', 'geo-competitor-gap'])
const CONTENT_MODULES = new Set(['social-media', 'content-audit', 'community-finder'])

// Checklist modules that help with each bottleneck
const STAGE_MODULES: Record<GrowthStage, Set<string>> = {
  awareness: new Set(['seo', 'geo', 'geo-competitor-gap', 'content-audit', 'social-media', 'backlinks']),
  conversion: new Set(['foundation', 'brand-audit']),
  retention: new Set(['email-marketing', 'user-analytics']),
  growth: new Set(['seo', 'social-media', 'backlinks', 'outreach-targets']),
  unknown: new Set(['foundation']),
}
const CONVERSION_SLUG = /cta|value|proof|testimonial|trust|pricing|headline|hero|h1/i

const DIAGNOSIS_MAX_AGE_MS = 20 * 3600000

function routeFor(exportType: string | null, moduleType: string): TaskRoute {
  if (exportType === 'auto' || exportType === 'needs_choice') return 'code'
  if (exportType === 'external' || exportType === 'skip') return 'manual'
  if (CODE_MODULES.has(moduleType)) return 'code'
  if (CONTENT_MODULES.has(moduleType)) return 'content'
  return 'manual'
}

// diagnose: 'auto' recomputes when the stored diagnosis is missing or older than 20h
// (live GA4 / GSC / PostHog calls, a few seconds). 'never' only reads the stored one —
// used by the email cron, which runs after the daily-signals cron has refreshed it.
export async function getTodayTasks(
  brandId: string,
  limit = 3,
  opts: { diagnose?: 'auto' | 'never' } = {},
): Promise<TodayTasks | null> {
  const [brand] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1)
  if (!brand) return null

  // Signal tables may not exist before the migration — degrade to checklist only
  let diagnosis = await getSnapshot<Diagnosis>(brandId, 'diagnosis').catch(() => null)
  const stale = !diagnosis || Date.now() - new Date(diagnosis.computedAt).getTime() > DIAGNOSIS_MAX_AGE_MS
  if (stale && opts.diagnose !== 'never') {
    const prev = diagnosis
    diagnosis = await runDiagnosis(brandId).catch((err) => {
      console.error('[today-tasks] diagnosis failed:', err)
      return prev
    })
  }
  const stage: GrowthStage = diagnosis?.stage ?? 'unknown'

  const [[github], allModules, signals] = await Promise.all([
    db.select({ metadata: brandIntegrations.metadata })
      .from(brandIntegrations)
      .where(and(
        eq(brandIntegrations.brandId, brandId),
        eq(brandIntegrations.provider, 'github'),
        eq(brandIntegrations.status, 'connected'),
      ))
      .limit(1),
    db.select().from(modules).where(eq(modules.brandId, brandId)).orderBy(modules.order),
    getOpenSignals(brandId).catch(() => []),
  ])
  const githubRepo = (github?.metadata as Record<string, string> | null)?.repo_url ?? null
  const activeModules = allModules.filter((m) => m.status !== 'locked' && m.status !== 'not-applicable')
  const modByType = new Map(activeModules.map((m) => [m.type, m]))

  // ── Alerts + plays (both stored as signals) ────────────────────────────────
  signals.sort((a, b) => b.priority - a.priority || (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
  const toTask = (s: (typeof signals)[number]): TodayTask => {
    const isPlay = s.source === 'diagnosis'
    const mod = modByType.get(s.source)
    return {
      id: s.id,
      key: s.signalKey,
      kind: isPlay ? 'play' : 'alert',
      label: s.title,
      priority: WEIGHT_LABEL[s.priority] ?? 'important',
      route: (s.route as TaskRoute) ?? 'manual',
      module: isPlay ? 'Growth focus' : mod?.name ?? s.source,
      moduleType: s.source,
      moduleId: mod?.id ?? null,
      category: isPlay ? `Focus: ${stage}` : 'Alert',
      finding: s.detail,
      action: s.action,
      needsUserInput: false,
    }
  }
  const alerts = signals.filter((s) => s.source !== 'diagnosis').map(toTask)
  const plays = signals.filter((s) => s.source === 'diagnosis').map(toTask)

  // ── Checklist items, boosted when they match the bottleneck ────────────────
  const moduleIds = activeModules.map((m) => m.id)
  const [items, cats] = moduleIds.length
    ? await Promise.all([
        db.select().from(moduleItems).where(inArray(moduleItems.moduleId, moduleIds)),
        db.select().from(moduleCategories).where(inArray(moduleCategories.moduleId, moduleIds)),
      ])
    : [[], []]
  const modMap = new Map(activeModules.map((m) => [m.id, m]))
  const catMap = new Map(cats.map((c) => [c.id, c]))

  const matchesStage = (i: (typeof items)[number]) => {
    if (stage === 'conversion' && CONVERSION_SLUG.test(i.slug)) return true
    return STAGE_MODULES[stage].has(modMap.get(i.moduleId)?.type ?? '')
  }
  // critical+match > critical > important+match > important > ...
  const score = (i: (typeof items)[number]) => (i.weight ?? 1) * 2 + (matchesStage(i) ? 1 : 0)

  // Quick wins must be concrete one-time fixes: fixed checklist checks (Foundation, SEO, GEO…)
  // or items flagged as fixable in code. AI-generated strategy advice ("make educational
  // content your main pillar") stays in its module, not in today's list.
  const isConcrete = (i: (typeof items)[number]) => {
    const type = modMap.get(i.moduleId)?.type ?? ''
    return !MODULE_MAP[type]?.dynamic || !!i.fixable || i.exportType === 'auto' || i.exportType === 'needs_choice'
  }

  // Pending = not verified, not checked, not skipped, actually analysed, and concrete
  const pending = items.filter((i) => !i.aiVerified && !i.userChecked && !i.userSkipped && i.aiDetail && isConcrete(i))
  pending.sort((a, b) =>
    score(b) - score(a) ||
    (modMap.get(a.moduleId)?.order ?? 99) - (modMap.get(b.moduleId)?.order ?? 99) ||
    a.slug.localeCompare(b.slug),
  )
  const itemTasks = pending.slice(0, limit).map((item): TodayTask => {
    const mod = modMap.get(item.moduleId)!
    return {
      id: item.id,
      key: item.slug,
      kind: 'item',
      label: item.label,
      priority: WEIGHT_LABEL[item.weight ?? 1] ?? 'minor',
      route: routeFor(item.exportType ?? null, mod.type),
      module: mod.name,
      moduleType: mod.type,
      moduleId: mod.id,
      category: catMap.get(item.categoryId)?.label ?? 'Uncategorized',
      finding: item.aiDetail ?? null,
      action: item.aiAction ?? null,
      needsUserInput: item.exportType === 'needs_choice' && !item.userChoice,
    }
  })

  // ── Fill slots: alert → play → quick win → leftovers ──────────────────────
  const tasks: TodayTask[] = []
  const take = (list: TodayTask[], n: number) => {
    while (n-- > 0 && list.length && tasks.length < limit) tasks.push(list.shift()!)
  }
  take(alerts, 1)
  take(plays, 1)
  take(itemTasks, 1)
  take(alerts, limit) // more breakage beats more suggestions
  take(plays, limit)
  take(itemTasks, limit)

  return {
    brandName: brand.name,
    websiteUrl: brand.websiteUrl ?? null,
    githubRepo,
    focus: diagnosis ? { stage: diagnosis.stage, summary: diagnosis.summary, computedAt: diagnosis.computedAt } : null,
    tasks,
  }
}

// Cards for the in-app /today page. Plays the page can act on inline (outreach,
// social post, blog) keep those card types so the existing inline panels open.
const PLAY_SETTINGS = new Set(['connect-ga4', 'fix-ga4-tracking'])

export function tasksToCards(today: TodayTasks): ActionCard[] {
  return today.tasks.map((t, i): ActionCard => {
    let type: ActionCardType = t.kind === 'alert' ? 'alert' : t.kind === 'play' ? 'play' : 'module-item'
    if (t.key === 'social-post') type = 'social'
    else if (t.key === 'outreach-batch') type = 'outreach'
    else if (t.key === 'blog-weekly' || t.key.startsWith('blog-query:')) type = 'blog'

    const ctaUrl = t.moduleId ? `/dashboard/${t.moduleId}` : PLAY_SETTINGS.has(t.key) ? '/settings' : '/dashboard'
    return {
      id: `${t.kind}-${t.id}`,
      type,
      priority: i,
      headline: t.label,
      reason: t.finding ?? '',
      cta: t.moduleId ? `Open ${t.module}` : PLAY_SETTINGS.has(t.key) ? 'Open settings' : 'Open modules',
      ctaUrl,
      sourceModule: t.moduleId ?? undefined,
      data: { taskKind: t.kind, taskId: t.id, action: t.action, route: t.route },
    }
  })
}

// Prompt handed to Claude (email deep link + MCP prompt). Keeps instructions in
// one place so the email and MCP never drift apart.
export function buildTodayPrompt(t: Pick<TodayTasks, 'brandName' | 'websiteUrl' | 'githubRepo'>): string {
  return [
    `Use the GrowJin MCP to work through today's growth tasks for ${t.brandName}${t.websiteUrl ? ` (${t.websiteUrl})` : ''}.`,
    '',
    '1. Call get_today_tasks. Start by telling me today\'s focus (my current bottleneck) in one sentence.',
    `2. For each "code" task: make the change in the website codebase${t.githubRepo ? ` (${t.githubRepo})` : ''} and open a pull request. If you cannot edit the repo here, give me the exact code change to apply.`,
    '3. For each "content" task: draft the content (blog copy, emails). For social posts use create_social_post, show me the preview, and only call schedule_social_post after I approve.',
    '4. For each "manual" task: give me short step-by-step instructions.',
    '5. If a task needs real data from me (stats, testimonials, quotes), ask instead of inventing it.',
    '6. When a task is done: if its kind is "item", call toggle_item with its id and checked=true; if its kind is "alert" or "play", call resolve_signal with its id and status="done".',
  ].join('\n')
}
