import { NextRequest, NextResponse } from 'next/server'
import { inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { signalSnapshots } from '@/lib/db/schema'
import { runLeadAgent } from '@/lib/agents/lead-agent'
import { runSearchAgentScheduled } from '@/lib/agents/search-agent'
import { LEAD_KEY, SEARCH_KEY } from '@/lib/agents/store'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const TIME_BUDGET = 270_000

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

// Daily (vercel.json): every brand's switched-on agents. The Lead Agent runs daily; the Search
// Agent researches weekly and writes the next draft on a later day. Brands that don't fit in this
// run's time are picked up first tomorrow (least recently run first).
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const started = Date.now()
  const rows = await db.select({ brandId: signalSnapshots.brandId, source: signalSnapshots.source, data: signalSnapshots.data, updatedAt: signalSnapshots.updatedAt })
    .from(signalSnapshots).where(inArray(signalSnapshots.source, [LEAD_KEY, SEARCH_KEY]))

  const jobs = rows
    .filter(r => (r.data as { settings?: { enabled?: boolean } })?.settings?.enabled)
    .sort((x, y) => (x.updatedAt?.getTime() ?? 0) - (y.updatedAt?.getTime() ?? 0))

  const results: { brandId: string; agent: string; summary?: string; error?: string }[] = []
  for (const j of jobs) {
    const left = TIME_BUDGET - (Date.now() - started)
    if (left < 60_000) break
    try {
      const r = j.source === LEAD_KEY
        ? await runLeadAgent(j.brandId, { deadline: Date.now() + Math.min(left - 20_000, 150_000) })
        : await runSearchAgentScheduled(j.brandId)
      results.push({ brandId: j.brandId, agent: j.source, summary: r.summary, error: r.error })
    } catch (e) {
      results.push({ brandId: j.brandId, agent: j.source, error: e instanceof Error ? e.message : 'failed' })
    }
  }
  return NextResponse.json({ ok: true, ran: results.length, of: jobs.length, results })
}
