import { GMAIL_OUTREACH_MODULE } from './gmail-outreach/definition'
import { BACKLINKS_MODULE } from './backlinks/definition'
import { FOUNDATION_MODULE } from './foundation/definition'
import { WEBSITE_MODULE } from './website/definition'
import { SEO_MODULE } from './seo/definition'
import { COMPETITOR_ANALYSIS_MODULE } from './competitor-analysis/definition'
import { SOCIAL_MEDIA_MODULE } from './social-media/definition'
import { BRAND_AUDIT_MODULE } from './brand-audit/definition'
import { CONTENT_AUDIT_MODULE } from './content-audit/definition'
import { META_ADS_MODULE } from './meta-ads/definition'
import { OUTREACH_TARGETS_MODULE } from './outreach-targets/definition'
import { GEO_MODULE } from './geo/definition'
import { GEO_COMPETITOR_GAP_MODULE } from './geo-competitor-gap/definition'
import { USER_ANALYTICS_MODULE } from './user-analytics/definition'
import { BUSINESS_STAGE_MODULE } from './business-stage/definition'
import { EMAIL_MARKETING_MODULE } from './email-marketing/definition'
import { AUDIENCE_DISCOVERY_MODULE } from './audience-discovery/definition'
import { isDynamicIdea, type ModuleDefinition, type ModuleCategoryDefinition, type ModuleItemDefinition } from './types'

// ── Module Registry ───────────────────────────────────────────────────────────
// To add a new module: import its definition and add it to this array.
// The order field on each definition controls the sequence and gating.

export const MODULE_REGISTRY: ModuleDefinition[] = [
  // Growth Path, in step order
  FOUNDATION_MODULE,              // 1
  WEBSITE_MODULE,                 // 2
  SEO_MODULE,                     // 3
  GEO_MODULE,                     // 4 (includes the AI competitor gap checks)
  SOCIAL_MEDIA_MODULE,            // 5
  BRAND_AUDIT_MODULE,             // 6
  CONTENT_AUDIT_MODULE,           // 7
  COMPETITOR_ANALYSIS_MODULE,     // 8
  EMAIL_MARKETING_MODULE,         // 9
  // Off the path (see `placement`): kept registered so existing data and lookups keep working
  BUSINESS_STAGE_MODULE,          // internal: sidebar stage card, diagnosis, red flags
  META_ADS_MODULE,                // tool: Meta Ads page
  GMAIL_OUTREACH_MODULE,          // tool: Outreach
  USER_ANALYTICS_MODULE,          // hidden
  OUTREACH_TARGETS_MODULE,        // hidden
  AUDIENCE_DISCOVERY_MODULE,      // hidden
  BACKLINKS_MODULE,               // hidden
  GEO_COMPETITOR_GAP_MODULE,      // hidden (merged into GEO Audit)
]

/** 'path' unless the definition says otherwise. */
export const placementOf = (def: ModuleDefinition | undefined) => def?.placement ?? 'path'
/** Growth Path step (scored, locked in order, shown in the sidebar roadmap). */
export const isPathModule = (type: string) => placementOf(MODULE_MAP[type]) === 'path' && !!MODULE_MAP[type]
/** Created for each brand: Growth Path steps plus tools and internal modules (not retired ones). */
export const SEEDED_MODULES = (): ModuleDefinition[] => MODULE_REGISTRY.filter(d => placementOf(d) !== 'hidden')

export const MODULE_MAP: Record<string, ModuleDefinition> = Object.fromEntries(
  MODULE_REGISTRY.map((m) => [m.type, m]),
)

// slug → item definition, per static module (built once)
const ITEM_DEFS = new Map<string, Map<string, ModuleItemDefinition>>()
function itemDefs(type: string): Map<string, ModuleItemDefinition> | null {
  const def = MODULE_MAP[type]
  if (!def || def.dynamic) return null
  let m = ITEM_DEFS.get(type)
  if (!m) {
    m = new Map((def.categories as ModuleCategoryDefinition[]).flatMap((c) => c.subCategories.flatMap((s) => s.items)).map((i) => [i.slug, i]))
    ITEM_DEFS.set(type, m)
  }
  return m
}

/**
 * Whether a saved item is a real, scored check: still in its module's definition (a check removed
 * later keeps its old row) and not an insight. Dynamic modules' items always count.
 */
export function isScoredItem(moduleType: string, slug: string): boolean {
  if (MODULE_MAP[moduleType]?.dynamic) return !isDynamicIdea(MODULE_MAP[moduleType], slug)
  const defs = itemDefs(moduleType)
  if (!defs) return true
  const d = defs.get(slug)
  return !!d && !d.insight
}
