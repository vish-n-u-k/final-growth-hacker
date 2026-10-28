import { NextResponse } from 'next/server'
import { requirePro } from '@/lib/billing/guard'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { checkDomains } from '@/lib/leads/social-check'
import { readLinkedIn, saveLinkedIn } from '@/lib/leads/linkedin-saved'

export const maxDuration = 180

const MAX_LEADS = 30
const FRESH_MS = 7 * 86_400_000   // a check younger than this is kept

// Social check for the leads in the saved LinkedIn search. The domains come from the saved leads, never
// from the request, so this cannot be pointed at an address of the caller's choice.
export async function POST() {
  const proBlock = await requirePro()
  if (proBlock) return proBlock
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  const saved = await readLinkedIn(brand.id)
  if (!saved?.leads.length) return NextResponse.json({ error: 'Search for people first, then check them.' }, { status: 400 })

  const now = Date.now()
  const todo = saved.leads.filter(l => l.domain && (!l.social || now - Date.parse(l.social.checkedAt) > FRESH_MS)).slice(0, MAX_LEADS)
  if (todo.length === 0) return NextResponse.json({ leads: saved.leads, checked: 0 })

  let found
  try {
    found = await checkDomains(todo.map(l => l.domain!))
  } catch (e) {
    console.error('[social-check] failed:', e)
    return NextResponse.json({ error: 'The social check did not work just now. Try again in a minute.' }, { status: 502 })
  }

  const leads = saved.leads.map(l => (l.domain && found.has(l.domain.toLowerCase()) ? { ...l, social: found.get(l.domain.toLowerCase()) } : l))
  await saveLinkedIn(brand.id, { leads }).catch(e => console.error('[social-check] could not save:', e))
  return NextResponse.json({ leads, checked: todo.length })
}
