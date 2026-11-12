import { NextRequest, NextResponse } from 'next/server'
import { askAccess } from '@/lib/agents/access'
import { createClient } from '@/lib/supabase/server'
import { askQuestion, questionsLeft } from '@/lib/ask/engine'
import { enqueue, modeFor } from '@/lib/ask/queue'
import type { AskEvent } from '@/lib/ask/types'

// Ask, phase 2: a typed question (lib/ask/engine.ts). POST { question, clarify? } answers it and
// streams progress, one JSON object per line (AskEvent), ending with an answer, a question back,
// a ready answer to open, or an error. GET: questions left today.
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET() {
  const a = await askAccess()
  if (a.error) return a.error
  return NextResponse.json({ left: await questionsLeft(a.brandId) })
}

export async function POST(req: NextRequest) {
  const a = await askAccess()
  if (a.error) return a.error
  const body = await req.json().catch(() => ({})) as { question?: unknown; clarify?: { asked?: unknown; chosen?: unknown }; threadId?: unknown }
  const question = typeof body.question === 'string' ? body.question : ''
  const clarify = body.clarify && typeof body.clarify.asked === 'string' && typeof body.clarify.chosen === 'string'
    ? { asked: body.clarify.asked, chosen: body.clarify.chosen } : undefined

  const threadId = typeof body.threadId === 'string' ? body.threadId : undefined

  // Runs switched to the admin queue: the team runs it, the answer shows on Ask's home
  const { data: { user } } = await (await createClient()).auth.getUser()
  let queued: { t: 'queued'; id: string; text: string } | { t: 'error'; text: string } | null = null
  if (question.trim() && await modeFor(user?.email) === 'queue') {
    const r = await enqueue(a.brandId, { id: user?.id ?? '', email: user?.email ?? '' }, { kind: 'question', question: question.slice(0, 300), threadId, clarify })
    queued = r.job ? { t: 'queued', id: r.job.id, text: 'Sent to the GrowJin team. Your answer will show on Ask’s home, and we’ll email you when it’s ready.' } : { t: 'error', text: r.error ?? 'Couldn’t send it. Try again.' }
  }

  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: AskEvent) => { try { controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`)) } catch { /* closed by the browser */ } }
      try {
        if (queued) emit(queued)
        else await askQuestion(a.brandId, { question, clarify, threadId }, emit)
      } catch (e) {
        console.error('[ask] stream failed', e)
        emit({ t: 'error', text: 'Ask couldn’t finish this answer. Try again.' })
      } finally {
        try { controller.close() } catch { /* already closed */ }
      }
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } })
}
