import { NextRequest, NextResponse } from 'next/server'
import { requirePro } from '@/lib/billing/guard'
import { createClient } from '@/lib/supabase/server'
import type { RawReview } from '@/lib/lead-finder/reviews'
import { brandContextFor, draftEmail, findContact, scoreBatch, startReviews, trustpilotPoll, type Platform } from '@/lib/lead-finder/scan'
import { addUsage, newMeter } from '@/lib/agents/store'

// One step of a Competitor Leads scan per call (lib/lead-finder/scan.ts), so the page can show
// each step's progress as it happens:
//   { op: 'reviews', platform, url }   → { reviews } or { pending: taskId } (Trustpilot via DataForSEO)
//   { op: 'reviews_poll', taskId }     → { reviews } or { pending }
//   { op: 'score', reviews }           → { scored } for a small batch
//   { op: 'contact', platform, name }  → { contact }
//   { op: 'draft', platform, name, painPoints, fitReason } → { draft: { subject, body } }
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const proBlock = await requirePro()
  if (proBlock) return proBlock
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const brand = await brandContextFor(user.id)
  if (!brand) return NextResponse.json({ error: 'No brand found' }, { status: 404 })

  const body = await req.json().catch(() => ({})) as { op?: string; platform?: Platform; url?: string; taskId?: string; reviews?: RawReview[]; name?: string; painPoints?: string[]; fitReason?: string }
  const platform: Platform = body.platform === 'shopify' ? 'shopify' : 'trustpilot'

  try {
    switch (body.op) {
      case 'reviews': {
        if (!body.url?.trim()) return NextResponse.json({ error: 'Enter a competitor first.' }, { status: 400 })
        const r = await startReviews(platform, body.url)
        if (r.cost) await addUsage(brand.brandId, { ...newMeter(), dataforseo: r.cost }).catch(() => {})
        return NextResponse.json(r)
      }
      case 'reviews_poll': {
        if (!body.taskId) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
        const reviews = await trustpilotPoll(body.taskId)
        return NextResponse.json(reviews ? { reviews, source: 'Trustpilot' } : { pending: body.taskId, source: 'Trustpilot' })
      }
      case 'score': {
        const reviews = (body.reviews ?? []).slice(0, 10).map(r => ({
          company: String(r.company ?? '').slice(0, 120), reviewText: String(r.reviewText ?? '').slice(0, 400),
          rating: Number(r.rating) || 0, reviewDate: r.reviewDate ?? null, reviewUrl: r.reviewUrl ?? null,
        }))
        return NextResponse.json({ scored: await scoreBatch(reviews, brand.context) })
      }
      case 'contact': {
        if (!body.name) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
        const contact = await findContact(platform, body.name.slice(0, 120))
        if (contact.hunterLookups) await addUsage(brand.brandId, { ...newMeter(), hunter: contact.hunterLookups }).catch(() => {})
        return NextResponse.json({ contact })
      }
      case 'draft': {
        if (!body.name) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
        const draft = await draftEmail(brand, {
          name: body.name.slice(0, 120), platform,
          painPoints: (body.painPoints ?? []).map(String).slice(0, 4), fitReason: String(body.fitReason ?? '').slice(0, 300),
        })
        return NextResponse.json({ draft })
      }
      default:
        return NextResponse.json({ error: 'Unknown step' }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'That step failed.' }, { status: 502 })
  }
}
