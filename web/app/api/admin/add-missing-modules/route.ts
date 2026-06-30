import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules, moduleCategories } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { MODULE_REGISTRY } from '@/lib/modules/registry'
import { isDynamicCategory, type ModuleDefinition, type ModuleCategoryDefinition } from '@/lib/modules/types'

// Helper to seed module structure
async function seedModuleStructure(moduleId: string, def: ModuleDefinition) {
  for (const cat of def.categories) {
    await db
      .insert(moduleCategories)
      .values({ moduleId, parentId: null, slug: cat.slug, label: cat.label, order: cat.order })
      .onConflictDoNothing()

    if (def.dynamic || isDynamicCategory(cat)) continue

    // Static module: seed subcategories and empty item rows
    for (const sub of (cat as ModuleCategoryDefinition).subCategories || []) {
      await db
        .insert(moduleCategories)
        .values({ moduleId, parentId: moduleId, slug: sub.slug, label: sub.label, order: sub.order })
        .onConflictDoNothing()
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await request.json()

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    // Get user's brand
    const [brand] = await db.select().from(brands).where(eq(brands.userId, userId))

    if (!brand) {
      return NextResponse.json({ error: 'Brand not found for this user' }, { status: 404 })
    }

    // Get existing modules
    const existingModules = await db.select().from(modules).where(eq(modules.brandId, brand.id))
    const existingTypes = new Set(existingModules.map((m) => m.type))

    // Find missing modules
    const missingModules = MODULE_REGISTRY.filter((mod) => !existingTypes.has(mod.type))

    if (missingModules.length === 0) {
      return NextResponse.json({ message: 'All modules already exist', addedCount: 0 })
    }

    // Add missing modules
    const brandFields: Record<string, string | null> = {
      website_url: brand.websiteUrl,
      brand_name: brand.name,
      industry: brand.industry,
      target_audience: brand.targetAudience,
      usp: brand.usp,
      brand_voice: brand.brandVoice,
    }

    const addedModules = []

    for (const def of missingModules) {
      const requirements: Record<string, string> = {}
      for (const req of def.requirements) {
        const val = brandFields[req.key]
        if (val) requirements[req.key] = val
      }

      const [newModule] = await db
        .insert(modules)
        .values({
          brandId: brand.id,
          type: def.type,
          name: def.name,
          order: def.order,
          status: def.order === 0 ? 'pending' : 'locked',
          requirements: Object.keys(requirements).length > 0 ? requirements : null,
          score: 0,
        })
        .returning()

      await seedModuleStructure(newModule.id, def)
      addedModules.push({ id: newModule.id, type: def.type, name: def.name })
    }

    return NextResponse.json({
      message: `Added ${addedModules.length} missing module(s)`,
      addedCount: addedModules.length,
      modules: addedModules,
    })
  } catch (error) {
    console.error('Failed to add modules:', error)
    return NextResponse.json({ error: 'Failed to add modules' }, { status: 500 })
  }
}
