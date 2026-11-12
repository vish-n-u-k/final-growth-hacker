import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/admin'
import { getAnalysisMode, getAskMode, setAnalysisMode, setAskMode } from '@/lib/modules/analysis-mode'

// Admin switches between running through the API ('direct') and the manual queue: Growth Path
// modules, and (target: 'ask') Ask's AI work.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdminEmail(user.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json({ mode: await getAnalysisMode(), askMode: await getAskMode() })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdminEmail(user.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { mode, target } = await req.json().catch(() => ({})) as { mode?: string; target?: string }
  if (mode !== 'direct' && mode !== 'queue') return NextResponse.json({ error: 'mode must be "direct" or "queue"' }, { status: 400 })
  if (target === 'ask') await setAskMode(mode)
  else await setAnalysisMode(mode)
  return NextResponse.json({ mode })
}
