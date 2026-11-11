import { NOT_CONNECTED, posthogConn, phQuery, emailExpr, emailNote, clampDays } from './posthog-common'

// People active in the last N days, by email, newest first
export async function getPosthogUsers(brandId: string, days = 1, limit = 100) {
  const c = await posthogConn(brandId)
  if (!c) return NOT_CONNECTED
  const span = clampDays(days, 1)
  const cappedLimit = Math.min(Math.max(1, limit || 100), 200)

  const r = await phQuery(c,
    `SELECT ${emailExpr(c)} AS email, max(timestamp) AS last_seen
     FROM events
     WHERE timestamp >= now() - interval ${span} day
     GROUP BY email
     HAVING isNotNull(email)
     ORDER BY last_seen DESC
     LIMIT ${cappedLimit}`,
  )
  if (!r.ok) return { connected: true, days: span, error: r.error }

  const users = r.results.map(([email, lastSeen]) => ({ email: email as string, lastSeen: lastSeen as string }))
  return {
    connected: true,
    days: span,
    totalReturned: users.length,
    note: users.length === cappedLimit ? `Capped at ${cappedLimit}. Use a smaller day range for a tighter list.` : users.length === 0 ? `No one with an email was active in the last ${span} days. ${emailNote(c)}` : null,
    users,
  }
}
