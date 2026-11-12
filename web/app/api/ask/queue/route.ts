import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { askAccess } from '@/lib/agents/access'
import { isAdminEmail } from '@/lib/admin'
import { withDemo } from '@/lib/agents/demo'
import { advanceEngine } from '@/lib/leads/engine'
import { markSeen, readQueue, runQueued } from '@/lib/ask/queue'
import { viaClaudeCode } from '@/lib/ai/claude-code'

// Ask's work waiting for the team (lib/ask/queue.ts):
//   GET                          → { jobs } this brand's waiting and finished jobs (Ask's home, "From the team")
//   GET ?brandId=                → admin: that brand's jobs
//   POST { op: 'seen', id }      → a finished job was opened
//   POST { op: 'run', brandId }  → admin: run that brand's waiting jobs → { ran, remaining }
export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function admin() {
  const { data: { user } } = await (await createClient()).auth.getUser()
  return isAdminEmail(user?.email)
}

export async function GET(req: NextRequest) {
  const brandId = req.nextUrl.searchParams.get('brandId')
  if (brandId) {
    if (!(await admin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ jobs: await readQueue(brandId) })
  }
  const a = await askAccess()
  if (a.error) return a.error
  return NextResponse.json({ jobs: (await readQueue(a.brandId)).slice(0, 10) })
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({})) as { op?: string; id?: string; brandId?: string }
  if (b.op === 'run') {
    if (!(await admin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!b.brandId) return NextResponse.json({ error: 'Missing brandId' }, { status: 400 })
    // A lead search keeps going after the answer, as Lead Finder's own route does
    const later = (id: string) => after(() => withDemo(false, () => advanceEngine(id)).catch(e => console.error('[ask] queued search advance failed', e)))
    // Through Claude Code (USE_CLAUDE_CLI, on your computer) each turn is slower, so a Run may take longer
    return NextResponse.json(await runQueued(b.brandId, viaClaudeCode() ? 1_800_000 : 270_000, later))
  }
  if (b.op === 'seen') {
    const a = await askAccess()
    if (a.error) return a.error
    if (b.id) await markSeen(a.brandId, b.id)
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'Unknown op' }, { status: 400 })
}
