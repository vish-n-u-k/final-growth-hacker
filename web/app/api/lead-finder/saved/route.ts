import { NextRequest, NextResponse } from 'next/server'
import { requirePro } from '@/lib/billing/guard'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { loadScanLeads } from '@/lib/lead-finder/saved'
import { patchSuggestion, saveSuggestions } from '@/lib/tool-suggestions'

// Saved Competitor Leads scans (lib/lead-finder/saved.ts):
//   GET   ?scan=<id>                                  → { leads } of an earlier scan
//   POST  { scan: { id, platform, competitor, … } }   → saves the scan's summary
//   PATCH { leadId, status?, email?, draft? }          → saves a send, skip or edit

async function brandId(): Promise<string | NextResponse> {
  const proBlock = await requirePro()
  if (proBlock) return proBlock
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, user.id)).limit(1)
  return brand?.id ?? NextResponse.json({ error: 'No brand' }, { status: 404 })
}

export async function GET(req: NextRequest) {
  const id = await brandId()
  if (typeof id !== 'string') return id
  const scan = req.nextUrl.searchParams.get('scan')
  if (!scan) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  return NextResponse.json({ leads: await loadScanLeads(id, scan) })
}

export async function POST(req: NextRequest) {
  const id = await brandId()
  if (typeof id !== 'string') return id
  const { scan } = await req.json().catch(() => ({})) as { scan?: Record<string, unknown> }
  if (!scan || typeof scan.id !== 'string' || typeof scan.competitor !== 'string') return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const ok = await saveSuggestions(id, 'competitor_leads', [{
    kind: 'scan', externalId: scan.id.slice(0, 64), title: scan.competitor.slice(0, 200),
    payload: {
      platform: scan.platform === 'shopify' ? 'shopify' : 'trustpilot', competitor: scan.competitor.slice(0, 200),
      reviewsRead: Number(scan.reviewsRead) || 0, unhappy: Number(scan.unhappy) || 0, others: Number(scan.others) || 0,
      scannedAt: typeof scan.scannedAt === 'string' ? scan.scannedAt : new Date().toISOString(),
    },
  }])
  return NextResponse.json({ ok })
}

export async function PATCH(req: NextRequest) {
  const id = await brandId()
  if (typeof id !== 'string') return id
  const b = await req.json().catch(() => ({})) as { leadId?: string; status?: string | null; email?: string; draft?: { subject?: string; body?: string } }
  if (!b.leadId) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const payload: Record<string, unknown> = {}
  if (typeof b.email === 'string') payload.email = b.email.trim().slice(0, 200)
  if (b.draft && typeof b.draft.subject === 'string' && typeof b.draft.body === 'string') {
    payload.draft = { subject: b.draft.subject.slice(0, 300), body: b.draft.body.slice(0, 5000) }
  }
  const status = b.status === 'sent' || b.status === 'skipped' ? b.status : b.status === null ? 'suggested' : undefined
  const ok = await patchSuggestion(id, 'competitor_leads', b.leadId, { payload: Object.keys(payload).length ? payload : undefined, status })
  return NextResponse.json({ ok })
}
