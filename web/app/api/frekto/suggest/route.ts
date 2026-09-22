import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { generatePostSuggestions } from '@/lib/frekto/suggest'

export const maxDuration = 90

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { moduleId } = await request.json() as { moduleId: string }
  if (!moduleId) return NextResponse.json({ error: 'moduleId is required' }, { status: 400 })

  const [mod] = await db.select().from(modules).where(eq(modules.id, moduleId)).limit(1)
  if (!mod) return NextResponse.json({ error: 'Module not found' }, { status: 404 })

  const [brand] = await db.select().from(brands).where(eq(brands.id, mod.brandId)).limit(1)
  if (!brand || brand.userId !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const suggestions = await generatePostSuggestions({ brand, moduleId })
    return NextResponse.json({ suggestions })
  } catch (e) {
    console.error('[suggest] failed:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
