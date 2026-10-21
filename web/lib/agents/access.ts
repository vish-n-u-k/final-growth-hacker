// Who can use the AI Agents: signed in, with a brand, on the early-access list, and on Pro when
// billing is on. API routes call agentAccess() and return its `error` response when set.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { requirePro } from '@/lib/billing/guard'
import { hasEarlyAccess } from '@/lib/early-access'
import { isComingSoon } from '@/lib/features'

export async function agentAccess(): Promise<{ brandId: string; error?: undefined } | { brandId?: undefined; error: NextResponse }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (isComingSoon('/agents', await hasEarlyAccess(user.email))) {
    return { error: NextResponse.json({ error: 'AI Agents are coming soon.' }, { status: 403 }) }
  }
  const pro = await requirePro()
  if (pro) return { error: pro }
  const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return { error: NextResponse.json({ error: 'No brand' }, { status: 404 }) }
  return { brandId: brand.id }
}
