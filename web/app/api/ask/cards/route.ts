import { NextRequest, NextResponse } from 'next/server'
import { askAccess } from '@/lib/agents/access'
import { readCards, type OnStep } from '@/lib/ask/cards'
import { pinnedAnswers, refreshPins } from '@/lib/ask/pins'
import { createClient } from '@/lib/supabase/server'
import { modeFor } from '@/lib/ask/queue'
import type { FillEvent } from '@/lib/ask/types'

// Ask's ready answers (lib/ask/cards.ts). GET: the saved cards, worked out again when older than a
// day, plus the pinned questions (refreshed when older than a day). POST: both now ("Check again").
// With ?stream=1 the answer is one JSON object per line (FillEvent): each step as it starts and
// ends, then { t: 'done', data }, so the page can show what's happening.
export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function both(brandId: string, refresh: boolean, onStep?: OnStep) {
  // Pinned answers are rewritten by Claude: paused while runs go to the admin queue (they keep their last answer)
  const { data: { user } } = await (await createClient()).auth.getUser()
  const paused = await modeFor(user?.email) === 'queue'
  const [cards, pins] = await Promise.all([readCards(brandId, { refresh, onStep }), paused ? pinnedAnswers(brandId) : refreshPins(brandId, { force: refresh, onStep })])
  return { ...cards, pins }
}

function answer(req: NextRequest, brandId: string, refresh: boolean) {
  if (req.nextUrl.searchParams.get('stream') !== '1') return both(brandId, refresh).then(d => NextResponse.json(d))
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: FillEvent) => { try { controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`)) } catch { /* closed */ } }
      try {
        send({ t: 'done', data: await both(brandId, refresh, e => send({ t: 'step', ...e })) })
      } catch (e) {
        console.error('[ask] cards', e)
        send({ t: 'error', text: 'Couldn’t check your data just now. Try again.' })
      } finally {
        try { controller.close() } catch { /* closed */ }
      }
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } })
}

export async function GET(req: NextRequest) {
  const a = await askAccess()
  if (a.error) return a.error
  return answer(req, a.brandId, false)
}

export async function POST(req: NextRequest) {
  const a = await askAccess()
  if (a.error) return a.error
  return answer(req, a.brandId, true)
}
