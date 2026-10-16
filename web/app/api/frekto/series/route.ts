import { NextRequest, NextResponse } from 'next/server'
import { requirePro } from '@/lib/billing/guard'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations, frektoScheduledPosts, socialSuggestions } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { toClientPost } from '@/lib/frekto/drafts'

export const maxDuration = 90

const FREKTO_BASE = 'https://api.frekto.ai'
const POLL_INTERVAL_MS = 5000
const MAX_POLLS = 36 // up to 3 minutes

interface FrektoPost {
  job_id?: string
  scheduled_id?: string
  topic?: string
  status: string
  url?: string
  output_url?: string
  scheduled_at?: string
}

interface FrektoSeriesStatus {
  series_id?: string
  status: string
  posts?: FrektoPost[]
  error?: string | null
}

async function pollSeries(
  seriesId: string,
  apiKey: string,
): Promise<{ posts: FrektoPost[] } | { error: string }> {
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    try {
      const res = await fetch(`${FREKTO_BASE}/series/${seriesId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!res.ok) return { error: `Poll failed: ${res.status}` }
      const data = await res.json() as FrektoSeriesStatus
      if (data.status === 'scheduled' || data.status === 'done') return { posts: data.posts ?? [] }
      if (data.status === 'failed') return { error: data.error ?? 'Series generation failed' }
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Network error' }
    }
  }
  return { error: 'Series timed out after 3 minutes' }
}

export async function POST(request: NextRequest) {
  const proBlock = await requirePro()
  if (proBlock) return proBlock
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    suggestionId?: string
    brandId: string
    platform: string
    instruction: string
    count: number
    cadence: string
    format: string
    outputFormat: string
    startDate: string
  }

  const { suggestionId, brandId, platform, instruction, count, cadence, format, outputFormat, startDate } = body
  if (!brandId || !platform || !instruction?.trim() || !count || !cadence || !startDate) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const [brand] = await db
    .select()
    .from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.userId, user.id)))
    .limit(1)
  if (!brand) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [frektoInt] = await db
    .select()
    .from(brandIntegrations)
    .where(and(
      eq(brandIntegrations.brandId, brandId),
      eq(brandIntegrations.provider, 'frekto'),
      eq(brandIntegrations.status, 'connected'),
    ))
    .limit(1)

  if (!frektoInt?.apiKey) {
    return NextResponse.json(
      { error: 'Frekto is not connected. Go to Settings → Integrations to add your API key.' },
      { status: 400 },
    )
  }

  const frektoMeta = (frektoInt.metadata as Record<string, string> | null) ?? {}
  const timezone = frektoMeta['timezone'] ?? 'UTC'
  const preferredTime = frektoMeta['preferred_time'] ?? '10:00'

  // Claim the saved suggestion so the same series can't be launched twice
  if (suggestionId) {
    const claimed = await db.update(socialSuggestions)
      .set({ status: 'accepted', updatedAt: new Date() })
      .where(and(eq(socialSuggestions.id, suggestionId), eq(socialSuggestions.brandId, brandId), eq(socialSuggestions.status, 'suggested')))
      .returning({ id: socialSuggestions.id })
    if (claimed.length === 0) return NextResponse.json({ error: 'This series was already launched or dismissed.' }, { status: 409 })
  }
  const release = async () => {
    if (suggestionId) await db.update(socialSuggestions).set({ status: 'suggested', updatedAt: new Date() }).where(eq(socialSuggestions.id, suggestionId)).catch(() => {})
  }

  let seriesId: string
  try {
    const genRes = await fetch(`${FREKTO_BASE}/generate/series`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${frektoInt.apiKey}`,
      },
      body: JSON.stringify({
        instruction: instruction.trim(),
        count,
        platform,
        cadence,
        format: format ?? '1:1',
        output_format: outputFormat ?? 'png',
        schedule: { start_date: startDate, time: preferredTime, timezone },
      }),
    })
    if (!genRes.ok) {
      const err = await genRes.text()
      await release()
      return NextResponse.json({ error: `Frekto rejected request (${genRes.status}): ${err}` }, { status: 502 })
    }
    const genData = await genRes.json() as { series_id?: string }
    if (!genData.series_id) { await release(); return NextResponse.json({ error: 'No series_id returned from Frekto' }, { status: 502 }) }
    seriesId = genData.series_id
  } catch (e) {
    await release()
    return NextResponse.json({ error: `Could not reach Frekto: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }

  const result = await pollSeries(seriesId, frektoInt.apiKey)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 502 })

  const insertedPosts: { id: string; topic: string; scheduledAt: string; outputUrl: string | null }[] = []
  const rows: (typeof frektoScheduledPosts.$inferSelect)[] = []
  for (const post of result.posts) {
    const outputUrl = post.url ?? post.output_url ?? null
    const scheduledAt = post.scheduled_at ? new Date(post.scheduled_at) : new Date(startDate)
    const [row] = await db.insert(frektoScheduledPosts).values({
      brandId,
      platform,
      topic: post.topic ?? instruction.trim(),
      postType: outputFormat === 'mp4' ? 'video' : 'image',
      scheduledAt,
      // Each post's own render id when Frekto gives one (needed to cancel/reschedule it)
      frektoJobId: post.job_id ?? seriesId,
      frektoScheduledId: post.scheduled_id ?? null,
      seriesId,
      outputUrl,
      source: suggestionId ? 'suggestion' : 'series',
      suggestionId: suggestionId ?? null,
      status: 'scheduled',
    }).returning()
    rows.push(row)
    insertedPosts.push({ id: row.id, topic: row.topic, scheduledAt: scheduledAt.toISOString(), outputUrl })
  }
  if (suggestionId && rows[0]) {
    await db.update(socialSuggestions).set({ postId: rows[0].id }).where(eq(socialSuggestions.id, suggestionId)).catch(() => {})
  }

  return NextResponse.json({ seriesId, posts: insertedPosts, rows: rows.map(toClientPost) })
}
