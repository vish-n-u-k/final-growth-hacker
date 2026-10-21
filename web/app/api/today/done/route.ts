import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBrandForUser } from '@/lib/server-session'
import { db } from '@/lib/db'
import { taskProofs, moduleItems, brandSignals } from '@/lib/db/schema'
import { and, desc, eq, gte } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

// "Recently done" on Today: tasks finished in the last 2 weeks that came with proof
// (a link to the change and a note), newest first.
export interface DoneTask {
  id: string
  label: string
  url: string | null
  note: string | null
  source: 'claude' | 'agent' | 'ai' | 'user'
  at: string
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const brand = await getBrandForUser(user.id)
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  try {
    const rows = await db
      .select({
        id: taskProofs.id,
        url: taskProofs.url,
        note: taskProofs.note,
        source: taskProofs.source,
        at: taskProofs.createdAt,
        itemLabel: moduleItems.label,
        itemHighlight: moduleItems.aiHighlight,
        signalTitle: brandSignals.title,
      })
      .from(taskProofs)
      .leftJoin(moduleItems, eq(moduleItems.id, taskProofs.itemId))
      .leftJoin(brandSignals, eq(brandSignals.id, taskProofs.signalId))
      .where(and(eq(taskProofs.brandId, brand.id), gte(taskProofs.createdAt, new Date(Date.now() - 14 * 86_400_000))))
      .orderBy(desc(taskProofs.createdAt))
      .limit(6)
    const done: DoneTask[] = rows.map(r => ({
      id: r.id,
      label: r.itemHighlight || r.itemLabel || r.signalTitle || 'Task',
      url: r.url,
      note: r.note,
      source: r.source as DoneTask['source'],
      at: r.at.toISOString(),
    }))
    return NextResponse.json({ done })
  } catch (err) {
    // task_proofs not created yet (drizzle/task_proofs.sql): nothing to show
    console.error('[today/done] load failed:', err)
    return NextResponse.json({ done: [] })
  }
}
