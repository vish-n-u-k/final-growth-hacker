import { NOT_CONNECTED, posthogConn, phQuery, emailExpr, emailNote, clampDays } from './posthog-common'

// How far back a churned user may have last been seen. Reading all of history timed out.
const LOOKBACK_DAYS = 90

// Churned users = seen in the last 90 days, but not in the last inactiveDays
export async function getPosthogChurnedUsers(brandId: string, inactiveDays = 14, limit = 100) {
  const c = await posthogConn(brandId)
  if (!c) return NOT_CONNECTED
  const inactive = clampDays(inactiveDays, 14, 1, LOOKBACK_DAYS - 1)
  const cappedLimit = Math.min(Math.max(1, limit || 100), 200)

  const r = await phQuery(c,
    `SELECT ${emailExpr(c)} AS email, max(timestamp) AS last_seen
     FROM events
     WHERE timestamp > now() - interval ${LOOKBACK_DAYS} day
     GROUP BY email
     HAVING isNotNull(email) AND last_seen < now() - interval ${inactive} day
     ORDER BY last_seen DESC
     LIMIT ${cappedLimit}`,
  )
  const definition = `Users last seen between ${LOOKBACK_DAYS} and ${inactive} days ago (not since)`
  if (!r.ok) return { connected: true, definition, inactiveDays: inactive, error: r.error }

  const users = r.results.map(([email, lastSeen]) => ({ email: email as string, lastSeen: lastSeen as string }))
  return {
    connected: true,
    definition,
    inactiveDays: inactive,
    totalReturned: users.length,
    ...(users.length === 0 ? { note: `No one with an email fits. ${emailNote(c)}` } : {}),
    users,
  }
}
