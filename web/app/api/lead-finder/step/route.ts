import { NextRequest, NextResponse } from 'next/server'
import { requirePro } from '@/lib/billing/guard'
import { createClient } from '@/lib/supabase/server'
import { brandContextFor, draftEmail, findContact, scoreBatch, startReviews, trustpilotPoll, type Platform } from '@/lib/lead-finder/scan'
import { loadReview, loadScan, saveScanReviews } from '@/lib/lead-finder/saved'
import { patchSuggestion } from '@/lib/tool-suggestions'
import { addUsage, newMeter } from '@/lib/agents/store'

// One step of Competitor Leads per call (lib/lead-finder/scan.ts), each result saved as it's made
// (lib/lead-finder/saved.ts):
//   { op: 'reviews', platform, url, scanId }               → { scan, reviews } or { pending: taskId }
//   { op: 'reviews_poll', taskId, platform, url, scanId }  → { scan, reviews } or { pending }
// Reaching out to one reviewer (leadId = the saved review's id), each → { review }:
//   { op: 'assess', leadId }    how well the brand fits them
//   { op: 'contact', leadId }   their email, if one can be found
//   { op: 'draft', leadId }     a short personal email (again = a fresh one)
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const proBlock = await requirePro()
  if (proBlock) return proBlock
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const brand = await brandContextFor(user.id)
  if (!brand) return NextResponse.json({ error: 'No brand found' }, { status: 404 })

  const body = await req.json().catch(() => ({})) as { op?: string; platform?: Platform; url?: string; taskId?: string; scanId?: string; leadId?: string }
  const platform: Platform = body.platform === 'shopify' ? 'shopify' : 'trustpilot'
  const scanFor = () => ({ id: (body.scanId ?? crypto.randomUUID()).slice(0, 64), platform, competitor: (body.url ?? '').trim().slice(0, 200) })

  try {
    switch (body.op) {
      case 'reviews': {
        if (!body.url?.trim()) return NextResponse.json({ error: 'Enter a competitor first.' }, { status: 400 })
        const r = await startReviews(platform, body.url)
        if (r.cost) await addUsage(brand.brandId, { ...newMeter(), dataforseo: r.cost }).catch(() => {})
        if ('pending' in r) return NextResponse.json({ pending: r.pending })
        return NextResponse.json(await saveScanReviews(brand.brandId, scanFor(), r.reviews))
      }
      case 'reviews_poll': {
        if (!body.taskId) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
        const reviews = await trustpilotPoll(body.taskId)
        if (!reviews) return NextResponse.json({ pending: body.taskId })
        return NextResponse.json(await saveScanReviews(brand.brandId, scanFor(), reviews))
      }
      case 'assess':
      case 'contact':
      case 'draft': {
        const review = body.leadId ? await loadReview(brand.brandId, body.leadId) : null
        if (!review) return NextResponse.json({ error: 'That review is gone. Go back to the list and try again.' }, { status: 404 })
        let change: Record<string, unknown>
        if (body.op === 'assess') {
          const [s] = await scoreBatch([{ company: review.name, reviewText: review.text, rating: review.rating, reviewDate: review.date, reviewUrl: review.reviewUrl }], brand.context)
          if (!s) throw new Error('Couldn’t check this review. Try again.')
          change = { fit: s.fitScore, why: s.fitReason, pains: s.painPoints }
        } else if (body.op === 'contact') {
          const scan = await loadScan(brand.brandId, review.scanId)
          const c = await findContact(scan?.platform ?? 'trustpilot', review.name)
          if (c.hunterLookups) await addUsage(brand.brandId, { ...newMeter(), hunter: c.hunterLookups }).catch(() => {})
          change = { website: c.website, email: c.email, verified: c.verified, contactChecked: true }
        } else {
          const scan = await loadScan(brand.brandId, review.scanId)
          change = { draft: await draftEmail(brand, { name: review.name, platform: scan?.platform ?? 'trustpilot', painPoints: review.pains ?? [], fitReason: review.why ?? '' }) }
        }
        await patchSuggestion(brand.brandId, 'competitor_leads', review.id, { payload: change })
        return NextResponse.json({ review: { ...review, ...change, contactChecked: review.contactChecked || body.op === 'contact' } })
      }
      default:
        return NextResponse.json({ error: 'Unknown step' }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'That step failed.' }, { status: 502 })
  }
}
