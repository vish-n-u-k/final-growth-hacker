import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { generatePlaybook } from '@/lib/playbook/generator'
import { fetchFoundationData } from '@/lib/modules/foundation/fetcher'
import { getRelevantContext } from '@/lib/brain'

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()

  await db.update(brands)
    .set({ playbook: body })
    .where(eq(brands.userId, user.id))

  return NextResponse.json({ ok: true })
}

export async function POST(_request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand found' }, { status: 404 })

  const [prefetch, brainCtx] = await Promise.all([
    fetchFoundationData({ website_url: brand.websiteUrl }),
    getRelevantContext(brand.id, 'playbook', 'Sales playbook generation with accumulated brand intelligence').catch(() => ''),
  ])

  const result = await generatePlaybook(prefetch, brand.name, brainCtx || undefined)
  if (!result) return NextResponse.json({ error: 'Could not fetch website' }, { status: 422 })

  await db.update(brands)
    .set({ playbook: result })
    .where(eq(brands.id, brand.id))

  return NextResponse.json({ ok: true })
}
