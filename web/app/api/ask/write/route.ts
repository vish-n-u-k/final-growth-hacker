import { NextRequest, NextResponse } from 'next/server'
import { agentAccess } from '@/lib/agents/access'
import { withDemo } from '@/lib/agents/demo'
import { readDemoSwitch } from '@/lib/agents/store'
import { withAIContext } from '@/lib/ai/client'
import { writeAnswer, writeForLead } from '@/lib/ask/write'

// Ask writes what you're about to send: POST { lead_id } → the first email or message to a lead;
// POST { thread_id } → an answer to their reply (with the thread's last messages). Nothing is sent or saved.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const a = await agentAccess()
  if (a.error) return a.error
  const body = await req.json().catch(() => ({})) as { lead_id?: unknown; thread_id?: unknown }
  const run = async () => {
    if (typeof body.lead_id === 'string' && body.lead_id) return writeForLead(a.brandId, body.lead_id)
    if (typeof body.thread_id === 'string' && body.thread_id) return writeAnswer(a.brandId, body.thread_id)
    return { error: 'Give lead_id or thread_id.' }
  }
  const out = await withDemo(await readDemoSwitch(a.brandId), () => withAIContext({ brandId: a.brandId, moduleType: 'ask-write' }, run))
  return NextResponse.json(out, { status: 'error' in out && !('messages' in out) ? 400 : 200 })
}
