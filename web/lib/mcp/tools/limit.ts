// The `limit` every data passthrough tool takes: default 10, hard max 50 (larger asks are cut to 50).
export const DEFAULT_LIMIT = 10
export const MAX_LIMIT = 50

export function capLimit(v: unknown): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.floor(n))
}
