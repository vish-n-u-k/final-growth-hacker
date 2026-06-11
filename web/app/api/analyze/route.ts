import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, channels, channelItems } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { fetchWebsiteContent } from '@/lib/analyzer/fetch'
import { analyzeWithClaude } from '@/lib/analyzer/claude'

// Allow up to 90s — website fetch + Claude can take a while
export const maxDuration = 90

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { channelId } = await request.json()

  // Verify the channel belongs to this user
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId))
  if (!channel) return NextResponse.json({ error: 'Channel not found' }, { status: 404 })

  const [brand] = await db.select().from(brands).where(eq(brands.id, channel.brandId))
  if (!brand || brand.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // 1. Fetch website content
  const content = await fetchWebsiteContent(channel.url)

  if (!content.html) {
    return NextResponse.json(
      { error: `Could not fetch ${channel.url}. Please check the URL is publicly accessible.` },
      { status: 400 },
    )
  }

  // 2. Run Claude analysis
  let results
  try {
    results = await analyzeWithClaude(
      channel.url,
      content.html,
      content.robotsTxt,
      content.sitemapXml,
      channel.type,
    )
  } catch (err) {
    console.error('Claude analysis failed:', err)
    return NextResponse.json({ error: 'Analysis failed. Please try again.' }, { status: 500 })
  }

  // 3. Upsert channel_items — preserve user_checked, update ai fields only
  await Promise.all(
    results.map((result) =>
      db
        .insert(channelItems)
        .values({
          channelId: channel.id,
          itemSlug: result.slug,
          aiDetail: result.detail,
          aiVerified: result.verified,
          aiVerifiedAt: result.verified ? new Date() : null,
        })
        .onConflictDoUpdate({
          target: [channelItems.channelId, channelItems.itemSlug],
          set: {
            aiDetail: result.detail,
            aiVerified: result.verified,
            aiVerifiedAt: result.verified ? new Date() : null,
            updatedAt: new Date(),
          },
        }),
    ),
  )

  // 4. Update last analysed timestamp
  await db
    .update(channels)
    .set({ lastAnalyzedAt: new Date() })
    .where(eq(channels.id, channel.id))

  return NextResponse.json({ ok: true, itemCount: results.length })
}
