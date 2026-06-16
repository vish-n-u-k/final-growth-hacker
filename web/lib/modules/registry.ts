import { FOUNDATION_MODULE } from './foundation/definition'
import { WEBSITE_MODULE } from './website/definition'
import { SEO_MODULE } from './seo/definition'
import { COMPETITOR_ANALYSIS_MODULE } from './competitor-analysis/definition'
import { BRAND_AUDIT_MODULE } from './brand-audit/definition'
import type { ModuleDefinition } from './types'

// ── Module Registry ───────────────────────────────────────────────────────────
// To add a new module: import its definition and add it to this array.
// The order field on each definition controls the sequence and gating.

export const MODULE_REGISTRY: ModuleDefinition[] = [
  FOUNDATION_MODULE,              // order: 0
  WEBSITE_MODULE,                 // order: 1
  SEO_MODULE,                     // order: 2
  COMPETITOR_ANALYSIS_MODULE,     // order: 3
  BRAND_AUDIT_MODULE,             // order: 5
]

export const MODULE_MAP: Record<string, ModuleDefinition> = Object.fromEntries(
  MODULE_REGISTRY.map((m) => [m.type, m]),
)
