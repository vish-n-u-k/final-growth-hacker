import { db } from '@/lib/db'
import { brainContext } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import type { ModuleAnalysisResult, DynamicModuleAnalysisResult } from '@/lib/modules/types'
import { callAI } from '@/lib/ai/client'

// ── Canonical decision store ──────────────────────────────────────────────────

interface CanonicalDecision {
  moduleType: string
  concern: string
  recommendation: string
  verified: boolean
  slug: string
  establishedAt: string
}

const CANONICAL_SLUG_KEYS: Record<string, string> = {
  'page-title-set':       'page_title',
  'title.present':        'page_title',
  'title.length':         'page_title',
  'title.keyword':        'page_title',
  'title.brand':          'page_title',
  'description.present':  'meta_description',
  'description.length':   'meta_description',
  'description.keyword':  'meta_description',
  'description.cta':      'meta_description',
  'h1.exists':            'h1_heading',
  'geo-structure-h1':     'h1_heading',
  'value-prop-exists':    'value_proposition',
  'cta-exists':           'cta_text',
  'og.title':             'og_title',
  'no-noindex':           'robots_indexing',
  'robots.noindex':       'robots_indexing',
}

const DYNAMIC_LABEL_PATTERNS: Array<{ keywords: string[]; concern: string }> = [
  { keywords: ['title', 'tag'],        concern: 'page_title' },
  { keywords: ['meta', 'description'], concern: 'meta_description' },
  { keywords: ['h1'],                  concern: 'h1_heading' },
  { keywords: ['value', 'prop'],       concern: 'value_proposition' },
  { keywords: ['cta'],                 concern: 'cta_text' },
  { keywords: ['call', 'action'],      concern: 'cta_text' },
  { keywords: ['og', 'title'],         concern: 'og_title' },
]

function getCanonicalConcernKey(slug: string, label: string, isDynamic: boolean): string | null {
  if (!isDynamic && CANONICAL_SLUG_KEYS[slug]) return CANONICAL_SLUG_KEYS[slug]
  if (isDynamic) {
    const lower = label.toLowerCase()
    for (const p of DYNAMIC_LABEL_PATTERNS) {
      if (p.keywords.every(kw => lower.includes(kw))) return p.concern
    }
  }
  return null
}

function extractRecommendationText(
  r: ModuleAnalysisResult | DynamicModuleAnalysisResult,
): string | null {
  if (r.verified && r.detail?.trim()) return r.detail.trim()
  if (!r.verified && r.action?.trim()) return r.action.trim()
  if (r.detail?.trim()) return r.detail.trim()
  return null
}

// ── 1. Filter brain context for relevance before a module runs ────────────────
// Called before each module's agent runs (skip for Foundation — it runs first).
// Uses Haiku: fast + cheap, just a filtering/summarising task.

export async function getRelevantContext(
  brandId: string,
  moduleType: string,
  modulePurpose: string,
): Promise<string> {
  const [ctx] = await db.select().from(brainContext).where(eq(brainContext.brandId, brandId))
  if (!ctx) return ''

  const facts = ctx.facts as Record<string, unknown> | null
  const userResolved = (ctx.userResolved as string[]) ?? []

  if (!facts && !ctx.summary) return ''

  // Exclude internal canonical store from facts sent to Haiku — it's for DB tracking only, not prompt injection
  const factsForHaiku = facts
    ? Object.fromEntries(Object.entries(facts).filter(([k]) => k !== 'canonical'))
    : null

  if (!factsForHaiku && !ctx.summary) return ''

  const raw = await callAI({
    system: 'You are a concise analyst. Extract only what is relevant. Return plain text bullet points or "No prior context."',
    prompt: `Accumulated knowledge about this brand from previous module analyses:

FACTS:
${factsForHaiku ? JSON.stringify(factsForHaiku, null, 2) : 'None yet'}

SUMMARY:
${ctx.summary ?? 'Not yet available'}

USER SELF-REPORTED AS FIXED (not yet AI-verified):
${userResolved.length > 0 ? userResolved.join(', ') : 'None'}

The next module to run is: "${moduleType}"
Its purpose: ${modulePurpose}

Extract only what is directly relevant to this module's analysis.
Return 3–6 concise bullet points. Plain text only, no JSON.
If nothing is relevant return exactly: "No prior context."`,
    maxTokens: 400,
    model: 'claude-haiku-4-5-20251001',
  })

  const filtered = raw.trim()
  return filtered === 'No prior context.' ? '' : filtered
}

// ── 2. Extract facts after a module runs and merge into brain_context ─────────
// Foundation: deterministic extraction from known slugs (no extra Claude call for facts).
// Dynamic modules: Claude decides what facts are worth storing for future modules.
// Both get an updated narrative summary.

export async function extractAndMergeFacts(
  brandId: string,
  moduleType: string,
  results: ModuleAnalysisResult[] | DynamicModuleAnalysisResult[],
): Promise<void> {
  const newFacts =
    moduleType === 'foundation'
      ? extractFoundationFacts(results as ModuleAnalysisResult[])
      : await extractDynamicFacts(moduleType, results as DynamicModuleAnalysisResult[])

  const summary = await buildSummary(brandId, moduleType, results)

  const [existing] = await db.select().from(brainContext).where(eq(brainContext.brandId, brandId))
  const existingFacts = (existing?.facts as Record<string, unknown>) ?? {}

  // Build canonical decisions — first-wins per concern key
  const isDynamic = results.length > 0 && 'category' in results[0]
  const existingCanonical =
    (existingFacts['canonical'] as Record<string, CanonicalDecision> | undefined) ?? {}
  const newCanonical = { ...existingCanonical }

  for (const result of results) {
    const slug = result.slug
    const label = 'label' in result ? (result as DynamicModuleAnalysisResult).label : slug
    const concernKey = getCanonicalConcernKey(slug, label, isDynamic)
    if (!concernKey) continue
    if (newCanonical[concernKey]) continue  // first-wins: already established
    const recommendation = extractRecommendationText(result)
    if (!recommendation) continue
    newCanonical[concernKey] = {
      moduleType,
      concern: concernKey,
      recommendation,
      verified: result.verified,
      slug,
      establishedAt: new Date().toISOString(),
    }
  }

  const updatedFacts = { ...existingFacts, [moduleType]: newFacts, canonical: newCanonical }

  if (existing) {
    await db
      .update(brainContext)
      .set({ facts: updatedFacts, summary, lastUpdated: new Date() })
      .where(eq(brainContext.brandId, brandId))
  } else {
    await db.insert(brainContext).values({
      brandId,
      facts: updatedFacts,
      summary,
      userResolved: [],
    })
  }
}

// ── 3. Update user_resolved when user checks/unchecks an item ─────────────────
// No Claude call — pure DB update.

export async function updateUserResolved(
  brandId: string,
  slug: string,
  checked: boolean,
): Promise<void> {
  const [existing] = await db.select().from(brainContext).where(eq(brainContext.brandId, brandId))
  const current = (existing?.userResolved as string[]) ?? []
  const updated = checked
    ? [...new Set([...current, slug])]
    : current.filter((s) => s !== slug)

  if (existing) {
    await db
      .update(brainContext)
      .set({ userResolved: updated })
      .where(eq(brainContext.brandId, brandId))
  } else {
    // Brain context doesn't exist yet — create a minimal row
    await db.insert(brainContext).values({ brandId, userResolved: updated, facts: {} })
  }
}

// ── Internal: Foundation fact extraction (deterministic, no Claude) ───────────

function extractFoundationFacts(results: ModuleAnalysisResult[]): Record<string, unknown> {
  const slugToKey: Record<string, string> = {
    'site-accessible':    'site_live',
    'ssl-active':         'ssl_active',
    'no-noindex':         'indexable',
    'mobile-viewport':    'mobile_ready',
    'no-placeholder':     'has_real_content',
    'ga4-installed':      'ga4_installed',
    'gsc-linked':         'gsc_linked',
    'privacy-policy':     'has_privacy_policy',
    'contact-accessible': 'has_contact_page',
    'value-prop-exists':  'value_prop_clear',
    'cta-exists':         'has_cta',
    'favicon-present':    'has_favicon',
    'business-name-clear':'business_name_visible',
    'page-title-set':     'has_page_title',
  }

  const facts: Record<string, unknown> = {}
  for (const r of results) {
    const key = slugToKey[r.slug]
    if (key) {
      facts[key] = r.verified
      // Store the detail string too — contains actual values (e.g. CTA text, business name)
      if (r.detail) facts[`${key}_detail`] = r.detail
    }
  }
  return facts
}

// ── Internal: Dynamic module fact extraction (Claude/Haiku) ───────────────────

async function extractDynamicFacts(
  moduleType: string,
  results: DynamicModuleAnalysisResult[],
): Promise<Record<string, unknown>> {
  if (results.length === 0) return {}

  const findings = results
    .map((r) => `[${r.verified ? 'PASS' : 'FAIL'}] ${r.label}: ${r.detail}`)
    .join('\n')

  const raw = await callAI({
    system: 'You extract structured facts from audit results. Return only a flat JSON object, no markdown, no explanation.',
    prompt: `Given these ${moduleType} audit findings, extract 5–10 key facts that would be useful context for future marketing modules.

${findings}

Return ONLY a flat JSON object with snake_case keys and concrete values.
Examples: { "primary_keyword": "AI news", "has_schema_markup": false, "og_tags_complete": true }
No explanation, no markdown — just the JSON object.`,
    maxTokens: 500,
    model: 'claude-haiku-4-5-20251001',
  })
  const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()
  try {
    return JSON.parse(clean)
  } catch {
    return {}
  }
}

// ── Internal: Build updated narrative summary ─────────────────────────────────

async function buildSummary(
  brandId: string,
  moduleType: string,
  results: ModuleAnalysisResult[] | DynamicModuleAnalysisResult[],
): Promise<string> {
  const [existing] = await db.select().from(brainContext).where(eq(brainContext.brandId, brandId))
  const prior = existing?.summary ?? ''

  const open = results.filter((r) => !r.verified).length
  const pass = results.filter((r) => r.verified).length
  const lines = results.map((r) => `[${r.verified ? '✓' : '✗'}] ${r.detail}`).join('\n')

  const text = await callAI({
    system: 'You write concise brand health summaries. Be specific. No preamble.',
    prompt: `Prior summary: "${prior}"

New ${moduleType} results (${pass} passing, ${open} open issues):
${lines}

Write an updated 2-sentence summary of this brand's overall growth health. Be specific. No preamble.`,
    maxTokens: 150,
    model: 'claude-haiku-4-5-20251001',
  })

  return text.trim() || prior
}
