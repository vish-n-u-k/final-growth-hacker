import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { emailSuppressions, outreachEmails } from '@/lib/db/schema'
import { readLeadData } from '@/lib/agents/store'

/**
 * Which of these addresses GrowJin should not show as new leads: already emailed (sent, scheduled or
 * sending), asked not to be emailed or bounced, or already a lead in the Lead Agent (any status, so
 * people the user skipped or added from an earlier search stay out too). Never throws: if a lookup
 * fails that source is simply not applied.
 */
export async function alreadyContacted(brandId: string, emails: string[]): Promise<Set<string>> {
  const list = [...new Set(emails.map(e => e.trim().toLowerCase()).filter(Boolean))]
  const out = new Set<string>()
  if (!list.length) return out
  const [sent, suppressed, agent] = await Promise.all([
    db.select({ e: outreachEmails.toEmail }).from(outreachEmails)
      .where(and(eq(outreachEmails.brandId, brandId), inArray(outreachEmails.toEmail, list), inArray(outreachEmails.status, ['sent', 'scheduled', 'sending']))).catch(() => []),
    db.select({ e: emailSuppressions.email }).from(emailSuppressions)
      .where(and(eq(emailSuppressions.brandId, brandId), inArray(emailSuppressions.email, list))).catch(() => []),
    readLeadData(brandId).catch(() => null),
  ])
  for (const x of sent) out.add(x.e.toLowerCase())
  for (const x of suppressed) out.add(x.e.toLowerCase())
  for (const l of agent?.leads ?? []) if (l.email) out.add(l.email.toLowerCase())
  return out
}
