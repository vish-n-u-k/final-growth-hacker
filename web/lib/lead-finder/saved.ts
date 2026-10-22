// Competitor Leads scans and leads, saved in tool_suggestions (lib/tool-suggestions.ts):
// one 'scan' row per scan (externalId = scan id) and one 'lead' row per good fit
// (groupId = scan id). The step route saves what the AI finds; the page saves the user's
// sends, skips and edits.

import { createHash } from 'crypto'
import { listSuggestions, type SavedSuggestion } from '@/lib/tool-suggestions'

export type Platform = 'trustpilot' | 'shopify'

export interface SavedScan {
  id: string
  platform: Platform
  competitor: string
  reviewsRead: number
  unhappy: number
  others: number
  scannedAt: string
  leadCount?: number
}

export interface SavedLead {
  id: string
  name: string
  rating: number
  date: string | null
  reviewUrl: string | null
  text: string
  fit: number
  why: string
  pains: string[]
  stage: 'scored' | 'contact' | 'contacted' | 'drafting' | 'drafted'
  website?: string | null
  email?: string | null
  verified?: boolean
  draft?: { subject: string; body: string }
  draftError?: string
  status?: 'sent' | 'skipped'
}

/** Stable id for a reviewer within a scan, so re-saving updates the same row. */
export function leadIdFor(scanId: string, r: { company: string; reviewDate: string | null; reviewUrl: string | null }): string {
  const h = createHash('sha1').update(r.reviewUrl || `${r.company}|${r.reviewDate ?? ''}`).digest('hex').slice(0, 12)
  return `${scanId}:${h}`
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

function toScan(row: SavedSuggestion): SavedScan {
  const p = row.payload ?? {}
  return {
    id: row.externalId,
    platform: p.platform === 'shopify' ? 'shopify' : 'trustpilot',
    competitor: str(p.competitor) || row.title,
    reviewsRead: Number(p.reviewsRead) || 0,
    unhappy: Number(p.unhappy) || 0,
    others: Number(p.others) || 0,
    scannedAt: str(p.scannedAt) || row.createdAt.toISOString(),
  }
}

function toLead(row: SavedSuggestion): SavedLead {
  const p = (row.payload ?? {}) as Partial<SavedLead>
  // A scan closed half-way leaves leads mid-step: show them as finished so they can still be emailed
  const finished = p.stage === 'drafted'
  return {
    id: row.externalId,
    name: p.name ?? row.title,
    rating: Number(p.rating) || 0,
    date: p.date ?? null,
    reviewUrl: p.reviewUrl ?? null,
    text: p.text ?? '',
    fit: Number(p.fit) || 0,
    why: p.why ?? '',
    pains: Array.isArray(p.pains) ? p.pains : [],
    stage: 'drafted',
    website: p.website ?? null,
    email: p.email ?? null,
    verified: !!p.verified,
    draft: p.draft,
    draftError: p.draftError ?? (!finished && !p.draft ? 'The scan stopped before this email was written. Write your own below.' : undefined),
    status: row.status === 'sent' || row.status === 'skipped' ? row.status : undefined,
  }
}

/** Past scans, newest first, with how many good fits each found. */
export async function listScans(brandId: string): Promise<SavedScan[]> {
  const [scans, leads] = await Promise.all([
    listSuggestions(brandId, 'competitor_leads', { kind: 'scan', limit: 20 }),
    listSuggestions(brandId, 'competitor_leads', { kind: 'lead', limit: 1000 }),
  ])
  const counts = new Map<string, number>()
  for (const l of leads) if (l.groupId) counts.set(l.groupId, (counts.get(l.groupId) ?? 0) + 1)
  return scans.map(s => ({ ...toScan(s), leadCount: counts.get(s.externalId) ?? 0 }))
}

export async function loadScanLeads(brandId: string, scanId: string): Promise<SavedLead[]> {
  const rows = await listSuggestions(brandId, 'competitor_leads', { kind: 'lead', groupId: scanId, limit: 100 })
  return rows.reverse().map(toLead)
}
