import { NextRequest, NextResponse } from 'next/server'
import { runLifecycleCron } from '@/lib/email/lifecycle'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Daily: "Pro access ends soon" and the two win-back emails. Event-driven emails
// (welcome, Pro, cancellation) are sent from onboarding and the Stripe webhook instead.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const counts = await runLifecycleCron()
  return NextResponse.json({ ok: true, counts })
}
