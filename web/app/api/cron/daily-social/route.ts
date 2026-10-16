import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations, modules, frektoScheduledPosts, socialSuggestions } from '@/lib/db/schema'
import { eq, and, gte, inArray } from 'drizzle-orm'
import { generatePostSuggestions, savePostSuggestions } from '@/lib/frekto/suggest'
import { createDraft, formatFor, utcToZoned, validTimezone } from '@/lib/frekto/drafts'
import { zonedToUtc } from '@/lib/frekto/posts'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const FREKTO_BASE = 'https://api.frekto.ai'

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

// Auto-post modes (frekto integration metadata `auto_post_mode`):
//   'approve' (default) — render previews and leave them as drafts in Social Studio for the
//                         user to approve. Nothing is published without a click.
//   'auto'              — render and schedule straight away (the old behaviour).
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const allBrands = await db.select().from(brands).where(eq(brands.frektoAutoPostEnabled, true))
  const results: { brandName: string; platform: string; status: string; error?: string }[] = []

  for (const brand of allBrands) {
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
    const timezone = validTimezone(meta['timezone']) ? meta['timezone'] : 'UTC'
    const preferredTime = /^\d{2}:\d{2}$/.test(meta['preferred_time'] ?? '') ? meta['preferred_time'] : '10:00'
    const mode = meta['auto_post_mode'] === 'auto' ? 'auto' : 'approve'
    const autoPostPlatforms = (meta['auto_post_platforms'] ?? '')
      .split(',')
      .map(p => p.trim().toLowerCase())
      .filter(Boolean)

    if (autoPostPlatforms.length === 0) {
      results.push({ brandName: brand.name, platform: 'all', status: 'skipped', error: 'No auto-post platforms set' })
      continue
    }

    const [socialMod] = await db
      .select({ id: modules.id })
      .from(modules)
      .where(and(
        eq(modules.brandId, brand.id),
        eq(modules.type, 'social-media'),
      ))
      .limit(1)

    if (!socialMod) continue

    // Suggestions already skip platforms with a post due in the next 48h and topics
    // that were posted, queued or rejected before
    let suggestions
    try {
      suggestions = await generatePostSuggestions({ brand, moduleId: socialMod.id })
    } catch (e) {
      results.push({ brandName: brand.name, platform: 'all', status: 'error', error: String(e) })
      continue
    }
    suggestions = suggestions.filter(s => s.shouldPost && autoPostPlatforms.includes(s.platform))
    if (suggestions.length === 0) continue

    // Don't pile up: skip a platform that already got a post today or still has a preview waiting
    const todayStart = new Date()
    todayStart.setUTCHours(0, 0, 0, 0)
    const [madeToday, waiting] = await Promise.all([
      db.select({ platform: frektoScheduledPosts.platform })
        .from(frektoScheduledPosts)
        .where(and(
          eq(frektoScheduledPosts.brandId, brand.id),
          inArray(frektoScheduledPosts.status, ['draft', 'scheduling', 'scheduled', 'done']),
          gte(frektoScheduledPosts.createdAt, todayStart),
        )),
      db.select({ platform: frektoScheduledPosts.platform })
        .from(frektoScheduledPosts)
        .where(and(eq(frektoScheduledPosts.brandId, brand.id), eq(frektoScheduledPosts.status, 'draft'))),
    ])
    const busyPlatforms = new Set([...madeToday, ...waiting].map(r => r.platform))
    suggestions = suggestions.filter(s => !busyPlatforms.has(s.platform))
    if (suggestions.length === 0) continue

    const saved = await savePostSuggestions(brand.id, suggestions, 'auto')

    for (const s of saved) {
      if (!s.id) continue
      // Publish on the suggested day, at the brand's preferred time in its timezone
      const suggested = isNaN(Date.parse(s.scheduledAt)) ? new Date(Date.now() + 864e5) : new Date(s.scheduledAt)
      const day = utcToZoned(suggested, timezone).date
      const scheduledAt = zonedToUtc(day, preferredTime, timezone)

      if (mode === 'approve') {
        const draft = await createDraft(brand.id, {
          platform: s.platform, topic: s.topic, postType: s.postType, scheduledAt,
          source: 'auto', suggestionId: s.id, waitMs: 0,
        })
        results.push({ brandName: brand.name, platform: s.platform, status: draft.ok ? 'draft' : 'error', ...(draft.ok ? {} : { error: draft.error }) })
        continue
      }

      const postType = s.postType === 'video' ? 'video' : 'image'
      const { format, outputFormat } = formatFor(s.platform, postType)
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
            schedule: { start_date: day, time: preferredTime, timezone, platform: s.platform },
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

        const [row] = await db.insert(frektoScheduledPosts).values({
          brandId: brand.id,
          platform: s.platform,
          topic: s.topic,
          postType,
          scheduledAt,
          frektoJobId: genData.job_id,
          source: 'auto',
          suggestionId: s.id,
          status: 'scheduled',
        }).returning({ id: frektoScheduledPosts.id })
        await db.update(socialSuggestions)
          .set({ status: 'accepted', postId: row.id, updatedAt: new Date() })
          .where(eq(socialSuggestions.id, s.id))

        results.push({ brandName: brand.name, platform: s.platform, status: 'scheduled' })
      } catch (e) {
        results.push({ brandName: brand.name, platform: s.platform, status: 'error', error: String(e) })
      }
    }
  }

  return NextResponse.json({ ok: true, results })
}
