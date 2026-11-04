// Foundation's "Google Business Profile" check, for brands customers visit or that serve an area
// (website type local / agency, see the item's relevantFor). Looks the business up in Google's
// business listings (DataForSEO, by website, then by name) and reads the site for a link to its
// profile or an embedded Google map. No AI.

import type { ModuleAnalysisResult } from '../types'
import type { FoundationFetchResult } from './fetcher'
import { businessListings, dataForSeoConfigured, type BusinessListing } from '@/lib/agents/dataforseo'
import { addUsage, type UsageMeter } from '@/lib/agents/store'

export const GBP_SLUG = 'google-business-profile'

export interface FoundationBrand { id?: string; name?: string; websiteType?: string | null }

const hostOf = (url: string) => {
  try { return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '').toLowerCase() } catch { return '' }
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** The listing that is this business: same website first, else exactly the same name. */
function pick(listings: BusinessListing[], host: string, name: string): BusinessListing | null {
  const byDomain = listings.find(l => l.domain && hostOf(l.domain) === host)
  if (byDomain) return byDomain
  const n = norm(name)
  return n.length > 2 ? listings.find(l => norm(l.title) === n) ?? null : null
}

function result(verified: boolean, detail: string, highlight: string, narrative: string, action: string): ModuleAnalysisResult {
  return { slug: GBP_SLUG, verified, detail, highlight, narrative, action }
}

export async function checkGoogleProfile(data: FoundationFetchResult, brand: FoundationBrand): Promise<ModuleAnalysisResult> {
  const e = data.extracted
  const host = hostOf(data.url)
  const name = brand.name ?? ''

  let listing: BusinessListing | null = null
  let lookedUp = false
  if (dataForSeoConfigured() && host) {
    const meter: UsageMeter = { dataforseo: 0, hunter: 0, apis: {} }
    try {
      listing = pick(await businessListings(host, name, meter), host, name)
      lookedUp = true
    } catch (err) {
      console.error('[foundation] Google Business Profile lookup failed:', err instanceof Error ? err.message : err)
    }
    if (brand.id && meter.dataforseo > 0) await addUsage(brand.id, meter, 'Foundation').catch(() => {})
  }

  if (listing) {
    const stars = listing.rating != null
      ? ` — **${listing.rating.toFixed(1)}★ from ${listing.reviews ?? 0} review${listing.reviews === 1 ? '' : 's'}**`
      : ' — **no reviews yet**'
    const unclaimed = listing.claimed === false
    const few = (listing.reviews ?? 0) < 5
    const linked = !!e?.googleProfileLink
    return result(
      !unclaimed,
      `Google Business Profile found: "${listing.title}"${listing.category ? ` (${listing.category})` : ''}${stars}.${unclaimed ? ' It is **not claimed** by the owner.' : ''}`,
      unclaimed ? 'Profile exists but isn’t claimed' : few ? 'Profile is live, needs more reviews' : 'Google Business Profile is live',
      unclaimed
        ? 'An unclaimed profile can be edited by anyone and **you can’t reply to reviews** or fix your hours.'
        : few
          ? 'Profiles with **fewer than 5 reviews** rarely show in the top 3 on Google Maps.'
          : 'Your business shows on Google Maps and in local search results.',
      unclaimed
        ? 'Claim it: open the listing on Google Maps → "Own this business?" → verify.'
        : few
          ? 'Ask your last 5–10 happy customers for a review using the profile’s review link.'
          : linked ? '' : 'Link your Google profile from your website footer or contact page.',
    )
  }

  if (e?.googleProfileLink) {
    return result(true,
      `Your site links to a Google profile or map: **${e.googleProfileLink.slice(0, 80)}**.`,
      'Google profile is linked from site',
      'Customers can find your location and reviews from your site.',
      '')
  }

  if (!lookedUp) {
    return result(false,
      `No link to a Google Business Profile or Google map was found on your site${e?.localBusinessSchema ? ' (it does have local business data for search engines)' : ''}.`,
      'No Google profile linked',
      '**Most people find local businesses on Google Maps** — without a profile you don’t show there.',
      'Search your business name on Google Maps; if it isn’t there, create a profile at business.google.com.')
  }

  return result(false,
    `No Google Business Profile found for **${host}**${name ? ` or "${name}"` : ''}.`,
    'Not on Google Maps',
    '**Most people find local businesses on Google Maps** — without a profile you don’t show there or in the local map results.',
    'Create a free profile at business.google.com and verify it.')
}
