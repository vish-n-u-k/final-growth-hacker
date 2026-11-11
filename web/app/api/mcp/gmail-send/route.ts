import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { saveMcpSendPermission } from '@/lib/mcp/gmail-permission'
import { gmailStatus } from '@/lib/mcp/tools/gmail'

// Settings → Connect Claude: the "Let Claude send email" switch (the MCP send_email tool's permission)

async function brandId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const [b] = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, user.id)).limit(1)
  return b?.id ?? null
}

export async function GET() {
  const id = await brandId()
  if (!id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const s = await gmailStatus(id)
  return NextResponse.json({ on: s.sending_allowed, dailyLimit: s.daily_limit, sentToday: s.sent_today, connected: s.connected, canSend: s.can_send, address: s.address })
}

export async function POST(req: NextRequest) {
  const id = await brandId()
  if (!id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { on?: boolean; dailyLimit?: number }
  const p = await saveMcpSendPermission(id, { on: body.on, dailyLimit: Number(body.dailyLimit) || undefined })
  return NextResponse.json({ on: p.on, dailyLimit: p.dailyLimit })
}
