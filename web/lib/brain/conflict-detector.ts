import { db } from '@/lib/db'
import { itemLinks, modules, moduleItems } from '@/lib/db/schema'
import { eq, inArray, and } from 'drizzle-orm'

// Concern key → all slugs across all modules that check the same real-world element
const CONCERN_SLUGS: Record<string, string[]> = {
  page_title: [
    'page-title-set',
    'title.present', 'title.length', 'title.keyword', 'title.unique', 'title.brand',
    'has-title',
  ],
  meta_description: [
    'description.present', 'description.length', 'description.keyword', 'description.cta', 'description.unique',
    'meta-description',
  ],
  h1_heading: [
    'value-prop-exists',
    'h1.exists', 'h1.single', 'h1.keyword', 'h1.length', 'h1.title_match',
    'has-h1',
    'geo-structure-h1',
  ],
  mobile_viewport: [
    'mobile-viewport',
    'mobile.viewport',
    'viewport-meta', 'viewport-configured',
  ],
  canonical_url: [
    'canonical.present', 'canonical.same_domain', 'canonical.self', 'canonical.resolves',
    'canonical',
  ],
  open_graph: [
    'og.title', 'og.description', 'og.image', 'og.url', 'og.type',
    'og-tags',
  ],
  image_alt: [
    'alt.present', 'alt.not_empty', 'alt.decorative', 'alt.filename',
    'alt.descriptive', 'alt.length', 'alt.keyword_stuffing', 'alt.context',
    'image-alt-text',
  ],
  robots_txt: [
    'robots.exists', 'robots.no_block',
    'robots-txt',
    'geo-robots-tier1', 'geo-robots-tier2', 'geo-robots-tier3',
  ],
  https_ssl: [
    'ssl-active',
    'https.enforced', 'https.ssl_valid', 'https.hsts',
    'uses-https', 'ssl-valid',
  ],
  xml_sitemap: [
    'sitemap.exists', 'sitemap.valid',
    'sitemap-xml',
  ],
  search_indexing: [
    'no-noindex',
    'robots.noindex',
  ],
  privacy_policy: [
    'privacy-policy',
    'has-privacy-page',
  ],
  contact_page: [
    'contact-accessible',
    'has-contact-page',
  ],
}

// Reverse lookup: slug → concern key
const SLUG_TO_CONCERN: Record<string, string> = {}
for (const [concern, slugs] of Object.entries(CONCERN_SLUGS)) {
  for (const slug of slugs) SLUG_TO_CONCERN[slug] = concern
}

// All slugs that participate in any concern (for targeted DB query)
const ALL_CONCERN_SLUGS = Object.values(CONCERN_SLUGS).flat()

// Label keyword fallback for dynamic modules (Brand Audit, Competitor Analysis, etc.)
// whose slugs are Claude-generated and won't be in SLUG_TO_CONCERN
const LABEL_KEYWORD_CONCERNS: Array<{ keywords: string[]; concern: string }> = [
  { keywords: ['h1'],                    concern: 'h1_heading' },
  { keywords: ['title', 'tag'],          concern: 'page_title' },
  { keywords: ['meta', 'description'],   concern: 'meta_description' },
  { keywords: ['ssl'],                   concern: 'https_ssl' },
  { keywords: ['https'],                 concern: 'https_ssl' },
  { keywords: ['robots'],               concern: 'robots_txt' },
  { keywords: ['sitemap'],              concern: 'xml_sitemap' },
  { keywords: ['canonical'],            concern: 'canonical_url' },
  { keywords: ['viewport'],             concern: 'mobile_viewport' },
  { keywords: ['open graph'],           concern: 'open_graph' },
  { keywords: ['og tag'],              concern: 'open_graph' },
  { keywords: ['image alt'],           concern: 'image_alt' },
  { keywords: ['alt text'],            concern: 'image_alt' },
  { keywords: ['noindex'],             concern: 'search_indexing' },
  { keywords: ['privacy'],             concern: 'privacy_policy' },
  { keywords: ['contact page'],        concern: 'contact_page' },
]

function getConcernFromLabel(label: string): string | null {
  const lower = label.toLowerCase()
  for (const { keywords, concern } of LABEL_KEYWORD_CONCERNS) {
    if (keywords.every(kw => lower.includes(kw))) return concern
  }
  return null
}

/**
 * Called fire-and-forget after any module analysis completes.
 * Finds overlapping items between the newly analyzed module and all other
 * analyzed modules for this brand, then writes them to item_links as 'same_issue' pairs.
 *
 * Convention: current module's item ID is always itemIdA.
 * Previous runs are cleaned up by deleting old itemIdA rows before inserting.
 */
export async function detectAndStoreConflicts(
  brandId: string,
  currentModuleId: string,
  currentItems: { id: string; slug: string; label?: string }[],
): Promise<void> {
  // Match each item to a concern: slug lookup first, label keyword fallback for dynamic modules
  const currentWithConcern = currentItems
    .map(item => {
      const concern = SLUG_TO_CONCERN[item.slug] ?? (item.label ? getConcernFromLabel(item.label) : null)
      return concern ? { id: item.id, concern } : null
    })
    .filter((item): item is { id: string; concern: string } => item !== null)

  if (currentWithConcern.length === 0) return

  // Get all other analyzed modules for this brand
  const allMods = await db
    .select({ id: modules.id, status: modules.status })
    .from(modules)
    .where(eq(modules.brandId, brandId))

  const otherModuleIds = allMods
    .filter(m => m.id !== currentModuleId && m.status === 'complete')
    .map(m => m.id)

  if (otherModuleIds.length === 0) return

  // Fetch only concern-related items from other modules (targeted query)
  const otherItems = await db
    .select({ id: moduleItems.id, slug: moduleItems.slug })
    .from(moduleItems)
    .where(and(
      inArray(moduleItems.moduleId, otherModuleIds),
      inArray(moduleItems.slug, ALL_CONCERN_SLUGS),
    ))

  // Build concern → other item IDs
  const concernToOther = new Map<string, string[]>()
  for (const item of otherItems) {
    const concern = SLUG_TO_CONCERN[item.slug]
    if (!concern) continue
    if (!concernToOther.has(concern)) concernToOther.set(concern, [])
    concernToOther.get(concern)!.push(item.id)
  }

  // Build canonical pairs (deduplicated)
  const pairs: { itemIdA: string; itemIdB: string }[] = []
  const seen = new Set<string>()
  for (const curr of currentWithConcern) {
    for (const otherId of concernToOther.get(curr.concern) ?? []) {
      const key = [curr.id, otherId].sort().join('|')
      if (seen.has(key)) continue
      seen.add(key)
      pairs.push({ itemIdA: curr.id, itemIdB: otherId })
    }
  }

  if (pairs.length === 0) return

  // Delete previous links where current module's items were itemIdA (clean re-analysis)
  const currentIds = currentWithConcern.map(i => i.id)
  await db.delete(itemLinks).where(
    and(
      inArray(itemLinks.itemIdA, currentIds),
      eq(itemLinks.relationshipType, 'same_issue'),
    ),
  )

  // Insert fresh pairs
  await Promise.all(
    pairs.map(pair =>
      db.insert(itemLinks).values({
        itemIdA: pair.itemIdA,
        itemIdB: pair.itemIdB,
        relationshipType: 'same_issue',
        createdBy: 'ai',
      }),
    ),
  )
}
