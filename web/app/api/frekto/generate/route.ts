import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export const maxDuration = 90

const FREKTO_BASE = 'https://api.frekto.ai'
const POLL_INTERVAL_MS = 2500
const MAX_POLLS = 36 // 90 seconds max

async function pollJob(
  jobId: string,
  apiKey: string,
): Promise<{ outputUrl: string } | { error: string }> {
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))

    let data: { status: string; output_url?: string; error?: string | null }
    try {
      const res = await fetch(`${FREKTO_BASE}/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!res.ok) return { error: `Frekto job poll failed with status ${res.status}` }
      data = await res.json()
    } catch (e) {
      return { error: `Network error while polling: ${e instanceof Error ? e.message : String(e)}` }
    }

    if (data.status === 'done' && data.output_url) return { outputUrl: data.output_url }
    if (data.status === 'failed') return { error: data.error ?? 'Frekto render failed' }
    // status === 'queued' | 'rendering' → keep polling
  }
  return { error: 'Render timed out after 90 seconds. Try again.' }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    moduleId: string
    topic: string
    format?: string
    outputFormat?: string
  }

  const { moduleId, topic, format = '4:5', outputFormat = 'png' } = body

  if (!moduleId || !topic?.trim()) {
    return NextResponse.json({ error: 'moduleId and topic are required' }, { status: 400 })
  }

  // Verify module belongs to this user
  const [mod] = await db.select().from(modules).where(eq(modules.id, moduleId)).limit(1)
  if (!mod) return NextResponse.json({ error: 'Module not found' }, { status: 404 })

  const [brand] = await db.select().from(brands).where(eq(brands.id, mod.brandId)).limit(1)
  if (!brand || brand.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Get Frekto API key
  const [frektoInt] = await db
    .select()
    .from(brandIntegrations)
    .where(
      and(
        eq(brandIntegrations.brandId, brand.id),
        eq(brandIntegrations.provider, 'frekto'),
        eq(brandIntegrations.status, 'connected'),
      ),
    )
    .limit(1)

  if (!frektoInt?.apiKey) {
    return NextResponse.json(
      { error: 'Frekto is not connected. Go to Settings → Integrations to add your API key.' },
      { status: 400 },
    )
  }

  // Submit generation job to Frekto
  let jobId: string
  try {
    const genRes = await fetch(`${FREKTO_BASE}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${frektoInt.apiKey}`,
      },
      body: JSON.stringify({
        topic: topic.trim(),
        format,
        output_format: outputFormat,
      }),
    })

    if (!genRes.ok) {
      const errText = await genRes.text()
      return NextResponse.json(
        { error: `Frekto rejected the request (${genRes.status}): ${errText}` },
        { status: 502 },
      )
    }

    const genData = await genRes.json() as { job_id?: string }
    if (!genData.job_id) {
      return NextResponse.json({ error: 'No job_id returned from Frekto' }, { status: 502 })
    }
    jobId = genData.job_id
  } catch (e) {
    return NextResponse.json(
      { error: `Could not reach Frekto: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }

  // Poll until done
  const result = await pollJob(jobId, frektoInt.apiKey)
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 502 })
  }

  return NextResponse.json({ outputUrl: result.outputUrl })
}
