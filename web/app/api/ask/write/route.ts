import { NextRequest, NextResponse } from 'next/server'
import { askAccess } from '@/lib/agents/access'
import { withDemo } from '@/lib/agents/demo'
import { readDemoSwitch } from '@/lib/agents/store'
import { withAIContext } from '@/lib/ai/client'
import { writeAnswer, writeForLead, writeListEmail, writePost } from '@/lib/ask/write'

// Ask writes what you're about to send: POST { lead_id } → the first email or message to a lead;
// POST { thread_id } → an answer to their reply, or a follow-up nudge (with the thread's last messages);
// POST { list_about } → one email for a list, with {first name} / {company}; POST { topic } → a blog post. Nothing is sent or saved.
export const dynamic = 'force-dynamic'
export const maxDuration = 180

export async function POST(req: NextRequest) {
  const a = await askAccess()
  if (a.error) return a.error
  const body = await req.json().catch(() => ({})) as { lead_id?: unknown; thread_id?: unknown; list_about?: unknown; topic?: unknown }
  const run = async () => {
    if (typeof body.lead_id === 'string' && body.lead_id) return writeForLead(a.brandId, body.lead_id)
    if (typeof body.thread_id === 'string' && body.thread_id) return writeAnswer(a.brandId, body.thread_id)
    if (typeof body.list_about === 'string') return writeListEmail(a.brandId, body.list_about.slice(0, 500))
    if (typeof body.topic === 'string' && body.topic) return writePost(a.brandId, body.topic)
    return { error: 'Give lead_id, thread_id, list_about or topic.' }
  }
  const out = await withDemo(await readDemoSwitch(a.brandId), () => withAIContext({ brandId: a.brandId, moduleType: 'ask-write' }, run))
  return NextResponse.json(out, { status: 'error' in out && !('messages' in out) ? 400 : 200 })
}
