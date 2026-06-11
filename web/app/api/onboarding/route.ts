import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, channels } from '@/lib/db/schema'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { brandName, websiteUrl } = await request.json()

  if (!brandName?.trim() || !websiteUrl?.trim()) {
    return NextResponse.json({ error: 'Brand name and website URL are required' }, { status: 400 })
  }

  // Normalise URL — add https:// if missing
  const url = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`

  // Create brand
  const [brand] = await db
    .insert(brands)
    .values({ userId: user.id, name: brandName.trim() })
    .returning()

  // Create website channel
  const [channel] = await db
    .insert(channels)
    .values({ brandId: brand.id, type: 'website', url })
    .returning()

  return NextResponse.json({ brandId: brand.id, channelId: channel.id })
}
