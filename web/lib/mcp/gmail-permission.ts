import { getSnapshot, saveSnapshot } from '@/lib/signals'

// The user's OK for Claude (through the MCP send_email tool) to send email from their connected Gmail.
// Set in Settings → Connect Claude. Off by default: until it's on, send_email sends nothing.

const KEY = 'mcp:gmail-send'
export const MCP_SEND_LIMITS = [10, 25, 50] as const
const DEFAULT_LIMIT = 25

export interface McpSendPermission { on: boolean; dailyLimit: number; at: string | null }

export async function readMcpSendPermission(brandId: string): Promise<McpSendPermission> {
  const p = await getSnapshot<Partial<McpSendPermission>>(brandId, KEY).catch(() => null)
  return {
    on: p?.on === true,
    dailyLimit: MCP_SEND_LIMITS.includes(p?.dailyLimit as never) ? (p!.dailyLimit as number) : DEFAULT_LIMIT,
    at: p?.at ?? null,
  }
}

export async function saveMcpSendPermission(brandId: string, change: { on?: boolean; dailyLimit?: number }): Promise<McpSendPermission> {
  const cur = await readMcpSendPermission(brandId)
  const next: McpSendPermission = {
    on: typeof change.on === 'boolean' ? change.on : cur.on,
    dailyLimit: MCP_SEND_LIMITS.includes(change.dailyLimit as never) ? (change.dailyLimit as number) : cur.dailyLimit,
    at: typeof change.on === 'boolean' && change.on !== cur.on ? new Date().toISOString() : cur.at,
  }
  await saveSnapshot(brandId, KEY, next)
  return next
}
