import { NextResponse } from 'next/server'
import { requirePro } from '@/lib/billing/guard'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { suggestFilters } from '@/lib/leads/suggest-filters'

export const maxDuration = 60

// The LinkedIn search form's starting values, worked out from the brand's website analysis
export async function GET() {
  const proBlock = await requirePro()
  if (proBlock) return proBlock
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  try {
    const filters = await suggestFilters(brand.id)
    if (!filters) return NextResponse.json({ error: 'We could not work out who to look for from your website yet. Fill the search in by hand.' }, { status: 422 })
    return NextResponse.json({ filters })
  } catch (e) {
    console.error('[linkedin-suggest] failed:', e)
    return NextResponse.json({ error: 'We could not work out who to look for just now. Fill the search in by hand.' }, { status: 502 })
  }
}
