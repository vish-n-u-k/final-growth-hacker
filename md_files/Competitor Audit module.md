# Module: Competitor Analysis

## Metadata
- Type: competitor-analysis
- Name: Competitor Analysis
- Description: Discover competitors, compare keywords, content, SEO, social media, ads, positioning, and get a SWOT-based action plan.
- Order: 3
- Unlock threshold: 60
- Mode: dynamic

> **Architecture note:** Type is `competitor-analysis`. Our current DB has `competitor-audit` at order 3. Before building this, run a DB migration to rename the type or drop the old module rows and re-onboard. Do not run both simultaneously.

---

## Data requirements

- Key: website_url
  Label: Your website URL
  Type: url
  Required: yes
  Placeholder: https://yourbusiness.com
  Note: Auto-filled from brand record at onboarding.

- Key: competitor_urls
  Label: Competitor URLs (comma-separated)
  Type: url_list
  Required: no
  Placeholder: https://competitor1.com, https://competitor2.com
  Note: If left empty, Claude infers likely competitors from the user's homepage HTML and industry keyword. Accuracy is lower than user-provided URLs — show a warning in the UI when empty.

- Key: industry
  Label: Industry or main keyword
  Type: text
  Required: yes
  Placeholder: e.g. project management software
  Note: Used to anchor keyword analysis and competitor discovery. NOT auto-filled — must be collected either at onboarding (preferred) or as a module requirement input. Requires adding an `industry` field to the brand record or collecting it in the module requirements form.

---

## Data fetching

### What to fetch
All fetching is done in Node.js using `fetch` + `cheerio` (already installed). No Python libraries.

1. **User's homepage HTML**
   - URL: `requirements.website_url`
   - Method: GET
   - Auth: none
   - Format: HTML → parse with cheerio, extract head + body text (strip scripts/styles/nav/footer)
   - How much: full head + first 8000 chars of body text
   - Timeout: 15000ms
   - Fallback: throw error and abort analysis

2. **Each competitor's homepage HTML** (up to 5 URLs)
   - URL: each entry in `requirements.competitor_urls` (split by comma/newline)
   - Method: GET
   - Auth: none
   - Format: HTML → same extraction as user's site
   - How much: full head + first 6000 chars of body text per competitor
   - Timeout: 10000ms per competitor
   - Fallback: if a competitor URL fails to fetch, skip it and continue with the rest. Flag it in findings as "could not be verified".

3. **PageSpeed Insights — user's site** (optional but recommended)
   - URL: `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url={website_url}&strategy=mobile`
   - Method: GET
   - Auth: none for up to 25k requests/day. Add `&key={GOOGLE_PSI_API_KEY}` if env var is set.
   - Format: JSON
   - Fields to extract: `categories.performance.score`, `audits.largest-contentful-paint.numericValue`, `audits.cumulative-layout-shift.numericValue`, `audits.total-blocking-time.numericValue`
   - Timeout: 20000ms
   - Fallback: if PSI call fails, skip performance comparison — mark SEO gap performance items as info-level in the prompt

4. **PageSpeed Insights — each competitor** (optional, same as above)
   - Run in parallel with the user's PSI call
   - Same fallback: skip if it fails

### What to do if fetch fails
- User's homepage: throw — analysis cannot proceed without the user's own data
- Competitor URL: skip that competitor, continue with others. Include a note in the prompt so Claude flags it.
- PSI calls: skip silently — Claude will note that performance data was unavailable

### Structured result shape

```typescript
interface CompetitorAnalysisFetchResult {
  userUrl: string
  userHtml: string                          // stripped head + body text
  userPsi: PsiScore | null                  // null if PSI call failed

  competitors: {
    url: string
    html: string                            // stripped head + body text, empty string if fetch failed
    psi: PsiScore | null
    fetchFailed: boolean
  }[]

  industry: string                          // from requirements
  competitorsProvided: boolean              // false = user left competitor_urls empty
}

interface PsiScore {
  performance: number       // 0–100
  lcp: number               // ms
  cls: number               // 0–1
  tbt: number               // ms (proxy for FID)
}
```

---

## System prompt

You are an expert competitor analyst embedded in a growth audit tool. Your tone is direct, specific, and consultant-like. You receive the user's website content, up to 5 competitor websites, their performance scores, and an industry keyword.

**Your job:** Produce a dynamic checklist covering 8 categories. For each category, generate 3–8 findings based only on what you can observe from the data provided.

**Rules:**
1. Only report what you can verify from the HTML and PSI data provided. Do not fabricate competitor capabilities.
2. Every finding must have a specific, non-generic action. Bad: "improve your SEO". Good: "Add alt text to the 8 product images on your homepage — competitor X has alt text on all images."
3. If competitor HTML is empty (fetch failed), note "could not fetch [URL]" but still include the competitor in the discovery category.
4. If competitor URLs were not provided by the user, infer 3–5 likely competitors from the user's homepage content and the industry keyword. Be explicit that these are inferred, not confirmed.
5. If PSI data is missing, skip numeric performance comparisons — do not invent scores.
6. Weight assignment:
   - 3 (Critical): Gap directly costs revenue, customers, or rankings (no SSL, competitor runs ads you don't, blocking indexation)
   - 2 (Important): Gap measurably hurts performance (page speed >30 points worse, missing schema, major keyword gap)
   - 1 (Minor): Nice-to-have (single missing hashtag, low-volume keyword, minor copy difference)
7. verified: true = no actionable gap (user is at parity or ahead). verified: false = gap exists, action needed.
8. Slug format: `{category-slug}-{short-descriptor}` e.g. `keyword-gap-predictive-scoring`

---

## Categories

### 1. Competitor Discovery
Slug: competitor-discovery

Category prompt:
Based on the user's homepage HTML and the industry keyword provided, identify the direct competitors. If the user provided competitor URLs, verify each one is a real competitor (they target the same audience, offer similar products/services). If no URLs were provided, infer 3–5 likely competitors from the homepage content and industry keyword — flag these as inferred. For each competitor, generate one finding: why they are a competitor (e.g. "targets same keyword cluster", "offers similar feature set", "outranks user for [keyword]"). Mark verified: true if the competitor was confirmed from provided URLs or clearly inferable. Mark verified: false if the competitor could not be fetched or is uncertain. Action for each: "Review [URL] — focus on their [specific observed strength]."

### 2. Keyword Gap
Slug: keyword-gap

Category prompt:
Extract the main keyword phrases (2–4 word phrases) from the user's title tag, H1, H2s, and meta description. Do the same for each competitor. Identify keywords that appear prominently in competitor headings and meta tags but are absent from the user's site. Prioritise multi-word commercial-intent phrases over single generic words. For each gap keyword, generate one finding. Weight by how competitive and relevant the term appears. Action: "Create a landing page or blog post targeting '[keyword]'. Competitor [URL] ranks for this term."

### 3. Content Gap
Slug: content-gap

Category prompt:
Compare the visible body content of the user's site against competitors. Identify content themes, topics, or formats present in competitor body copy (e.g. comparison pages, case studies, pricing breakdowns, FAQs, integration lists, customer testimonials with specifics) that are missing from the user's site. For each gap, suggest a specific content format. Action: "Competitor X has a detailed comparison page vs. their top alternatives. You have no such page. Create a '[Your Product] vs [Competitor]' page targeting users in the decision stage."

### 4. SEO Gap
Slug: seo-gap

Category prompt:
Compare the following technical SEO signals between the user's site and each competitor, using the HTML and PSI data provided:
- Page speed score (mobile) — if PSI data available; flag if competitor is >20 points higher
- Meta title: present and well-formed?
- Meta description: present and well-formed?
- H1: present, single, keyword-relevant?
- Image alt text: proportion of images with non-empty alt
- Schema markup: JSON-LD or microdata detected?
- robots.txt / sitemap.xml: note if mentioned in the HTML (cannot verify externally)
- Internal link count: number of same-domain links in body

For any metric where a competitor is materially better, generate a finding with a specific fix. Do not report a gap if both the user and competitor are equally weak.

### 5. Social Media Gap
Slug: social-gap

Category prompt:
Scan the user's homepage HTML and each competitor's HTML for links to social platforms. Look for these patterns: `instagram.com/`, `facebook.com/`, `linkedin.com/company/`, `twitter.com/`, `x.com/`, `tiktok.com/@`, `youtube.com/`, `pinterest.com/`. For each platform where a competitor has a visible link but the user does not, create a finding. If the user has the same platforms, check whether the link is in the header (prominent) vs footer (less prominent). Action: "Competitor is visibly linked to TikTok in their header. You have no TikTok presence. Create a business account and post 3 short videos this month."

### 6. Ad Strategy Gap
Slug: ad-gap

Category prompt:
Scan the HTML source of the user's site and each competitor's site for tracking pixels and ad network scripts. Look for:
- Google Tag Manager: `googletagmanager.com/gtm.js`
- Google Ads: `googleads.g.doubleclick.net`
- Facebook/Meta Pixel: `connect.facebook.net` or `fbq(`
- LinkedIn Insight: `snap.licdn.com`
- TikTok Pixel: `analytics.tiktok.com`

For each ad network present in a competitor's HTML but absent in the user's, generate a finding. Note: pixel presence in HTML means the competitor is running (or has previously run) paid campaigns on that network. Action: "Competitor has Facebook Pixel installed — they are running or testing Meta retargeting ads. Install Facebook Pixel on your site this week and set up a small retargeting campaign ($50–100) for visitors who viewed your pricing page."

### 7. Market Positioning
Slug: positioning

Category prompt:
Extract the user's apparent positioning from: their H1, the first paragraph of body text, and their meta description. Do the same for each competitor. Identify the key positioning claims each site makes (e.g. "affordable", "enterprise-grade", "fastest", "easiest", "24/7 support", "no-code"). Compare the user's positioning against competitors. Highlight one clear differentiation opportunity — something no competitor claims that the user could own, OR something the user claims but doesn't back up with evidence on the page. Action: "You claim '[X]' but provide no proof on your homepage. Competitor Y backs their claim with '[specific social proof]'. Add a specific data point or testimonial to your hero section."

### 8. SWOT Analysis
Slug: swot

Category prompt:
Synthesise all findings from the previous 7 categories into a SWOT. Use only what the data showed — do not add external knowledge.
- Strengths: areas where the user is at parity or ahead of competitors (e.g. faster page speed, more social platforms linked, stronger positioning clarity)
- Weaknesses: categories where competitors clearly lead (e.g. missing keywords, no schema, no ad pixels)
- Opportunities: high-impact gaps that are quick to fix (e.g. missing alt text, add one meta tag, create one content page)
- Threats: competitor advantages that could capture market share (e.g. they have paid ad infrastructure running, stronger keyword coverage, more content depth)

Output 3–4 bullets per quadrant. Then provide a prioritised 30/60/90 day action plan using only the findings from this analysis. Language must be non-technical. Example format: "Week 1: Add meta descriptions to your 5 key pages (30 min). Week 2–4: Create a comparison landing page targeting '[keyword]' (competitor X ranks #1 for this)."

---

## Logic & integrations (Node.js/TypeScript)

This module runs entirely in Node.js. No Python dependencies.

### Pipeline

1. **Fetch phase** (fetcher.ts)
   - `fetch` + cheerio to extract head and body text from user's site and up to 5 competitor URLs
   - Run all competitor fetches in parallel with `Promise.allSettled`
   - Run PSI API calls in parallel: user + each competitor (or skip if `GOOGLE_PSI_API_KEY` not set and free tier is exhausted)
   - Return `CompetitorAnalysisFetchResult`

2. **AI phase** (agent.ts)
   - Build one large prompt with all fetched data: user HTML, each competitor HTML + PSI, industry keyword
   - Single Claude call with all 8 category prompts embedded
   - Claude returns JSON array of `DynamicModuleAnalysisResult[]`
   - Validate slugs follow `{category-slug}-{descriptor}` pattern

3. **Storage** (analyze route)
   - Upsert findings into `module_items` keyed by slug
   - Score computation: sum of verified item weights / total weights × 100
   - Unlock next module if score ≥ next module's unlock threshold

### Environment variables
- `GOOGLE_PSI_API_KEY` — optional. Without it, PSI calls use the free unauthenticated tier (25k requests/day shared across all users). Add the key if volume becomes an issue.

### Dependencies
- `cheerio` — already installed
- `fetch` — Node.js built-in
- No new npm packages required

---

## Foreseeable issues (developer notes)

1. **Competitor auto-discovery is Claude-based, not search-based**
   The original MD assumed `googlesearch-python` to run real Google searches. In our stack, Claude infers competitors from homepage content. This is less reliable — Claude may hallucinate plausible-sounding competitors that don't exist or aren't real competitors. Mitigation: always show inferred competitors with a clear "inferred — not verified" label and let the user edit.

2. **JS-rendered competitor sites return near-empty HTML**
   Competitors using React/Next.js/Vue SPAs will have little visible content in a static fetch. Keyword and content gap analysis will be inaccurate for those sites. No fix without headless browser (Playwright/Puppeteer) — not suitable for serverless. Mitigation: Claude should flag when a competitor HTML is suspiciously short.

3. **`industry` field not in current brand schema**
   The `brands` table has no `industry` column. Either add it to the onboarding flow (preferred — ask "What industry are you in?") or collect it as a module requirement input at analysis time. If it's a module requirement, it won't auto-fill and users must type it before every analysis.

4. **PSI API timeout adds to total analysis time**
   PSI calls take 10–25 seconds each. With 6 URLs (user + 5 competitors), that's up to 6 parallel PSI calls. Even in parallel, slowest call could take 25 seconds. Combined with HTML fetching and the Claude call, total analysis time could approach the 90-second `maxDuration`. Mitigation: cap PSI to user + top 2 competitors only, or make PSI optional and run it only if `GOOGLE_PSI_API_KEY` is set.

5. **Competitor HTML bot blocking**
   Well-known competitor sites (Notion, Linear, Stripe, etc.) actively block scrapers with Cloudflare, rate limiting, or CAPTCHAs. Fetch will return a 403, CAPTCHA page, or empty response. Mitigation: handle gracefully — flag as "could not fetch" and skip that competitor's HTML-based checks.

6. **Token volume**
   5 competitor HTML snippets at 6000 chars each = 30,000 chars of competitor content + 8000 chars of user content + PSI JSON + 8 category prompts. Total prompt could reach 50,000+ tokens. Monitor Claude costs — this is the most expensive module per analysis call.

7. **SWOT synthesis quality**
   The SWOT category asks Claude to synthesise all previous findings. Since we make one Claude call for all 8 categories, Claude generates SWOT in the same pass without actually "seeing" the other category results yet. The SWOT will be based on whatever patterns Claude notices in the raw fetched data, not a true aggregation of the checklist results. Mitigation: pass a summary of the top findings from the other 7 categories explicitly in the SWOT prompt section.

8. **Type collision with existing `competitor-audit` module**
   The current codebase has `competitor-audit` registered in the module registry at order 3. This new spec uses `competitor-analysis`. Before building, either rename the existing module type or remove it. Switching types requires a DB migration for existing users.

---

## Slug rules
- All slugs: kebab-case, lowercase, no spaces
- Category slugs: `competitor-discovery`, `keyword-gap`, `content-gap`, `seo-gap`, `social-gap`, `ad-gap`, `positioning`, `swot`
- Item slugs (generated dynamically by Claude): `{category-slug}-{short-descriptor}` — e.g. `keyword-gap-predictive-scoring`, `ad-gap-no-facebook-pixel`
- Slugs must be stable across re-runs for the same finding

## Weight guide
- **3 – Critical**: Gap directly blocks revenue, traffic, or conversions
- **2 – Important**: Gap measurably hurts performance
- **1 – Minor**: Nice-to-have

## Fixable flag
Dynamic module — `fixable` is always false. Claude should still write specific, immediately actionable steps that a non-technical user can complete within a week.
