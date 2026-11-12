// Lead Finder's "Download leads": the leads still to do (not sent, not skipped) as a CSV in the
// outreach lead format (same 26 columns, same order). Only what a lead already has is filled in;
// the rest stays empty, as the format asks. No server code, so the page can import it.

import type { Lead } from '@/lib/agents/store'

export const LEAD_CSV_COLUMNS = [
  'website', 'contact_name', 'contact_email', 'company_name', 'contact_role', 'country', 'segment', 'relationship', 'referred_by',
  'hook_type', 'hook_detail', 'hook_date', 'hook_source_url', 'linkedin_company_url', 'instagram_url', 'posting_activity',
  'last_post_date', 'post_style_now', 'best_assets', 'preferred_content', 'pain_point', 'avoid', 'compliance_notes', 'language',
  'priority', 'notes',
] as const

type Row = Partial<Record<(typeof LEAD_CSV_COLUMNS)[number], string>>

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const POST_SOURCES = new Set(['reddit', 'forum'])
const DONE = new Set(['sent', 'skipped', 'posted', 'replied', 'opted_out', 'bounced'])
const DAY = 86_400_000

/** Leads to put in the file: people to contact (not forum posts) that haven't been sent or skipped. */
export function leadsToExport(leads: Lead[]): Lead[] {
  return leads.filter(l => !POST_SOURCES.has(l.source) && !DONE.has(l.status))
}

const fact = (l: Lead, k: string) => l.facts?.find(f => f.k === k)?.v?.trim() ?? ''
const day = (iso: string | null | undefined) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toISOString().slice(0, 10) : '')

function priority(l: Lead): string {
  const label = (l.fitLabel ?? '').toLowerCase()
  if (label) return label.startsWith('very likely') ? 'A' : label.startsWith('likely') ? 'B' : 'C'
  return l.score >= 9 ? 'A' : l.score >= 7 ? 'B' : 'C'
}

function row(l: Lead, now: number): Row {
  const isPage = l.source === 'profile'
  const site = !isPage && l.website ? l.website.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '') : ''
  const where = fact(l, 'Where')
  const insta = l.social?.accounts.find(a => a.platform === 'instagram')?.url
    || (l.dm && /instagram/i.test(l.dm.platform) ? l.dm.url : '')
    || (isPage && /instagram\.com/i.test(l.url) ? l.url : '')
  const linkedin = l.linkedinUrl && /linkedin\.com\/company\//i.test(l.linkedinUrl) ? l.linkedinUrl : ''

  // Posting: only the values we can tell from what was checked (no accounts, or quiet for 60+ days)
  const last = l.social?.lastPostAt ?? null
  const posting = l.social?.group === 'none' ? 'none'
    : last && now - Date.parse(last) > 60 * DAY ? 'dormant' : ''

  const social = fact(l, 'Social')
  const emailNote = l.email && !l.emailVerified && l.emailVia ? `Email: ${l.emailVia.toLowerCase()}` : ''
  const noEmail = !l.email || !EMAIL.test(l.email)
    ? (l.dm ? `No email; message them on ${l.dm.platform}: ${l.dm.url}` : isPage ? `No email; their page: ${l.url}` : 'No email found')
    : ''
  const personLink = l.linkedinUrl && !linkedin ? `Their LinkedIn: ${l.linkedinUrl}` : ''

  return {
    website: site,
    contact_name: l.name ?? '',
    contact_email: l.email && EMAIL.test(l.email) ? l.email : '',
    company_name: l.company || (isPage ? '' : l.title) || '',
    contact_role: l.role ?? '',
    country: where ? where.split(',').pop()!.trim() : '',
    linkedin_company_url: linkedin,
    instagram_url: insta,
    posting_activity: posting,
    last_post_date: day(last),
    priority: priority(l),
    notes: [l.why, social && `Social: ${social}`, emailNote, noEmail, personLink].filter(Boolean).join(' · '),
  }
}

// Quotes when needed; a leading = + - @ is escaped so spreadsheets don't run it as a formula
function cell(v: string): string {
  let x = v.replace(/\r?\n/g, ' ').trim()
  if (/^[=+\-@]/.test(x)) x = `'${x}`
  return /[",]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x
}

export function leadsCsv(leads: Lead[], now = Date.now()): string {
  const lines = [LEAD_CSV_COLUMNS.join(',')]
  for (const l of leads) {
    const r = row(l, now)
    lines.push(LEAD_CSV_COLUMNS.map(c => cell(r[c] ?? '')).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}
