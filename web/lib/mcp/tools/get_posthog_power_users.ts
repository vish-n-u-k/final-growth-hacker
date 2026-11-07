import { NOT_CONNECTED, posthogConn, phQuery, emailExpr, emailNote } from './posthog-common'

// Power users = active on 5+ distinct days in the last 7 days
export async function getPosthogPowerUsers(brandId: string, limit = 100) {
  const c = await posthogConn(brandId)
  if (!c) return NOT_CONNECTED
  const cappedLimit = Math.min(Math.max(1, limit || 100), 200)

  const r = await phQuery(c,
    `SELECT ${emailExpr(c)} AS email, count(DISTINCT toDate(timestamp)) AS active_days, max(timestamp) AS last_seen
     FROM events
     WHERE timestamp > now() - interval 7 day
     GROUP BY email
     HAVING isNotNull(email) AND active_days >= 5
     ORDER BY active_days DESC, last_seen DESC
     LIMIT ${cappedLimit}`,
  )
  const definition = 'Users active on 5 or more distinct days in the last 7 days'
  if (!r.ok) return { connected: true, definition, error: r.error }

  const users = r.results.map(([email, activeDays, lastSeen]) => ({ email: email as string, activeDaysLast7: Number(activeDays), lastSeen: lastSeen as string }))
  return {
    connected: true,
    definition,
    totalReturned: users.length,
    ...(users.length === 0 ? { note: `No one with an email was active on 5 of the last 7 days. ${emailNote(c)}` } : {}),
    users,
  }
}
