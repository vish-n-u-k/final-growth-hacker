# Brand Audit Module — Findings & Build Notes

## What is being built

Module 5 in the Growth Hacker module chain. Unlock threshold: 0 (available from onboarding alongside all other modules — threshold rule suspended for all modules in current phase).

A dynamic AI-driven brand audit across 9 categories. The fetcher collects structured data using Node.js tools (fetch, cheerio, natural, sentiment, compromise, Wikidata API, Flesch-Kincaid math). Claude receives pre-processed data and generates findings per category.

### Module chain position
```
Foundation (0) → Website (1) → SEO (2) → Competitor Analysis (3) → Social Media (4, TBD) → Brand Audit (5)
```

### Files to create
```
lib/modules/brand-audit/definition.ts    — 9 categories, dynamic mode, requirements
lib/modules/brand-audit/fetcher.ts       — HTML fetch + NLP pre-processing + Wikidata check
lib/modules/brand-audit/agent.ts         — deterministic checks + single Claude call
lib/modules/registry.ts                  — add BRAND_AUDIT_MODULE
app/api/modules/analyze/route.ts         — add case 'brand-audit'
```

### New npm packages needed
- `compromise` — noun-phrase extraction, replaces spaCy
- `sentiment` — VADER sentiment scoring, replaces nltk.vader

Everything else is either already installed (`natural`, `cheerio`) or pure math (Flesch-Kincaid).

---

## Categories (9)

| Order | Slug | Label |
|---|---|---|
| 1 | `brand-positioning` | Brand Positioning |
| 2 | `messaging-value-prop` | Messaging & Value Prop |
| 3 | `brand-voice` | Brand Voice |
| 4 | `brand-consistency` | Brand Consistency |
| 5 | `audience-fit` | Audience Fit |
| 6 | `trust-credibility` | Trust & Credibility |
| 7 | `ai-entity-visibility` | AI Search & Entity Visibility |
| 8 | `differentiation` | Differentiation |
| 9 | `brand-strength-score` | Brand Strength Score |

Item slugs follow pattern: `{category-slug}-{short-descriptor}` e.g. `brand-positioning-no-audience-in-h1`

---

## Data requirements (module requirements form)

| Key | Source | Auto-fill? |
|---|---|---|
| `website_url` | Brand record | Yes — from onboarding |
| `brand_name` | Brand record (`name`) | Yes — from onboarding |
| `industry` | Brand record | Yes — if filled in onboarding step 3 |
| `target_audience` | Brand record | Yes — if filled in onboarding step 3 |
| `usp` | Brand record | Yes — if filled in onboarding step 3 |
| `brand_voice` | Brand record | Yes — if filled in onboarding step 3 |
| `social_handles` | Optional user input | No — Social Media module not yet built |
| `competitor_usps` | Brain context | No — pulled from brain at analysis time if Competitor Analysis has run |

`social_handles` and `competitor_usps` are optional — module runs without them, Claude skips those comparisons and notes the data was unavailable.

---

## Python → Node.js library replacements

### 1. `requests` + `beautifulsoup4` → `fetch` + `cheerio`
**Status: Already implemented across all modules. No change.**

Used for: HTML crawling of homepage, About page, Pricing page, Privacy/Terms pages, social profile pages.

### 2. `spaCy` (NER, noun-chunks, tokenization) → `compromise` + cheerio
**Status: New package (`compromise`) + direct cheerio extraction.**

What spaCy was doing and what replaces it:

| spaCy task | Replacement |
|---|---|
| Extract brand name (ORG entity) | User already provided `brand_name` at onboarding — no extraction needed |
| Extract positioning category/audience from H1 | `cheerio` — `$('h1').text()` directly |
| Noun-phrase extraction from copy | `compromise` — `nlp(text).nouns().out('array')` |
| Tokenization | `natural` (already installed) |

### 3. `nltk.sentiment.vader` → `sentiment` npm package
**Status: New package (`sentiment`) — direct VADER port, same output format.**

Used for:
- Score website hero/body copy tone (positive/negative/neutral + numeric score)
- Score social media bio tone (if handles provided)
- Compute tone delta between website and social — if > 0.4, flag as inconsistent
- Pass numeric scores to Claude; Claude judges whether tone matches `brand_voice` input and target audience

Claude is NOT needed for the score computation — only for the contextual judgement ("casual tone detected, but your audience is enterprise CTOs — that's a mismatch").

### 4. `textstat` (Flesch-Kincaid readability) → pure math implementation
**Status: No package needed. ~15 lines of code in fetcher.**

Formula:
```
Flesch Reading Ease = 206.835 - 1.015 × (total words / total sentences) - 84.6 × (total syllables / total words)
```

Score interpretation:
- > 60: Plain English (pass)
- 30–60: Difficult (flag)
- < 30: Very difficult (critical flag)

Syllable counting: heuristic vowel-group counting (accurate enough for our purpose).
Computed in fetcher, passed as a number to Claude. Claude does not compute it.

### 5. `googlesearch-python` → SKIPPED
**Status: Not implemented. Affected checks become info-level.**

Reason: Scraping Google search results is blocked by CAPTCHAs and IP bans in serverless environments. Changes per region, login state, and HTML structure. Not reliable in production.

Affected checks and how they are handled:

| Original check | Handling |
|---|---|
| Google Knowledge Panel existence | Replaced by Wikidata API check (see #6) |
| People Also Ask (PAA) presence | Info-level — Claude tells user what to search and what to look for manually |
| `.edu` / `.gov` backlink count | Info-level — Claude directs user to Ahrefs free tier or Google Search Console |

### 6. `wikipedia-api` / Wikidata → Wikidata public REST API via `fetch`
**Status: Implemented with a single fetch call. No package, no API key.**

Endpoint:
```
https://www.wikidata.org/w/api.php?action=wbsearchentities&search={brand_name}&language=en&format=json
```

Logic:
- If results array is non-empty AND any result's description or sitelinks matches the user's domain → Knowledge Graph likely exists (verified: true)
- If empty → no entity found (verified: false)

Caveat: Common brand names may match unrelated Wikidata entries. Mitigated by checking if the result's website field or description contains the user's domain.

### 7. `yake` (keyword extraction) → `natural` TF-IDF
**Status: Already installed. Same approach as competitor analysis fetcher.**

Used for: Extract top 20 distinctive terms from homepage copy. Passed to Claude as a keyword fingerprint to reduce token usage. Claude handles the qualitative audience-fit judgement — not yake/natural.

### 8. `scikit-learn` TF-IDF cosine similarity → `natural` TF-IDF + cosine math
**Status: `natural` already installed. Cosine similarity implemented in ~10 lines.**

Used for:
- **USP vs competitor USP similarity** — deterministic. If cosine similarity > 0.85, flag as undifferentiated. Reliable bag-of-words comparison for short marketing phrases.
- **Audience fit** — NOT used here. Claude handles this — keyword overlap is too weak for semantic judgements like "does this copy speak to CTOs?"

---

## What is deterministic vs what Claude handles

| Check | Who does it |
|---|---|
| Wikidata Knowledge Graph existence | Fetcher (single API call, boolean result) |
| Flesch-Kincaid readability score | Fetcher (math formula, numeric result) |
| VADER sentiment score (website + social) | Fetcher (`sentiment` package, numeric score) |
| Tone delta between website and social | Fetcher (math: abs(score_a - score_b)) |
| TF-IDF keyword extraction | Fetcher (`natural`) |
| USP cosine similarity vs competitors | Fetcher (math on TF-IDF vectors) |
| Schema detection | Fetcher (cheerio) |
| Privacy/Terms page presence | Fetcher (cheerio link scan) |
| SSL / HTTPS | Fetcher (URL protocol check) |
| Social proof signals (testimonials, logos, G2 widgets) | Fetcher (cheerio + regex) |
| Brand name consistency across platforms | Fetcher (fuzzy string match) |
| **All qualitative judgements** | Claude |
| Positioning clarity ("is this clear in 5 seconds?") | Claude |
| Voice appropriateness for audience | Claude (uses VADER scores as input) |
| USP benefit vs feature language | Claude (uses regex counts as input) |
| Differentiation opportunity | Claude (uses cosine scores as input) |
| SWOT-style Brand Strength Score | Claude (synthesises all category findings) |

---

## Known limitations and skipped checks

1. **PAA / Google Knowledge Panel via search**: Cannot scrape Google. Knowledge Graph proxied via Wikidata. PAA is info-level only.

2. **Backlink counts (`.edu`/`.gov`)**: Requires paid API (Ahrefs, Moz, SEMrush). Info-level only — Claude tells user to check Ahrefs free tier manually.

3. **Social media bios**: Most platforms (Instagram, Facebook, TikTok, Twitter) are JS-rendered — static fetch returns very little. LinkedIn and YouTube have some static meta content. Tone analysis on social bios will be partial or skipped if handles return empty HTML. Social Media module (order 4) will provide this data via Brain when built.

4. **`competitor_usps`**: Only available if Competitor Analysis has run AND extracted USPs into brain context. If not available, differentiation category skips competitor comparison and focuses on internal uniqueness only.

5. **Brand Strength Score (category 9)**: The spec defines a 0–10 composite score with specific percentage weights per category. Since we make one Claude call for all 9 categories simultaneously, Claude generates the Brand Strength Score in the same pass — it doesn't see the other 8 categories' numeric scores first. Mitigation: pass a summary of all pre-computed signals (readability, sentiment delta, Wikidata result, cosine scores, schema count, social proof count) explicitly in the Brand Strength Score category prompt so Claude has the data to compute it.

6. **`social_handles` requirement**: Social Media module not yet built. Brand Audit accepts handles as optional input. If provided, fetcher attempts static fetch of profile pages. Most will return minimal HTML. Full social data will come from Brain once Social Media module runs.

7. **Brand name fuzzy matching**: Using Levenshtein distance for brand name consistency checks across platforms. May produce false positives for brands with very short names (< 4 chars).

---

## Onboarding changes made to support this module

- Added `industry`, `target_audience`, `usp`, `brand_voice` columns to `brands` table (SQL: `ALTER TABLE brands ADD COLUMN IF NOT EXISTS ...`)
- Updated `schema.ts` to include 4 new nullable columns
- Updated onboarding UI: step 2 of 2 → step 3 of 3. New step 3 collects industry, target audience, USP, brand voice. All optional with a Skip button.
- Updated `/api/onboarding` route: saves new fields to brand record; auto-fills any module requirement key that matches a brand field (`website_url`, `industry`, `target_audience`, `usp`, `brand_voice`)

---

## Module ordering and unlock thresholds

Threshold rule suspended for all modules in current development phase. All modules set to `unlockThreshold: 0`. Onboarding marks modules with `unlockThreshold === 0` as `pending` from the start.

Final chain (with thresholds to be configured later):
```
Foundation (0) → Website (1) → SEO (2) → Competitor Analysis (3) → Social Media (4, TBD) → Brand Audit (5)
```
