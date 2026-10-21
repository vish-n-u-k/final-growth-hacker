import { NextRequest, NextResponse } from 'next/server'
import { requirePro } from '@/lib/billing/guard'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { frektoHttpError, frektoJobFailed, frektoNetworkError, frektoPollError } from '@/lib/frekto/errors'

export const maxDuration = 90

const FREKTO_BASE = 'https://api.frekto.ai'
const POLL_INTERVAL_MS = 2500
const MAX_POLLS = 30 // 75 seconds: stop before maxDuration (90s) kills the request with no message

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
      if (!res.ok) return { error: frektoPollError(res.status) }
      data = await res.json()
    } catch (e) {
      return { error: frektoNetworkError(e, 'check on it') }
    }

    if (data.status === 'done' && data.output_url) return { outputUrl: data.output_url }
    if (data.status === 'failed') return { error: frektoJobFailed(data.error, 'post') }
    // status === 'queued' | 'rendering' → keep polling
  }
  return { error: 'Frekto is still working on this after 75 seconds. It may still finish in Frekto; check there, or try again.' }
}

export async function POST(request: NextRequest) {
  const proBlock = await requirePro()
  if (proBlock) return proBlock
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
        { error: frektoHttpError(genRes.status, errText, 'create the post') },
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
      { error: frektoNetworkError(e, 'create the post') },
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
