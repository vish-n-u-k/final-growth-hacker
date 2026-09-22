import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { db } from '@/lib/db'
import { frektoScheduledPosts } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export const maxDuration = 30

export async function POST(request: NextRequest) {
  const secret = process.env.FREKTO_WEBHOOK_SECRET
  if (secret) {
    const sig = request.headers.get('x-frekto-signature')
    if (!sig) return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
    const rawBody = await request.text()
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
    if (sig !== expected) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    try {
      const payload = JSON.parse(rawBody) as { job_id?: string; status?: string; output_url?: string }
      if (payload.job_id) {
        await db
          .update(frektoScheduledPosts)
          .set({
            status: payload.status === 'done' ? 'done' : payload.status === 'failed' ? 'failed' : 'scheduled',
            ...(payload.output_url ? { outputUrl: payload.output_url } : {}),
          })
          .where(eq(frektoScheduledPosts.frektoJobId, payload.job_id))
      }
      return NextResponse.json({ ok: true })
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
  }

  // No secret configured — still process
  try {
    const payload = await request.json() as { job_id?: string; status?: string; output_url?: string }
    if (payload.job_id) {
      await db
        .update(frektoScheduledPosts)
        .set({
          status: payload.status === 'done' ? 'done' : payload.status === 'failed' ? 'failed' : 'scheduled',
          ...(payload.output_url ? { outputUrl: payload.output_url } : {}),
        })
        .where(eq(frektoScheduledPosts.frektoJobId, payload.job_id))
    }
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
}
