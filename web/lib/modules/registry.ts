import { FOUNDATION_MODULE } from './foundation/definition'
import { SEO_MODULE } from './seo/definition'
import type { ModuleDefinition } from './types'

// ── Module Registry ───────────────────────────────────────────────────────────
// To add a new module: import its definition and add it to this array.
// The order field on each definition controls the sequence and gating.

export const MODULE_REGISTRY: ModuleDefinition[] = [
  FOUNDATION_MODULE,  // order: 0
  SEO_MODULE,         // order: 1
  // Add new modules here as your team provides MD files:
  // SOCIAL_MEDIA_MODULE,  // order: 2
  // EMAIL_MODULE,         // order: 3
]

export const MODULE_MAP: Record<string, ModuleDefinition> = Object.fromEntries(
  MODULE_REGISTRY.map((m) => [m.type, m]),
)
