import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { checkBrandFollowups } from '@/lib/gmail/reply-check'

export const maxDuration = 60

// Checks open follow-ups against their Gmail threads (replies, opt-outs, bounces, out-of-office).
// Body: { force?: boolean } — force re-checks ones checked in the last 10 minutes.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  const { force } = await req.json().catch(() => ({})) as { force?: boolean }
  const { results, error } = await checkBrandFollowups(brand.id, { force, deadline: Date.now() + 50_000 })
  if (error) return NextResponse.json({ error }, { status: 400 })

  const count = (o: string) => results.filter(r => r.outcome === o).length
  return NextResponse.json({
    checked:     results.length,
    replied:     count('replied'),
    optedOut:    count('opted_out'),
    bounced:     count('bounced'),
    autoReply:   count('auto_reply'),
    selfReplied: count('self_replied'),
    untracked:   count('untracked'),
  })
}
