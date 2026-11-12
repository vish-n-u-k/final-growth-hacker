import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { modeFor } from '@/lib/ask/queue'
import { askAccess } from '@/lib/agents/access'
import { withDemo } from '@/lib/agents/demo'
import { addFoundLeads, advanceEngine, readJob, statusOf, stopEngine } from '@/lib/leads/engine'

// A long job Ask started (today: a lead search with its own brief, lib/leads/engine.ts):
//   GET                          → { task } its status; a running one nobody is advancing moves on after
//                                  the answer (the page polls this every few seconds)
//   POST { op: 'stop' }          → finish with what's been found
//   POST { op: 'add', picks }    → add the picked found leads (indexes) to the list
export const dynamic = 'force-dynamic'
export const maxDuration = 300

function advanceLater(brandId: string) {
  after(() => withDemo(false, () => advanceEngine(brandId)).catch(e => console.error('[ask task] advance failed:', e)))
}

export async function GET() {
  const a = await askAccess()
  if (a.error) return a.error
  const job = await readJob(a.brandId)
  // On the admin queue (Ask AI switch), only the admin's Run moves a search on: the page just shows it
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (job?.status === 'running' && !(job.lockUntil && job.lockUntil > Date.now()) && await modeFor(user?.email) === 'direct') advanceLater(a.brandId)
  return NextResponse.json({ task: statusOf(job) })
}

export async function POST(req: NextRequest) {
  const a = await askAccess()
  if (a.error) return a.error
  const body = await req.json().catch(() => ({})) as { op?: string; picks?: unknown }
  if (body.op === 'stop') return NextResponse.json({ task: statusOf(await stopEngine(a.brandId)) })
  if (body.op === 'add') {
    const picks = Array.isArray(body.picks) ? body.picks.filter((x): x is number => typeof x === 'number') : []
    const r = await withDemo(false, () => addFoundLeads(a.brandId, picks))
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 })
    return NextResponse.json({ ok: true, added: r.result!.added, skipped: r.result!.skipped, task: statusOf(await readJob(a.brandId)) })
  }
  return NextResponse.json({ error: 'Unknown op' }, { status: 400 })
}
