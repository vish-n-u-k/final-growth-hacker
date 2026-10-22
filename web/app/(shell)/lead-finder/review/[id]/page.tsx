import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import ReachOut from '@/components/lead-finder/ReachOut'
import { loadReview, loadScan, loadScanReviews } from '@/lib/lead-finder/saved'

// Reach out to one reviewer from a Competitor Leads scan (components/lead-finder/ReachOut).
export default async function ReachOutPage({ params }: { params: Promise<{ id: string }> }) {
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

  // Next: the next unhappy reviewer not contacted yet, newest first, wrapping round to the start
  const order = [...siblings].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  const open = (x: (typeof order)[number]) => x.id !== review.id && x.status === 'new' && x.rating <= 3
  const at = order.findIndex(x => x.id === review.id)
  const next = order.slice(at + 1).find(open) ?? order.slice(0, Math.max(0, at)).find(open) ?? null

  return (
    <ReachOut
      review={review}
      scan={scan}
      brandName={brand.name}
      gmailConnected={integration?.status === 'connected'}
      next={next && { id: next.id, name: next.name }}
    />
  )
}
