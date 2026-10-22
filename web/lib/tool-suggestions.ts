// Saved tool output (tool_suggestions): every lead, email draft, topic and link a tool comes up
// with gets its own row, the way social_suggestions keeps Social Studio's ideas. Saving is
// best-effort: a failed save is logged and never breaks the tool that called it.

import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { toolSuggestions } from '@/lib/db/schema'

export type SuggestionTool = 'competitor_leads' | 'lead_agent' | 'search_agent' | 'email_outreach'
export type SuggestionKind = 'scan' | 'lead' | 'email' | 'topic' | 'link' | 'task'

export interface SuggestionInput {
  kind: SuggestionKind
  externalId: string
  groupId?: string | null
  title: string
  payload: Record<string, unknown>
  status?: string
}

export type SavedSuggestion = typeof toolSuggestions.$inferSelect

/** Inserts new rows and updates existing ones (same brand, tool and externalId). */
export async function saveSuggestions(brandId: string, tool: SuggestionTool, items: SuggestionInput[]): Promise<boolean> {
  if (!items.length) return true
  try {
    for (let i = 0; i < items.length; i += 100) {
      await db.insert(toolSuggestions)
        .values(items.slice(i, i + 100).map(x => ({
          brandId, tool, kind: x.kind, externalId: x.externalId.slice(0, 300), groupId: x.groupId ?? null,
          title: x.title.slice(0, 300) || '(untitled)', payload: x.payload, status: x.status ?? 'suggested',
        })))
        .onConflictDoUpdate({
          target: [toolSuggestions.brandId, toolSuggestions.tool, toolSuggestions.externalId],
          set: {
            title: sql`excluded.title`, payload: sql`excluded.payload`, status: sql`excluded.status`,
            groupId: sql`coalesce(excluded.group_id, ${toolSuggestions.groupId})`, updatedAt: new Date(),
          },
        })
    }
    return true
  } catch (e) {
    console.error(`[tool-suggestions] save failed (${tool}):`, e instanceof Error ? e.message : e)
    return false
  }
}

/** Merges `payload` into a saved row's payload and/or sets its status. */
export async function patchSuggestion(
  brandId: string, tool: SuggestionTool, externalId: string,
  change: { payload?: Record<string, unknown>; status?: string },
): Promise<boolean> {
  try {
    const rows = await db.update(toolSuggestions)
      .set({
        ...(change.payload ? { payload: sql`coalesce(${toolSuggestions.payload}, '{}'::jsonb) || ${JSON.stringify(change.payload)}::jsonb` } : {}),
        ...(change.status ? { status: change.status } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(toolSuggestions.brandId, brandId), eq(toolSuggestions.tool, tool), eq(toolSuggestions.externalId, externalId)))
      .returning({ id: toolSuggestions.id })
    return rows.length > 0
  } catch (e) {
    console.error(`[tool-suggestions] patch failed (${tool}):`, e instanceof Error ? e.message : e)
    return false
  }
}

export async function listSuggestions(
  brandId: string, tool: SuggestionTool,
  opts: { kind?: SuggestionKind; groupId?: string; limit?: number } = {},
): Promise<SavedSuggestion[]> {
  try {
    return await db.select().from(toolSuggestions)
      .where(and(
        eq(toolSuggestions.brandId, brandId), eq(toolSuggestions.tool, tool),
        opts.kind ? eq(toolSuggestions.kind, opts.kind) : undefined,
        opts.groupId ? eq(toolSuggestions.groupId, opts.groupId) : undefined,
      ))
      .orderBy(desc(toolSuggestions.createdAt))
      .limit(opts.limit ?? 200)
  } catch (e) {
    console.error(`[tool-suggestions] list failed (${tool}):`, e instanceof Error ? e.message : e)
    return []
  }
}

/** Items in `after` that are new or changed since `before` (matched by `key`). */
export function changedItems<T>(before: T[] | undefined, after: T[] | undefined, key: (x: T) => string): T[] {
  const old = new Map((before ?? []).map(x => [key(x), JSON.stringify(x)]))
  return (after ?? []).filter(x => old.get(key(x)) !== JSON.stringify(x))
}

/** Marks Email Outreach's saved drafts to this address as sent (or scheduled). */
export async function markOutreachDrafts(brandId: string, to: string, status: 'sent' | 'scheduled'): Promise<void> {
  const address = (to.match(/<([^>]+)>/)?.[1] ?? to).trim().toLowerCase()
  if (!address) return
  try {
    await db.update(toolSuggestions)
      .set({ status, updatedAt: new Date() })
      .where(and(
        eq(toolSuggestions.brandId, brandId), eq(toolSuggestions.tool, 'email_outreach'),
        eq(toolSuggestions.status, 'suggested'),
        sql`lower(${toolSuggestions.payload}->>'to') = ${address}`,
      ))
  } catch (e) {
    console.error('[tool-suggestions] mark sent failed:', e instanceof Error ? e.message : e)
  }
}
