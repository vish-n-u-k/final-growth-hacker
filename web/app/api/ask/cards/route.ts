import { NextResponse } from 'next/server'
import { agentAccess } from '@/lib/agents/access'
import { readCards } from '@/lib/ask/cards'

// Ask's ready answers (lib/ask/cards.ts). GET: the saved cards, worked out again when older than a
// day. POST: work them out now ("Check again").
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const a = await agentAccess()
  if (a.error) return a.error
  return NextResponse.json(await readCards(a.brandId))
}

export async function POST() {
  const a = await agentAccess()
  if (a.error) return a.error
  return NextResponse.json(await readCards(a.brandId, { refresh: true }))
}
