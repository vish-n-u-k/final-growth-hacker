import { NextRequest, NextResponse } from 'next/server'
import { agentAccess } from '@/lib/agents/access'
import { askQuestion, questionsLeft } from '@/lib/ask/engine'
import type { AskEvent } from '@/lib/ask/types'

// Ask, phase 2: a typed question (lib/ask/engine.ts). POST { question, clarify? } answers it and
// streams progress, one JSON object per line (AskEvent), ending with an answer, a question back,
// a ready answer to open, or an error. GET: questions left today.
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET() {
  const a = await agentAccess()
  if (a.error) return a.error
  return NextResponse.json({ left: await questionsLeft(a.brandId) })
}

export async function POST(req: NextRequest) {
  const a = await agentAccess()
  if (a.error) return a.error
  const body = await req.json().catch(() => ({})) as { question?: unknown; clarify?: { asked?: unknown; chosen?: unknown } }
  const question = typeof body.question === 'string' ? body.question : ''
  const clarify = body.clarify && typeof body.clarify.asked === 'string' && typeof body.clarify.chosen === 'string'
    ? { asked: body.clarify.asked, chosen: body.clarify.chosen } : undefined

  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: AskEvent) => { try { controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`)) } catch { /* closed by the browser */ } }
      try {
        await askQuestion(a.brandId, { question, clarify }, emit)
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
