import { db } from '@/lib/db'
import { emailSuppressions, outreachProspects } from '@/lib/db/schema'
import { and, eq, sql } from 'drizzle-orm'

// Addresses that opted out or bounced. sendGmailMessage refuses to email them again,
// and their saved prospects are hidden from the outreach list.

/** "Priya <priya@x.io>" → "priya@x.io" */
export function emailAddressOf(to: string): string {
  return (to.match(/<([^>]+)>/)?.[1] ?? to).trim().toLowerCase()
}

export async function isSuppressed(brandId: string, to: string): Promise<{ reason: string } | null> {
  try {
    const [row] = await db
      .select({ reason: emailSuppressions.reason })
      .from(emailSuppressions)
      .where(and(eq(emailSuppressions.brandId, brandId), eq(emailSuppressions.email, emailAddressOf(to))))
      .limit(1)
    return row ?? null
  } catch {
    return null // table missing before the migration — don't block sending
  }
}

export async function suppressEmail(brandId: string, to: string, reason: 'opted_out' | 'bounced', note?: string) {
  const email = emailAddressOf(to)
  if (!email.includes('@')) return
  try {
    await db.insert(emailSuppressions)
      .values({ brandId, email, reason, note: note?.slice(0, 280) ?? null })
      .onConflictDoNothing()
    await db.update(outreachProspects)
      .set({ status: reason })
      .where(and(eq(outreachProspects.brandId, brandId), sql`lower(${outreachProspects.email}) = ${email}`))
  } catch (e) {
    console.error('[suppression] failed:', e instanceof Error ? e.message : e)
  }
}
