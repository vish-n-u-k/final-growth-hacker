import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { getEarlyAccessEmails } from '@/lib/early-access'
import { fillCards } from '@/lib/ask/cards'
import { refreshPins } from '@/lib/ask/pins'
import { getAskMode } from '@/lib/modules/analysis-mode'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const TIME_BUDGET = 270_000

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

// Daily (vercel.json, after the agents' run): Ask's ready answers for every early-access brand,
// so opening /ask in the morning is instant. Ask is early-access only for now.
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const started = Date.now()
  const emails = new Set(await getEarlyAccessEmails())
  if (!emails.size) return NextResponse.json({ ok: true, ran: 0 })

  // Early-access users' ids, from their emails (one page of 1,000 users at a time)
  const admin = createAdminClient()
  const ids = new Set<string>()
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error || !data?.users.length) break
    for (const u of data.users) if (u.email && emails.has(u.email.toLowerCase())) ids.add(u.id)
    if (data.users.length < 1000) break
  }

  const rows = (await db.select({ id: brands.id, userId: brands.userId }).from(brands)).filter(b => ids.has(b.userId))
  const paused = await getAskMode() === 'queue'
  const results: { brandId: string; error?: string }[] = []
  for (const b of rows) {
    if (Date.now() - started > TIME_BUDGET) break
    try {
      await fillCards(b.id)
      if (!paused) await refreshPins(b.id)   // Claude rewrites pins: paused while runs go to the admin queue
      results.push({ brandId: b.id })
    } catch (e) {
      results.push({ brandId: b.id, error: e instanceof Error ? e.message : 'failed' })
    }
  }
  return NextResponse.json({ ok: true, ran: results.length, of: rows.length, results })
}
