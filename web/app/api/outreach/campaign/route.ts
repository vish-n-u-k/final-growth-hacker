import { NextRequest, NextResponse } from 'next/server'
import { requirePro } from '@/lib/billing/guard'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { listSuggestions, patchSuggestion, saveSuggestions, type SuggestionInput } from '@/lib/tool-suggestions'

// Email Outreach campaigns (tool_suggestions, lib/tool-suggestions.ts), one row each: the
// instruction the user typed or pasted, the recipients, and every email written for them,
// including the user's own edits. Saved as the page changes, restored when one is opened.
//   GET            → { campaigns: CampaignSummary[] } (newest first)
//   GET ?id=…      → { campaign: { id, instruction, prospects, emails } | null }
//   PUT { id, instruction, prospects, emails } → saves it; each email also gets its own row,
//       so it's kept after the campaign is deleted.
//   DELETE ?id=…   → hides it from the list (the emails' own rows stay)
// The single campaign saved before there was a list lives under id "current".

const rowId = (id: string) => `campaign:${id}`
const cleanId = (v: unknown) => (typeof v === 'string' && /^[a-z0-9-]{1,40}$/i.test(v) ? v : null)

interface Prospect { id: string; email: string; name: string; domain: string }
interface Email { subject: string; body: string; toEmail?: string; status: string; scheduledAt?: string }
interface Saved { instruction?: string; prospects?: Prospect[]; emails?: Record<string, Email>; savedAt?: string }

export interface CampaignSummary {
  id: string; title: string; recipients: number; written: number; sent: number; scheduled: number; savedAt: string
}

async function brandId(): Promise<string | NextResponse> {
  const proBlock = await requirePro()
  if (proBlock) return proBlock
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, user.id)).limit(1)
  return brand?.id ?? NextResponse.json({ error: 'No brand' }, { status: 404 })
}

export async function GET(req: NextRequest) {
  const bid = await brandId()
  if (typeof bid !== 'string') return bid
  const rows = (await listSuggestions(bid, 'email_outreach', { kind: 'campaign', limit: 100 })).filter(r => r.status !== 'archived')

  const id = cleanId(req.nextUrl.searchParams.get('id'))
  if (id) {
    const row = rows.find(r => r.externalId === rowId(id))
    const p = row?.payload as Saved | undefined
    return NextResponse.json({ campaign: p ? { id, instruction: p.instruction ?? '', prospects: p.prospects ?? [], emails: p.emails ?? {} } : null })
  }

  const campaigns: CampaignSummary[] = rows.map(r => {
    const p = r.payload as Saved
    const emails = Object.values(p.emails ?? {})
    return {
      id: r.externalId.replace(/^campaign:/, ''),
      title: r.title,
      recipients: p.prospects?.length ?? 0,
      written: emails.length,
      sent: emails.filter(e => e.status === 'sent').length,
      scheduled: emails.filter(e => e.status === 'scheduled').length,
      savedAt: p.savedAt ?? r.updatedAt.toISOString(),
    }
  }).sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  return NextResponse.json({ campaigns })
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

export async function PUT(req: NextRequest) {
  const bid = await brandId()
  if (typeof bid !== 'string') return bid
  const b = await req.json().catch(() => ({})) as { id?: unknown; instruction?: unknown; prospects?: unknown; emails?: unknown }
  const id = cleanId(b.id)
  if (!id) return NextResponse.json({ error: 'Missing campaign id' }, { status: 400 })

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

  const instruction = str(b.instruction, 10_000)
  const rows: SuggestionInput[] = [{
    kind: 'campaign', externalId: rowId(id), title: instruction.trim().split('\n')[0].slice(0, 120) || 'Untitled campaign',
    payload: { instruction, prospects, emails, savedAt: new Date().toISOString() },
    status: 'draft',
  }]
  for (const p of prospects) {
    const e = emails[p.id]
    if (!e) continue
    const to = (e.toEmail || p.email).trim()
    rows.push({
      kind: 'email', externalId: `campaign:${to.toLowerCase()}`, groupId: rowId(id), title: e.subject || '(no subject)',
      payload: { to, toName: p.name || null, domain: p.domain || null, subject: e.subject, body: e.body, instruction: instruction.slice(0, 2000), campaign: true },
      status: e.status === 'ready' ? 'suggested' : e.status,
    })
  }
  const ok = await saveSuggestions(bid, 'email_outreach', rows)
  return NextResponse.json({ ok }, { status: ok ? 200 : 500 })
}

export async function DELETE(req: NextRequest) {
  const bid = await brandId()
  if (typeof bid !== 'string') return bid
  const id = cleanId(req.nextUrl.searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'Missing campaign id' }, { status: 400 })
  const ok = await patchSuggestion(bid, 'email_outreach', rowId(id), { status: 'archived' })
  return NextResponse.json({ ok })
}
