import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

async function load() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return { error: NextResponse.json({ error: 'No brand' }, { status: 404 }) }
  return { user, brand }
}

/** Current setting and where the email goes. */
export async function GET() {
  const r = await load()
  if ('error' in r) return r.error
  return NextResponse.json({ dailyEmailEnabled: !!r.brand.dailyEmailEnabled, email: r.brand.notificationEmail ?? r.user.email ?? null })
}

/** Body { enabled } sets it; no body flips it (older callers). */
export async function POST(request: Request) {
  const r = await load()
  if ('error' in r) return r.error
  const { user, brand } = r

  const body = await request.json().catch(() => null) as { enabled?: unknown } | null
  const next = typeof body?.enabled === 'boolean' ? body.enabled : !brand.dailyEmailEnabled

  // Opting in stores where to send it (the cron skips brands without an address)
  const email = next ? (user.email ?? brand.notificationEmail) : brand.notificationEmail
  await db.update(brands)
    .set({ dailyEmailEnabled: next, ...(next && user.email ? { notificationEmail: user.email } : {}) })
    .where(eq(brands.id, brand.id))

  return NextResponse.json({ dailyEmailEnabled: next, email: email ?? null })
}
