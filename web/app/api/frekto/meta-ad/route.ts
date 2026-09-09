import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import type { CampaignBrief } from '@/components/MetaAdLaunchPanel'

export const maxDuration = 90

const FREKTO_BASE = 'https://api.frekto.ai'
const POLL_INTERVAL_MS = 2500
const MAX_POLLS = 36

async function pollJob(jobId: string, apiKey: string): Promise<{ outputUrl: string } | { error: string }> {
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    let data: { status: string; output_url?: string; error?: string | null }
    try {
      const res = await fetch(`${FREKTO_BASE}/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!res.ok) return { error: `Frekto job poll failed: ${res.status}` }
      data = await res.json()
    } catch (e) {
      return { error: `Network error while polling: ${e instanceof Error ? e.message : String(e)}` }
    }
    if (data.status === 'done' && data.output_url) return { outputUrl: data.output_url }
    if (data.status === 'failed') return { error: data.error ?? 'Frekto render failed' }
  }
  return { error: 'Render timed out after 90 seconds. Try again.' }
}

async function submitJob(topic: string, format: string, apiKey: string, outputFormat = 'mp4'): Promise<{ jobId: string } | { error: string }> {
  try {
    const res = await fetch(`${FREKTO_BASE}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ topic, format, output_format: outputFormat }),
    })
    if (!res.ok) {
      const errText = await res.text()
      return { error: `Frekto rejected request (${res.status}): ${errText}` }
    }
    const data = await res.json() as { job_id?: string }
    if (!data.job_id) return { error: 'No job_id returned from Frekto' }
    return { jobId: data.job_id }
  } catch (e) {
    return { error: `Could not reach Frekto: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { moduleId: string; brief: CampaignBrief }
  const { moduleId, brief } = body

  if (!moduleId || !brief?.creative?.topic) {
    return NextResponse.json({ error: 'moduleId and brief.creative.topic are required' }, { status: 400 })
  }

  const [mod] = await db.select().from(modules).where(eq(modules.id, moduleId)).limit(1)
  if (!mod) return NextResponse.json({ error: 'Module not found' }, { status: 404 })

  const [brand] = await db.select().from(brands).where(eq(brands.id, mod.brandId)).limit(1)
  if (!brand || brand.userId !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [frektoInt] = await db
    .select()
    .from(brandIntegrations)
    .where(and(
      eq(brandIntegrations.brandId, brand.id),
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

  const { topic, format } = brief.creative
  const safeTopic = topic.slice(0, 300)

  const jobResult = await submitJob(safeTopic, format, frektoInt.apiKey)
  if ('error' in jobResult) return NextResponse.json({ error: jobResult.error }, { status: 502 })

  const pollResult = await pollJob(jobResult.jobId, frektoInt.apiKey)
  if ('error' in pollResult) return NextResponse.json({ error: pollResult.error }, { status: 502 })

  return NextResponse.json({ images: [{ url: pollResult.outputUrl, index: 0 }] })
}
