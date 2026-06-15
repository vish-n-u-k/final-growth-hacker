# SEO Audit Module — Findings & Build Notes

## What is being built

Module 3 in the Growth Hacker module chain. Unlocks when Website Audit score ≥ 70%.

A rule-based + AI-augmented SEO audit across 6 categories and 81 static items. The rule engine (`seo-audit.ts`) runs deterministic checks using Cheerio + Node TLS + fetch. Claude is called once at the end — only to generate business-impact narratives for failing items.

### Module chain position
```
Foundation (0) → Website Audit (1) → SEO (2) → Competitor Audit (3)
```

### Files created / modified
```
lib/audit/seo-audit.ts                   — rule engine (81 checks, 6 functions)
lib/modules/seo/definition.ts            — 81 static items, 6 categories, weights/fixable flags
lib/modules/seo/fetcher.ts               — thin wrapper: calls runSeoAudit(url)
lib/modules/seo/agent.ts                 — maps findings + single Claude narrative batch call
app/api/modules/analyze/route.ts         — updated seo case + static migration logic
```

### Categories and item count

| Slug | Category | Subcategories | Items |
|------|----------|---------------|-------|
| `meta-tags` | Meta Tags | Title Tag, Meta Description, Canonical Tag, Indexability, Open Graph | 20 |
| `headings` | Headings | H1 Tag, Heading Hierarchy, Content Outline | 13 |
| `images` | Images | Alt Text, Image Assets | 12 |
| `internal-links` | Internal Links | Link Structure, Anchor Text, Page Authority Flow | 12 |
| `schema` | Schema & Rich Results | Structured Data | 5 |
| `technical` | Technical SEO | Core Web Vitals, Security, Mobile Readiness, Crawlability, HTTP Errors, Performance | 19 |

**Total: 81 items**

### Item weights
- **Weight 3 (Critical):** title.present, description.present, canonical.present, robots.noindex, h1.exists, alt.present, links.broken, schema.valid, cwv.lcp, cwv.cls, https.enforced, https.ssl_valid, mobile.viewport, robots.no_block, http.5xx
- **Weight 2 (Important):** title.length, title.keyword, title.unique, description.length, description.keyword, canonical.same_domain, canonical.self, canonical.resolves, og.title, og.description, og.image, h1.single, h1.keyword, hierarchy.skipped, hierarchy.h2_exists, hierarchy.descriptive, alt.not_empty, alt.filename, alt.keyword_stuffing, image.filesize, image.dimensions, links.orphan, links.depth, links.homepage_links, anchor.descriptive, pagerank.nav, pagerank.contextual, schema.present, schema.type, schema.required-fields, https.hsts, robots.exists, sitemap.exists, http.4xx, cwv.fid, lighthouse.score, perf.render_blocking, perf.js_size, perf.ttfb
- **Weight 1 (Minor):** everything else (info-level checks, CTA language, brand in title, question headings, image format, etc.)

### Analysis flow
1. `runSeoAudit(url)` — fetches page (measures TTFB), reads response headers, loads Cheerio
2. Fetches robots.txt + sitemap.xml in parallel
3. Optionally runs Lighthouse CLI if installed (degrades gracefully if not)
4. Runs 6 check functions (meta/image/technical in parallel, headings/links/schema sequential)
5. Returns flat `findings[]` array — one finding per item key
6. `analyzeSeo()` maps each static item slug → finding from the flat map
7. Single Claude batch call — generates `ai_narrative` for all FAIL items only
8. Results written to `module_items` — migration logic re-seeds if slugs don't match DB

### What AI does vs what the engine does
| Task | Who does it |
|------|-------------|
| Pass / fail decision | `seo-audit.ts` rule engine (deterministic) |
| Finding text (`ai_detail`) | Rule engine finding `.text` |
| Fix instruction (`ai_action`) | Rule engine finding `.fix` |
| Business impact (`ai_narrative`) | Claude — one batch call, failing items only |
| `fixable` flag | Definition — true for title/meta/canonical/OG/JSON-LD/viewport/alt attrs |

---

## Known issues

### 1. Info-level items count as "verified" (pass)
Items the engine cannot check without a full crawl (e.g. `links.orphan`, `links.depth`, `title.unique`, `sitemap.valid`) return `level: 'info'`. The agent treats `info` as verified=true. This inflates the score — users get credit for checks that were never actually run. The alternative (treat info as fail) would unfairly penalise all sites for checks that are impossible to automate from a single page fetch.

### 2. Lighthouse not available on Vercel
Lighthouse CLI is auto-detected via `which lighthouse`. It is not available on Vercel serverless functions (no persistent PATH, no headless Chrome). All 4 Core Web Vitals items (`cwv.lcp`, `cwv.cls`, `cwv.fid`, `lighthouse.score`) return `info` level and count as pass. To get real CWV data you need self-hosting with Chrome, a background job, or the PageSpeed Insights API.

### 3. Static HTML only — JS-rendered SPAs show near-empty DOM
Cheerio parses the raw HTML response. If the site is a React/Vue/Angular SPA, the DOM at fetch time has almost no content. This affects: H1 detection, heading structure, image alt analysis, internal link counting, CTA/social proof detection (from website module), and schema detection if schema is injected via JS. A significant proportion of modern sites will have inflated "good" scores because checks return `info` instead of finding real problems.

### 4. Image file size checks via HEAD requests
`checkImageAlt()` does HEAD requests to the first 8 images to check file sizes. If images are served from a CDN with relative paths or if the CDN doesn't return `content-length`, all image size checks fall back to `info`. This is common for sites using Next.js Image, Imgix, Cloudinary, etc.

### 5. SSL check uses raw TCP/TLS — server-side only
`checkSSL()` uses Node's `tls.connect()`. This works in Node.js API routes but **will not work in Next.js edge runtime**. The analyze route must remain on the Node.js runtime (no `export const runtime = 'edge'`). Currently safe because the route doesn't set an edge runtime.

### 6. 15-second fetch timeout vs Vercel function limits
`runSeoAudit()` has a 15-second page fetch timeout and additional timeouts for robots.txt, sitemap, HEAD requests, and SSL checks. The analyze route sets `maxDuration = 90`. On slow sites this could still be tight if many HEAD requests queue up. If Lighthouse were enabled, it would almost certainly exceed 90 seconds.

### 7. Migration re-seeding is sequential (slow)
The migration logic (triggered when old dynamic SEO slugs are in DB) runs sequential `await` inside `for` loops to insert categories and items. For 81 items across 16 subcategories and 6 parent categories, this is ~100 sequential DB inserts. Acceptable as a one-time migration but could be parallelised.

### 8. Claude narrative call re-runs on every analysis
Every re-analysis triggers a Claude batch call for all failing items, even if they haven't changed since last time. If 50 items are failing, that's 50 narratives generated every time the user clicks Re-analyse. Should only call Claude for items that changed status since last run.

### 9. `og.url` check is path-only
The canonical vs og:url comparison strips the domain and compares pathnames only. This means it won't catch mismatches between `yourdomain.com/page` and `www.yourdomain.com/page`. Not a significant issue in practice but worth noting.

### 10. `perf.js_size` is always info
JavaScript bundle size requires fetching all `<script>` URLs and summing their sizes. The engine marks this as `info` (no check performed). It always passes. Users with massive JS bundles get credit for this item for free.

---

## What could be improved

### Short term

**1. Use PageSpeed Insights API for Core Web Vitals**
Replace the optional Lighthouse CLI with the free Google PageSpeed Insights API (`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=...`). Returns LCP, CLS, FID, and performance score without needing Chrome. Needs a `GOOGLE_PSI_API_KEY` env var (free tier: 25k requests/day).

```typescript
const psiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&key=${process.env.GOOGLE_PSI_API_KEY}`
const psi = await fetch(psiUrl).then(r => r.json())
```

**2. Skip Claude call for items that haven't changed**
Before calling Claude, compare each failing item's `ai_detail` against what's already in the DB. Only send items where the finding text changed (or where `ai_narrative` is null). Saves tokens on re-analysis of stable sites.

**3. Parallelise migration re-seeding**
Replace sequential inserts in the migration path with batched inserts per category:
```typescript
await db.insert(moduleItems).values(items.map(...))  // insert all items in one query
```

**4. Detect SPA and show warning**
If the fetched HTML has an empty `<body>` or only a single `<div id="root">`, add a banner in the dashboard: "This site uses client-side rendering — some checks ran against the initial HTML only and may be inaccurate."

### Medium term

**5. PageSpeed Insights integration**
Add `GOOGLE_PSI_API_KEY` as an optional env var. When present, `runSeoAudit()` calls the PSI API in parallel with the page fetch. Replaces all 4 `info`-level Core Web Vitals items with real data from Google's servers (field data, not synthetic).

**6. Multi-page crawl for info-level items**
Items currently returning `info` (orphan pages, link depth, duplicate titles/descriptions, broken links) could be resolved by crawling up to 20 pages. Add a lightweight BFS crawler that follows internal links up to depth 2 and re-runs the relevant checks. Run as a background job after the main analysis completes.

**7. Sitemap URL validation**
Parse `sitemap.xml`, extract up to 20 URLs, HEAD-request each one, and flag any that return non-200. Currently `sitemap.valid` is always `info`. With this improvement it becomes a real check.

**8. Historical score trending**
Store per-item `ai_verified` history over time. Show "improved since last analysis" indicators (green delta) on items that flipped from fail → pass between runs. Makes re-analysis more motivating.

**9. Sector-specific weighting**
Ask during onboarding what type of site it is (SaaS, e-commerce, content/blog, local business). Adjust item weights — e.g. for e-commerce, weight `schema.required-fields` (Product schema) and `image.filesize` at weight 3; for blogs, weight `outline.questions` and `hierarchy.h2_exists` higher.

### Long term

**10. Continuous monitoring via cron**
Schedule `runSeoAudit()` weekly. Store results per-run. Show trend lines per category on the dashboard. Alert users when a previously-passing item starts failing (e.g. SSL cert approaching expiry, canonical accidentally removed).

**11. Competitor SEO benchmarking**
Run `runSeoAudit()` against 2-3 competitor URLs. Show per-item comparison: "Your title is 82 chars (too long) — Competitor A uses 57 chars." Could integrate with the Competitor Audit module.

**12. Fix agent for SEO items**
The `fixable: true` items (title, meta description, canonical, OG tags, JSON-LD) could be auto-applied via a GitHub commit. Needs a fix-agent that generates the correct HTML snippet based on the site's framework (Next.js head, plain HTML, WordPress meta plugin, etc.) and opens a PR with the change.
