import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const brandId  = request.nextUrl.searchParams.get('brandId')
  const personId = request.nextUrl.searchParams.get('personId')
  if (!brandId || !personId) return NextResponse.json({ error: 'brandId and personId required' }, { status: 400 })

  const [brand] = await db
    .select()
    .from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.userId, user.id)))
    .limit(1)
  if (!brand) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [phInt] = await db
    .select()
    .from(brandIntegrations)
    .where(and(
      eq(brandIntegrations.brandId, brandId),
      eq(brandIntegrations.provider, 'posthog'),
      eq(brandIntegrations.status, 'connected'),
    ))
    .limit(1)

  if (!phInt?.apiKey) return NextResponse.json({ summary: null, hasRecording: false })

  const meta      = (phInt.metadata as Record<string, string> | null) ?? {}
  const projectId = meta['project_id']
  const host      = (meta['posthog_host'] ?? 'https://us.posthog.com').replace(/\/$/, '')

  if (!projectId) return NextResponse.json({ summary: null })

  try {
    // Fetch the most recent session recording for this person
    const url = `${host}/api/projects/${projectId}/session_recordings/?person_uuid=${encodeURIComponent(personId)}&limit=3&ordering=-start_time`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${phInt.apiKey}` },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return NextResponse.json({ summary: null })

    const data = await res.json() as {
      results?: Array<{
        id: string
        summary?: string | null
        start_time?: string
        duration?: number
      }>
    }

    // Find the most recent recording that actually has a summary
    const withSummary = (data.results ?? []).find(r => r.summary && r.summary.trim().length > 0)

    if (withSummary?.summary) {
      return NextResponse.json({ summary: withSummary.summary.trim() })
    }

    // No summary yet — return the latest recording id so the client knows a recording exists
    const latest = data.results?.[0]
    if (latest?.id) {
      return NextResponse.json({ summary: null, recordingId: latest.id, hasRecording: true })
    }

    return NextResponse.json({ summary: null, hasRecording: false })
  } catch {
    return NextResponse.json({ summary: null, hasRecording: false })
  }
}
