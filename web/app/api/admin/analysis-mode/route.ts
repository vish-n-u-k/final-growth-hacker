import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/admin'
import { getAnalysisMode, setAnalysisMode } from '@/lib/modules/analysis-mode'

// Admin switch between running Growth Path modules through the API ('direct') and the manual queue.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdminEmail(user.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json({ mode: await getAnalysisMode() })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdminEmail(user.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { mode } = await req.json().catch(() => ({})) as { mode?: string }
  if (mode !== 'direct' && mode !== 'queue') return NextResponse.json({ error: 'mode must be "direct" or "queue"' }, { status: 400 })
  await setAnalysisMode(mode)
  return NextResponse.json({ mode })
}
