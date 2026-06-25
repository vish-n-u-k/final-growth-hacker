# GEO Audit Module — Findings & Build Notes

## What is being built

Module 9 in the Growth Hacker module chain. Always unlocked (`unlockThreshold: 0`) — runs independently of other modules.

A hybrid rule-engine + AI-knowledge audit for Generative Engine Optimization. The rule engine pre-computes all structural facts from fetched files (robots.txt, llms.txt, HTML schema, discovery endpoints). Claude is called once with all pre-computed findings + page content to generate detail, narrative, and action for each item. Brand sentiment items use Claude's own training knowledge rather than fetched data.

Companion module: **GEO Competitor Gap** (order 10) — runs the same rule engine against competitor sites in parallel and surfaces structural citation gaps. Manual trigger only, separate sidebar entry.

### Module chain position
```
... → Meta Ads (7) → Outreach (8) → GEO Audit (9) → GEO Competitor Gap (10)
```

### Files created / modified
```
lib/modules/geo/definition.ts              — 31 static items, 6 categories, weights
lib/modules/geo/fetcher.ts                 — fetches 7 URLs in parallel (html, robots, llms, 4 discovery)
lib/modules/geo/agent.ts                   — rule engine + single Claude Sonnet call
lib/modules/geo-competitor-gap/definition.ts — dynamic module, 6 categories with per-category prompts
lib/modules/geo-competitor-gap/fetcher.ts  — runs fetchGeoData on your site + up to 3 competitors
lib/modules/geo-competitor-gap/agent.ts    — builds comparison table, Claude generates gap items
lib/modules/registry.ts                   — GEO + GEO_COMPETITOR_GAP added
app/api/modules/analyze/route.ts          — cases for 'geo' and 'geo-competitor-gap'
```

### Categories and item count

| Slug | Category | Sub-categories | Items |
|------|----------|----------------|-------|
| `ai-crawler-access` | AI Crawler Access | robots-ai-bots | 3 |
| `llms-txt` | LLMs.txt | llms-txt-checks | 6 |
| `structured-data` | Structured Data for AI | schema-types | 4 |
| `content-citability` | Content Citability | citation-signals, answer-structure | 5 |
| `technical-signals` | Technical Signals | freshness-signals, ai-discovery | 7 |
| `brand-sentiment` | Brand Sentiment in AI | ai-perception | 4 |

**Total: 29 items**

### Item weights

- **Weight 3 (Critical):** `geo-robots-tier1`, `geo-robots-tier2`, `geo-llms-present`, `geo-schema-faq`, `geo-schema-org`, `geo-sentiment-known`
- **Weight 2 (Important):** `geo-robots-tier3`, `geo-llms-h1`, `geo-llms-sections`, `geo-llms-links`, `geo-schema-website`, `geo-content-stats`, `geo-content-citations`, `geo-structure-h1`, `geo-structure-faq-content`, `geo-signals-modified`, `geo-sentiment-framing`, `geo-sentiment-use-cases`
- **Weight 1 (Minor):** `geo-llms-blockquote`, `geo-llms-depth`, `geo-schema-article`, `geo-content-lists`, `geo-signals-lang`, `geo-signals-rss`, `geo-discovery-aitxt`, `geo-discovery-summary`, `geo-discovery-faq`, `geo-discovery-service`, `geo-sentiment-competitors`

**Total weight: 53**

### Fetcher — what gets fetched

All 7 requests fire in parallel with independent timeouts:

| URL | Timeout | Returns null on |
|-----|---------|-----------------|
| Homepage HTML | 12s | fetch error or non-200 |
| `/robots.txt` | 8s | 404 or timeout |
| `/llms.txt` | 8s | 404 or timeout → stored as null |
| `/.well-known/ai.txt` | 8s | 404 → null |
| `/ai/summary.json` | 8s | 404 → null |
| `/ai/faq.json` | 8s | 404 → null |
| `/ai/service.json` | 8s | 404 → null |

### Analysis flow

1. `fetchGeoData()` — 7 parallel URL fetches
2. `buildRuleFindings()` — pure JS, no AI:
   - robots.txt parser: walks line-by-line, resolves wildcard `*` inheritance, classifies 13 bots across 3 tiers
   - JSON-LD extractor: Cheerio finds all `<script type="application/ld+json">`, checks for FAQPage / Organization+sameAs / WebSite / Article
   - Page data extractor: extracts lang, title, H1, headings, freshness dates, RSS link, stats count, list items, FAQ heading detection
   - llms.txt analyzer: regex checks H1, blockquote, sections, link count, section count → depth flag
   - Discovery endpoints: null checks on 4 fetched JSON paths
3. `buildRuleContext()` — formats all findings into a structured text block (ground truth for Claude)
4. Single Claude Sonnet call (8000 max tokens) — 29 items sent in one batch
5. `parseClaudeJsonArray()` — robust JSON extraction with truncation recovery
6. Filter: slug must be in `validSlugs`, detail must be string, verified must be boolean
7. Analyze route does `UPDATE module_items SET ai_detail, ai_narrative, ai_action, ai_verified WHERE moduleId AND slug`
8. Score computed: sum(weight of aiVerified=true) / 53 × 100

### What AI does vs what the rule engine does

| Task | Who does it |
|------|-------------|
| Bot blocked / allowed / not-mentioned | Rule engine (robots.txt parser) |
| llms.txt present, H1, blockquote, sections, links, depth | Rule engine (regex) |
| Schema types present (FAQPage, Org, WebSite, Article) | Rule engine (Cheerio + JSON parse) |
| Organization has sameAs array | Rule engine |
| Discovery endpoints present | Rule engine (null check on fetch result) |
| html lang, freshness date, RSS link | Rule engine (Cheerio) |
| Stats count, list items, FAQ headings | Rule engine (Cheerio + regex) |
| Why each finding matters (narrative) | Claude |
| What to do about it (action) | Claude |
| Content quality judgement (H1 specificity, FAQ-style content) | Claude (from page body excerpt) |
| Brand sentiment (known, framing, use-cases, competitor defaults) | Claude (training knowledge) |

---

## Known Issues

### 1. externalLinks count is always wrong
In `extractPageData`, the external link filter does:
```typescript
return !href.includes(new URL('https://placeholder.com').hostname)
```
`new URL('https://placeholder.com').hostname` always returns `"placeholder.com"`. So the filter checks if the href contains "placeholder.com" — which it never does. Every `href^="http"` link is counted as external, including internal absolute links. The `geo-content-citations` check (which uses `externalLinks`) receives an inflated count. Low impact because Claude also evaluates from the body text, but the pre-computed signal is inaccurate.

**Fix:** Pass the site's origin into `extractPageData` and filter correctly.

### 2. Brand sentiment reflects Claude's knowledge only
The 4 `geo-sentiment-*` items use Claude's own training data (cutoff: August 2025). This does not represent what ChatGPT, Perplexity, or Gemini would say about the brand. For large/well-known brands this is a reasonable proxy. For small, niche, or recently-founded brands, Claude may have no knowledge — verified=false correctly flags this, but the action is limited to "improve your GEO signals so future models pick you up."

**Fix:** Add Perplexity API call in the fetcher (optional, gated on `PERPLEXITY_API_KEY`) and send the Perplexity response as additional sentiment context.

### 3. JS-rendered sites give empty content signals
Cheerio parses raw HTML. React/Vue/Next.js SPAs that inject content via JavaScript return near-empty bodies at fetch time. This affects: `geo-content-stats` (stats count = 0), `geo-content-lists` (list items = 0), `geo-structure-faq-content` (no FAQ headings), `geo-structure-h1` (H1 may be empty). Claude will flag these as fails even though the rendered page may have all this content.

**Fix:** Detect empty body (`bodyText.length < 100`) and note it in the context block so Claude can caveat its findings.

### 4. AI discovery endpoints: no content validation
The fetcher checks `res.ok` (status 200) for `/ai/faq.json`, `/ai/service.json` etc. Sites with catch-all 200 routes (soft 404s) will show these as "present" even when the response is an HTML error page or empty object. The content is never validated as valid JSON.

**Fix:** After fetching, `JSON.parse()` the response and check it has at least one expected key before marking as present.

### 5. robots.txt parser does not handle partial path blocks
The parser only flags `Disallow: /` (block all) as `disallowAll`. A robots.txt with `Disallow: /api/` or `Disallow: /wp-admin/` is treated as "allowed" for that bot. This is correct for homepage crawling but could be misleading if the content AI needs is under a blocked path.

### 6. Single Claude call for 29 items may get tight on token budget
With 29 items × (detail + narrative + action) and brand sentiment requiring more reasoning, the 8000 token output limit on Sonnet can be tight for sites with complex signals. `parseClaudeJsonArray` handles truncation recovery (finds last complete `},` and closes the array), but truncated responses mean some items at the end of the list come back without narrative/action. Brand sentiment items are last in the item list — they are the most likely to be truncated if the token budget is hit.

**Fix:** Send brand sentiment as a separate second Claude call with its own 2000 token budget.

### 7. GEO Competitor Gap module not auto-seeded for existing users
The competitor gap module (order 10) was added after some users completed onboarding. Onboarding runs once and only seeds modules present in the registry at that time. Existing users will not see the module in the sidebar without a manual SQL insert:
```sql
INSERT INTO modules (brand_id, type, name, "order", status, requirements)
SELECT id, 'geo-competitor-gap', 'GEO Competitor Gap', 10, 'pending',
  jsonb_build_object('website_url', website_url)
FROM brands WHERE user_id = '<user_id>';
```

### 8. Competitor gap: failed competitor fetches are silently dropped
If a competitor URL is unreachable (timeout, non-200, bad URL), it is filtered out with `.filter(c => c !== null)`. The analysis proceeds with however many competitors were successfully fetched. If all 3 fail, the route throws "Could not fetch any competitor sites." — but if 1 of 3 fails, the user gets no notification that a competitor was skipped.

### 9. llms.txt link regex misses relative links
The link counter uses `/\[.+?\]\(https?:\/\/.+?\)/g` — matches only absolute URLs. The llms.txt spec recommends absolute URLs, but some sites use relative paths. These would be missed in the link count and depth check.

---

## What could be improved

### Short term

**1. Fix the externalLinks bug**
Pass `origin` into `extractPageData` and filter correctly:
```typescript
return !href.startsWith(origin) && !href.startsWith('/')
```

**2. Validate AI discovery endpoint content**
After fetching, attempt `JSON.parse()` and check for at least one key. Only mark as present if it parses cleanly.

**3. Detect JS-rendered sites**
If `bodyText.length < 200` after stripping scripts/nav/footer, add a warning line to the rule context:
```
⚠ Site appears to be JS-rendered — content checks based on limited static HTML
```
Claude will then caveat its content findings accordingly.

**4. Notify when competitor fetch fails in gap analysis**
Return a `skippedCompetitors` array from the fetcher and surface it in the gap module's module-level detail so the user knows one of their URLs was unreachable.

### Medium term

**5. Split brand sentiment into a separate Claude call**
Brand sentiment items require a different mode of reasoning (introspection vs data analysis). A separate 2000-token Sonnet call for just the 4 sentiment items would prevent them from being crowded out when the main call is token-heavy.

**6. Add Perplexity API for brand sentiment**
Gate on `PERPLEXITY_API_KEY`. If present, query Perplexity with 3 brand questions:
- "What is [brand name]?"
- "What are the downsides of [brand name]?"
- "What are alternatives to [brand name]?"
Send the Perplexity responses as additional context for the sentiment Claude call. Gives a real-world AI output rather than just Claude's training knowledge.

**7. llms.txt generator as an action**
When `geo-llms-present` is false, the action currently just says "create /llms.txt". Instead, generate a complete, ready-to-deploy llms.txt file based on the page H1, meta description, and extracted headings. Return it as `ai_data` on the item so the dashboard can show a copy button.

**8. Historical GEO score tracking**
Store score per analysis run. Show a trend line: "GEO score: 34% → 41% → 58%" so users see progress as they implement fixes.

### Long term

**9. Real-time AI sentiment sampling**
Query multiple AI engines with 5 brand questions each. Aggregate responses. Detect negative framing patterns across engines. Currently only feasible with Perplexity API (OpenAI and Gemini do not expose grounded web search results via API in a way that reflects what users actually see).

**10. Continuous GEO monitoring via cron**
Schedule weekly `fetchGeoData` runs. Alert when a previously-passing item regresses — e.g. llms.txt disappears after a deploy, AI bots accidentally get blocked by a new robots.txt entry, schema gets removed.

**11. Auto-generate AI discovery endpoints**
When `/ai/summary.json`, `/ai/faq.json`, `/ai/service.json` are missing, generate the JSON content from page data and brand context. Open a GitHub PR that creates these files in the `public/` directory. Extends the existing fix-agent pattern used by the SEO module.

**12. GEO score as an unlock gate**
Currently GEO and GEO Competitor Gap are both always unlocked (`unlockThreshold: 0`). Consider gating Competitor Gap behind GEO ≥ 50% — makes no sense to compare against competitors if your own GEO fundamentals (llms.txt, schema, bot access) aren't in place.
