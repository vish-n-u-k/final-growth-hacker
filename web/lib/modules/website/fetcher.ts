import { runAudit } from '@/lib/audit/audit'
import type { AuditResult, AuditError } from '@/lib/audit/audit'

export type { AuditResult, AuditError }

export async function fetchWebsiteData(
  requirements: Record<string, string>,
): Promise<AuditResult | AuditError> {
  const rawUrl = requirements['website_url'] ?? ''
  const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`
  return runAudit(url, requirements['psi_api_key'] || undefined)
}
