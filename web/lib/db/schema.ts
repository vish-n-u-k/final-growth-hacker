import {
  pgTable, uuid, integer, timestamp, unique,
  text, boolean, jsonb, type AnyPgColumn,
} from 'drizzle-orm/pg-core'

// ── Brands ───────────────────────────────────────────────────────────────────

export const brands = pgTable('brands', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  name: text('name').notNull(),
  websiteUrl: text('website_url').notNull(),
  industry: text('industry'),
  targetAudience: text('target_audience'),
  usp: text('usp'),
  brandVoice: text('brand_voice'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

// ── Modules ──────────────────────────────────────────────────────────────────

export const modules = pgTable('modules', {
  id: uuid('id').primaryKey().defaultRandom(),
  brandId: uuid('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),           // 'foundation' | 'seo' | 'social_media' | ...
  name: text('name').notNull(),
  order: integer('order').notNull(),      // 0 = Foundation, 1 = SEO, 2 = Social, ...
  status: text('status').notNull().default('locked'), // 'locked'|'pending'|'analyzing'|'complete'
  requirements: jsonb('requirements'),    // { website_url: "https://..." }
  score: integer('score').default(0),     // 0-100 completion %
  lastAnalyzedAt: timestamp('last_analyzed_at', { withTimezone: true }),
  agentBranch: text('agent_branch'),      // shared GitHub branch for this module's fixes
  agentPrUrl: text('agent_pr_url'),       // GitHub PR URL for the shared fixes branch
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

// ── Module Categories (self-referential for sub-categories) ──────────────────

export const moduleCategories = pgTable('module_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  moduleId: uuid('module_id').notNull().references(() => modules.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id').references((): AnyPgColumn => moduleCategories.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  label: text('label').notNull(),
  order: integer('order').notNull(),
})

// ── Module Items (actionable checklist items) ─────────────────────────────────

export const moduleItems = pgTable(
  'module_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    moduleId: uuid('module_id').notNull().references(() => modules.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').notNull().references(() => moduleCategories.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    label: text('label').notNull(),
    weight: integer('weight').notNull().default(1), // 1=minor | 2=important | 3=critical
    aiDetail: text('ai_detail'),           // one-line finding (always shown)
    aiNarrative: text('ai_narrative'),     // paragraph analysis (expandable)
    aiAction: text('ai_action'),           // specific next step (expandable)
    aiVerified: boolean('ai_verified').default(false),
    aiVerifiedAt: timestamp('ai_verified_at', { withTimezone: true }),
    userChecked: boolean('user_checked').default(false),
    userCheckedAt: timestamp('user_checked_at', { withTimezone: true }),
    completedBy: text('completed_by'),     // 'ai' | 'user' | 'agent' | null
    fixable: boolean('fixable').default(false), // true = Claude can auto-fix via GitHub
    fixInputKey: text('fix_input_key'),                    // metadata key to read from brandIntegrations (e.g. 'ga4_measurement_id')
    fixIntegrationProvider: text('fix_integration_provider'), // which integration to read from (e.g. 'google_analytics')
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    uniq: unique('module_item_unique').on(table.moduleId, table.slug),
  }),
)

// ── Brand Integrations ────────────────────────────────────────────────────────

export const brandIntegrations = pgTable(
  'brand_integrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    brandId: uuid('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),        // 'github' | 'openai' | 'vercel' | ...
    type: text('type').notNull(),                // 'oauth' | 'api_key' | 'webhook'
    status: text('status').notNull().default('connected'), // 'connected' | 'expired' | 'revoked'
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    scopes: text('scopes').array(),
    apiKey: text('api_key'),
    metadata: jsonb('metadata'),                 // { repo_url, default_branch, stack_type, ... }
    connectedAt: timestamp('connected_at', { withTimezone: true }).defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (table) => ({
    uniq: unique('brand_integration_unique').on(table.brandId, table.provider),
  }),
)

// ── Brain Agent ───────────────────────────────────────────────────────────────

export const brainContext = pgTable('brain_context', {
  id: uuid('id').primaryKey().defaultRandom(),
  brandId: uuid('brand_id').notNull().unique().references(() => brands.id, { onDelete: 'cascade' }),
  summary: text('summary'),                 // running narrative of brand health
  facts: jsonb('facts'),                    // { foundation: {...}, seo: {...} } — accumulated per module
  userResolved: jsonb('user_resolved'),     // string[] — slugs user self-reported as fixed
  priorityQueue: jsonb('priority_queue'),
  lastUpdated: timestamp('last_updated', { withTimezone: true }).defaultNow(),
})

export const itemLinks = pgTable('item_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  itemIdA: uuid('item_id_a').notNull().references(() => moduleItems.id, { onDelete: 'cascade' }),
  itemIdB: uuid('item_id_b').notNull().references(() => moduleItems.id, { onDelete: 'cascade' }),
  relationshipType: text('relationship_type').notNull(), // 'same_issue'|'related'|'depends_on'
  createdBy: text('created_by').notNull(),               // 'ai' | 'hardcoded'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const brainInsights = pgTable('brain_insights', {
  id: uuid('id').primaryKey().defaultRandom(),
  brandId: uuid('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  insight: text('insight').notNull(),
  affectedItemIds: uuid('affected_item_ids').array(),
  impactScore: integer('impact_score').default(0),
  resolved: boolean('resolved').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})
