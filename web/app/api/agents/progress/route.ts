import { NextRequest, NextResponse } from 'next/server'
import { agentAccess } from '@/lib/agents/access'
import { readProgress } from '@/lib/agents/progress'

export const dynamic = 'force-dynamic'

// Live steps of the latest agent run, polled by the "what the agent is doing" popup
export async function GET(req: NextRequest) {
  const a = await agentAccess()
  if (a.error) return a.error
  const agent = req.nextUrl.searchParams.get('agent')
  if (agent !== 'lead' && agent !== 'search') return NextResponse.json({ error: 'Unknown agent' }, { status: 400 })
  return NextResponse.json({ progress: await readProgress(a.brandId, agent) })
}
