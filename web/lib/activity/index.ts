// ── Activity events ───────────────────────────────────────────────────────────
// Answers "is the Claude-first loop being used?": daily email sent → "Do it in
// Claude" clicked → GrowJin MCP called → tasks completed (in Claude or the app).
// Never store email bodies, task text or tool arguments here — only what happened.

import { createHmac, timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'
import { activityEvents, brandIntegrations } from '@/lib/db/schema'
import { and, eq, gte, lt, sql } from 'drizzle-orm'

// "Do it in Claude" links go through /api/r/claude so clicks can be counted.
// The signature stops anyone else from inflating a brand's click count.
function clickSig(brandId: string): string {
  return createHmac('sha256', process.env.CRON_SECRET ?? 'dev').update(`claude-click:${brandId}`).digest('hex').slice(0, 20)
}

export function claudeClickUrl(appUrl: string, brandId: string): string {
  return `${appUrl.replace(/\/$/, '')}/api/r/claude?b=${brandId}&s=${clickSig(brandId)}`
}

export function isValidClickSig(brandId: string, sig: string): boolean {
  const expected = Buffer.from(clickSig(brandId))
  const given = Buffer.from(sig)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export type ActivityType =
  | 'mcp_session'        // a Claude client connected (MCP initialize)
  | 'mcp_call'           // { tool }
  | 'daily_email_sent'   // { tasks }
  | 'email_claude_click' // "Do it in Claude" in the daily email
  | 'task_completed'     // { kind, via: 'claude' | 'app', status }

export async function logActivity(brandId: string, type: ActivityType, detail?: Record<string, unknown>) {
  try {
    await db.insert(activityEvents).values({ brandId, type, detail: detail ?? null })
  } catch (e) {
    // Table missing before the migration, or a DB blip — never break the caller
    console.error('[activity] log failed:', e instanceof Error ? e.message : e)
  }
}

/** Marks the brand's MCP connection as used (shows "last used" for the connector). */
export async function touchMcp(brandId: string) {
  await db.update(brandIntegrations)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.provider, 'mcp')))
    .catch(() => {})
}

/** Event counts by type for one brand in [from, to). */
export async function countActivity(brandId: string, from: Date, to: Date): Promise<Record<string, number>> {
  try {
    const rows = await db
      .select({ type: activityEvents.type, n: sql<number>`count(*)::int` })
      .from(activityEvents)
      .where(and(eq(activityEvents.brandId, brandId), gte(activityEvents.createdAt, from), lt(activityEvents.createdAt, to)))
      .groupBy(activityEvents.type)
    return Object.fromEntries(rows.map((r) => [r.type, r.n]))
  } catch {
    return {}
  }
}
