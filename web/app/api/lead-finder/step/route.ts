import { NextRequest, NextResponse } from 'next/server'
import { requirePro } from '@/lib/billing/guard'
import { createClient } from '@/lib/supabase/server'
import type { RawReview } from '@/lib/lead-finder/reviews'
import { brandContextFor, draftEmail, findContact, scoreBatch, startReviews, trustpilotPoll, type Platform } from '@/lib/lead-finder/scan'
import { addUsage, newMeter } from '@/lib/agents/store'
import { leadIdFor } from '@/lib/lead-finder/saved'
import { patchSuggestion, saveSuggestions } from '@/lib/tool-suggestions'

// One step of a Competitor Leads scan per call (lib/lead-finder/scan.ts), so the page can show
// each step's progress as it happens:
//   { op: 'reviews', platform, url }   → { reviews } or { pending: taskId } (Trustpilot via DataForSEO)
//   { op: 'reviews_poll', taskId }     → { reviews } or { pending }
//   { op: 'score', reviews, scanId }   → { scored } for a small batch; good fits get a leadId
//   { op: 'contact', platform, name, leadId }  → { contact }
//   { op: 'draft', platform, name, painPoints, fitReason, leadId } → { draft: { subject, body } }
// With a scanId / leadId, each result is saved as it's made (lib/lead-finder/saved.ts).
export const maxDuration = 60

const GOOD = 7  // same "good fit" line as the page

export async function POST(req: NextRequest) {
  const proBlock = await requirePro()
  if (proBlock) return proBlock
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const brand = await brandContextFor(user.id)
  if (!brand) return NextResponse.json({ error: 'No brand found' }, { status: 404 })

  const body = await req.json().catch(() => ({})) as { op?: string; platform?: Platform; url?: string; taskId?: string; reviews?: RawReview[]; name?: string; painPoints?: string[]; fitReason?: string; scanId?: string; leadId?: string }
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
        const scanId = body.scanId?.slice(0, 64)
        const scored = (await scoreBatch(reviews, brand.context)).map(x => ({ ...x, leadId: scanId ? leadIdFor(scanId, x) : undefined }))
        if (scanId) {
          await saveSuggestions(brand.brandId, 'competitor_leads', scored.filter(x => x.fitScore >= GOOD).map(x => ({
            kind: 'lead', externalId: x.leadId!, groupId: scanId, title: x.company,
            payload: { name: x.company, rating: x.rating, date: x.reviewDate, reviewUrl: x.reviewUrl, text: x.reviewText, fit: x.fitScore, why: x.fitReason, pains: x.painPoints, stage: 'scored' },
          })))
        }
        return NextResponse.json({ scored })
      }
      case 'contact': {
        if (!body.name) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
        const contact = await findContact(platform, body.name.slice(0, 120))
        if (contact.hunterLookups) await addUsage(brand.brandId, { ...newMeter(), hunter: contact.hunterLookups }).catch(() => {})
        if (body.leadId) await patchSuggestion(brand.brandId, 'competitor_leads', body.leadId, { payload: { website: contact.website, email: contact.email, verified: contact.verified, stage: 'contacted' } })
        return NextResponse.json({ contact })
      }
      case 'draft': {
        if (!body.name) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
        const draft = await draftEmail(brand, {
          name: body.name.slice(0, 120), platform,
          painPoints: (body.painPoints ?? []).map(String).slice(0, 4), fitReason: String(body.fitReason ?? '').slice(0, 300),
        })
        if (body.leadId) await patchSuggestion(brand.brandId, 'competitor_leads', body.leadId, { payload: { draft, stage: 'drafted' } })
        return NextResponse.json({ draft })
      }
      default:
        return NextResponse.json({ error: 'Unknown step' }, { status: 400 })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'That step failed.'
    if (body.op === 'draft' && body.leadId) await patchSuggestion(brand.brandId, 'competitor_leads', body.leadId, { payload: { draftError: msg, stage: 'drafted' } })
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
