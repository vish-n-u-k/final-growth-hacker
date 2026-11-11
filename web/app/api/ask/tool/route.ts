import { NextRequest, NextResponse } from 'next/server'
import { agentAccess } from '@/lib/agents/access'
import { askTool, UI_TOOLS } from '@/lib/ask/tools'

// Ask's panels call the MCP tools through here: POST { name, args } → the tool's answer.
// Only the tools in UI_TOOLS; sends count as the person's own (they pressed the button).
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const ALLOWED: readonly string[] = UI_TOOLS

export async function POST(req: NextRequest) {
  const a = await agentAccess()
  if (a.error) return a.error
  const { name, args } = await req.json().catch(() => ({})) as { name?: unknown; args?: unknown }
  if (typeof name !== 'string' || !ALLOWED.includes(name)) return NextResponse.json({ error: 'Not a tool Ask can use.' }, { status: 400 })
  const input = args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {}
  return NextResponse.json(await askTool(a.brandId, name, input))
}
