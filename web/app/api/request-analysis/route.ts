import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { queueAnalysisRequest } from '@/lib/modules/analysis-queue'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { moduleId, moduleName, reason } = await req.json() as { moduleId: string; moduleName: string; reason?: string }
  if (!moduleId || !moduleName) {
    return NextResponse.json({ error: 'Missing moduleId or moduleName' }, { status: 400 })
  }

  await queueAnalysisRequest({
    userId: user.id,
    userEmail: user.email ?? '',
    moduleId,
    moduleName,
    reason: typeof reason === 'string' ? reason.slice(0, 500) : undefined,
  })

  return NextResponse.json({ ok: true })
}
