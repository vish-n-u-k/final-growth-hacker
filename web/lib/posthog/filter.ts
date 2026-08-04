/**
 * Builds a PostHog filter config from the integration metadata.
 *
 * Default (no filter set): counts every person — no WHERE conditions added.
 * With filter (e.g. $email): counts only persons where that property is set, deduplicating by it.
 *
 * This is the single source of truth applied to every PostHog user-count query in the app.
 */

export interface PostHogPersonFilter {
  /**
   * Full HogQL query to count total persons.
   * No filter:    'SELECT count(*) FROM persons'
   * With filter:  'SELECT count(DISTINCT properties.$email) FROM persons WHERE isNotNull(properties.$email)'
   */
  personsCountQuery: string
  /** For persons table WHERE clause: '' | 'WHERE isNotNull(properties.$email)' */
  personWhereClause: string
  /** For events table distinct col: 'person_id' | 'person.properties.$email' */
  eventDistinctCol: string
  /**
   * For events table WHERE prefix (includes trailing ' AND ').
   * '' when no filter, 'isNotNull(person.properties.$email) AND ' when filter set.
   * Usage: `WHERE ${f.eventPersonWherePrefix}timestamp >= ...`
   */
  eventPersonWherePrefix: string
  /**
   * Appended to events WHERE clause to restrict by person property via subquery.
   * '' when no filter, 'AND person_id IN (SELECT id FROM persons WHERE isNotNull(properties.$email))' when set.
   */
  personSubqueryAndClause: string
  /** Full persons subquery string, used inside IN (...) clauses */
  personSubquery: string
}

export function buildPostHogFilter(meta: Record<string, string>): PostHogPersonFilter {
  const filterEnabled = meta['unique_filter_enabled'] === 'true'
  const prop = meta['unique_filter_property']

  if (filterEnabled && prop && /^[\w$.]+$/.test(prop)) {
    return {
      personsCountQuery: `SELECT count(DISTINCT properties.${prop}) FROM persons WHERE isNotNull(properties.${prop})`,
      personWhereClause: `WHERE isNotNull(properties.${prop})`,
      eventDistinctCol: `person.properties.${prop}`,
      eventPersonWherePrefix: `isNotNull(person.properties.${prop}) AND `,
      personSubqueryAndClause: `AND person_id IN (SELECT id FROM persons WHERE isNotNull(properties.${prop}))`,
      personSubquery: `SELECT id FROM persons WHERE isNotNull(properties.${prop})`,
    }
  }

  return {
    personsCountQuery: 'SELECT count(*) FROM persons',
    personWhereClause: '',
    eventDistinctCol: 'person_id',
    eventPersonWherePrefix: '',
    personSubqueryAndClause: '',
    personSubquery: 'SELECT id FROM persons',
  }
}
