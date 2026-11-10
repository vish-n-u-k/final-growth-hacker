import { NOT_CONNECTED, posthogConn, phQuery, num, clampDays } from './posthog-common'

export async function getPosthogAnalytics(brandId: string, days = 30) {
  const c = await posthogConn(brandId)
  if (!c) return NOT_CONNECTED
  const span = clampDays(days, 30, 1, 90)
  // Counted like the app's own user counts (the "Count unique users only" setting)
  const who = c.filter.eventDistinctCol
  const where = c.filter.eventPersonWherePrefix

  const [eventsData, dauData, wauData, mauData] = await Promise.all([
    phQuery(c, `SELECT event, count() AS cnt FROM events WHERE timestamp > now() - interval ${span} day AND event NOT LIKE '$%' GROUP BY event ORDER BY cnt DESC LIMIT 20`),
    phQuery(c, `SELECT count(DISTINCT ${who}) FROM events WHERE ${where}timestamp >= today()`),
    phQuery(c, `SELECT count(DISTINCT ${who}) FROM events WHERE ${where}timestamp > now() - interval 7 day`),
    phQuery(c, `SELECT count(DISTINCT ${who}) FROM events WHERE ${where}timestamp > now() - interval 30 day`),
  ])

  const errors: Record<string, string> = {}
  if (!eventsData.ok) errors.topEvents = eventsData.error
  if (!dauData.ok) errors.dau = dauData.error
  if (!wauData.ok) errors.wau = wauData.error
  if (!mauData.ok) errors.mau = mauData.error

  return {
    connected: true,
    days: span,
    dau: num(dauData),
    wau: num(wauData),
    mau: num(mauData),
    topEvents: eventsData.ok ? eventsData.results.map(([event, count]) => ({ event: event as string, count: Number(count) })) : [],
    ...(Object.keys(errors).length ? { errors } : {}),
  }
}
