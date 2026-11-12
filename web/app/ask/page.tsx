import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { hasEarlyAccess } from '@/lib/early-access'
import { askIsHome } from '@/lib/features'
import { savedCards, STALE_MS } from '@/lib/ask/cards'
import { pinnedAnswers } from '@/lib/ask/pins'
import { CARD_IDS, type CardId } from '@/lib/ask/types'
import AskPage from '@/components/ask/AskPage'
import { isAdminEmail } from '@/lib/admin'
import { getAnalysisMode } from '@/lib/modules/analysis-mode'

export const dynamic = 'force-dynamic'

const IDS: readonly string[] = CARD_IDS

// Ask (md_files/ASK_PLAN.md): the ready answers, questions of your own and the work itself. Any signed-in user.
export default async function Ask({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  // Any signed-in user can open Ask (from the sidebar or by typing /ask)
  const home = askIsHome(await hasEarlyAccess(user.email))
  const [brand] = await db.select({ id: brands.id, name: brands.name, websiteUrl: brands.websiteUrl })
    .from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) redirect('/onboarding')

  const admin = isAdminEmail(user.email)
  const [cards, pins, mode] = await Promise.all([savedCards(brand.id), pinnedAnswers(brand.id), admin ? getAnalysisMode() : Promise.resolve('direct' as const)])
  const saved = cards ? { ...cards, pins } : null
  // Missing or older than a day (cards or any pin): the page works them out again on arrival
  const fresh = !!saved?.at && Date.now() - Date.parse(saved.at) < STALE_MS && pins.every(p => Date.now() - Date.parse(p.at) < STALE_MS)
  const { q } = await searchParams
  const site = (() => { try { return new URL(brand.websiteUrl.startsWith('http') ? brand.websiteUrl : `https://${brand.websiteUrl}`).hostname.replace(/^www\./, '') } catch { return brand.websiteUrl } })()

  return (
    <AskPage
      brandName={brand.name}
      site={site}
      initial={saved}
      stale={!fresh}
      initialOpen={IDS.includes(q as CardId) ? (q as CardId) : null}
      backHref={home ? null : '/dashboard'}
      admin={admin}
      mode={mode}
    />
  )
}
