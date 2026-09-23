import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations, modules, frektoScheduledPosts } from '@/lib/db/schema'
import { eq, and, gte } from 'drizzle-orm'
import { generatePostSuggestions } from '@/lib/frekto/suggest'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const FREKTO_BASE = 'https://api.frekto.ai'

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const allBrands = await db.select().from(brands).where(eq(brands.frektoAutoPostEnabled, true))
  const results: { brandName: string; platform: string; status: string; error?: string }[] = []

  for (const brand of allBrands) {
    // Get frekto integration
    const [frektoInt] = await db
      .select()
      .from(brandIntegrations)
      .where(and(
        eq(brandIntegrations.brandId, brand.id),
        eq(brandIntegrations.provider, 'frekto'),
        eq(brandIntegrations.status, 'connected'),
      ))
      .limit(1)

    if (!frektoInt?.apiKey) continue

    const meta = (frektoInt.metadata as Record<string, string> | null) ?? {}
    const timezone = meta['timezone'] ?? 'UTC'
    const preferredTime = meta['preferred_time'] ?? '10:00'
    const autoPostPlatformsRaw = meta['auto_post_platforms'] ?? ''
    const autoPostPlatforms = autoPostPlatformsRaw
      .split(',')
      .map(p => p.trim().toLowerCase())
      .filter(Boolean)

    if (autoPostPlatforms.length === 0) continue

    // Find social-media module
    const [socialMod] = await db
      .select({ id: modules.id })
      .from(modules)
      .where(and(
        eq(modules.brandId, brand.id),
        eq(modules.type, 'social-media'),
      ))
      .limit(1)

    if (!socialMod) continue

    // Generate suggestions
    let suggestions
    try {
      suggestions = await generatePostSuggestions({ brand, moduleId: socialMod.id })
    } catch (e) {
      results.push({ brandName: brand.name, platform: 'all', status: 'error', error: String(e) })
      continue
    }

    // Dedup: start of today UTC
    const todayStart = new Date()
    todayStart.setUTCHours(0, 0, 0, 0)

    for (const s of suggestions) {
      if (!s.shouldPost) continue
      if (!autoPostPlatforms.includes(s.platform)) continue

      // Check dedup
      const existing = await db
        .select({ id: frektoScheduledPosts.id })
        .from(frektoScheduledPosts)
        .where(and(
          eq(frektoScheduledPosts.brandId, brand.id),
          eq(frektoScheduledPosts.platform, s.platform),
          gte(frektoScheduledPosts.createdAt, todayStart),
        ))
        .limit(1)

      if (existing.length > 0) continue

      // Build schedule params
      const schedDate = new Date(s.scheduledAt)
      const datePart = schedDate.toISOString().slice(0, 10)
      const timePart = preferredTime

      const postType = s.postType ?? 'image'
      const isVideo = postType === 'video'
      const outputFormat = isVideo ? 'mp4' : 'png'
      const formatMap: Record<string, string> = {
        instagram: '4:5', linkedin: '1:1', twitter: '1:1',
        facebook: '1:1', youtube: isVideo ? '16:9' : '1:1', tiktok: '9:16',
      }
      const format = formatMap[s.platform] ?? '1:1'

      try {
        const genRes = await fetch(`${FREKTO_BASE}/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${frektoInt.apiKey}`,
          },
          body: JSON.stringify({
            topic: s.topic,
            format,
            output_format: outputFormat,
            schedule: { start_date: datePart, time: timePart, timezone },
          }),
          signal: AbortSignal.timeout(15000),
        })

        if (!genRes.ok) {
          const errText = await genRes.text()
          results.push({ brandName: brand.name, platform: s.platform, status: 'frekto_error', error: errText })
          continue
        }

        const genData = await genRes.json() as { job_id?: string }
        if (!genData.job_id) {
          results.push({ brandName: brand.name, platform: s.platform, status: 'no_job_id' })
          continue
        }

        await db.insert(frektoScheduledPosts).values({
          brandId: brand.id,
          platform: s.platform,
          topic: s.topic,
          postType,
          scheduledAt: schedDate,
          frektoJobId: genData.job_id,
          status: 'scheduled',
        })

        results.push({ brandName: brand.name, platform: s.platform, status: 'scheduled' })
      } catch (e) {
        results.push({ brandName: brand.name, platform: s.platform, status: 'error', error: String(e) })
      }
    }
  }

  return NextResponse.json({ ok: true, results })
}
