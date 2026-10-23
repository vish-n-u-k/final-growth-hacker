import { cache } from 'react'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { adminSettings } from '@/lib/db/schema'

// Early-access users: every Growth Path module is open (no "previous module must reach 80%" lock)
// and the parked tools (lib/features.ts) are live. The list is edited on the admin page (Early access tab)
// and kept in admin_settings as one lowercase email per line.
const KEY = 'early_access_emails'

export function parseEmails(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(s => s.includes('@')))]
}

export async function getEarlyAccessEmails(): Promise<string[]> {
  const [row] = await db.select({ value: adminSettings.value }).from(adminSettings).where(eq(adminSettings.key, KEY))
  return parseEmails(row?.value ?? '')
}

export async function setEarlyAccessEmails(emails: string[]): Promise<string[]> {
  const list = parseEmails(emails.join('\n'))
  const value = list.join('\n')
  await db
    .insert(adminSettings)
    .values({ key: KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: adminSettings.key, set: { value, updatedAt: new Date() } })
  return list
}

// Read once per request (the shell layout and the page both ask).
const earlyAccessList = cache(async (): Promise<string[]> => {
  try {
    return await getEarlyAccessEmails()
  } catch (err) {
    console.error('[early-access] list read failed', err)
    return []
  }
})

export async function hasEarlyAccess(email: string | null | undefined): Promise<boolean> {
  // Local `next dev`: everything is open, so the parked tools (AI Agents, Email Outreach,
  // Competitor Leads) can be tried without editing the early-access list. Never on a deployment.
  if (process.env.NODE_ENV === 'development') return true
  if (!email) return false
  return (await earlyAccessList()).includes(email.toLowerCase())
}
