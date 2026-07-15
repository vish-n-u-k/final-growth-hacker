import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations, frektoScheduledPosts } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export const maxDuration = 90

const FREKTO_BASE = 'https://api.frekto.ai'
const POLL_INTERVAL_MS = 5000
const MAX_POLLS = 36 // up to 3 minutes

interface FrektoPost {
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
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    brandId: string
    platform: string
    instruction: string
    count: number
    cadence: string
    format: string
    outputFormat: string
    startDate: string
  }

  const { brandId, platform, instruction, count, cadence, format, outputFormat, startDate } = body
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
        schedule: { start_date: startDate },
      }),
    })
    if (!genRes.ok) {
      const err = await genRes.text()
      return NextResponse.json({ error: `Frekto rejected request (${genRes.status}): ${err}` }, { status: 502 })
    }
    const genData = await genRes.json() as { series_id?: string }
    if (!genData.series_id) return NextResponse.json({ error: 'No series_id returned from Frekto' }, { status: 502 })
    seriesId = genData.series_id
  } catch (e) {
    return NextResponse.json({ error: `Could not reach Frekto: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }

  const result = await pollSeries(seriesId, frektoInt.apiKey)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 502 })

  const insertedPosts: { topic: string; scheduledAt: string; outputUrl: string | null }[] = []
  for (const post of result.posts) {
    const outputUrl = post.url ?? post.output_url ?? null
    const scheduledAt = post.scheduled_at ? new Date(post.scheduled_at) : new Date(startDate)
    await db.insert(frektoScheduledPosts).values({
      brandId,
      platform,
      topic: post.topic ?? instruction.trim(),
      postType: outputFormat === 'mp4' ? 'video' : 'image',
      scheduledAt,
      frektoJobId: seriesId,
      outputUrl,
      status: 'scheduled',
    })
    insertedPosts.push({ topic: post.topic ?? instruction.trim(), scheduledAt: scheduledAt.toISOString(), outputUrl })
  }

  return NextResponse.json({ seriesId, posts: insertedPosts })
}
