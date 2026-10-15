import { runSeoAudit } from '@/lib/audit/seo-audit'
import type { SeoAuditResult, SeoAuditError } from '@/lib/audit/seo-audit'
import { saveScreenshot } from '@/lib/audit/screenshot'

export type { SeoAuditResult, SeoAuditError }

export async function fetchSeoData(requirements: Record<string, string>): Promise<SeoAuditResult | SeoAuditError> {
  const rawUrl = requirements['website_url'] ?? ''
  const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`
  const audit = await runSeoAudit(url)
  // Store the page screenshot (for boxing failing elements) and keep only its size on the result
  if (!('error' in audit) && audit.screenshot && 'data' in audit.screenshot) {
    audit.screenshot = await saveScreenshot(requirements['brand_id'] ?? '', audit.screenshot, 'seo')
  }
  return audit
}
