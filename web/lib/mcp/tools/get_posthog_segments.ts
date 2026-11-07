import { NOT_CONNECTED, posthogConn, phQuery, num } from './posthog-common'

// Every count reads a bounded window: the old "not seen before" subqueries scanned all of history
// and timed out, which came back as null.
const CHURN_LOOKBACK_DAYS = 60

export async function getPosthogSegments(brandId: string) {
  const c = await posthogConn(brandId)
  if (!c) return NOT_CONNECTED
  // Counted like the app's own user counts (the "Count unique users only" setting)
  const f = c.filter
  const personAnd = f.personWhereClause ? ` AND ${f.personWhereClause.replace(/^WHERE\s+/i, '')}` : ''

  const [newThisWeekData, newLastWeekData, churnedData, powerUsersData, totalActiveData] = await Promise.all([
    // New users: people PostHog first created in the last 7 days / 8-14 days ago
    phQuery(c, `SELECT count() FROM persons WHERE created_at > now() - interval 7 day${personAnd}`),
    phQuery(c, `SELECT count() FROM persons WHERE created_at > now() - interval 14 day AND created_at <= now() - interval 7 day${personAnd}`),
    // Churned: active 15-60 days ago, not seen in the last 14 days
    phQuery(c, `SELECT count() FROM (
       SELECT person_id, max(timestamp) AS last_seen FROM events
       WHERE timestamp > now() - interval ${CHURN_LOOKBACK_DAYS} day ${f.personSubqueryAndClause}
       GROUP BY person_id
       HAVING last_seen < now() - interval 14 day
     )`),
    // Power users: active on 5+ distinct days in the last 7 days
    phQuery(c, `SELECT count() FROM (
       SELECT person_id, count(DISTINCT toDate(timestamp)) AS active_days FROM events
       WHERE timestamp > now() - interval 7 day ${f.personSubqueryAndClause}
       GROUP BY person_id
       HAVING active_days >= 5
     )`),
    phQuery(c, `SELECT count(DISTINCT ${f.eventDistinctCol}) FROM events WHERE ${f.eventPersonWherePrefix}timestamp > now() - interval 30 day`),
  ])

  const newThisWeek = num(newThisWeekData)
  const newLastWeek = num(newLastWeekData)
  const churned = num(churnedData)
  const powerUsers = num(powerUsersData)
  const totalActive30d = num(totalActiveData)

  const errors: Record<string, string> = {}
  for (const [k, r] of Object.entries({ newUsersThisWeek: newThisWeekData, newUsersLastWeek: newLastWeekData, churnedUsers: churnedData, powerUsers: powerUsersData, totalActive30d: totalActiveData })) {
    if (!r.ok) errors[k] = r.error
  }

  const weekOverWeekGrowth =
    newThisWeek !== null && newLastWeek !== null && newLastWeek > 0
      ? Math.round(((newThisWeek - newLastWeek) / newLastWeek) * 100)
      : null

  return {
    connected: true,
    segments: {
      newUsersThisWeek: newThisWeek,
      newUsersLastWeek: newLastWeek,
      weekOverWeekGrowthPct: weekOverWeekGrowth,
      churnedUsers: churned,
      powerUsers,
      totalActive30d,
    },
    definitions: {
      newUsers: 'People PostHog first saw (created) in that week',
      churnedUsers: `Active ${CHURN_LOOKBACK_DAYS}-15 days ago, not seen in the last 14 days`,
      powerUsers: 'Active on 5 or more of the last 7 days',
    },
    interpretation: {
      growthTrend: weekOverWeekGrowth === null ? 'unknown'
        : weekOverWeekGrowth > 10 ? 'strong growth'
        : weekOverWeekGrowth > 0 ? 'growing'
        : weekOverWeekGrowth === 0 ? 'flat'
        : 'declining',
      churnRisk: churned !== null && totalActive30d !== null && totalActive30d > 0
        ? Math.round((churned / totalActive30d) * 100)
        : null,
    },
    ...(Object.keys(errors).length ? { errors } : {}),
  }
}
