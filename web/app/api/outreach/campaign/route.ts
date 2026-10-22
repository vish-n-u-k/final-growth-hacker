import { NextRequest, NextResponse } from 'next/server'
import { requirePro } from '@/lib/billing/guard'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { listSuggestions, saveSuggestions, type SuggestionInput } from '@/lib/tool-suggestions'

// The Email Outreach campaign being worked on (tool_suggestions, lib/tool-suggestions.ts):
// the instruction the user typed or pasted, the recipients, and every email written for them,
// including the user's own edits. Saved as the page changes, restored when it opens.
//   GET → { campaign: { instruction, prospects, emails } | null }
//   PUT { instruction, prospects, emails } → saves it; each email also gets its own row,
//       so it's kept after the campaign is cleared.

const CURRENT = 'campaign:current'

interface Prospect { id: string; email: string; name: string; domain: string }
interface Email { subject: string; body: string; toEmail?: string; status: string; scheduledAt?: string }

async function brandId(): Promise<string | NextResponse> {
  const proBlock = await requirePro()
  if (proBlock) return proBlock
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, user.id)).limit(1)
  return brand?.id ?? NextResponse.json({ error: 'No brand' }, { status: 404 })
}

export async function GET() {
  const id = await brandId()
  if (typeof id !== 'string') return id
  const [row] = (await listSuggestions(id, 'email_outreach', { kind: 'campaign', limit: 5 })).filter(r => r.externalId === CURRENT)
  return NextResponse.json({ campaign: row?.payload ?? null })
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

export async function PUT(req: NextRequest) {
  const id = await brandId()
  if (typeof id !== 'string') return id
  const b = await req.json().catch(() => ({})) as { instruction?: unknown; prospects?: unknown; emails?: unknown }

  const prospects: Prospect[] = (Array.isArray(b.prospects) ? b.prospects : []).slice(0, 500)
    .map((p: Record<string, unknown>) => ({ id: str(p.id, 80), email: str(p.email, 200), name: str(p.name, 200), domain: str(p.domain, 200) }))
    .filter(p => p.id && p.email)
  const known = new Set(prospects.map(p => p.id))
  const emails: Record<string, Email> = {}
  for (const [pid, e] of Object.entries((b.emails && typeof b.emails === 'object' ? b.emails : {}) as Record<string, Record<string, unknown>>)) {
    if (!known.has(pid) || !e) continue
    const subject = str(e.subject, 300), body = str(e.body, 50_000)
    if (!subject && !body) continue
    emails[pid] = {
      subject, body, status: ['sent', 'scheduled'].includes(String(e.status)) ? String(e.status) : 'ready',
      ...(e.toEmail ? { toEmail: str(e.toEmail, 200) } : {}),
      ...(e.scheduledAt ? { scheduledAt: str(e.scheduledAt, 40) } : {}),
    }
  }

  const rows: SuggestionInput[] = [{
    kind: 'campaign', externalId: CURRENT, title: str(b.instruction, 120) || 'Campaign',
    payload: { instruction: str(b.instruction, 10_000), prospects, emails, savedAt: new Date().toISOString() },
  }]
  for (const p of prospects) {
    const e = emails[p.id]
    if (!e) continue
    const to = (e.toEmail || p.email).trim()
    rows.push({
      kind: 'email', externalId: `campaign:${to.toLowerCase()}`, title: e.subject || '(no subject)',
      payload: { to, toName: p.name || null, domain: p.domain || null, subject: e.subject, body: e.body, instruction: str(b.instruction, 2000), campaign: true },
      status: e.status === 'ready' ? 'suggested' : e.status,
    })
  }
  const ok = await saveSuggestions(id, 'email_outreach', rows)
  return NextResponse.json({ ok }, { status: ok ? 200 : 500 })
}
