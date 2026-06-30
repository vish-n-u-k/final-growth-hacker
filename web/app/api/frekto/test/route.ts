import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 90

const FREKTO_BASE = 'https://api.frekto.ai'
const POLL_INTERVAL_MS = 2500
const MAX_POLLS = 36

async function pollJob(
  jobId: string,
  apiKey: string,
): Promise<{ outputUrl: string } | { error: string }> {
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    try {
      const res = await fetch(`${FREKTO_BASE}/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!res.ok) return { error: `Poll failed: ${res.status} ${res.statusText}` }
      const data = await res.json() as { status: string; output_url?: string; error?: string | null }
      if (data.status === 'done' && data.output_url) return { outputUrl: data.output_url }
      if (data.status === 'failed') return { error: data.error ?? 'Render failed' }
    } catch (e) {
      return { error: `Network error while polling: ${e instanceof Error ? e.message : String(e)}` }
    }
  }
  return { error: 'Render timed out after 90s' }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    apiKey: string
    topic: string
    format?: string
    outputFormat?: string
    style?: string
  }

  const { apiKey, topic, format = '4:5', outputFormat = 'png', style } = body

  if (!apiKey?.trim()) return NextResponse.json({ error: 'API key is required' }, { status: 400 })
  if (!topic?.trim()) return NextResponse.json({ error: 'Topic is required' }, { status: 400 })

  // Submit job
  let jobId: string
  try {
    const payload: Record<string, string> = { topic: topic.trim(), format, output_format: outputFormat }
    if (style) payload.style = style

    const genRes = await fetch(`${FREKTO_BASE}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify(payload),
    })

    if (!genRes.ok) {
      const errText = await genRes.text()
      return NextResponse.json(
        { error: `Frekto rejected request (${genRes.status}): ${errText}` },
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

  const result = await pollJob(jobId, apiKey.trim())
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 502 })

  return NextResponse.json({ outputUrl: result.outputUrl, jobId })
}
