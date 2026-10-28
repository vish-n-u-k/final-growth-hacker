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
  industries: string[]
  keywords: string[]
  countries: string[]
  sizes: string[]
  technologies: string[]
  why: string
}

// Store platforms and other tools a buyer's website may run on: the only technologies worth offering
const TECH_HINTS = ['Shopify', 'Woo Commerce', 'Magento', 'BigCommerce', 'Wix', 'Squarespace', 'WordPress', 'Etsy', 'Ecwid', 'Klaviyo', 'HubSpot', 'Salesforce', 'Stripe', 'Zendesk', 'Intercom', 'MailChimp']
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

Return {"jobTitles":[...],"industries":[...],"keywords":[...],"countries":[...],"sizes":[...],"technologies":[...],"why":"..."}
- jobTitles: 2-4 job titles of the person who decides to buy, in the words people put on their profile ("Founder", "Owner", "Head of Marketing"). For a small business the owner or founder; for a larger one the marketing or ecommerce lead.
- industries: 1-4 industries of the BUYER's company (not the brand's own), each exactly one of: ${ACTOR_INDUSTRIES.join(' | ')}
- keywords: 0-3 words the buyers' own companies use to describe themselves, only if industries alone are too loose. Never words that describe companies that SERVE these buyers (agencies, apps, software).
- countries: [] unless the brand clearly sells to one country; then full English country names (e.g. "United States").
- sizes: company sizes of the buyers, from ${ACTOR_SIZES.join(', ')}. Small businesses: ["1-10","11-50"].
- technologies: only if the buyers' websites run on a known platform that the brand connects to (for example a store platform), chosen from ${TECH_HINTS.join(', ')}; else [].
- why: one plain sentence (max 25 words) saying who we are looking for and why, written to the brand's owner.`,
  }))

  const j = parseJsonLoose<Record<string, unknown>>(raw, 'object')
  if (!j) return null
  const m = mapFilters({
    industries: list(j.industries, 4), keywords: list(j.keywords, 3), countries: list(j.countries, 3),
    sizes: list(j.sizes, 4), technologies: list(j.technologies, 3),
  })
  const titles = list(j.jobTitles, 4)
  if (!titles.length && !m.industries.length && !m.keywords.length) return null
  return {
    jobTitles: titles,
    industries: m.industries,
    // An industry the actor does not know was moved to keywords by mapFilters
    keywords: m.keywords,
    countries: m.countries.concat(m.cities),
    sizes: m.sizes,
    technologies: m.technologies,
    why: typeof j.why === 'string' ? j.why.trim().slice(0, 220) : '',
  }
}
