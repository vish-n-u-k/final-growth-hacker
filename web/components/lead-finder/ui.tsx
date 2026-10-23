// Small pieces shared by the Competitor Leads list (components/LeadFinder) and the reach-out page
// (components/lead-finder/ReachOut).

export function Stars({ n }: { n: number }) {
  const r = Math.max(0, Math.min(5, Math.round(n)))
  return <span className="cl-stars" aria-label={`${r} out of 5 stars`}>{'★'.repeat(r)}<s>{'★'.repeat(5 - r)}</s></span>
}

export const initials = (n: string) => n.replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase() || '?'
export const fmtDate = (d: string | null | undefined) => d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''
export const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  return m < 2 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : fmtDate(iso)
}
export const firstName = (n: string) => { const f = n.trim().split(/\s+/)[0]; return /^[\p{L}'-]{2,}$/u.test(f) && n.trim().includes(' ') ? f : '' }
/** A short name for what was scanned: "buffer.com", or the app name for a Shopify App Store link. */
export function competitorLabel(c: string): string {
  const t = c.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/[?#].*$/, '').replace(/\/+$/, '')
  const app = t.match(/^apps\.shopify\.com\/([^/]+)/i)?.[1]
  if (app) return app.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  const tp = t.match(/trustpilot\.com\/review\/([^/]+)/i)?.[1]
  return tp ?? t.split('/')[0]
}
export const reviewHref = (id: string) => `/lead-finder/review/${encodeURIComponent(id)}`

/** Calls one Competitor Leads step (app/api/lead-finder/step) and throws its plain error message. */
export async function step<T>(payload: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/lead-finder/step', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const j = await res.json().catch(() => ({})) as T & { error?: string; upgrade?: boolean }
  if (!res.ok) throw new Error(j.upgrade ? 'Competitor Leads is part of GrowJin Pro.' : j.error ?? 'That step failed. Try again.')
  return j
}

/** Saves a send, skip or edit on a review (app/api/lead-finder/saved). */
export async function saveReview(leadId: string, change: { status?: 'sent' | 'skipped' | null; email?: string; draft?: { subject: string; body: string } }) {
  await fetch('/api/lead-finder/saved', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId, ...change }) }).catch(() => {})
}
