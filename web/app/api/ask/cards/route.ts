import { NextResponse } from 'next/server'
import { agentAccess } from '@/lib/agents/access'
import { readCards } from '@/lib/ask/cards'
import { refreshPins } from '@/lib/ask/pins'

// Ask's ready answers (lib/ask/cards.ts). GET: the saved cards, worked out again when older than a
// day, plus the pinned questions (refreshed when older than a day). POST: both now ("Check again").
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const a = await agentAccess()
  if (a.error) return a.error
  const [cards, pins] = await Promise.all([readCards(a.brandId), refreshPins(a.brandId)])
  return NextResponse.json({ ...cards, pins })
}

export async function POST() {
  const a = await agentAccess()
  if (a.error) return a.error
  const [cards, pins] = await Promise.all([readCards(a.brandId, { refresh: true }), refreshPins(a.brandId, { force: true })])
  return NextResponse.json({ ...cards, pins })
}
