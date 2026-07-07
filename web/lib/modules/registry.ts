import { GMAIL_OUTREACH_MODULE } from './gmail-outreach/definition'
import { USER_ACQUISITION_MODULE } from './user-acquisition/definition'
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
import type { ModuleDefinition } from './types'

// ── Module Registry ───────────────────────────────────────────────────────────
// To add a new module: import its definition and add it to this array.
// The order field on each definition controls the sequence and gating.

export const MODULE_REGISTRY: ModuleDefinition[] = [
  USER_ACQUISITION_MODULE,        // order: 0
  FOUNDATION_MODULE,              // order: 1
  WEBSITE_MODULE,                 // order: 2
  SEO_MODULE,                     // order: 3
  COMPETITOR_ANALYSIS_MODULE,     // order: 4
  SOCIAL_MEDIA_MODULE,            // order: 5
  BRAND_AUDIT_MODULE,             // order: 6
  CONTENT_AUDIT_MODULE,           // order: 7
  META_ADS_MODULE,                // order: 8
  OUTREACH_TARGETS_MODULE,        // order: 9
  GEO_MODULE,                     // order: 10
  GEO_COMPETITOR_GAP_MODULE,      // order: 11
  BACKLINKS_MODULE,               // order: 12 — Coming Soon
  USER_ANALYTICS_MODULE,          // order: 13
  BUSINESS_STAGE_MODULE,          // order: 14
  GMAIL_OUTREACH_MODULE,          // order: 15
]

export const MODULE_MAP: Record<string, ModuleDefinition> = Object.fromEntries(
  MODULE_REGISTRY.map((m) => [m.type, m]),
)
