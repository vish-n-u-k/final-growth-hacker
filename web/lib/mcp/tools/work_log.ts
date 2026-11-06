import { db } from '@/lib/db'
import { workLog } from '@/lib/db/schema'
import { and, asc, desc, eq, gte, ilike, isNotNull, lte, ne, or, sql } from 'drizzle-orm'

// Work log: growth work the owner did outside GrowJin, saved when they tell Claude.
// Only the MCP tools log_work / list_work / update_work / delete_work use this;
// nothing else in the app reads it. Needs drizzle/work_log.sql to have been run.

const STATUSES = ['done', 'waiting', 'follow_up']
const MAX_BATCH = 100
const NO_TABLE = 'The work log table is missing. Run web/drizzle/work_log.sql in the Supabase SQL editor.'

type Row = typeof workLog.$inferSelect

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const s = String(v).trim()
  return s ? s.slice(0, max) : null
}

/** YYYY-MM-DD, or null. Accepts anything Date can read ("2026-11-02", "Nov 2 2026"). */
function day(v: unknown): string | null {
  const s = str(v, 40)
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function kindOf(v: unknown): string {
  const s = str(v, 40)?.toLowerCase().replace(/\s+/g, '_')
  return s || 'other'
}

function statusOf(v: unknown): string | null {
  const s = str(v, 20)?.toLowerCase().replace(/[\s-]+/g, '_')
  if (!s) return null
  if (s === 'followup') return 'follow_up'
  return STATUSES.includes(s) ? s : null
}

function urlOf(v: unknown): string | null {
  const s = str(v, 2000)
  if (!s) return null
  // Bare domains and emails are kept as typed; only add https:// to things that look like a site
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.includes('@') || !s.includes('.')) return s
  return `https://${s}`
}

function out(r: Row) {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    url: r.url,
    done_on: r.doneOn,
    how: r.how,
    status: r.status,
    next_check: r.nextCheck,
    notes: r.notes,
    logged_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  }
}

function missingTable(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.message} ${String((err as { cause?: unknown }).cause ?? '')}` : String(err)
  return /work_log/.test(msg) && /does not exist|relation/i.test(msg)
}

async function guard<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn()
  } catch (err) {
    if (missingTable(err)) return { error: NO_TABLE }
    throw err
  }
}

/** Adds one entry or many. An entry whose URL is already logged is not added again. */
export async function logWork(brandId: string, args: Record<string, unknown>) {
  const raw: unknown[] = Array.isArray(args['entries'])
    ? (args['entries'] as unknown[])
    : [args]
  if (raw.length === 0) return { error: 'Nothing to log: pass entries, or title (and kind) for one entry.' }
  if (raw.length > MAX_BATCH) return { error: `At most ${MAX_BATCH} entries per call.` }

  const rows: (typeof workLog.$inferInsert)[] = []
  const problems: { index: number; error: string }[] = []
  raw.forEach((e, i) => {
    const o = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>
    const url = urlOf(o['url'])
    const title = str(o['title'], 300) ?? url
    if (!title) {
      problems.push({ index: i, error: 'Needs a title or a url.' })
      return
    }
    rows.push({
      brandId,
      kind: kindOf(o['kind']),
      title,
      url,
      doneOn: day(o['done_on']) ?? today(),
      how: str(o['how'], 500),
      status: statusOf(o['status']) ?? 'done',
      nextCheck: day(o['next_check']),
      notes: str(o['notes'], 2000),
    })
  })

  return guard(async () => {
    // Skip URLs already in the log (and repeats within this call)
    const urls = rows.map(r => r.url).filter((u): u is string => !!u)
    const known = new Map<string, Row>()
    if (urls.length) {
      const existing = await db
        .select()
        .from(workLog)
        .where(and(eq(workLog.brandId, brandId), sql`lower(${workLog.url}) in (${sql.join(urls.map(u => sql`${u.toLowerCase()}`), sql`, `)})`))
      for (const r of existing) if (r.url) known.set(r.url.toLowerCase(), r)
    }
    const fresh: typeof rows = []
    const already: ReturnType<typeof out>[] = []
    const seen = new Set<string>()
    for (const r of rows) {
      const key = r.url?.toLowerCase()
      if (key && known.has(key)) { already.push(out(known.get(key)!)); continue }
      if (key && seen.has(key)) continue
      if (key) seen.add(key)
      fresh.push(r)
    }

    const added = fresh.length ? await db.insert(workLog).values(fresh).returning() : []
    return {
      ok: true,
      added: added.map(out),
      ...(already.length ? { already_logged: already } : {}),
      ...(problems.length ? { not_added: problems } : {}),
    }
  })
}

/** Lists entries, newest first, with filters. due=true: open entries whose next_check is today or earlier. */
export async function listWork(brandId: string, args: Record<string, unknown>) {
  const conds = [eq(workLog.brandId, brandId)]
  const kind = str(args['kind'], 40)
  if (kind) conds.push(eq(workLog.kind, kindOf(kind)))
  const status = statusOf(args['status'])
  if (status) conds.push(eq(workLog.status, status))
  const from = day(args['from'])
  if (from) conds.push(gte(workLog.doneOn, from))
  const to = day(args['to'])
  if (to) conds.push(lte(workLog.doneOn, to))
  const q = str(args['search'], 200)
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, m => `\\${m}`)}%`
    conds.push(or(ilike(workLog.title, like), ilike(workLog.url, like), ilike(workLog.notes, like), ilike(workLog.how, like))!)
  }
  const due = args['due'] === true || args['due'] === 'true'
  if (due) conds.push(isNotNull(workLog.nextCheck), lte(workLog.nextCheck, today()), ne(workLog.status, 'done'))
  const limit = Math.min(Math.max(parseInt(String(args['limit'] ?? '50'), 10) || 50, 1), 500)

  return guard(async () => {
    const where = and(...conds)
    const [rows, counts] = await Promise.all([
      db.select().from(workLog).where(where)
        .orderBy(...(due ? [asc(workLog.nextCheck)] : [desc(workLog.doneOn), desc(workLog.createdAt)]))
        .limit(limit),
      db.select({ kind: workLog.kind, status: workLog.status, n: sql<number>`count(*)::int` })
        .from(workLog).where(where).groupBy(workLog.kind, workLog.status),
    ])
    const total = counts.reduce((s, c) => s + c.n, 0)
    const byKind: Record<string, number> = {}
    const byStatus: Record<string, number> = {}
    for (const c of counts) {
      byKind[c.kind] = (byKind[c.kind] ?? 0) + c.n
      byStatus[c.status] = (byStatus[c.status] ?? 0) + c.n
    }
    return {
      total,
      by_kind: byKind,
      by_status: byStatus,
      showing: rows.length,
      entries: rows.map(out),
      ...(total === 0 ? { message: 'Nothing logged matches.' } : {}),
    }
  })
}

/** Changes the given fields of one entry. add_note appends a dated line to notes. */
export async function updateWork(brandId: string, args: Record<string, unknown>) {
  const id = str(args['id'], 64)
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return { error: 'Pass the entry id (from list_work or log_work).' }

  return guard(async () => {
    const [row] = await db.select().from(workLog).where(and(eq(workLog.id, id), eq(workLog.brandId, brandId))).limit(1)
    if (!row) return { error: 'Entry not found.' }

    const set: Partial<typeof workLog.$inferInsert> = { updatedAt: new Date() }
    if ('kind' in args && str(args['kind'], 40)) set.kind = kindOf(args['kind'])
    if ('title' in args && str(args['title'], 300)) set.title = str(args['title'], 300)!
    if ('url' in args) set.url = urlOf(args['url'])
    if ('done_on' in args && day(args['done_on'])) set.doneOn = day(args['done_on'])!
    if ('how' in args) set.how = str(args['how'], 500)
    if ('status' in args) {
      const s = statusOf(args['status'])
      if (!s) return { error: `status must be one of ${STATUSES.join(', ')}.` }
      set.status = s
    }
    if ('next_check' in args) set.nextCheck = day(args['next_check'])
    if ('notes' in args) set.notes = str(args['notes'], 2000)
    const add = str(args['add_note'], 1000)
    if (add) {
      const base = set.notes !== undefined ? set.notes : row.notes
      set.notes = `${base ? `${base}\n` : ''}${today()}: ${add}`.slice(-4000)
    }

    const [updated] = await db.update(workLog).set(set).where(eq(workLog.id, id)).returning()
    return { ok: true, entry: out(updated) }
  })
}

export async function deleteWork(brandId: string, args: Record<string, unknown>) {
  const id = str(args['id'], 64)
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return { error: 'Pass the entry id (from list_work or log_work).' }
  return guard(async () => {
    const gone = await db.delete(workLog).where(and(eq(workLog.id, id), eq(workLog.brandId, brandId))).returning({ id: workLog.id, title: workLog.title })
    return gone.length ? { ok: true, deleted: gone[0] } : { error: 'Entry not found.' }
  })
}
