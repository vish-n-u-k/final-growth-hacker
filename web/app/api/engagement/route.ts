import { NextRequest, NextResponse } from 'next/server'
import { agentAccess } from '@/lib/agents/access'
import { apifyConfigured } from '@/lib/engagement/apify'
import { runEngagement } from '@/lib/engagement/engine'
import { buildProfile, cleanProfile } from '@/lib/engagement/profile'
import { readEngagement, updateEngagement } from '@/lib/engagement/store'
import type { EngagementStatus } from '@/lib/engagement/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const STATUSES: EngagementStatus[] = ['to_do', 'followed', 'commented', 'replied', 'skip']

export async function GET() {
  const a = await agentAccess('/engagement')
  if (a.error) return a.error
  return NextResponse.json({ data: await readEngagement(a.brandId), ready: apifyConfigured() })
}

export async function POST(req: NextRequest) {
  const a = await agentAccess('/engagement')
  if (a.error) return a.error
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* handled by the op check */ }
  const op = typeof body.op === 'string' ? body.op : ''

  // Find new leads: builds the search settings from the brand the first time
  if (op === 'run') {
    const r = await runEngagement(a.brandId)
    const data = await readEngagement(a.brandId)
    if (r.error) return NextResponse.json({ data, error: r.error })
    const found = r.added === 1 ? '1 new lead' : `${r.added} new leads`
    return NextResponse.json({ data, result: r, message: r.added ? `Found ${found}.${r.notes.length ? ' ' + r.notes.join(' ') : ''}` : `No new leads this time (${r.checked} checked).${r.notes.length ? ' ' + r.notes.join(' ') : ''}` })
  }

  // "Fill in with AI": drafts the search settings from the brand and saves them
  if (op === 'profile') {
    const p = await buildProfile(a.brandId)
    if (!p) return NextResponse.json({ data: await readEngagement(a.brandId), error: 'We could not work out the search settings. Fill them in by hand.' })
    const data = await updateEngagement(a.brandId, d => { d.profile = p })
    return NextResponse.json({ data, message: 'Search settings filled in from your brand.' })
  }

  if (op === 'save_profile') {
    const data = await updateEngagement(a.brandId, d => { d.profile = cleanProfile((body.profile ?? {}) as Record<string, unknown>, d.profile) })
    return NextResponse.json({ data, message: 'Saved.' })
  }

  // One lead's status: followed, commented, replied, skipped, or back to to do
  if (op === 'status') {
    const status = body.status as EngagementStatus
    const id = typeof body.id === 'string' ? body.id : ''
    if (!id || !STATUSES.includes(status)) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })
    const data = await updateEngagement(a.brandId, d => {
      const l = d.leads.find(x => x.id === id)
      if (!l) return
      l.status = status
      if (status === 'to_do') delete l.doneAt
      else l.doneAt = new Date().toISOString()
    })
    return NextResponse.json({ data })
  }

  return NextResponse.json({ error: 'Unknown request.' }, { status: 400 })
}
