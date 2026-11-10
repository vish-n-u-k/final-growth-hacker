import { NOT_CONNECTED, posthogConn, phQuery, num } from './posthog-common'

// Every count reads a bounded window: the old "not seen before" subqueries scanned all of history
// and timed out, which came back as null.
const CHURN_LOOKBACK_DAYS = 60
// "New" = first seen in that week, looking back this far (one grouped scan instead of all history)
const FIRST_SEEN_LOOKBACK_DAYS = 180

export async function getPosthogSegments(brandId: string) {
  const c = await posthogConn(brandId)
  if (!c) return NOT_CONNECTED
  // Every segment counts the same people as the app's own user counts (the "Count unique users
  // only" setting): unique emails when it's on, PostHog persons when it's off. Mixing the two
  // made churn larger than the active base (e.g. 134 churned of 27 active).
  const who = c.filter.eventDistinctCol
  const where = c.filter.eventPersonWherePrefix
  const perPerson = (days: number, select: string, having: string) =>
    `SELECT count() FROM (
       SELECT ${who} AS who, ${select} FROM events
       WHERE ${where}timestamp > now() - interval ${days} day
       GROUP BY who
       HAVING ${having}
     )`

  const [newThisWeekData, newLastWeekData, churnedData, churnBaseData, powerUsersData, totalActiveData] = await Promise.all([
    phQuery(c, perPerson(FIRST_SEEN_LOOKBACK_DAYS, 'min(timestamp) AS first_seen', 'first_seen > now() - interval 7 day')),
    phQuery(c, perPerson(FIRST_SEEN_LOOKBACK_DAYS, 'min(timestamp) AS first_seen', 'first_seen > now() - interval 14 day AND first_seen <= now() - interval 7 day')),
    // Churned: active 15-60 days ago, not seen in the last 14 days
    phQuery(c, perPerson(CHURN_LOOKBACK_DAYS, 'max(timestamp) AS last_seen, min(timestamp) AS first_seen', 'last_seen < now() - interval 14 day')),
    // Everyone active 15-60 days ago (churned or not): what churn is a share of
    phQuery(c, perPerson(CHURN_LOOKBACK_DAYS, 'min(timestamp) AS first_seen', 'first_seen < now() - interval 14 day')),
    phQuery(c, perPerson(7, 'count(DISTINCT toDate(timestamp)) AS active_days', 'active_days >= 5')),
    phQuery(c, `SELECT count(DISTINCT ${who}) FROM events WHERE ${where}timestamp > now() - interval 30 day`),
  ])

  const newThisWeek = num(newThisWeekData)
  const newLastWeek = num(newLastWeekData)
  const churned = num(churnedData)
  const churnBase = num(churnBaseData)
  const powerUsers = num(powerUsersData)
  const totalActive30d = num(totalActiveData)

  const errors: Record<string, string> = {}
  for (const [k, r] of Object.entries({ newUsersThisWeek: newThisWeekData, newUsersLastWeek: newLastWeekData, churnedUsers: churnedData, churnBase: churnBaseData, powerUsers: powerUsersData, totalActive30d: totalActiveData })) {
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
      counted: c.filter.eventDistinctCol === 'person_id' ? 'PostHog persons (anonymous visitors included)' : `unique ${c.filter.eventDistinctCol.replace('person.properties.', '')} values`,
      newUsers: `First seen in that week (looking back ${FIRST_SEEN_LOOKBACK_DAYS} days)`,
      churnedUsers: `Active ${CHURN_LOOKBACK_DAYS}-15 days ago, not seen in the last 14 days`,
      churnRiskPct: `Churned as a share of everyone active ${CHURN_LOOKBACK_DAYS}-15 days ago`,
      powerUsers: 'Active on 5 or more of the last 7 days',
    },
    interpretation: {
      growthTrend: weekOverWeekGrowth === null ? 'unknown'
        : weekOverWeekGrowth > 10 ? 'strong growth'
        : weekOverWeekGrowth > 0 ? 'growing'
        : weekOverWeekGrowth === 0 ? 'flat'
        : 'declining',
      churnRisk: churned !== null && churnBase !== null && churnBase > 0
        ? Math.round((churned / churnBase) * 100)
        : null,
    },
    ...(Object.keys(errors).length ? { errors } : {}),
  }
}
