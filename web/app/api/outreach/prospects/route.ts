import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, outreachProspects } from '@/lib/db/schema'
import { eq, desc, and } from 'drizzle-orm'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  const prospects = await db
    .select()
    .from(outreachProspects)
    .where(eq(outreachProspects.brandId, brand.id))
    .orderBy(desc(outreachProspects.createdAt))
    .limit(500)

  return NextResponse.json({ prospects })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  const { prospects } = await req.json() as {
    prospects: { email: string; name?: string; domain?: string; rawInput?: string }[]
  }
  if (!Array.isArray(prospects) || prospects.length === 0)
    return NextResponse.json({ error: 'prospects array required' }, { status: 400 })

  // Skip emails already saved for this brand
  const existing = await db.select({ email: outreachProspects.email })
    .from(outreachProspects).where(eq(outreachProspects.brandId, brand.id))
  const seen = new Set(existing.map(e => e.email.toLowerCase()))
  const fresh = prospects.filter(p => {
    const key = p.email?.trim().toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (fresh.length === 0) return NextResponse.json({ ids: [] }, { status: 200 })

  const rows = await db.insert(outreachProspects).values(
    fresh.map(p => ({
      brandId:  brand.id,
      email:    p.email.trim(),
      name:     p.name ?? null,
      domain:   p.domain ?? null,
      rawInput: p.rawInput ?? null,
    }))
  ).returning({ id: outreachProspects.id })

  return NextResponse.json({ ids: rows.map(r => r.id) }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  const { id } = await req.json() as { id: string }
  await db.delete(outreachProspects)
    .where(and(eq(outreachProspects.id, id), eq(outreachProspects.brandId, brand.id)))

  return NextResponse.json({ ok: true })
}
