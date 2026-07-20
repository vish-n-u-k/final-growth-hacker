import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { MODULE_MAP } from '@/lib/modules/registry'

// Finds an existing module by type for the user's brand, or creates it if missing.
// Used when a module was added to the registry after the user onboarded.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { type } = (await request.json()) as { type: string }

  const def = MODULE_MAP[type]
  if (!def) return NextResponse.json({ error: 'Unknown module type' }, { status: 400 })

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  const allMods = await db.select().from(modules).where(eq(modules.brandId, brand.id))
  const existing = allMods.find((m) => m.type === type)
  if (existing) return NextResponse.json({ moduleId: existing.id })

  const [newMod] = await db
    .insert(modules)
    .values({
      brandId: brand.id,
      type,
      name: def.name,
      order: def.order,
      status: 'pending',
      requirements: {},
    })
    .returning()

  return NextResponse.json({ moduleId: newMod.id })
}
