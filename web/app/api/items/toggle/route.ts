import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, channels, channelItems } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { channelId, itemSlug, checked } = await request.json()

  // Verify ownership
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId))
  if (!channel) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [brand] = await db.select().from(brands).where(eq(brands.id, channel.brandId))
  if (!brand || brand.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await db
    .insert(channelItems)
    .values({
      channelId,
      itemSlug,
      userChecked: checked,
      userCheckedAt: checked ? new Date() : null,
    })
    .onConflictDoUpdate({
      target: [channelItems.channelId, channelItems.itemSlug],
      set: {
        userChecked: checked,
        userCheckedAt: checked ? new Date() : null,
        updatedAt: new Date(),
      },
    })

  return NextResponse.json({ ok: true })
}
