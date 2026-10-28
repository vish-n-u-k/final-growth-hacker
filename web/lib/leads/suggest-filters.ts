import { callAI, withAIContext } from '@/lib/ai/client'
import { brandBlock, loadBrandContext, parseJsonLoose } from '@/lib/agents/context'
import { customerBlock } from '@/lib/agents/lead-agent'
import { readLeadData } from '@/lib/agents/store'
import { ACTOR_INDUSTRIES, ACTOR_SIZES } from './linkedin-options'
import { mapFilters } from './linkedin-leads'

// Works out the LinkedIn search filters for a brand from what GrowJin already knows about it: the
// website analysis (what it sells, who it is for) and the ideal-customer card from the Lead Agent, if
// the user made one. The reply is checked against the lists the lead actor accepts.

export interface SuggestedFilters {
  jobTitles: string[]
  excludeTitles: string[]
  industries: string[]
  keywords: string[]
  countries: string[]
  sizes: string[]
  technologies: string[]
  why: string
}

// Store platforms and other tools a buyer's website may run on: the only technologies worth offering
const TECH_HINTS = ['Shopify', 'Woo Commerce', 'Magento', 'BigCommerce', 'Wix', 'Squarespace', 'WordPress', 'Ecwid', 'Klaviyo', 'HubSpot', 'Salesforce', 'Stripe', 'Zendesk', 'Intercom', 'MailChimp']
const list = (v: unknown, max: number) => (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim().slice(0, 60)).slice(0, max)

export async function suggestFilters(brandId: string): Promise<SuggestedFilters | null> {
  const b = await loadBrandContext(brandId)
  if (!b) return null
  const data = await readLeadData(brandId).catch(() => null)
  const customer = data ? customerBlock(b, data.settings) : `Ideal customer: ${b.targetAudience ?? 'not given'}`

  const raw = await withAIContext({ brandId: b.id, moduleType: 'lead-finder', websiteUrl: b.websiteUrl }, () => callAI({
    feature: 'lead-finder',
    model: 'claude-sonnet-4-6',
    maxTokens: 700,
    system: 'You turn a description of a business and its ideal customers into B2B lead-search filters. Return only a raw JSON object.',
    prompt: `${brandBlock(b)}
${customer}

We are searching a database of people (name, job title, company, work email) to find the PEOPLE WHO WOULD BUY from this brand.

If the notes about the ideal customer and the brand's own website description disagree, trust the brand's own website description.

Return {"jobTitles":[...],"excludeTitles":[...],"industries":[...],"keywords":[...],"countries":[...],"sizes":[...],"technologies":[...],"why":"..."}
- jobTitles: 3-5 job titles of the person who decides to buy, in the words people put on their profile ("Founder", "Owner", "Co-Founder", "Head of Marketing"). For a small business the owner or founder (always include "Owner" and "Founder" then); for a larger one the marketing or ecommerce lead.
- excludeTitles: 3-8 titles that would match the titles above but are NOT the buyer for this brand, e.g. for a social media tool "CTO", "Chief Technology Officer", "Engineer", "Developer"; for a developer tool the opposite (sales and marketing titles). Never a title that is also in jobTitles.
- industries: 1-4 industries of the BUYER's company (not the brand's own), each exactly one of: ${ACTOR_INDUSTRIES.join(' | ')}
- keywords: 0-3 words the buyers' own companies use to describe themselves, only if industries alone are too loose. Never words that describe companies that SERVE these buyers (agencies, apps, software).
- countries: the brand's main market, worked out from its language, currency and address (for example "United States" for a dollar-priced English site). 1-3 full English country names. [] only if the brand clearly sells worldwide in many languages.
- sizes: ALWAYS 1-3 company sizes of the buyers, from ${ACTOR_SIZES.join(', ')}. Small businesses with an owner or founder as the buyer: ["1-10","11-50"]. Never empty.
- technologies: [] unless the brand's own website says it connects to a platform that its buyers' websites run on (for example a store platform it syncs with). Then choose only from ${TECH_HINTS.join(', ')}. Never guess a platform from the kind of business, and never use it for buyers who sell on a marketplace such as Etsy or Amazon, whose own website would not show it.
- why: one plain sentence (max 25 words) saying who we are looking for and why, written to the brand's owner.`,
  }))

  const j = parseJsonLoose<Record<string, unknown>>(raw, 'object')
  if (!j) return null
  const m = mapFilters({
    industries: list(j.industries, 4), keywords: list(j.keywords, 3), countries: list(j.countries, 3),
    sizes: list(j.sizes, 4), technologies: list(j.technologies, 3),
  })
  const titles = list(j.jobTitles, 5)
  const excludes = list(j.excludeTitles, 8).filter(t => !titles.some(x => x.toLowerCase() === t.toLowerCase()))
  if (!titles.length && !m.industries.length && !m.keywords.length) return null
  return {
    jobTitles: titles,
    excludeTitles: excludes,
    industries: m.industries,
    // An industry the actor does not know was moved to keywords by mapFilters
    keywords: m.keywords,
    countries: m.countries.concat(m.cities),
    sizes: m.sizes.length ? m.sizes : ['1-10', '11-50'],
    technologies: m.technologies,
    why: typeof j.why === 'string' ? j.why.trim().slice(0, 220) : '',
  }
}
