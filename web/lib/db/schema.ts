import { pgTable, uuid, integer, timestamp, unique, text, boolean } from 'drizzle-orm/pg-core'

export const userTasks = pgTable(
  'user_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    levelId: integer('level_id').notNull(),
    taskIndex: integer('task_index').notNull(),
    checkedAt: timestamp('checked_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    uniq: unique('user_task_unique').on(table.userId, table.levelId, table.taskIndex),
  }),
)

export const userProgress = pgTable('user_progress', {
  userId: uuid('user_id').primaryKey(),
  userCount: integer('user_count').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

// ── Marketing Agent tables ──────────────────────────────────────────────────

export const brands = pgTable('brands', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const channels = pgTable('channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  brandId: uuid('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'website' | 'ios' | 'android' | 'shopify'
  url: text('url').notNull(),
  lastAnalyzedAt: timestamp('last_analyzed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const channelItems = pgTable(
  'channel_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
    itemSlug: text('item_slug').notNull(),
    aiDetail: text('ai_detail'),           // Claude's site-specific finding
    aiVerified: boolean('ai_verified').default(false),
    aiVerifiedAt: timestamp('ai_verified_at', { withTimezone: true }),
    userChecked: boolean('user_checked').default(false),
    userCheckedAt: timestamp('user_checked_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    uniq: unique('channel_item_unique').on(table.channelId, table.itemSlug),
  }),
)
