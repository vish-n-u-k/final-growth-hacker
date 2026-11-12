import { NextRequest, NextResponse } from 'next/server'
import { askAccess } from '@/lib/agents/access'
import { addPin, removePin } from '@/lib/ask/pins'

// Ask, phase 4: POST { threadId } pins that conversation's newest answer to the home page;
// DELETE { id } unpins. Both answer with the pins as cards.
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const a = await askAccess()
  if (a.error) return a.error
  const { threadId } = await req.json().catch(() => ({})) as { threadId?: unknown }
  if (typeof threadId !== 'string' || !threadId) return NextResponse.json({ error: 'Missing threadId' }, { status: 400 })
  const r = await addPin(a.brandId, threadId)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}

export async function DELETE(req: NextRequest) {
  const a = await askAccess()
  if (a.error) return a.error
  const { id } = await req.json().catch(() => ({})) as { id?: unknown }
  if (typeof id !== 'string' || !id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  return NextResponse.json({ ok: true, pins: await removePin(a.brandId, id) })
}
