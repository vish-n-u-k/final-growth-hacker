import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { askAccess } from '@/lib/agents/access'
import { askTool, UI_TOOLS } from '@/lib/ask/tools'
import { createClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/admin'
import { db } from '@/lib/db'
import { modules } from '@/lib/db/schema'
import { getAnalysisMode } from '@/lib/modules/analysis-mode'
import { queueAnalysisRequest } from '@/lib/modules/analysis-queue'

// Ask's panels, and actions Claude proposed that the owner approved, call the MCP tools through here:
// POST { name, args } → the tool's answer. Only the tools in UI_TOOLS; each is the person's own click.
export const dynamic = 'force-dynamic'
export const maxDuration = 300   // re-checking a roadmap step can take a few minutes

const ALLOWED: readonly string[] = UI_TOOLS

export async function POST(req: NextRequest) {
  const a = await askAccess()
  if (a.error) return a.error
  const { name, args } = await req.json().catch(() => ({})) as { name?: unknown; args?: unknown }
  if (typeof name !== 'string' || !ALLOWED.includes(name)) return NextResponse.json({ error: 'Not a tool Ask can use.' }, { status: 400 })
  const input = args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {}

  // A roadmap re-check follows the admin's "Module runs" switch, like the Run button on the module page
  if (name === 'analyze_module') {
    const { data: { user } } = await (await createClient()).auth.getUser()
    if (!isAdminEmail(user?.email) && await getAnalysisMode() === 'queue') {
      const [mod] = await db.select({ id: modules.id, name: modules.name, type: modules.type }).from(modules)
        .where(and(eq(modules.brandId, a.brandId), eq(modules.type, String(input.module_type ?? '')))).limit(1)
      if (!mod) return NextResponse.json({ error: `No roadmap step called “${String(input.module_type ?? '')}”.` })
      if (mod.type !== 'foundation') {
        await queueAnalysisRequest({ userId: user?.id ?? '', userEmail: user?.email ?? '', moduleId: mod.id, moduleName: mod.name ?? mod.type })
        return NextResponse.json({ message: `Sent to the GrowJin team: they’ll re-check ${mod.name ?? mod.type} and email you when it’s done.` })
      }
    }
  }
  return NextResponse.json(await askTool(a.brandId, name, input))
}
