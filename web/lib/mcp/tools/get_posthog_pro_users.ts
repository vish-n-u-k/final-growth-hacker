import { NOT_CONNECTED, posthogConn, phQuery, emailExpr, emailNote } from './posthog-common'

// Active in the last 90 days. Reading all of history timed out.
const LOOKBACK_DAYS = 90

// Pro/paid users = users whose PostHog person property matches a given plan value.
// Defaults to plan="pro" but caller can pass any property name + value.
export async function getPosthogProUsers(
  brandId: string,
  planProperty = 'plan',
  planValue = 'pro',
  limit = 100,
) {
  const c = await posthogConn(brandId)
  if (!c) return NOT_CONNECTED
  const cappedLimit = Math.min(Math.max(1, limit || 100), 200)

  // Sanitise property name and value: only letters, digits, $, underscore and hyphen
  const safeProp = planProperty.replace(/[^a-zA-Z0-9_$]/g, '') || 'plan'
  const safeVal = planValue.replace(/[^a-zA-Z0-9_\-]/g, '')

  const r = await phQuery(c,
    `SELECT ${emailExpr(c)} AS email, any(toString(person.properties.${safeProp})) AS plan, max(timestamp) AS last_seen
     FROM events
     WHERE timestamp > now() - interval ${LOOKBACK_DAYS} day
       AND lower(toString(person.properties.${safeProp})) = lower('${safeVal}')
     GROUP BY email
     HAVING isNotNull(email)
     ORDER BY last_seen DESC
     LIMIT ${cappedLimit}`,
  )
  const definition = `Users active in the last ${LOOKBACK_DAYS} days whose PostHog person property "${safeProp}" = "${safeVal}" (any letter case)`
  if (!r.ok) return { connected: true, definition, planProperty: safeProp, planValue: safeVal, error: r.error }

  const users = r.results.map(([email, plan, lastSeen]) => ({ email: email as string, plan: plan as string, lastSeen: lastSeen as string }))
  return {
    connected: true,
    definition,
    planProperty: safeProp,
    planValue: safeVal,
    totalReturned: users.length,
    ...(users.length === 0 ? { note: `No one matched. Check the property name and value (e.g. plan_property "plan", plan_value "pro"). ${emailNote(c)}` } : {}),
    users,
  }
}
