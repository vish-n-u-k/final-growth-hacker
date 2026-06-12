# Growth Hacker — Architecture & Planning

## Vision

A guided growth platform that takes a brand from 0 → 500 users, one module at a time. Each module audits a specific growth lever (website foundation, SEO, social media, email, ads, etc.), generates a personalised checklist powered by Claude, and optionally applies fixes automatically via connected integrations (GitHub, etc.).

Users unlock modules sequentially — you can't skip ahead. Each gate enforces quality before moving on.

---

## Current State (as of June 2026)

### What's live
- Auth (Supabase email/password)
- Onboarding (brand name + website URL → Foundation analysis → dashboard)
- Module dashboard with sidebar nav, per-module scoring, expandable items
- Re-analyse button
- Manual checkbox toggle with background AI verification (Foundation items)
- Settings page (Brand / Integrations / Account tabs)
- GitHub + OpenAI integrations (PAT-based, stored in DB)

### Modules built
| # | Type | Style | Unlock condition |
|---|------|-------|-----------------|
| 0 | Foundation | Static (hardcoded items) | Always unlocked |
| 1 | SEO | Dynamic (Claude generates items per brand) | Foundation ≥ 70% |

---

## Architecture

### Module system

Every module is self-contained in `lib/modules/<name>/`:

```
definition.ts   — ModuleDefinition (name, description, categories, unlock threshold)
fetcher.ts      — data collection (HTML, robots, sitemap, social APIs, etc.)
agent.ts        — Claude analysis → returns results
```

**Static modules** (Foundation): checklist items are hardcoded in the definition. Claude just evaluates them.

**Dynamic modules** (SEO+): Claude generates the checklist items themselves — slug, label, weight, category — based on the brand's actual content. No hardcoded items.

To add a new module:
1. Create `lib/modules/<name>/definition.ts`, `fetcher.ts`, `agent.ts`
2. Add to `lib/modules/registry.ts`
3. Add case to `app/api/modules/analyze/route.ts`

### DB schema (Supabase / PostgreSQL via Drizzle ORM)

```
brands              — one per user (id, user_id, name, website_url)
modules             — one per brand per module type (order, status, score, last_analyzed_at)
module_categories   — self-referential, seeded at onboarding
module_items        — checklist rows (slug, label, weight, ai_detail, ai_narrative, ai_action,
                       ai_verified, user_checked, completed_by)
brand_integrations  — connected services (provider, api_key, access_token, metadata, status)
brain_context       — memory layer (facts jsonb, summary, user_resolved, priority_queue)
item_links          — relationships between items (scaffold, unused)
brain_insights      — AI-generated cross-module insights (scaffold, unused)
```

### Scoring
- `score` stored per module (0–100) in `modules.score`
- Weighted: each item has weight 1 (minor) / 2 (important) / 3 (critical)
- Score = sum(done item weights) / sum(all item weights) × 100
- "Done" = ai_verified OR user_checked

### Verification loop (Foundation only)
When a user checks a Foundation item, the app:
1. Re-fetches the live website
2. Runs a targeted Haiku check for that single item
3. If verified → promotes `user_checked` to `ai_verified`

### Integration registry pattern
`lib/integrations/registry.ts` — one object per provider. Adding a new integration = one entry in `INTEGRATION_REGISTRY`. The settings page renders cards dynamically from this list. The `brand_integrations` table stores credentials per brand per provider with `UNIQUE(brand_id, provider)`.

---

## Brain AI (Phase 1 — built)

The Brain is a shared memory layer between modules.

**Flow:**
1. After a module runs → `extractAndMergeFacts()` extracts key-value facts and stores them in `brain_context.facts[moduleType]`
2. Before next module runs → `getRelevantContext()` uses Haiku to filter accumulated facts for relevance to that module
3. Filtered context is injected into the analysis prompt, so each module knows what previous modules found
4. When user checks an item → `updateUserResolved()` saves the slug to `brain_context.user_resolved`

**Brain context table:** `brain_context` (one row per brand)
- `facts` — `{ foundation: { ssl_active: true, ga4_installed: false, ... }, seo: {...} }`
- `summary` — running narrative updated after each module
- `user_resolved` — array of slugs user self-reported as fixed
- `priority_queue` — reserved for future cross-module prioritisation

---

## Planned Modules (roadmap)

| # | Type | Data sources | Notes |
|---|------|-------------|-------|
| 2 | Social Media | Instagram, LinkedIn, YouTube, Facebook, Twitter APIs | Profile, content, engagement audit |
| 3 | Email Marketing | Mailchimp / Klaviyo API or manual input | List health, flows, deliverability |
| 4 | Paid Ads | Meta Ads API, Google Ads API | Campaign structure, spend efficiency |
| 5 | Content / Blog | Website crawl + sitemap | Content gap, topical authority |
| 6 | Conversion Rate | GA4 API + heatmap data | Landing page, funnel analysis |

---

## Planned Integrations (roadmap)

| Provider | Use case | Auth method |
|----------|----------|-------------|
| GitHub | Read code, apply SEO/meta fixes automatically | PAT (built) |
| OpenAI | User's own key for future AI features | API key (built) |
| Vercel | Deploy after GitHub fix is applied | API token |
| Google Analytics | Pull real traffic/conversion data into modules | OAuth |
| Mailchimp | Email module data source | API key |
| Meta | Ads module data source | OAuth |

---

## Planned Features

### GitHub auto-fix (next)
When SEO agent identifies a fixable issue (e.g. missing `<title>` tag):
1. Check if GitHub integration is connected + repo URL stored
2. Clone/fetch the relevant file via GitHub API
3. Apply targeted fix
4. Open a PR (or commit directly to a branch)
5. Log fix as `completed_by: 'agent'` in module_items

### Brain AI Phase 2
- Cross-module insights: surface issues that appear in multiple modules as high-priority
- `brain_insights` table populated after each module run
- Dashboard "Brain summary" card showing top 3 cross-cutting issues

### Module gating UI
- Locked modules show padlock + "Complete X to unlock" tooltip
- Progress bar in sidebar shows overall journey score (avg of all module scores)

---

## Key Technical Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| AI model for analysis | claude-sonnet-4-6 | Best reasoning for complex audits |
| AI model for Brain filtering | claude-haiku-4-5-20251001 | Fast + cheap for simple filtering tasks |
| Module structure | Static (Foundation) vs Dynamic (SEO+) | Foundation has universal items; later modules are too brand-specific to hardcode |
| Credentials storage | Plaintext in DB | No encryption for now, can add at rest encryption later |
| PAT vs OAuth for GitHub | PAT | Simpler, no callback URL needed, still extensible |
| DB migrations | Raw SQL in Supabase editor | drizzle-kit push hangs (project pauses); direct connection issues |
| Two DB URLs | Pooler port 6543 (runtime), direct port 5432 (migrations) | Supabase requirement |

---

## File Map

```
app/
  dashboard/[moduleId]/page.tsx   — module dashboard (server component)
  settings/page.tsx               — settings page (server component)
  onboarding/page.tsx             — 2-step onboarding
  api/
    onboarding/route.ts           — creates brand + all modules + seeds DB
    modules/analyze/route.ts      — runs module agent, saves results, unlocks next
    items/toggle/route.ts         — manual checkbox toggle
    items/verify/route.ts         — Foundation verification loop
    settings/brand/route.ts       — PATCH brand name/URL
    settings/integrations/route.ts — POST/DELETE integrations
    settings/account/route.ts     — DELETE account

components/
  ModuleDashboard.tsx             — generic dashboard (works for any module)
  SettingsPage.tsx                — settings tabs (Brand / Integrations / Account)

lib/
  modules/
    types.ts                      — ModuleDefinition, DBItemFull, DynamicModuleAnalysisResult
    registry.ts                   — MODULE_REGISTRY array
    foundation/                   — Module 0 (static, always unlocked)
    seo/                          — Module 1 (dynamic, Claude generates items)
  integrations/
    registry.ts                   — INTEGRATION_REGISTRY + IntegrationDefinition interface
  brain/index.ts                  — getRelevantContext, extractAndMergeFacts, updateUserResolved
  db/schema.ts                    — Drizzle schema (all tables)

app/globals.css                   — all CSS (design tokens + component styles)
```
