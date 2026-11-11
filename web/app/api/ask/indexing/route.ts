import { NextRequest, NextResponse } from 'next/server'
import { askAccess } from '@/lib/agents/access'
import { withDemo } from '@/lib/agents/demo'
import { readDemoSwitch } from '@/lib/agents/store'
import { markAsked, readAsks } from '@/lib/ask/indexing'

// The "Why am I not on Google?" panel: GET answers the pages the owner asked Google to index;
// POST { url, asked } marks one ("Done, I asked Google") or undoes it. Each morning's check then
// says whether those pages got in.
export const dynamic = 'force-dynamic'

export async function GET() {
  const a = await askAccess()
  if (a.error) return a.error
  const asks = await withDemo(await readDemoSwitch(a.brandId), () => readAsks(a.brandId))
  return NextResponse.json({ asks })
}

export async function POST(req: NextRequest) {
  const a = await askAccess()
  if (a.error) return a.error
  const { url, asked } = await req.json().catch(() => ({})) as { url?: unknown; asked?: unknown }
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return NextResponse.json({ error: 'Missing url' }, { status: 400 })
  const asks = await withDemo(await readDemoSwitch(a.brandId), () => markAsked(a.brandId, url, asked !== false))
  return NextResponse.json({ ok: true, asks })
}
