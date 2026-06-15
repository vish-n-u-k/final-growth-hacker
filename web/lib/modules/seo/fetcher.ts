import { runSeoAudit } from '@/lib/audit/seo-audit'
import type { SeoAuditResult, SeoAuditError } from '@/lib/audit/seo-audit'

export type { SeoAuditResult, SeoAuditError }

export async function fetchSeoData(requirements: Record<string, string>): Promise<SeoAuditResult | SeoAuditError> {
  const rawUrl = requirements['website_url'] ?? ''
  const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`
  return runSeoAudit(url)
}
