# Frekto — Overview Dashboard: Technical Specification

**For:** Development handoff
**Scope:** Backend data model, computation logic, API contract, and integration requirements for the "Overview" page. Frontend component spec is covered separately — this doc is what powers it.

---

## 1. What this page actually needs to do

The Overview page is a **read-heavy aggregation layer**, not a new source of truth. It pulls from five existing/planned systems and computes a small number of derived values (ratios, rankings, narrative text) on top of them. Nothing on this page should store its own duplicate copy of data — it reads, computes, caches, and renders.

Five source systems:

| Domain | Source | Status |
|---|---|---|
| Growth audits (Foundation, Website Audit, SEO Audit, Competitor Analysis) | Internal audit engine | Exists |
| Product module health (15 modules, scores) | Internal module scanner | Exists |
| User activity (DAU, MAU, signups, sessions) | PostHog | Connected |
| Search performance (clicks, impressions, CTR, position) | Google Search Console API | Connected, data pending |
| Page speed | PageSpeed Insights API | Not connected |
| Traffic/conversion paths | GA4 | Not connected |
| CAC / Churn / ARPU | Billing provider (e.g. Stripe) | Not connected — no source exists yet |

---

## 2. Data model

These are the core entities the backend needs to expose. Written as TypeScript interfaces for clarity — translate to your DB/ORM layer as needed.

```typescript
interface GrowthAudit {
  id: string;
  name: string;                    // "Foundation", "SEO Audit", etc.
  score: number;                   // 0-100
  status: 'complete' | 'in_progress' | 'not_started';
  subItems: GrowthAuditSubItem[];  // e.g. "Competitor Discovery" under Competitor Analysis
  lastAnalysedAt: string | null;   // ISO timestamp
}

interface GrowthAuditSubItem {
  id: string;
  parentAuditId: string;
  name: string;
  completed: number;
  total: number;
  flaggedEntities?: { name: string; severity: 'critical' | 'important' }[];
}

interface ProductModule {
  id: string;
  name: string;
  score: number | null;            // null = not yet analysed
  analysedAt: string | null;
}

interface UserActivityMetrics {
  periodStart: string;
  periodEnd: string;
  dau: number;
  mau: number;
  newSignups: number;
  sessions: number;
  source: 'posthog';
}

interface SearchMetrics {
  clicks: number | null;
  impressions: number | null;
  avgCtr: number | null;
  avgPosition: number | null;
  connectionStatus: 'not_connected' | 'connected_pending_data' | 'active';
  connectedAt: string | null;      // used to compute "pending data" window
}

interface RevenueMetrics {
  cac: number | null;
  churnRate: number | null;
  arpu: number | null;
  sourceConnected: boolean;
  sourceType: 'stripe' | 'chargebee' | null;
}

interface IntegrationSource {
  id: string;                      // 'psi', 'ga4', 'gsc', 'billing'
  displayName: string;
  status: 'locked' | 'connected_pending_data' | 'active';
  connectUrl: string;              // OAuth start URL or config page
}

interface GoalProgress {
  current: number;                 // 93
  target: number;                  // 500
  level: number;                   // 0
  unit: string;                    // "users"
}
```

---

## 3. Computed values (this is the "logical" part)

Everything below is derived server-side. **None of this should be computed in the frontend** — the frontend renders numbers and text it's given, it doesn't calculate them. This keeps the logic testable and means the mobile app / email digest / Slack bot can all reuse the same computed output later.

### 3.1 Overall growth-audit score
```
overallGrowthScore = average(audit.score for audit in growthAudits)
```
Simple average for now, per the visible data (4 audits → 85%... actually recompute per current set). **Open question for the team:** should this be weighted by audit importance, or by number of sub-items, once you have more than 4 audits? Flag this as a config value (`scoringStrategy: 'simple_average' | 'weighted'`) rather than hardcoding, since it'll likely change.

### 3.2 Top Priority selection
This is the highest-leverage piece of logic on the page — it should **not** just be "lowest score." Rank candidates by:

```
impactScore = (averageOfAllComparableScores - candidate.score) × weightForCategory
```

Where `weightForCategory` lets you tune how much a product-module gap matters vs. a growth-audit gap. Candidates pool = all `ProductModule`s with a score, all `GrowthAuditSubItem`s with `completed < total`. Take the single highest `impactScore`. This is what decided "Content Audit at 9%" beat "Competitor Analysis at 53%" — it's further below its own peer average (15 modules averaging 55%) than Competitor Analysis is below its peer average (4 audits averaging 85%).

Expose this as its own reusable function — `getTopPriority(modules, audits): PriorityItem` — since "What's Next" (section 3.4) reuses the same ranking, just returns the top N instead of top 1.

### 3.3 Insight text (per-card callouts)
Each metric card's "insight" line is a **rule-based** computation, not free-text generation, except where noted:

| Card | Rule |
|---|---|
| User Activity | `stickiness = dau / mau`. If `stickiness < 0.10`, show amber warning comparing to a benchmark constant (`STICKINESS_BENCHMARK_LOW = 0.15`). If ≥ 0.10, show a neutral/positive note or omit. |
| Module Health | `coverage = analysedCount / totalCount`. If `coverage < 0.6`, note that average score is based on partial data. |
| Search Performance | If `connectionStatus === 'connected_pending_data'` and `now - connectedAt < 48h`, show "usually takes 24–48h" note. If `> 48h` and still no data, this should instead surface as a **pending/error state**, not the same friendly note — flag to support/ops. |

Keep these as a small rules table/config, not inline conditionals scattered through the codebase — makes it easy to add new metric cards later without duplicating logic.

### 3.4 Summary paragraph generation
This is the one piece that's genuinely LLM-generated (see the separate summary prompt already shared). Backend responsibility here:
1. Assemble the structured JSON payload (goal, audits, modules, activity, revenue) — same shape as sections 2–3 above.
2. Call the LLM with the fixed system prompt (already written).
3. **Cache the result** — regenerate only when underlying data changes materially (e.g. once per data refresh cycle), not on every page load. This is a cost and latency concern, not just a nice-to-have.
4. Store the generated text with a timestamp + hash of the input payload, so you can detect "nothing changed, reuse cached summary" vs. "data moved, regenerate."

### 3.5 What's Next list
Top 5 items from the same ranking function as 3.2, but also pulling in a third candidate type: **locked integrations**, ranked by a fixed manual weight (e.g. billing connection is always high-priority since it unlocks 3 metrics at once). This mixing of computed-priority items with fixed-priority items is intentional — don't try to force integration prompts into the same numeric ranking as content scores, just interleave them at reasonable positions.

### 3.6 Status Board aggregation
Merge three heterogeneous item types into one list, tagged by domain:
```
statusBoardItems = [
  ...growthAudits.map(toStatusItem('growth')),
  ...productModules.map(toStatusItem('product')),
  ...integrationSources.map(toStatusItem('revenue' | 'product')),
]
```
Bucket into Done / Ongoing / Pending / Locked using a shared status-mapping function — don't let each domain define its own status vocabulary, or the tabs will drift out of sync (e.g. one domain saying "active" where another says "complete").

---

## 4. State handling rules (important — easy to get wrong)

Three distinct states get shown differently. Your developer should treat these as separate enum values, not derived from missing/null checks scattered around:

| State | Meaning | UI treatment |
|---|---|---|
| `locked` | No integration connected at all | Dashed border, lock icon, "Connect →" button |
| `connected_pending_data` | Integration connected, but no data returned yet (e.g. GSC takes 24–48h) | Em-dashes, amber note explaining expected delay |
| `active` | Data flowing normally | Normal metric display |

**Do not** conflate "connected, no data" with "not connected" — they need different user actions (wait vs. click connect). This was a specific point of confusion in the mockup and should be an explicit backend field (`connectionStatus`), not inferred from `value === null`.

---

## 5. API endpoints

Suggested shape — adjust to match your existing API conventions:

```
GET /api/overview
  → returns the full assembled payload: goal, growthAudits, productModules,
    userActivity, searchMetrics, revenueMetrics, integrationSources,
    topPriority, summaryText, statusBoardItems, nextSteps
    (one call, server does all aggregation — avoid frontend waterfall requests)

POST /api/integrations/:sourceId/connect
  → kicks off OAuth flow or returns a config URL

POST /api/overview/refresh
  → forces re-fetch from upstream sources (PostHog, GSC, etc.) and
    recomputes derived values; returns updated payload
    (rate-limit this — don't let it hammer upstream APIs on every click)
```

Single aggregated `GET /api/overview` is deliberate: the frontend spec calls for one page load, and stitching together 5+ separate API calls client-side adds latency and partial-failure complexity you don't need.

---

## 6. Refresh & caching strategy

- **Growth audits / product modules**: recompute on-demand when the user clicks "Re-analyse" on the underlying audit pages (already exists per your screenshots). Overview just reads the latest stored result — no need to re-run audits itself.
- **PostHog / GSC data**: pull on a schedule (e.g. hourly cron) into your own DB, don't call PostHog/GSC live on every page load.
- **Summary text**: cache keyed by input-payload hash (see 3.4).
- **Refresh button**: should trigger the scheduled-pull job on-demand for the connected sources, show a per-card loading skeleton (not full-page), and be rate-limited (e.g. max once per 5 minutes per user) to avoid upstream API abuse.

---

## 7. Third-party integration requirements

| Source | Auth type | Notes |
|---|---|---|
| PostHog | API key (project-level) | Already connected — confirm which project |
| Google Search Console | OAuth 2.0 (Google) | Needs verified site ownership on the GSC side before data flows |
| PageSpeed Insights | API key (Google Cloud) | Simple key-based, no OAuth needed, has a free quota — check rate limits |
| GA4 | OAuth 2.0 (Google) + property ID | User needs GA4 Admin access to grant |
| Billing (Stripe, etc.) | OAuth 2.0 or Connect | This is new — needs its own build. CAC also requires ad-spend data from *somewhere* (Google Ads / Meta Ads API, or manual entry) since Stripe alone only gives you revenue, not acquisition cost |

**Flag for product decision:** CAC specifically needs a spend number from outside Stripe. Decide whether that's a manual monthly input field, a Google/Meta Ads API integration, or deferred to a later phase. This should not block shipping Churn and ARPU, which only need billing data.

---

## 8. Non-functional requirements

- **Page load target:** under 1.5s for the aggregated `/api/overview` call assuming cached upstream data (i.e. not counting the on-demand refresh path).
- **Graceful degradation:** if one upstream source is down (e.g. PostHog outage), the rest of the page should still render — don't let one failed fetch 500 the whole endpoint. Return partial data with a per-card error state.
- **Idempotent refresh:** calling refresh twice in a row shouldn't double-charge API quota or create duplicate cached rows.

---

## 9. Open decisions to resolve with your developer before build

1. **Scoring strategy** — simple average vs. weighted, for both growth-audit and module-health aggregates (section 3.1).
2. **CAC spend source** — manual entry vs. ad-platform API (section 7).
3. **Summary regeneration frequency** — real-time on every data change, or batched (e.g. once daily)?
4. **Stickiness/coverage benchmark constants** — where do `STICKINESS_BENCHMARK_LOW` etc. live? Recommend a config table, not hardcoded, since these will likely get tuned.
5. **Ownership of the ranking function** (section 3.2) — this is the piece most likely to need product/marketing input over time, so it should be easy to adjust without a full deploy (config-driven weights, not buried in application code).
