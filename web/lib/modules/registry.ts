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
import type { ModuleDefinition } from './types'

// ── Module Registry ───────────────────────────────────────────────────────────
// To add a new module: import its definition and add it to this array.
// The order field on each definition controls the sequence and gating.

export const MODULE_REGISTRY: ModuleDefinition[] = [
  FOUNDATION_MODULE,              // order: 0
  WEBSITE_MODULE,                 // order: 1
  SEO_MODULE,                     // order: 2
  COMPETITOR_ANALYSIS_MODULE,     // order: 3
  SOCIAL_MEDIA_MODULE,            // order: 4
  BRAND_AUDIT_MODULE,             // order: 5
  CONTENT_AUDIT_MODULE,           // order: 6
  META_ADS_MODULE,                // order: 7
  OUTREACH_TARGETS_MODULE,        // order: 8
  GEO_MODULE,                     // order: 9
  GEO_COMPETITOR_GAP_MODULE,      // order: 10
  USER_ANALYTICS_MODULE,          // order: 12
]

export const MODULE_MAP: Record<string, ModuleDefinition> = Object.fromEntries(
  MODULE_REGISTRY.map((m) => [m.type, m]),
)
