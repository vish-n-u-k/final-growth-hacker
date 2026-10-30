import { NextRequest, NextResponse, after } from 'next/server'
import { agentAccess } from '@/lib/agents/access'
import { withDemo } from '@/lib/agents/demo'
import { readDemoSwitch, readLeadData } from '@/lib/agents/store'
import { advanceEngine, readJob, startEngine, statusOf, stopEngine } from '@/lib/leads/engine'

export const dynamic = 'force-dynamic'
// Each request may advance the search for ~4 minutes after answering (lib/leads/engine.ts)
export const maxDuration = 300

// Lead Finder's search (lib/leads/engine.ts):
//   GET                  → { job } the current search's status; a running one that nobody is advancing
//                          is advanced after the answer (the page polls this every few seconds)
//   POST { op: 'start' } → starts a search with the brief and filters from Settings
//   POST { op: 'stop' }  → asks it to finish with what it has found
// The search always uses real data, never demo mode.

function advanceLater(brandId: string) {
  after(() => withDemo(false, () => advanceEngine(brandId)).catch(e => console.error('[lead-engine] advance failed:', e)))
}

export async function GET() {
  const a = await agentAccess()
  if (a.error) return a.error
  const job = await readJob(a.brandId)
  if (job?.status === 'running' && !(job.lockUntil && job.lockUntil > Date.now())) advanceLater(a.brandId)
  // Once it's finished, the page reloads the list with the new leads
  const data = job && job.status !== 'running' ? await withDemo(await readDemoSwitch(a.brandId), () => readLeadData(a.brandId)) : null
  return NextResponse.json({ job: statusOf(job), ...(data ? { data } : {}) })
}

export async function POST(req: NextRequest) {
  const a = await agentAccess()
  if (a.error) return a.error
  const body = await req.json().catch(() => ({})) as { op?: string }
  if (body.op === 'stop') return NextResponse.json({ job: statusOf(await stopEngine(a.brandId)) })
  if (body.op !== 'start') return NextResponse.json({ error: 'Unknown op' }, { status: 400 })
  if (await readDemoSwitch(a.brandId)) return NextResponse.json({ error: 'Lead Finder’s search uses real data. Turn Demo mode off in Settings first.' }, { status: 400 })
  const r = await withDemo(false, () => startEngine(a.brandId))
  if (!r.job) return NextResponse.json({ error: r.error }, { status: 400 })
  advanceLater(a.brandId)
  return NextResponse.json({ job: statusOf(r.job) })
}
