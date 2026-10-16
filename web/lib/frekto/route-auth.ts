import { NextResponse } from 'next/server'
import { requirePro } from '@/lib/billing/guard'
import { createClient } from '@/lib/supabase/server'
import { getBrandForUser } from '@/lib/server-session'

// Shared guard for Social Studio routes: Pro + signed in + has a brand
export async function socialBrand(): Promise<{ brandId: string } | { response: NextResponse }> {
  const proBlock = await requirePro()
  if (proBlock) return { response: proBlock }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const brand = await getBrandForUser(user.id)
  if (!brand) return { response: NextResponse.json({ error: 'Brand not found' }, { status: 404 }) }
  return { brandId: brand.id }
}
