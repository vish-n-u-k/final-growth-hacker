# Website Audit Module — Findings & Build Notes

## What is being built

Module 2 in the Growth Hacker module chain. Sits between Foundation (Module 0) and SEO (Module 1 or later). Unlocks when Foundation score ≥ 70%.

A rule-based + AI-augmented audit of the user's website across 8 categories. Unlike the SEO module which sends raw HTML to Claude for all checks, this module uses a deterministic JS engine (`audit.js`) for pass/fail decisions and only uses Claude for narrative context on failed items.

### Module chain position
```
Foundation (0) → Website Audit (1) → SEO (2) → CRO/Others (3+)
```

### Files being created
```
lib/audit/audit.js                          — the rule-based audit engine
lib/modules/website/definition.ts          — 32 static items, 8 categories, weights
lib/modules/website/fetcher.ts             — calls runAudit(), returns raw result
lib/modules/website/agent.ts              — maps findings + Claude narrative batch call
app/api/modules/analyze/route.ts           — add 'website' case to switch statement
lib/modules/registry.ts                    — register the website module
```

### Categories and item count
| Key | Category | Items |
|-----|----------|-------|
| `ux` | UX & UI Analysis | 4 |
| `nav` | Navigation & Structure | 4 |
| `speed` | Page Speed | 4 |
| `mobile` | Mobile Friendliness | 3 |
| `trust` | Trust Signals | 5 |
| `cro` | Conversion (CRO) | 4 |
| `forms` | Forms & CTAs | 4 |
| `tech` | Technical Health | 8 |

**Total: ~36 items**

### Analysis flow
1. `runAudit(url)` — 3 HTTP requests (page + robots.txt + sitemap.xml), pure JS, ~2s
2. Map each finding to a static item slug: `ai_verified`, `ai_detail`, `ai_action`, `fixable`
3. Single Claude batch call — generates `ai_narrative` (business context) for all FAIL items
4. Upsert all module_items to DB
5. If weighted score ≥ 70%, unlock next module

### What AI does vs what the engine does
| Task | Who does it |
|------|-------------|
| Pass / fail decision | `audit.js` rule engine (deterministic) |
| What is wrong (`ai_detail`) | `audit.js` finding text |
| What to do (`ai_action`) | `audit.js` fix text |
| Why it matters (`ai_narrative`) | Claude (one batch call) |
| Code fix (`fixable`) | `audit.js` — present when `finding.code` exists |

---

## Known issues

### 1. `audit.js` does not exist yet
The WEBSITE_AUDIT.md describes the engine interface but `audit.js` has not been written. The entire module depends on this file being implemented first. All 8 category functions need to be built in JS using `node-fetch` + `cheerio`.

### 2. Static HTML parsing only — no JS execution
`audit.js` uses Cheerio (static parser). Any content rendered client-side (React, Vue, Angular SPAs) will appear as an empty or near-empty DOM. This means:
- CTA detection will fail on SPAs
- Social proof detection will fail if injected via JS
- Nav landmark detection may miss dynamically rendered navs
- Affects a large percentage of modern websites

### 3. SSL check requires raw TCP/TLS connection
The Python version used `ssl` + `socket` stdlib directly. The JS equivalent requires `tls.connect()` from Node's built-in `tls` module. This works in Node.js but **does not work in Next.js edge runtime or browser**. Must run server-side only (Node.js runtime, not edge).

### 4. Lighthouse integration is optional and environment-dependent
Lighthouse is auto-detected via `which lighthouse`. This works locally and on some servers but:
- Not available on Vercel serverless functions (no persistent PATH, no headless Chrome)
- Would only work if self-hosting or running in a Docker container with Chrome installed
- Without Lighthouse, Page Speed section only gets basic timing + payload size — no LCP, FCP, CLS

### 5. 15-second timeout vs Vercel's function limits
`runAudit()` uses a 15-second HTTP timeout per request. The analyze route already has `maxDuration = 90`. However if the target site is slow AND Lighthouse is enabled, this could approach or exceed limits.

### 6. item slug mapping strategy not finalized
The audit engine returns findings dynamically — the number and type of findings per category varies per site. The module uses static pre-defined items (like SEO module). The mapping logic (finding → slug) needs a reliable strategy:
- Option A: Map by finding index position (fragile — engine changes break it)
- Option B: Map by keyword match on `finding.text` (brittle)
- Option C: Add a stable `key` field to each finding in `audit.js` (correct approach — needs to be built this way from the start)

**Recommendation: build `audit.js` with a `key` field on every finding that matches the static item slug exactly.**

### 7. Claude narrative call on re-analysis
Every re-analysis triggers a Claude batch call for all items, even items that haven't changed (still passing). This wastes tokens. Should only call Claude for items that are FAIL and either new or changed since last analysis.

### 8. `fixable` items are limited
Only items where `audit.js` returns a `finding.code` snippet are auto-fixable via GitHub. Many important issues (social proof, CTA copy, page speed, mobile layout) cannot be fixed with a code snippet. Users may be frustrated that "Apply fix" doesn't appear on high-priority items.

### 9. Score weighting not defined yet
The audit engine returns a 0-100 score per section. The module system uses weighted items. These two scoring systems need to be reconciled — either use the engine's scores directly or re-calculate from item weights. Using item weights is more consistent with the rest of the app.

---

## What could be improved

### Short term

**1. Add `key` field to every finding in `audit.js`**
Each finding should have a stable machine key matching its item slug. This makes the finding → item mapping reliable and refactor-proof.

```js
// Instead of:
{ level: 'bad', text: 'Page has no <title>.', fix: '...' }

// Use:
{ key: 'has-title', level: 'bad', text: 'Page has no <title>.', fix: '...' }
```

**2. Skip Claude call for PASS items**
Only send failed items to Claude for narrative generation. Pass items get a generic "This check passed" or no narrative at all. Saves tokens on every analysis.

**3. Cap and retry on timeout**
If `runAudit()` times out (site unreachable or very slow), return a partial result with the sections that completed rather than failing the whole analysis.

**4. Normalize score to weighted item system**
Use the same weighted scoring as SEO module (Critical/Important/Minor weights) rather than the engine's per-section score. Keeps the dashboard consistent.

### Medium term

**5. Lighthouse support via background job**
Run Lighthouse in a separate background worker (not in the API route) so it doesn't block the response. Store results separately and merge with the main audit result when available. Would unlock real Core Web Vitals data.

**6. SPA detection + fallback**
Detect if the site is a JS-rendered SPA (check for `<div id="root">`, `<div id="app">`, empty body with script tags). If detected, show a warning: "This site uses client-side rendering — some checks may be inaccurate." Could optionally use Playwright/Puppeteer for rendered HTML in a background job.

**7. Delta analysis**
On re-analysis, compare new results against previous `ai_verified` values. Only update narrative for items that changed status. Show "Improved since last analysis" indicators on items that flipped from fail → pass.

**8. Sector-specific scoring**
Weight items differently based on business type. A SaaS product should weight CRO/CTA items higher. An e-commerce site should weight trust signals and forms higher. Could ask during onboarding and adjust weights accordingly.

**9. Extend auto-fix coverage**
For non-code fixes (social proof, CTAs), the GitHub flow could still create placeholder content — e.g. create a testimonials section HTML snippet and commit it. Requires more sophisticated fix-agent prompts per item type.

**10. Competitor benchmarking**
Run `runAudit()` against 2-3 competitor URLs and show how the user's scores compare per category. Would make the findings much more motivating ("Your page speed score is 42 — your top competitor scores 78").

### Long term

**11. Continuous monitoring**
Schedule `runAudit()` to run weekly via a cron job. Store historical scores per category. Show trend lines on the dashboard (score improving over time as fixes are applied).

**12. Multi-page audit**
Currently audits only the homepage. Extend to audit 3-5 key pages (homepage, pricing, about, contact, a blog post). Surface per-page issues and aggregate scores. Would require a lightweight crawler limited to the same domain.
