import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations, frektoScheduledPosts } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'

export const maxDuration = 90

const FREKTO_BASE = 'https://api.frekto.ai'
const POLL_INTERVAL_MS = 2500
const MAX_POLLS = 36

function getFormat(platform: string, postType: string): { format: string; outputFormat: string } {
  if (postType === 'video') return { format: '9:16', outputFormat: 'mp4' }
  const imageFormats: Record<string, string> = {
    instagram: '4:5',
    linkedin: '1:1',
    twitter: '1:1',
    facebook: '1:1',
    youtube: '1:1',
    tiktok: '9:16',
  }
  return { format: imageFormats[platform] ?? '1:1', outputFormat: 'png' }
}

async function pollJob(jobId: string, apiKey: string): Promise<{ outputUrl: string } | { error: string }> {
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    try {
      const res = await fetch(`${FREKTO_BASE}/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!res.ok) return { error: `Poll failed: ${res.status}` }
      const data = await res.json() as { status: string; output_url?: string; error?: string | null }
      if (data.status === 'done' && data.output_url) return { outputUrl: data.output_url }
      if (data.status === 'failed') return { error: data.error ?? 'Render failed' }
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Network error' }
    }
  }
  return { error: 'Render timed out after 90 seconds' }
}

// GET ?brandId=xxx — last scheduled post per platform
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const brandId = request.nextUrl.searchParams.get('brandId')
  if (!brandId) return NextResponse.json({ error: 'brandId is required' }, { status: 400 })

  const [brand] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.userId, user.id)))
    .limit(1)
  if (!brand) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const posts = await db
    .select()
    .from(frektoScheduledPosts)
    .where(eq(frektoScheduledPosts.brandId, brandId))
    .orderBy(desc(frektoScheduledPosts.scheduledAt))

  const lastByPlatform: Record<string, { scheduledAt: string; status: string; outputUrl: string | null }> = {}
  for (const p of posts) {
    if (!lastByPlatform[p.platform] && p.scheduledAt) {
      lastByPlatform[p.platform] = {
        scheduledAt: p.scheduledAt.toISOString(),
        status: p.status,
        outputUrl: p.outputUrl,
      }
    }
  }

  return NextResponse.json({ lastByPlatform })
}

// POST — generate via Frekto + store
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    brandId: string
    platform: string
    topic: string
    postType: string
    scheduledAt: string
  }

  const { brandId, platform, topic, postType, scheduledAt } = body
  if (!brandId || !platform || !topic?.trim() || !postType || !scheduledAt) {
    return NextResponse.json({ error: 'brandId, platform, topic, postType, scheduledAt are required' }, { status: 400 })
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

  const { format, outputFormat } = getFormat(platform, postType)

  let jobId: string
  try {
    const genRes = await fetch(`${FREKTO_BASE}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${frektoInt.apiKey}`,
      },
      body: JSON.stringify({ topic: topic.trim(), format, output_format: outputFormat }),
    })
    if (!genRes.ok) {
      const err = await genRes.text()
      return NextResponse.json({ error: `Frekto rejected request (${genRes.status}): ${err}` }, { status: 502 })
    }
    const genData = await genRes.json() as { job_id?: string }
    if (!genData.job_id) return NextResponse.json({ error: 'No job_id returned from Frekto' }, { status: 502 })
    jobId = genData.job_id
  } catch (e) {
    return NextResponse.json({ error: `Could not reach Frekto: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }

  const result = await pollJob(jobId, frektoInt.apiKey)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 502 })

  await db.insert(frektoScheduledPosts).values({
    brandId,
    platform,
    topic: topic.trim(),
    postType,
    scheduledAt: new Date(scheduledAt),
    frektoJobId: jobId,
    outputUrl: result.outputUrl,
    status: 'scheduled',
  })

  return NextResponse.json({ outputUrl: result.outputUrl })
}
