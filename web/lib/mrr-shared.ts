// Projected MRR: what the brand's users are worth per month at the price they charge.
// Shared by the server helpers (lib/mrr.ts) and the client card (components/ProjectedMrr.tsx).

export interface MrrSettings {
  price: number      // monthly price per paying customer
  currency: string   // ISO code, one of MRR_CURRENCIES
  payingPct: number  // share of users who pay, 1–100
}

export const MRR_CURRENCIES = ['USD', 'INR', 'EUR', 'GBP', 'CAD', 'AUD'] as const

export function parseMrrSettings(raw: unknown): MrrSettings | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const price = Number(r.price)
  const payingPct = r.payingPct == null ? 100 : Number(r.payingPct)
  const currency = typeof r.currency === 'string' && (MRR_CURRENCIES as readonly string[]).includes(r.currency) ? r.currency : 'USD'
  if (!Number.isFinite(price) || price <= 0 || price > 1_000_000) return null
  if (!Number.isFinite(payingPct) || payingPct < 1 || payingPct > 100) return null
  return { price, currency, payingPct }
}

export function projectMrr(users: number, s: MrrSettings): number {
  return Math.round(users * (s.payingPct / 100)) * s.price
}

export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: amount >= 100_000 ? 'compact' : 'standard',
    maximumFractionDigits: amount >= 100_000 ? 1 : amount % 1 ? 2 : 0,
  }).format(amount)
}
