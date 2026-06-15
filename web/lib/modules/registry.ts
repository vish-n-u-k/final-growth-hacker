import { FOUNDATION_MODULE } from './foundation/definition'
import { WEBSITE_MODULE } from './website/definition'
import { SEO_MODULE } from './seo/definition'
import { COMPETITOR_AUDIT_MODULE } from './competitor-audit/definition'
import type { ModuleDefinition } from './types'

// ── Module Registry ───────────────────────────────────────────────────────────
// To add a new module: import its definition and add it to this array.
// The order field on each definition controls the sequence and gating.

export const MODULE_REGISTRY: ModuleDefinition[] = [
  FOUNDATION_MODULE,         // order: 0
  WEBSITE_MODULE,            // order: 1 — unlocks when Foundation ≥ 70%
  SEO_MODULE,                // order: 2 — unlocks when Website ≥ 70%
  COMPETITOR_AUDIT_MODULE,   // order: 3 — unlocks when SEO completes (any score)
]

export const MODULE_MAP: Record<string, ModuleDefinition> = Object.fromEntries(
  MODULE_REGISTRY.map((m) => [m.type, m]),
)
