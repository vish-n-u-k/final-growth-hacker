// Client-safe: how reminders created from audit suggestions (lib/reminders/audit-jobs.ts) are recognised.
// Their category is `audit:<job key>`.
export const AUDIT_PREFIX = 'audit:'

const SOURCE: Record<string, string> = {
  'blog-post': 'Content',
  'refresh-page': 'Content',
  'content-rerun': 'Content',
  'search-console': 'Search Console',
  'quick-win': 'Search Console',
  'seo-rerun': 'SEO',
  speed: 'SEO',
  'ai-answers': 'GEO',
}

/** The badge for an audit reminder ("SEO", "Content"…), or null for other reminders. */
export function auditJobSource(category: string): string | null {
  return category.startsWith(AUDIT_PREFIX) ? SOURCE[category.slice(AUDIT_PREFIX.length)] ?? null : null
}
