// Competitor Leads scans and reviews, saved in tool_suggestions (lib/tool-suggestions.ts):
// one 'scan' row per scan (externalId = scan id) and one 'lead' row per review read
// (groupId = scan id). A review starts as just the review; reaching out fills in the fit
// check, the contact and the email draft, one step at a time (app/api/lead-finder/step).

import { createHash } from 'crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { toolSuggestions } from '@/lib/db/schema'
import { listSuggestions, saveSuggestions, type SavedSuggestion } from '@/lib/tool-suggestions'
import type { RawReview } from '@/lib/lead-finder/reviews'

export type Platform = 'trustpilot' | 'shopify'

export interface SavedScan {
  id: string
  platform: Platform
  competitor: string
  reviewsRead: number
  scannedAt: string
  emailed?: number
}

export interface SavedReview {
  id: string
  scanId: string
  name: string
  rating: number
  date: string | null
  reviewUrl: string | null
  text: string
  // Filled in when the user reaches out
  fit?: number
  why?: string
  pains?: string[]
  contactChecked?: boolean
  website?: string | null
  email?: string | null
  verified?: boolean
  draft?: { subject: string; body: string }
  status: 'new' | 'sent' | 'skipped'
  sentAt?: string
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
    scannedAt: str(p.scannedAt) || row.createdAt.toISOString(),
  }
}

export function toReview(row: SavedSuggestion): SavedReview {
  const p = (row.payload ?? {}) as Partial<SavedReview> & { pains?: unknown }
  return {
    id: row.externalId,
    scanId: row.groupId ?? row.externalId.split(':')[0],
    name: p.name ?? row.title,
    rating: Number(p.rating) || 0,
    date: p.date ?? null,
    reviewUrl: p.reviewUrl ?? null,
    text: p.text ?? '',
    fit: typeof p.fit === 'number' ? p.fit : undefined,
    why: p.why,
    pains: Array.isArray(p.pains) ? p.pains.map(String) : undefined,
    contactChecked: !!p.contactChecked || p.email !== undefined,
    website: p.website ?? null,
    email: p.email ?? null,
    verified: !!p.verified,
    draft: p.draft,
    status: row.status === 'sent' || row.status === 'skipped' ? row.status : 'new',
    sentAt: p.sentAt,
  }
}

/** Saves a finished read: the scan and every review in it. Returns the saved reviews. */
export async function saveScanReviews(
  brandId: string,
  scan: { id: string; platform: Platform; competitor: string },
  reviews: RawReview[],
): Promise<{ scan: SavedScan; reviews: SavedReview[] }> {
  const saved: SavedScan = { ...scan, reviewsRead: reviews.length, scannedAt: new Date().toISOString(), emailed: 0 }
  const seen = new Set<string>()
  const rows = reviews.map(r => ({
    kind: 'lead' as const, externalId: leadIdFor(scan.id, r), groupId: scan.id, title: r.company || 'Reviewer',
    payload: { name: r.company || 'Reviewer', rating: r.rating, date: r.reviewDate, reviewUrl: r.reviewUrl, text: r.reviewText },
  })).filter(r => (seen.has(r.externalId) ? false : (seen.add(r.externalId), true)))
  await saveSuggestions(brandId, 'competitor_leads', [
    { kind: 'scan', externalId: scan.id, title: scan.competitor, payload: { platform: scan.platform, competitor: scan.competitor, reviewsRead: reviews.length, scannedAt: saved.scannedAt } },
    ...rows,
  ])
  return {
    scan: saved,
    reviews: rows.map(r => ({
      id: r.externalId, scanId: scan.id, name: r.payload.name, rating: r.payload.rating, date: r.payload.date,
      reviewUrl: r.payload.reviewUrl, text: r.payload.text, status: 'new' as const,
    })),
  }
}

/** Past scans, newest first, with how many reviewers were emailed from each. */
export async function listScans(brandId: string): Promise<SavedScan[]> {
  const [scans, sent] = await Promise.all([
    listSuggestions(brandId, 'competitor_leads', { kind: 'scan', limit: 20 }),
    db.select({ groupId: toolSuggestions.groupId }).from(toolSuggestions)
      .where(and(eq(toolSuggestions.brandId, brandId), eq(toolSuggestions.tool, 'competitor_leads'), eq(toolSuggestions.status, 'sent')))
      .catch(() => [] as { groupId: string | null }[]),
  ])
  const counts = new Map<string, number>()
  for (const s of sent) if (s.groupId) counts.set(s.groupId, (counts.get(s.groupId) ?? 0) + 1)
  return scans.map(s => ({ ...toScan(s), emailed: counts.get(s.externalId) ?? 0 }))
}

export async function loadScanReviews(brandId: string, scanId: string): Promise<SavedReview[]> {
  const rows = await listSuggestions(brandId, 'competitor_leads', { kind: 'lead', groupId: scanId, limit: 300 })
  return rows.reverse().map(toReview)
}

export async function loadScan(brandId: string, scanId: string): Promise<SavedScan | null> {
  const [row] = await db.select().from(toolSuggestions)
    .where(and(eq(toolSuggestions.brandId, brandId), eq(toolSuggestions.tool, 'competitor_leads'), eq(toolSuggestions.externalId, scanId)))
    .limit(1).catch(() => [])
  return row ? toScan(row) : null
}

export async function loadReview(brandId: string, id: string): Promise<SavedReview | null> {
  const [row] = await db.select().from(toolSuggestions)
    .where(and(eq(toolSuggestions.brandId, brandId), eq(toolSuggestions.tool, 'competitor_leads'), eq(toolSuggestions.kind, 'lead'), eq(toolSuggestions.externalId, id)))
    .limit(1).catch(() => [])
  return row ? toReview(row) : null
}
