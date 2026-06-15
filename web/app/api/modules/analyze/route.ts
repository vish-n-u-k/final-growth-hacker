import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules, moduleCategories, moduleItems } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { MODULE_MAP } from '@/lib/modules/registry'
import { fetchFoundationData } from '@/lib/modules/foundation/fetcher'
import { analyzeFoundation } from '@/lib/modules/foundation/agent'
import { fetchWebsiteData } from '@/lib/modules/website/fetcher'
import { analyzeWebsite } from '@/lib/modules/website/agent'
import { fetchSeoData } from '@/lib/modules/seo/fetcher'
import { analyzeSeo } from '@/lib/modules/seo/agent'
import type { ModuleAnalysisResult, DynamicModuleAnalysisResult } from '@/lib/modules/types'
import { getAllItems } from '@/lib/modules/types'
import { getRelevantContext, extractAndMergeFacts } from '@/lib/brain'

export const maxDuration = 90

async function runAnalysis(
  moduleType: string,
  requirements: Record<string, string>,
  brainCtx?: string,
): Promise<ModuleAnalysisResult[] | DynamicModuleAnalysisResult[]> {
  switch (moduleType) {
    case 'foundation': {
      const data = await fetchFoundationData(requirements)
      if (!data.html) throw new Error(`Could not fetch ${requirements['website_url']}`)
      return analyzeFoundation(data)
    }
    case 'website': {
      const data = await fetchWebsiteData(requirements)
      if ('error' in data) throw new Error(data.error)
      const url = requirements['website_url'] ?? ''
      return analyzeWebsite(data, url)
    }
    case 'seo': {
      const data = await fetchSeoData(requirements)
      if (!data.html) throw new Error(`Could not fetch ${requirements['website_url']}`)
      return analyzeSeo(data, brainCtx)
    }
    default:
      throw new Error(`No analyzer registered for module type: ${moduleType}`)
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { moduleId } = await request.json()

  const [mod] = await db.select().from(modules).where(eq(modules.id, moduleId))
  if (!mod) return NextResponse.json({ error: 'Module not found' }, { status: 404 })

  const [brand] = await db.select().from(brands).where(eq(brands.id, mod.brandId))
  if (!brand || brand.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const def = MODULE_MAP[mod.type]
  if (!def) return NextResponse.json({ error: 'Unknown module type' }, { status: 400 })

  await db.update(modules).set({ status: 'analyzing' }).where(eq(modules.id, moduleId))

  // Get relevant brain context to inject into this module's agent (skip for Foundation — runs first)
  let brainCtx: string | undefined
  if (def.order > 0) {
    try {
      brainCtx = await getRelevantContext(brand.id, mod.type, def.description)
    } catch {
      // Non-fatal — analysis continues without brain context
    }
  }

  let results: ModuleAnalysisResult[] | DynamicModuleAnalysisResult[]
  try {
    results = await runAnalysis(mod.type, (mod.requirements as Record<string, string>) ?? {}, brainCtx)
  } catch (err) {
    await db.update(modules).set({ status: 'pending' }).where(eq(modules.id, moduleId))
    console.error('Module analysis failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Analysis failed. Please try again.' },
      { status: 500 },
    )
  }

  if (def.dynamic) {
    // ── Dynamic module: Claude generates the items themselves ──────────────
    const dynamicResults = results as DynamicModuleAnalysisResult[]

    // Preserve any user_checked state before wiping items
    const existingItems = await db.select().from(moduleItems).where(eq(moduleItems.moduleId, moduleId))
    const userCheckedSlugs = new Set(existingItems.filter((i) => i.userChecked).map((i) => i.slug))

    // Delete all existing items for this module (fresh slate from Claude)
    if (existingItems.length > 0) {
      await db.delete(moduleItems).where(eq(moduleItems.moduleId, moduleId))
    }

    // Build category slug → id map
    const cats = await db.select().from(moduleCategories).where(eq(moduleCategories.moduleId, moduleId))
    const catMap = new Map(cats.filter((c) => !c.parentId).map((c) => [c.slug, c.id]))

    // Insert fresh items from Claude, restoring user_checked where slug matches
    await Promise.all(
      dynamicResults.map((r) => {
        const categoryId = catMap.get(r.category)
        if (!categoryId) return Promise.resolve()
        const wasChecked = userCheckedSlugs.has(r.slug)
        return db.insert(moduleItems).values({
          moduleId,
          categoryId,
          slug: r.slug,
          label: r.label,
          weight: r.weight,
          aiDetail: r.detail,
          aiNarrative: r.narrative,
          aiAction: r.action,
          aiVerified: r.verified,
          aiVerifiedAt: r.verified ? new Date() : null,
          userChecked: wasChecked,
          userCheckedAt: wasChecked ? new Date() : null,
          completedBy: r.verified ? 'ai' : wasChecked ? 'user' : null,
          fixable: (r as DynamicModuleAnalysisResult).fixable ?? false,
          updatedAt: new Date(),
        })
      }),
    )
  } else {
    // ── Static module: items pre-seeded, update findings by slug ──────────
    const staticResults = results as ModuleAnalysisResult[]
    const defItemMap = new Map(getAllItems(def).map((i) => [i.slug, i]))
    await Promise.all(
      staticResults.map((r) => {
        const defItem = defItemMap.get(r.slug)
        return db
          .update(moduleItems)
          .set({
            aiDetail: r.detail,
            aiNarrative: r.narrative,
            aiAction: r.action,
            aiVerified: r.verified,
            aiVerifiedAt: r.verified ? new Date() : null,
            completedBy: r.verified ? 'ai' : null,
            fixable: !!(defItem?.fixable || defItem?.assistedInput),
            fixInputKey: defItem?.assistedInput?.key ?? null,
            fixIntegrationProvider: defItem?.assistedInput?.integrationProvider ?? null,
            updatedAt: new Date(),
          })
          .where(and(eq(moduleItems.moduleId, moduleId), eq(moduleItems.slug, r.slug)))
      }),
    )
  }

  // Compute score and update module status
  const allItems = await db.select().from(moduleItems).where(eq(moduleItems.moduleId, moduleId))
  const totalWeight = allItems.reduce((s, i) => s + i.weight, 0)
  const doneWeight = allItems.filter((i) => i.aiVerified || i.userChecked).reduce((s, i) => s + i.weight, 0)
  const score = totalWeight > 0 ? Math.round((doneWeight / totalWeight) * 100) : 0

  await db
    .update(modules)
    .set({ status: 'complete', score, lastAnalyzedAt: new Date() })
    .where(eq(modules.id, moduleId))

  // Unlock next module if score meets its threshold
  const nextDef = Object.values(MODULE_MAP).find((m) => m.order === def.order + 1)
  if (nextDef && score >= nextDef.unlockThreshold) {
    const brandMods = await db.select().from(modules).where(eq(modules.brandId, brand.id))
    const nextMod = brandMods.find((m) => m.type === nextDef.type)
    if (nextMod && nextMod.status === 'locked') {
      await db.update(modules).set({ status: 'pending' }).where(eq(modules.id, nextMod.id))
    }
  }

  // Extract facts from this module's results and merge into brain memory
  try {
    await extractAndMergeFacts(brand.id, mod.type, results)
  } catch (err) {
    console.error('Brain fact extraction failed (non-fatal):', err)
  }

  return NextResponse.json({ ok: true, itemCount: results.length })
}
