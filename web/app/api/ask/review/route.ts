import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { askAccess } from '@/lib/agents/access'
import { isAdminEmail } from '@/lib/admin'
import { getAskMode } from '@/lib/modules/analysis-mode'
import { queueAnalysisRequest } from '@/lib/modules/analysis-queue'
import { markRequested, readReview, runReview, type ReviewEvent } from '@/lib/ask/review'
import { REVIEW_REQUEST_NAME } from '@/lib/ask/types'

// "Re-analyse website" on Ask (lib/ask/review.ts):
//   GET                              → { state, mode, admin }
//   POST { op: 'run' }               → streams ReviewEvent lines, or { queued } when runs go to the admin queue
//   POST { op: 'run', brandId }      → admin running a queued request for that brand (plain JSON)
export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function who() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { id: user?.id ?? '', email: user?.email ?? '', admin: isAdminEmail(user?.email) }
}

export async function GET() {
  const a = await askAccess()
  if (a.error) return a.error
  const [state, mode, u] = await Promise.all([readReview(a.brandId), getAskMode(), who()])
  return NextResponse.json({ state, mode, admin: u.admin })
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({})) as { op?: string; brandId?: string }
  const u = await who()

  if (b.op !== 'run') return NextResponse.json({ error: 'Unknown op' }, { status: 400 })

  // The admin queue's Run button: any brand, answered once it's done
  if (b.brandId) {
    if (!u.admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    let error = ''
    const review = await runReview(b.brandId, e => { if (e.t === 'error') error = e.text })
    return review ? NextResponse.json({ review }) : NextResponse.json({ error: error || 'The review didn’t finish.' }, { status: 500 })
  }

  const a = await askAccess()
  if (a.error) return a.error
  if (!u.admin && await getAskMode() === 'queue') {
    const s = await readReview(a.brandId)
    if (!s.requestedAt) await queueAnalysisRequest({ userId: u.id, userEmail: u.email, moduleId: a.brandId, moduleName: REVIEW_REQUEST_NAME })
    const at = s.requestedAt ?? await markRequested(a.brandId)
    return NextResponse.json({ queued: true, at })
  }

  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: ReviewEvent) => { try { controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`)) } catch { /* closed */ } }
      try { await runReview(a.brandId, emit) } catch (e) {
        console.error('[ask] review stream failed', e)
        emit({ t: 'error', text: 'The review didn’t finish. Try again.' })
      } finally { try { controller.close() } catch { /* closed */ } }
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } })
}
