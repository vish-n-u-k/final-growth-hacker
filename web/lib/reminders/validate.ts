import { REMINDER_CATEGORIES, type ReminderCategory } from '@/lib/reminders/presets'

export function cleanTitle(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s.slice(0, 200) : null
}

export function cleanCategory(v: unknown): ReminderCategory | null {
  return REMINDER_CATEGORIES.includes(v as ReminderCategory) ? (v as ReminderCategory) : null
}

export function cleanInterval(v: unknown): number | null {
  const n = parseInt(String(v), 10)
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 365) : null
}

// '' / null clears; anything else must be an http(s) URL (a bare domain gets https://)
export function cleanUrl(v: unknown): { ok: true; url: string | null } | { ok: false } {
  if (v === null || v === undefined) return { ok: true, url: null }
  const s = String(v).trim()
  if (!s) return { ok: true, url: null }
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false }
    return { ok: true, url: u.toString().slice(0, 2000) }
  } catch {
    return { ok: false }
  }
}
