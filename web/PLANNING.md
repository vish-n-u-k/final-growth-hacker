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
- **GitHub auto-fix** — SEO items tagged as fixable; one click opens a PR on the connected repo

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
fix-agent.ts    — (optional) two-step Claude fix generator for GitHub auto-fix
```

**Static modules** (Foundation): checklist items are hardcoded in the definition. Claude just evaluates them.

**Dynamic modules** (SEO+): Claude generates the checklist items themselves — slug, label, weight, category — based on the brand's actual content. No hardcoded items. Each item can also be tagged `fixable: true` if it's safe to auto-fix via GitHub.

To add a new module:
1. Create `lib/modules/<name>/definition.ts`, `fetcher.ts`, `agent.ts`
2. Add to `lib/modules/registry.ts`
3. Add case to `app/api/modules/analyze/route.ts`

### DB schema (Supabase / PostgreSQL via Drizzle ORM)

```
brands              — one per user (id, user_id, name, website_url)
modules             — one per brand per module type (order, status, score, last_analyzed_at,
                       agent_branch, agent_pr_url)
module_categories   — self-referential, seeded at onboarding
module_items        — checklist rows (slug, label, weight, ai_detail, ai_narrative, ai_action,
                       ai_verified, user_checked, completed_by, fixable)
brand_integrations  — connected services (provider, api_key, access_token, metadata, status)
brain_context       — memory layer (facts jsonb, summary, user_resolved, priority_queue)
item_links          — relationships between items (scaffold, unused)
brain_insights      — AI-generated cross-module insights (scaffold, unused)
```

**Key column additions (run in Supabase SQL editor):**
```sql
ALTER TABLE module_items ADD COLUMN IF NOT EXISTS fixable boolean DEFAULT false;
ALTER TABLE modules ADD COLUMN IF NOT EXISTS agent_branch text;
ALTER TABLE modules ADD COLUMN IF NOT EXISTS agent_pr_url text;
-- Also needed for brand_integrations (if not already created):
CREATE TABLE IF NOT EXISTS brand_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  provider text NOT NULL,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'connected',
  access_token text, refresh_token text, token_expires_at timestamptz,
  scopes text[], api_key text, metadata jsonb,
  connected_at timestamptz DEFAULT now(), last_used_at timestamptz,
  CONSTRAINT brand_integration_unique UNIQUE (brand_id, provider)
);
```

### Scoring
- `score` stored per module (0–100) in `modules.score`
- Weighted: each item has weight 1 (minor) / 2 (important) / 3 (critical)
- Score = sum(done item weights) / sum(all item weights) × 100
- "Done" = `ai_verified` OR `user_checked` OR `completed_by = 'agent'`

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

## GitHub Auto-Fix (built)

When the SEO module flags a fixable issue, the user can click "Apply fix via GitHub" directly in the dashboard. The app opens a Pull Request on the connected repo — no editor needed.

### What counts as fixable (safe to auto-fix)
`<title>`, `<meta name="description">`, canonical link, Open Graph tags, Twitter card tags, robots meta, viewport meta, JSON-LD structured data (additive only).

### What is NOT fixable
URL structure, internal linking, image files, site architecture, copy/content rewrites, framework config files.

### Flow
1. User clicks "Apply fix" on an SEO item
2. `POST /api/items/apply-fix { itemId }`
3. Load item + verify `fixable: true`, load GitHub integration (PAT + repo URL)
4. Get/create shared branch `growth-hacker/seo-fixes` on the repo (stored in `modules.agent_branch`)
5. Detect framework from `package.json` (Next.js, Astro, Gatsby, etc.)
6. Get full file tree → **Claude Call 1**: identify which files to fetch (max 5)
7. Fetch those files from GitHub API
8. **Claude Call 2**: generate exact code fix → returns `{ path, content }[]`
9. Commit each changed file to the shared branch
10. If no PR exists yet: create PR `growth-hacker/seo-fixes → main` (stored in `modules.agent_pr_url`)
11. If PR already exists: new commits are added to the same PR (Option 3 — shared accumulating PR)
12. Mark item `completed_by: 'agent'`, `ai_verified: true`
13. Return PR URL → UI shows "Applied — review PR on GitHub" link

### Key design decisions
- **PR not direct commit** — user always reviews and merges
- **One shared PR per module** — all fixes accumulate in one PR, not one per fix
- **Multiple files allowed** — Claude can touch up to 5 files per fix
- **Branch name**: `growth-hacker/{module-type}-fixes`
- **maxDuration**: 60s (GitHub API + 2 Claude calls)

### New files
```
lib/github/index.ts               — GitHub REST API helpers (parse URL, get tree, commit, PR)
lib/modules/seo/fix-agent.ts      — detectFramework, identifyFilesToFix, generateFix
app/api/items/apply-fix/route.ts  — orchestration endpoint
```

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

| Provider | Use case | Auth method | Status |
|----------|----------|-------------|--------|
| GitHub | Read code, apply SEO/meta fixes automatically | PAT | **Built** |
| OpenAI | User's own key for future AI features | API key | **Built** |
| Vercel | Trigger redeploy after GitHub PR is merged | API token | Planned |
| Google Analytics | Pull real traffic/conversion data into modules | OAuth | Planned |
| Mailchimp | Email module data source | API key | Planned |
| Meta | Ads module data source | OAuth | Planned |

---

## Planned Features

### Diff preview before PR (pinned)
Before opening the PR, show the user a diff of what will change in the app. They can confirm or cancel.

### Brain AI Phase 2
- Cross-module insights: surface issues that appear in multiple modules as high-priority
- `brain_insights` table populated after each module run
- Dashboard "Brain summary" card showing top 3 cross-cutting issues

### PR merge tracking
Listen for GitHub webhooks on PR merge → auto-mark item complete and re-run scoring.

### Vercel auto-deploy
After GitHub PR is merged, trigger a Vercel deploy via API so the fix goes live immediately.

---

## Key Technical Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| AI model for analysis | claude-sonnet-4-6 | Best reasoning for complex audits |
| AI model for Brain filtering | claude-haiku-4-5-20251001 | Fast + cheap for simple filtering tasks |
| AI model for fix generation | claude-sonnet-4-6 | Code generation needs reasoning, not just speed |
| Module structure | Static (Foundation) vs Dynamic (SEO+) | Foundation has universal items; later modules are too brand-specific to hardcode |
| Credentials storage | Plaintext in DB | No encryption for now, can add at-rest encryption later |
| PAT vs OAuth for GitHub | PAT | Simpler, no callback URL needed, still extensible |
| PR vs direct commit | PR always | User reviews before merge — nothing can break production |
| One PR vs one-per-fix | One shared PR per module | Less GitHub clutter, all fixes reviewable in one place |
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
    items/apply-fix/route.ts      — GitHub auto-fix orchestration (NEW)
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
      agent.ts                    — SEO analysis + fixable tagging
      fix-agent.ts                — framework detection + 2-step fix generation (NEW)
  integrations/
    registry.ts                   — INTEGRATION_REGISTRY + IntegrationDefinition interface
  github/
    index.ts                      — GitHub REST API helpers (NEW)
  brain/index.ts                  — getRelevantContext, extractAndMergeFacts, updateUserResolved
  db/schema.ts                    — Drizzle schema (all tables)

app/globals.css                   — all CSS (design tokens + component styles)
PLANNING.md                       — this file
GITHUB_AUTOFIX.md                 — detailed spec for the GitHub auto-fix feature
```
