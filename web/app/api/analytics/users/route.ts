import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

interface UserRow {
  name: string | null
  email: string
  userId: string
  timestamp: string
  source: string | null
  location: string | null
  plan: string | null
  sessions?: number
  referringDomain: string | null
  landingUrl: string | null
  utmSource: string | null
  topEvents?: string[]
  device: string | null
}

async function hogqlRows(host: string, projectId: string, apiKey: string, query: string): Promise<unknown[][] | null> {
  try {
    const res = await fetch(`${host}/api/projects/${projectId}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    const data = await res.json() as { results?: unknown[][] }
    return data.results ?? null
  } catch { return null }
}

async function fetchTopEventsForPersons(
  host: string,
  projectId: string,
  apiKey: string,
  personIds: string[],
  interval: string,
): Promise<Map<string, string[]>> {
  if (!personIds.length) return new Map()
  // Deduplicate and cap to avoid oversized IN clauses
  const uniqueIds = [...new Set(personIds)].slice(0, 100)
  const idList = uniqueIds.map(id => `'${id.replace(/'/g, "\\'")}'`).join(', ')
  try {
    const res = await fetch(`${host}/api/projects/${projectId}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query: `
        SELECT person_id, groupUniqArray(5)(event)
        FROM events
        WHERE person_id IN (${idList})
          AND timestamp >= now() - interval ${interval}
        GROUP BY person_id
      ` } }),
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return new Map()
    const data = await res.json() as { results?: unknown[][] }
    const map = new Map<string, string[]>()
    for (const r of data.results ?? []) {
      const pid = String(r[0] ?? '')
      map.set(pid, Array.isArray(r[1]) ? (r[1] as unknown[]).map(String) : [])
    }
    return map
  } catch {
    return new Map()
  }
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const brandId = request.nextUrl.searchParams.get('brandId')
  const type = request.nextUrl.searchParams.get('type') as 'signups' | 'signins' | 'dau' | 'deleted' | 'custom' | null
  const eventName = request.nextUrl.searchParams.get('eventName')
  const range = request.nextUrl.searchParams.get('range') ?? '24h'

  if (!brandId || !type) return NextResponse.json({ error: 'brandId and type required' }, { status: 400 })

  const [brand] = await db
    .select()
    .from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.userId, user.id)))
    .limit(1)
  if (!brand) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [phInt] = await db
    .select()
    .from(brandIntegrations)
    .where(and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.provider, 'posthog'), eq(brandIntegrations.status, 'connected')))
    .limit(1)

  if (!phInt?.apiKey) return NextResponse.json({ users: [], total: 0 })

  const meta = (phInt.metadata as Record<string, string> | null) ?? {}
  const projectId = meta['project_id']
  const host = (meta['posthog_host'] ?? 'https://us.posthog.com').replace(/\/$/, '')

  if (!projectId) return NextResponse.json({ users: [], total: 0 })

  const intervalMap: Record<string, string> = { '24h': '1 day', '7d': '7 day', '30d': '30 day' }
  const interval = intervalMap[range] ?? '1 day'

  const colName     = request.nextUrl.searchParams.get('colName')     ?? meta['display_name_field'] ?? '$email'
  const colEmail    = request.nextUrl.searchParams.get('colEmail')    ?? '$email'
  const colSource   = request.nextUrl.searchParams.get('colSource')   ?? '$channel_type'
  const colLocation = request.nextUrl.searchParams.get('colLocation') ?? '$geoip_country_name'
  const colPlan     = request.nextUrl.searchParams.get('colPlan')     ?? 'plan'

  // Helpers: build HogQL expressions per column
  const personProp  = (f: string) => f === 'distinct_id' ? 'distinct_id' : `person.properties.${f}`
  const evtOrPerson = (f: string) => `coalesce(properties.${f}, person.properties.${f})`
  const pProp       = (f: string) => f === 'distinct_id' ? 'toString(id)' : `properties.${f}`

  const eventsNameExpr    = colName === 'distinct_id' ? 'distinct_id' : `coalesce(${personProp(colName)}, distinct_id)`
  const eventsEmailExpr   = personProp(colEmail)
  const eventsSourceExpr  = evtOrPerson(colSource)
  const eventsLocExpr     = evtOrPerson(colLocation)
  const eventsPlanExpr    = personProp(colPlan)

  const personsNameExpr   = pProp(colName)
  const personsEmailExpr  = pProp(colEmail)
  const personsPlanExpr   = pProp(colPlan)

  let users: UserRow[] = []

  if (type === 'signups') {
    const rows = await hogqlRows(host, projectId, phInt.apiKey, `
      SELECT
        ${personsNameExpr},
        ${personsEmailExpr},
        id,
        toString(created_at),
        NULL,
        NULL,
        ${personsPlanExpr},
        properties.$initial_referring_domain,
        properties.$initial_current_url,
        properties.$initial_utm_source,
        properties.$initial_device_type
      FROM persons
      WHERE is_identified = 1
        AND created_at >= now() - interval ${interval}
      ORDER BY created_at DESC
      LIMIT 100
    `)
    const mapped = (rows ?? []).map(r => ({
      name: r[0] ? String(r[0]) : null,
      email: String(r[1] ?? ''),
      userId: String(r[2] ?? ''),
      timestamp: String(r[3] ?? ''),
      source: null,
      location: null,
      plan: r[6] ? String(r[6]) : 'Free',
      referringDomain: r[7] ? String(r[7]) : null,
      landingUrl: r[8] ? String(r[8]) : null,
      utmSource: r[9] ? String(r[9]) : null,
      device: r[10] ? String(r[10]) : null,
    }))
    const topEventsMap = await fetchTopEventsForPersons(host, projectId, phInt.apiKey, mapped.map(u => u.userId), interval)
    users = mapped.map(u => ({ ...u, topEvents: topEventsMap.get(u.userId) ?? [] }))
  } else if (type === 'signins') {
    const rows = await hogqlRows(host, projectId, phInt.apiKey, `
      SELECT
        ${eventsNameExpr},
        ${eventsEmailExpr},
        person_id,
        toString(timestamp),
        ${eventsSourceExpr},
        ${eventsLocExpr},
        ${eventsPlanExpr},
        person.properties.$initial_referring_domain,
        person.properties.$initial_current_url,
        person.properties.$initial_utm_source,
        properties.$device_type
      FROM events
      WHERE event = '$identify'
        AND person_id IN (SELECT id FROM persons WHERE is_identified = 1)
        AND timestamp >= now() - interval ${interval}
      ORDER BY timestamp DESC
      LIMIT 100
    `)
    const mapped = (rows ?? []).map(r => ({
      name: r[0] ? String(r[0]) : null,
      email: String(r[1] ?? ''),
      userId: String(r[2] ?? ''),
      timestamp: String(r[3] ?? ''),
      source: r[4] ? String(r[4]) : null,
      location: r[5] ? String(r[5]) : null,
      plan: r[6] ? String(r[6]) : 'Free',
      referringDomain: r[7] ? String(r[7]) : null,
      landingUrl: r[8] ? String(r[8]) : null,
      utmSource: r[9] ? String(r[9]) : null,
      device: r[10] ? String(r[10]) : null,
    }))
    const topEventsMap = await fetchTopEventsForPersons(host, projectId, phInt.apiKey, mapped.map(u => u.userId), interval)
    users = mapped.map(u => ({ ...u, topEvents: topEventsMap.get(u.userId) ?? [] }))
  } else if (type === 'dau') {
    const rows = await hogqlRows(host, projectId, phInt.apiKey, `
      SELECT
        any(${eventsNameExpr}),
        any(${eventsEmailExpr}),
        person_id,
        toString(max(timestamp)),
        any(${eventsSourceExpr}),
        any(${eventsLocExpr}),
        any(${eventsPlanExpr}),
        count() as sessions,
        any(person.properties.$initial_referring_domain),
        any(person.properties.$initial_current_url),
        any(person.properties.$initial_utm_source),
        groupUniqArray(5)(event) as top_events,
        any(properties.$device_type)
      FROM events
      WHERE person_id IN (SELECT id FROM persons WHERE is_identified = 1)
        AND timestamp >= now() - interval ${interval}
      GROUP BY person_id
      ORDER BY max(timestamp) DESC
      LIMIT 100
    `)
    users = (rows ?? []).map(r => ({
      name: r[0] ? String(r[0]) : null,
      email: String(r[1] ?? ''),
      userId: String(r[2] ?? ''),
      timestamp: String(r[3] ?? ''),
      source: r[4] ? String(r[4]) : null,
      location: r[5] ? String(r[5]) : null,
      plan: r[6] ? String(r[6]) : 'Free',
      sessions: Number(r[7] ?? 0),
      referringDomain: r[8] ? String(r[8]) : null,
      landingUrl: r[9] ? String(r[9]) : null,
      utmSource: r[10] ? String(r[10]) : null,
      topEvents: Array.isArray(r[11]) ? (r[11] as unknown[]).map(String) : [],
      device: r[12] ? String(r[12]) : null,
    }))
  } else if (type === 'deleted') {
    const rows = await hogqlRows(host, projectId, phInt.apiKey, `
      SELECT
        ${eventsNameExpr},
        ${eventsEmailExpr},
        person_id,
        toString(timestamp),
        ${eventsSourceExpr},
        ${eventsLocExpr},
        ${eventsPlanExpr},
        person.properties.$initial_referring_domain,
        person.properties.$initial_current_url,
        person.properties.$initial_utm_source,
        properties.$device_type
      FROM events
      WHERE event IN ('account_deleted', 'user_deleted', 'delete_account')
        AND person_id IN (SELECT id FROM persons WHERE is_identified = 1)
        AND timestamp >= now() - interval ${interval}
      ORDER BY timestamp DESC
      LIMIT 100
    `)
    const mapped = (rows ?? []).map(r => ({
      name: r[0] ? String(r[0]) : null,
      email: String(r[1] ?? ''),
      userId: String(r[2] ?? ''),
      timestamp: String(r[3] ?? ''),
      source: r[4] ? String(r[4]) : null,
      location: r[5] ? String(r[5]) : null,
      plan: r[6] ? String(r[6]) : 'Free',
      referringDomain: r[7] ? String(r[7]) : null,
      landingUrl: r[8] ? String(r[8]) : null,
      utmSource: r[9] ? String(r[9]) : null,
      device: r[10] ? String(r[10]) : null,
    }))
    const topEventsMap = await fetchTopEventsForPersons(host, projectId, phInt.apiKey, mapped.map(u => u.userId), interval)
    users = mapped.map(u => ({ ...u, topEvents: topEventsMap.get(u.userId) ?? [] }))
  }

  if (type === 'custom' && eventName) {
    const rows = await hogqlRows(host, projectId, phInt.apiKey, `
      SELECT
        any(${eventsNameExpr}),
        any(${eventsEmailExpr}),
        person_id,
        toString(max(timestamp)),
        any(${eventsSourceExpr}),
        any(${eventsLocExpr}),
        any(${eventsPlanExpr}),
        any(person.properties.$initial_referring_domain),
        any(person.properties.$initial_current_url),
        any(person.properties.$initial_utm_source),
        groupUniqArray(5)(event) as top_events,
        any(properties.$device_type)
      FROM events
      WHERE event = '${eventName.replace(/'/g, "\\'")}'
        AND person_id IN (SELECT id FROM persons WHERE is_identified = 1)
        AND timestamp >= now() - interval ${interval}
      GROUP BY person_id
      ORDER BY max(timestamp) DESC
      LIMIT 100
    `)
    users = (rows ?? []).map(r => ({
      name: r[0] ? String(r[0]) : null,
      email: String(r[1] ?? ''),
      userId: String(r[2] ?? ''),
      timestamp: String(r[3] ?? ''),
      source: r[4] ? String(r[4]) : null,
      location: r[5] ? String(r[5]) : null,
      plan: r[6] ? String(r[6]) : 'Free',
      referringDomain: r[7] ? String(r[7]) : null,
      landingUrl: r[8] ? String(r[8]) : null,
      utmSource: r[9] ? String(r[9]) : null,
      topEvents: Array.isArray(r[10]) ? (r[10] as unknown[]).map(String) : [],
      device: r[11] ? String(r[11]) : null,
    }))
  }

  return NextResponse.json({ users, total: users.length })
}
