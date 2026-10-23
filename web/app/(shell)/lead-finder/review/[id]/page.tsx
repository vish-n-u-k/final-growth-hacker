import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { ReachOutPage } from '@/components/lead-finder/ReachOut'
import { loadReview, loadScan, loadScanReviews } from '@/lib/lead-finder/saved'

// Reach out to one reviewer from a Competitor Leads scan, on its own page (components/lead-finder/ReachOut).
// The list opens reviewers in place; this page is for links straight to one of them.
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) redirect('/onboarding')

  const { id } = await params
  const review = await loadReview(brand.id, decodeURIComponent(id))
  if (!review) redirect('/lead-finder')

  const [scan, siblings, [integration]] = await Promise.all([
    loadScan(brand.id, review.scanId),
    loadScanReviews(brand.id, review.scanId),
    db.select({ status: brandIntegrations.status }).from(brandIntegrations)
      .where(and(eq(brandIntegrations.brandId, brand.id), eq(brandIntegrations.provider, 'gmail'))).limit(1),
  ])

  // Next: the next good fit not contacted yet, best fit first, wrapping round to the start
  const order = [...siblings].sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1) || (b.date ?? '').localeCompare(a.date ?? ''))
  const open = (x: (typeof order)[number]) => x.id !== review.id && x.status === 'new' && (x.fit ?? 0) >= 7
  const at = order.findIndex(x => x.id === review.id)
  const next = order.slice(at + 1).find(open) ?? order.slice(0, Math.max(0, at)).find(open) ?? null

  return (
    <ReachOutPage
      review={review}
      scan={scan}
      gmailConnected={integration?.status === 'connected'}
      next={next && { id: next.id, name: next.name }}
    />
  )
}
