import { db } from '@/lib/db'
import { taskProofs } from '@/lib/db/schema'
import { and, desc, eq, inArray } from 'drizzle-orm'

// Proof that a task was done: a link to the result (pull request, live page, published post)
// and a short note on what changed. Shown on finished tasks so "done" can be checked.
// Everything here tolerates the task_proofs table not existing yet (drizzle/task_proofs.sql).

export type ProofSource = 'claude' | 'agent' | 'ai' | 'user'
export interface TaskProof { url: string | null; note: string | null; source: ProofSource; createdAt: string }

/** Only http(s) links are kept, so a proof link can't run script or point somewhere odd. */
export function cleanProofUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const u = new URL(raw.trim())
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}

export async function saveProof(opts: {
  brandId: string
  itemId?: string
  signalId?: string
  url?: unknown
  note?: unknown
  source: ProofSource
}): Promise<void> {
  const url = cleanProofUrl(opts.url)
  const note = typeof opts.note === 'string' && opts.note.trim() ? opts.note.trim().slice(0, 500) : null
  if (!url && !note) return
  try {
    await db.insert(taskProofs).values({
      brandId: opts.brandId,
      itemId: opts.itemId ?? null,
      signalId: opts.signalId ?? null,
      url,
      note,
      source: opts.source,
    })
  } catch (err) {
    console.error('[proofs] save failed — has drizzle/task_proofs.sql been run?', err)
  }
}

/** Latest proof per checklist item (key: item id). Empty when there are none or the table is missing. */
export async function loadItemProofs(brandId: string, itemIds?: string[]): Promise<Record<string, TaskProof>> {
  if (itemIds && itemIds.length === 0) return {}
  try {
    const rows = await db.select().from(taskProofs)
      .where(itemIds ? and(eq(taskProofs.brandId, brandId), inArray(taskProofs.itemId, itemIds)) : eq(taskProofs.brandId, brandId))
      .orderBy(desc(taskProofs.createdAt))
    const out: Record<string, TaskProof> = {}
    for (const r of rows) {
      if (!r.itemId || out[r.itemId]) continue
      out[r.itemId] = { url: r.url, note: r.note, source: r.source as ProofSource, createdAt: r.createdAt.toISOString() }
    }
    return out
  } catch (err) {
    console.error('[proofs] load failed — has drizzle/task_proofs.sql been run?', err)
    return {}
  }
}
