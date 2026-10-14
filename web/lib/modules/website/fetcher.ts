import { runAudit } from '@/lib/audit/audit'
import type { AuditResult, AuditError } from '@/lib/audit/audit'
import { saveScreenshot } from '@/lib/audit/screenshot'

export type { AuditResult, AuditError }

export async function fetchWebsiteData(
  requirements: Record<string, string>,
): Promise<AuditResult | AuditError> {
  const rawUrl = requirements['website_url'] ?? ''
  const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`
  const audit = await runAudit(url)
  // Store the page screenshot (for showing failing elements) and keep only its size on the result
  if (!('error' in audit) && audit.screenshot && 'data' in audit.screenshot) {
    audit.screenshot = await saveScreenshot(requirements['brand_id'] ?? '', audit.screenshot)
  }
  return audit
}
