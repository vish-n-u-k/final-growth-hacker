# Module Audit — Complete vs Incomplete
Tracking what's built vs what the spec MD files describe, module by module.

---

## Module 1 — Foundation

### Complete
- Site accessible (200 OK check)
- HTTPS / SSL active (URL prefix check)
- Custom domain check (detects free hosting subdomains: Vercel, Netlify, GitHub Pages, etc.)
- No-noindex check (robots meta tag)
- Mobile viewport tag check
- Homepage content / no placeholder check
- GA4 / GTM detection from script tags
- Google Search Console verification (meta tag)
- PostHog detection from script tags
- Privacy policy link check
- Contact information check
- Value proposition clarity check
- CTA detection
- Favicon presence check
- Brand color extraction from favicon (via sharp)
- Business name / page title check
- Social profile link detection (Instagram, LinkedIn, Twitter/X, Facebook, YouTube, TikTok, Pinterest)
- Social links auto-saved to brandIntegrations on analysis
- Free hosting detection for 17 platforms

### Incomplete / Not Built

- **Playwright / headless browser rendering** — plain fetch used instead; JS-rendered sites return empty HTML
  - Why: Playwright can't run on Vercel serverless; needs dedicated worker infrastructure

- **Lighthouse FCP / LCP / CLS (Core Web Vitals)** — no performance metrics
  - Why: Lighthouse requires a long-running Node process; can't run serverless
  - Fix path: Use Google PageSpeed Insights API (free, no infra needed)

- **SSL certificate expiry date** — only checks HTTPS prefix, not actual cert expiry
  - Why: Needs `ssl-checker` library or TLS handshake inspection; not installed
  - Fix path: Call a free public SSL check API or add `ssl-checker` package

- **WHOIS domain expiry check** — not built
  - Why: `whoiser` not installed; WHOIS lookups need a DNS layer
  - Fix path: Call a free WHOIS API (e.g. whoisjson.com) — no native dependency needed

- **DNS record checks (A, MX, NS)** — not built
  - Why: No DNS library installed

- **Wappalyzer tech stack detection** — not built
  - Why: Requires running full fingerprint dataset against headers + HTML; heavy dependency

- **AI industry / USP / audience inference** — not built (MD suggests local BART/spaCy models)
  - Why: Current architecture uses Claude only for static pass/fail checks, not for brand inference
  - Note: Could be added as a dynamic finding in the agent prompt cheaply

- **Competitor auto-detection from "vs" mentions** — not built
  - Why: Competitor Analysis module handles this separately

- **Social follower counts / post frequency / engagement** — not built
  - Why: Requires scraping individual platform pages; brittle and frequently blocked

- **UTM parameter detection** — not built (easy to add)
  - Fix path: Regex scan on all `href` values in the fetcher — ~10 lines

- **Mixed content detection (HTTP resources on HTTPS page)** — not built (easy to add)
  - Fix path: Scan `<img src>`, `<script src>`, `<link href>` for `http://` — already have the HTML

- **Campaign / channel analysis** — not built
  - Why: Requires actual referrer/analytics data; not available from HTML

- **Async job endpoint** — not built (synchronous only)
  - Why: maxDuration=90s handles timing within Vercel limits for now

---

## Module 2 — Website Audit

### Complete
- All 8 categories fully implemented as a rule engine (`lib/audit/audit.ts`) — no AI needed for checks
- **UX & UI**: title tag (length check), H1 count, viewport meta, inline styles count
- **Navigation & Structure**: nav landmark, internal link count, descriptive anchor text, external link safety (noopener)
- **Page Speed**: server response time, HTML payload size, gzip/Brotli compression, image dimension attributes
- **Mobile Friendliness**: viewport config, fixed-width inline style detection, media queries in inline styles
- **Trust Signals**: HTTPS check, SSL cert validity + expiry days (via Node TLS), security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy), privacy/contact link detection
- **Conversion (CRO)**: CTA presence, CTA language strength (benefit-led patterns), above-fold CTA proxy, social proof signals (testimonials/reviews/ratings/customer counts)
- **Forms & CTAs**: labelled inputs, form field count, submit button presence, placeholder-as-label detection
- **Technical Health**: meta description (length), canonical URL, Open Graph tags (title/desc/image), image alt text, robots.txt, sitemap.xml, JSON-LD structured data, HTML lang attribute
- Lighthouse integration auto-detected via `which lighthouse` — if CLI is installed, adds FCP, LCP, TBT, CLS, performance score
- SSL cert expiry implemented (Node `tls` module — actual TLS handshake, not just URL prefix)
- Redirect following — captures `final_url` after redirects
- Overall score (0–100) + per-section scores + action count

### Incomplete / Not Built

- **Lighthouse in production** — auto-detection works but Lighthouse CLI is never installed in Vercel serverless; Core Web Vitals will always be missing in production
  - Fix path: Use Google PageSpeed Insights API (free, no install needed) as a fallback when `which lighthouse` fails

- **Color contrast analysis** — not built
  - Why: Requires a rendered DOM with computed CSS; static HTML parsing cannot determine actual rendered colors. Excluded by spec design (marked as `info` not scored)

- **Tap target size analysis** — not built
  - Why: Same reason — requires rendered layout. Excluded by spec design

- **External CSS/JS asset audit** — not checked (unminified assets, render-blocking scripts)
  - Why: Would require fetching each external asset URL; not in spec scope

- **Redirect chain detection** — only follows to final URL, doesn't flag long redirect chains
  - Fix path: Easy addition — count redirect hops during fetch

---

## Module 3 — SEO Audit

Rule-based + AI-augmented audit across meta tags, headings, images, internal links, schema, and technical SEO. 81 static items. Claude generates business-impact narratives for failing items only.

---

**Rule-based audit engine (meta tags, headings, images, internal links, schema, technical)**
Specified: ✅ Yes
Built: ✅ Yes — 81 static items across 6 categories; seo-audit.ts deterministic checks via Cheerio + Node TLS + fetch

**Multi-page crawl**
Specified: ✅ Yes — spec requires checking all crawled pages (duplicate titles, orphan pages, link graph)
Built: ❌ No
Reason: BFS crawler would require sequential HEAD requests to all internal links; too slow for a 90s Vercel serverless function; homepage-only fetch used instead

**Core Web Vitals via PageSpeed Insights API**
Specified: ✅ Yes — spec explicitly says "Fetch real Core Web Vitals from PageSpeed Insights API (mobile strategy)"
Built: ❌ No — Lighthouse CLI auto-detection used; CWV items always return info-level on Vercel (no Chrome)
Reason: GOOGLE_PSI_API_KEY env var not added; PSI API call not implemented; PSI would be a direct drop-in replacement

**Duplicate title / description detection across pages**
Specified: ✅ Yes — spec: "Flag duplicates across pages — Critical when titles/descriptions are identical for different URLs"
Built: ❌ No — title.unique and description.unique always return info-level
Reason: Requires multi-page crawl to compare across pages; single-page fetch cannot detect duplicates

**Orphan page detection**
Specified: ✅ Yes — spec: "Identify pages with inbound count = 0"
Built: ❌ No — links.orphan always returns info-level
Reason: Requires building a full site link graph from a multi-page crawl

**Click depth analysis (pages within 3 clicks)**
Specified: ✅ Yes — spec: "Calculate click depth from homepage"
Built: ❌ No — links.depth always returns info-level
Reason: Requires crawling and tracking hop count from homepage; not possible from single-page fetch

**Sitemap URL validation**
Specified: ✅ Yes — spec: "Parse sitemap, fetch a sample of URLs; Pass if all return 200"
Built: ❌ No — sitemap.valid always returns info-level
Reason: Not implemented; would need to parse sitemap XML and HEAD-request ~20 sample URLs

**Schema dynamic recommendation with JSON-LD code generation**
Specified: ✅ Yes — spec describes schema as a dynamic module that generates valid, copy-pasteable JSON-LD for the page
Built: ❌ No — static checks only (present / valid / type match); no JSON-LD generation
Reason: Generating correct JSON-LD requires a dynamic Claude call with page content; built as static pass/fail checks instead

**Keyword Research as standalone dynamic module**
Specified: ✅ Yes — spec defines it as a separate dynamic module with discovery, clustering, opportunity scoring, and content gap categories
Built: ❌ Partial — merged into SEO Audit as static kw-* items with AI prompts; no volume, difficulty, or clustering data
Reason: Volume and difficulty data requires third-party APIs (Ahrefs, Semrush, DataForSEO); not available; Google Autocomplete used as a free substitute

**Keyword Opportunities Synthesis module**
Specified: ✅ Yes — spec defines a separate synthesis module with embedding-based page assignment, cross-module blocker detection, and opportunity prioritization
Built: ❌ No
Reason: Requires cosine similarity over page embeddings and cross-module data aggregation; significant infrastructure not built

**Content Brief Generation**
Specified: ✅ Yes — spec: 10-section content brief per new/expanded page (title variants, heading outline, word count, internal link plan, schema)
Built: ❌ No
Reason: Depends on Keyword Opportunities Synthesis module which is not built

**GSC API integration (ranking data)**
Specified: ✅ Yes
Built: ✅ Yes — gsc_api brandIntegration; top queries, quick-win keywords (positions 4–20), low-CTR keywords

**SerpAPI integration (People Also Ask)**
Specified: ✅ Yes — PAA mentioned as SERP feature data source
Built: ✅ Yes — optional serpapi brandIntegration; PAA questions injected into kw-user-questions prompt

**AI narrative generation for failing items**
Specified: ✅ Yes
Built: ✅ Yes — single Claude batch call at end of seo-audit; generates ai_narrative for all failing items only

**Link Building section (directories, review platforms, communities, press)**
Specified: ❌ No — not in spec
Built: ✅ Yes — added beyond spec; 15 items across Product Hunt, Futurepedia, G2, Capterra, Hacker News, Reddit, Ben's Bites, etc.

**Google Autocomplete keyword suggestions**
Specified: ❌ No — spec uses crawl data + GSC only
Built: ✅ Yes — added beyond spec; Autocomplete fetched for use-case, comparison, question, and modifier variants; injected into keyword research prompts

---

## Module 4 — Competitor Analysis

Dynamic module. Fetches user + up to 5 competitor homepages, runs TF-IDF keyword fingerprinting and PSI scores, then Claude generates findings across 9 categories. Two implementations exist: `competitor-audit` (older, requires URLs) and `competitor-analysis` (newer, URLs optional).

---

**Competitor Discovery (identify, classify competitors)**
Specified: ✅ Yes
Built: ✅ Yes — fetches up to 5 competitor homepages; Claude classifies direct/indirect/aspirational from HTML content

**Auto-discovery via Google Search (no URLs provided case)**
Specified: ✅ Yes — spec says use googlesearch-python to find competitors from industry keyword
Built: ❌ Partial — when no URLs given, Claude infers competitors from the user's own homepage and industry text; no actual Google Search call made
Reason: googlesearch-python is a Python library; no free Node.js Google Search API equivalent without a key; Claude inference used as substitute

**TF-IDF keyword fingerprinting (content + keyword gap)**
Specified: ✅ Yes — spec uses scikit-learn TF-IDF
Built: ✅ Yes — implemented with natural (Node.js TF-IDF library); extracts top 20 terms per site, injected into Claude prompts

**PageSpeed Insights for SEO performance comparison**
Specified: ✅ Yes — spec explicitly requires PSI API (mobile strategy)
Built: ✅ Yes — PSI called for user + top 2 competitors in parallel; GOOGLE_PSI_API_KEY optional (free tier without key)

**Ad pixel detection (GTM, Facebook, LinkedIn, TikTok)**
Specified: ✅ Yes — spec: detect ad network scripts and tracking pixels in HTML
Built: ✅ Yes — regex patterns for GTM, Google Ads doubleclick, Facebook pixel (fbq), LinkedIn Insight, TikTok analytics

**Meta Ads Library / Google Ads Transparency integration**
Specified: ✅ Yes — spec mentions checking competitor ad creatives and spend via Ads Library
Built: ❌ No — social-gap and ad-gap categories marked comingSoon; no API calls to Meta Ads Library or Google Ads Transparency
Reason: Meta Ads Library requires an access token; Google Ads Transparency has no public API; both need user auth flows not yet built

**Social media follower counts**
Specified: ✅ Yes — spec: "optionally check follower count using public profile scraping"
Built: ❌ No — social link presence detected from HTML href patterns only; no follower count scraping
Reason: Follower count scraping requires platform-specific DOM parsing which is brittle and frequently blocked

**pytrends keyword volume for gap prioritization**
Specified: ✅ Yes — spec uses pytrends to prioritize missing keywords by search demand
Built: ❌ No
Reason: pytrends is a Python library; no free Node.js equivalent; gaps ranked by Claude using TF-IDF signal only

**Keyword Gap analysis**
Specified: ✅ Yes
Built: ✅ Yes — TF-IDF top terms + meta/heading data passed to Claude; Claude identifies commercial-intent terms competitors target that user doesn't

**Content Gap analysis**
Specified: ✅ Yes
Built: ✅ Yes — cleaned body text compared via TF-IDF; Claude identifies content themes and formats missing from user's site

**SEO Gap analysis**
Specified: ✅ Yes
Built: ✅ Yes — meta, H1 structure, alt coverage, schema presence, internal link count, PSI scores passed to Claude for comparison

**Feature Comparison category**
Specified: ✅ Yes (in updated spec)
Built: ✅ Yes — Claude extracts feature categories from nav/section headings and compares across competitors

**Market Positioning analysis**
Specified: ✅ Yes
Built: ✅ Yes — H1, first paragraph, meta description extracted for user and each competitor; Claude identifies positioning claims and differentiation gaps

**SWOT synthesis**
Specified: ✅ Yes
Built: ✅ Yes — final category always produces exactly 4 items: swot-strength, swot-weakness, swot-opportunity, swot-threat

**Competitor registry (persist discovered competitors for other modules)**
Specified: ❌ Not in spec
Built: ✅ Yes — competitor-discovery findings stored in registry; auto-populated into outreach-targets and other modules

---

## Module 5 — Social Media Audit

Dynamic 3-tier module. Tier 1: homepage social link detection (no input needed). Tier 2: handle extraction from user-provided profile URLs. Tier 3: full metrics via platform API integrations. The spec file for this order slot describes a Community Finder (Facebook/LinkedIn group discovery) — what was built is a social media profile audit instead.

---

**Homepage social link detection (Tier 1)**
Specified: ❌ Not in spec — spec describes community discovery, not a profile audit
Built: ✅ Yes — added beyond spec; detects 8 platforms (Instagram, Twitter, Facebook, LinkedIn, YouTube, TikTok, Pinterest, Threads) from homepage href attributes

**Profile URL → handle extraction and og:title scraping (Tier 2)**
Specified: ❌ Not in spec
Built: ✅ Yes — extracts handle from user-provided URLs; scrapes og:title from public YouTube, LinkedIn, Facebook pages (these are not JS-gated)

**YouTube Data API v3 integration (Tier 3)**
Specified: ❌ Not in spec
Built: ✅ Yes — subscribers, total video count, last 10 video timestamps, posts/week, bio, custom URL

**Twitter/X API v2 integration (Tier 3)**
Specified: ❌ Not in spec
Built: ✅ Yes — followers, following, tweet count, bio, website-in-bio; no last post date (timeline requires elevated access)

**Instagram Graph API integration (Tier 3)**
Specified: ❌ Not in spec
Built: ✅ Yes — followers, post count, engagement rate from last 20 posts (likes + comments), bio, website in bio, last post date, posts/week

**Facebook Graph API integration (Tier 3)**
Specified: ❌ Not in spec
Built: ✅ Yes — page fan/follower count, engagement rate from last 20 posts, bio, last post date, posts/week

**LinkedIn API v2 integration (Tier 3)**
Specified: ❌ Not in spec
Built: ✅ Partial — follower count and bio only; no post data, no engagement rate
Reason: LinkedIn API restricts post-level data for organizations; feed/engagement data requires Marketing Developer Platform approval (not publicly available)

**TikTok Open API v2 integration (Tier 3)**
Specified: ❌ Not in spec
Built: ✅ Partial — follower/following/video counts and bio only; no last post date, no engagement rate
Reason: TikTok API v2 user info endpoint does not return per-video timestamps or like counts; video list endpoint requires additional scope not yet implemented

**Facebook Groups / LinkedIn Groups discovery**
Specified: ✅ Yes — core feature of spec; keyword search, member count, activity rate, competitor absence scoring, ranked list
Built: ❌ No — Community Finder category in social-media module marked comingSoon; separate community-finder module (order 13) also marked comingSoon
Reason: Facebook Groups API is in restricted review and not publicly available; LinkedIn Groups search API was deprecated

**Social listening / community sentiment analysis**
Specified: ✅ Yes — spec: read group posts to extract pain points, culture indicators, common questions
Built: ❌ No
Reason: Depends on Facebook Groups API (unavailable) and LinkedIn Groups access (deprecated)

**Engagement strategy generator (community-specific templates)**
Specified: ✅ Yes — spec: custom conversation starters and post templates per community
Built: ❌ No
Reason: Depends on community discovery which is not built

**Performance / ROI tracker**
Specified: ✅ Yes — spec: track engagement results per community over time, optimize effort allocation
Built: ❌ No
Reason: Requires persistent community membership records and follow-up data collection; not built

**Relevance scoring for community ranking**
Specified: ✅ Yes — spec formula: keyword matches × 30% + member count × 20% + activity rate × 30% + competitor absence × 20%
Built: ❌ No
Reason: Depends on community discovery data which is unavailable

---

## Module 6 — Brand Audit

Dynamic module. Fetches homepage, runs NLP (readability, sentiment, TF-IDF, benefit/feature language, trust signals, schema, Wikidata) in Node.js. Claude generates findings across 9 categories. All 9 categories are built.

---

**Brand Positioning analysis (H1, meta, hero copy)**
Specified: ✅ Yes
Built: ✅ Yes — H1, meta description, og:title, first paragraph, hero copy extracted; TF-IDF keywords; audience mention count; all passed to Claude

**Flesch Reading Ease readability score**
Specified: ✅ Yes — spec: textstat library
Built: ✅ Yes — implemented natively (no package); pure math on syllable count, word count, sentence count

**Sentiment analysis for brand voice and tone delta**
Specified: ✅ Yes — spec: VADER via nltk
Built: ✅ Yes — sentiment npm package (AFINN-based, equivalent to VADER); tone delta between website and social profiles computed

**TF-IDF keyword extraction**
Specified: ✅ Yes — spec: yake keyword extraction
Built: ✅ Yes — natural TF-IDF (different library, same output); top 20 keywords from body copy

**Benefit vs feature language counting**
Specified: ✅ Yes — spec: regex dict for benefit vs feature triggers
Built: ✅ Yes — regex patterns for benefit words (save, grow, boost, etc.) and feature words (dashboard, API, integration, etc.)

**Trust signal detection**
Specified: ✅ Yes
Built: ✅ Yes — testimonial count, social proof count, client logo count, case study link, review widget (G2/Capterra/Trustpilot), team page, privacy page, terms page

**Wikidata entity check**
Specified: ✅ Yes
Built: ✅ Yes — free Wikidata search API; loose name match; no key required

**Social profile bio fetching and tone delta**
Specified: ✅ Yes — spec: scrape social bios, compare tone
Built: ✅ Yes — fetches og:description / meta description from provided social URLs; sentiment per profile; tone delta = |website sentiment − avg social sentiment|

**Schema type extraction for AI entity visibility**
Specified: ✅ Yes
Built: ✅ Yes — extracts @type from all JSON-LD blocks including @graph arrays

**Comparison page detection**
Specified: ✅ Yes
Built: ✅ Yes — scans all hrefs for /vs-, /compare, /alternatives patterns

**Brand Strength Score (0–10 composite)**
Specified: ✅ Yes
Built: ✅ Yes — final category always produces exactly 2 items: overall score + 30/60/90 day action plan

**spaCy NER + noun-chunk extraction for positioning**
Specified: ✅ Yes — spec: spaCy to extract category and audience from copy
Built: ❌ No — Claude infers positioning quality from raw copy; no structured NER
Reason: spaCy is a Python library; no Node.js NER equivalent with the same accuracy

**Competitor USP cosine similarity**
Specified: ✅ Yes — spec: competitor_usps JSON from Competitor Audit, TF-IDF cosine similarity to detect undifferentiated positioning
Built: ❌ No — fetcher does not receive competitor USP data; differentiation category relies on Claude reasoning only
Reason: Would require querying competitor audit results from DB and passing them in; wiring not implemented

**Multi-page crawl (About Us, Company page)**
Specified: ✅ Yes — spec: crawl homepage + About Us + Company page
Built: ❌ No — homepage only
Reason: Multi-page crawl not implemented; serverless time constraints

**Google Knowledge Panel / PAA / .edu backlinks**
Specified: ✅ Yes — spec: googlesearch-python for Knowledge Graph, PAA, .edu backlink counts
Built: ❌ No — Wikidata used as Knowledge Panel proxy; PAA and .edu backlinks not checked
Reason: googlesearch-python is a Python library; no reliable Node.js Google scraping approach without rate-limit risk

---

## Module 7 — Content Audit

Dynamic module. Multi-page crawl (sitemap + internal link fallback, up to 50 pages). Per-page metadata extraction. 7 categories across 3 parallel Claude calls. Deterministic verdict engine (no AI for page verdicts). Special pipeline in route.ts.

---

**Multi-page crawl (sitemap + internal link fallback)**
Specified: ✅ Yes
Built: ✅ Yes — parses sitemap.xml (including sitemap index, depth 2), falls back to homepage internal link extraction; up to 50 pages; URL filtering removes API/auth/asset routes; high-priority marketing pages fetched first

**Per-page metadata extraction (title, meta, H1, word count, images, internal/external links)**
Specified: ✅ Yes
Built: ✅ Yes — extracted for every page; body text stripped of script/style/nav/header/footer before word count

**Competitor page analysis**
Specified: ✅ Yes
Built: ✅ Yes — up to 5 competitor homepages fetched; title, meta, H1, word count, body excerpt passed to Claude for gap analysis

**Tech stack + CSR detection**
Specified: ❌ Not in spec
Built: ✅ Yes — detects Next.js, WordPress, Shopify, Webflow, Wix, Squarespace, Ghost, Nuxt.js; flags client-side rendered apps

**All 7 categories (content gap, foundational inventory, business alignment, quality, blog topics, calendar, categories)**
Specified: ✅ Yes
Built: ✅ Yes — 7 categories split into 3 parallel Claude calls (batches of 3); results merged

**Per-page verdict (Keep, Refresh, Consolidate, Remove)**
Specified: ✅ Yes
Built: ✅ Yes — deterministic engine, no AI call; rules: <200 words = Remove, title word-overlap = Consolidate, <500 words + missing images/links = Refresh, otherwise Keep

**Repurpose verdict**
Specified: ✅ Yes — spec lists Repurpose as a verdict option
Built: ❌ No — computeVerdicts() never returns Repurpose; type is defined but never assigned
Reason: No deterministic rule implemented; would require content format analysis (e.g. long blog → video/infographic)

**30-day editorial calendar**
Specified: ✅ Yes
Built: ✅ Yes — Claude generates 12 entries as JSON; parsed and stored in aiData; rendered as calendar UI in dashboard

**CSV / Excel download of calendar**
Specified: ✅ Yes — spec says "downloadable Excel (CSV) export"
Built: ❌ No — calendar stored as JSON in DB; no download endpoint built
Reason: Export endpoint not implemented; calendar data is accessible but no CSV generation added

**Per-page readability score**
Specified: ✅ Yes — spec output has readability per page
Built: ❌ No — word count, image count, link count per page; readability score not calculated
Reason: Flesch computation per page not implemented; word count used as proxy

**Per-page alignment and quality scores**
Specified: ✅ Yes — spec output includes numeric alignment and quality per page
Built: ❌ No — verdicts use heuristic rules, not numeric scores
Reason: Alignment would require TF-IDF cosine similarity of page content vs target_audience per page; not implemented

**Summary stats object (verdict counts, avg readability)**
Specified: ✅ Yes — spec output has top-level summary with verdict_counts
Built: ❌ Partial — stats computed in buildSiteStats() and sent to Claude as text; not returned as structured JSON in the API response

**additional_keywords parameter**
Specified: ✅ Yes — extra keywords for gap analysis
Built: ❌ No — not added to module requirements
Reason: Not carried over when module was built

**Google search fallback for competitor gap keywords**
Specified: ✅ Yes — spec: fall back to Google search if no competitors provided
Built: ❌ No — Claude instructed to use industry best practices when no competitors given
Reason: No Google search API integration exists

---

## Module 8 — Meta Ads Audit

Dynamic module. Read-only audit of Meta ad account performance. Requires Meta access token + ad account ID via brandIntegrations. 5 categories. The spec describes a full ad management platform with posting capabilities — what was built is a pure performance audit.

---

**Campaign performance data (7-day: spend, impressions, clicks, CTR, CPC, CPM, frequency, reach)**
Specified: ✅ Yes
Built: ✅ Yes — /act_{id}/insights at campaign level, date_preset=last_7d; account-level aggregates computed

**Campaign list (name, status, objective, daily budget)**
Specified: ✅ Yes
Built: ✅ Yes — /act_{id}/campaigns with fields=id,name,objective,status,daily_budget

**Total conversions / actions**
Specified: ✅ Yes
Built: ✅ Yes — actions array summed into totalActions per campaign

**Token validation**
Specified: ✅ Yes
Built: ✅ Yes — /me endpoint called first; error code 190 = expired, 200 = insufficient permissions

**Campaign Performance, Budget Efficiency, Audience & Reach, Conversion Performance categories**
Specified: ✅ Yes
Built: ✅ Yes — all four categories built; benchmarks baked into system prompt (CTR avg 0.9%, CPC $1.72, CPM $14.40, fatigue threshold 5.0)

**Meta Ads Score (0–10 composite)**
Specified: ❌ Not in spec
Built: ✅ Yes — added beyond spec; weighted composite across 4 categories + 30/60/90 day action plan

**Ad set level data**
Specified: ✅ Yes — spec: /act_{id}/adsets for ad set budgets and targeting
Built: ❌ No — campaign level only
Reason: Adding ad set layer doubles API calls and significantly increases Claude prompt size; kept at campaign level for speed

**Individual ad and creative data**
Specified: ✅ Yes — spec: /act_{id}/ads with creative title, body text, performance score
Built: ❌ No
Reason: Ads endpoint returns dozens to hundreds of records requiring pagination; not implemented

**Lifetime budget field**
Specified: ✅ Yes
Built: ❌ No — only daily_budget fetched; lifetime_budget field not added to query
Reason: Omission; trivial to add to the campaigns fields parameter

**Content gap analysis (untested campaign objective types)**
Specified: ✅ Yes — spec: compare active objectives against all Meta objective types
Built: ❌ No — module scoped to performance audit only
Reason: Content strategy features not included in audit scope

**Caption ideas, hashtag research, 7-day content calendar for ads**
Specified: ✅ Yes — spec has a full Content Strategy tab with niche-specific captions, hashtags, posting schedule
Built: ❌ No
Reason: Content generation scoped to Content Audit module; Meta Ads module kept to paid performance only

**Direct Facebook posting**
Specified: ✅ Yes — spec: POST /{page_id}/feed to publish text, links, images, videos
Built: ❌ No
Reason: Publishing is a product action, not an audit; requires pages_manage_posts permission beyond ads_read; out of scope

**Direct Instagram publishing**
Specified: ✅ Yes — spec: two-step media creation + publish via Instagram Graph API
Built: ❌ No
Reason: Same as above; publishing not appropriate for an audit tool

---

## Module 9 — Outreach Targets

Dynamic module. No spec file — built from scratch. Crawls competitor websites to find external links (press, partners, resources) and generates personalised pitches for each. Requires competitor_urls (auto-populated from competitor registry if not provided).

---

**Multi-page competitor crawl (homepage + 6 sub-pages per competitor)**
Specified: N/A — no spec file
Built: ✅ Yes — crawls homepage + /press, /media, /about, /partners, /integrations, /blog for each competitor; up to 5 competitors in parallel

**External link extraction + deduplication**
Specified: N/A
Built: ✅ Yes — extracts all absolute external href links; one domain per page; deduplicated across all competitors (first occurrence wins); capped at 60 links sent to Claude

**Noise domain filtering**
Specified: N/A
Built: ✅ Yes — 50+ noise domains blocklisted (social platforms, CDNs, analytics tools, payment processors, stock photo sites, font providers); subdomain-aware matching

**Section context extraction (press/partner/blog/footer hint)**
Specified: N/A
Built: ✅ Yes — walks DOM parents for class/id keywords; finds nearest heading above each link; captures surrounding paragraph text; classifies into press, partners, blog, footer, or other

**3 categories: Press & Media Coverage, Partner & Ecosystem Sites, Resource & Community Links**
Specified: N/A
Built: ✅ Yes — Claude assigns each opportunity to a category and generates personalised pitch citing the competitor that already links there

**Auto-population from competitor registry**
Specified: N/A
Built: ✅ Yes — route auto-populates competitor_urls from competitor registry if user hasn't entered them manually

**Domain Authority / backlink database check**
Specified: N/A
Built: ❌ No — no Moz, Ahrefs, or Semrush API calls; weight assigned by Claude from context signals only
Reason: All DA APIs are paid; no free equivalent available

**Email finder / contact form detection**
Specified: N/A
Built: ❌ No — pitches include generic contact guidance but no automated contact discovery
Reason: Hunter.io and similar tools are paid; email scraping is legally sensitive

**Outreach tracking (sent/replied/converted)**
Specified: N/A
Built: ❌ No — one-time findings with no state tracking
Reason: Would require a separate outreach CRM table; not built

---

## Module 10 — GEO Audit

Dynamic module. Hybrid rule engine + single Claude Sonnet call. Fetches 7 URLs in parallel (homepage, robots.txt, llms.txt, 4 AI discovery endpoints). Rule engine pre-computes all structural facts; Claude generates narrative/action per item and evaluates brand sentiment from training knowledge. 36 static items across 9 categories.

---

**Overall approach**
Specified: ❌ No (spec = Python `geo-optimizer-skill` CLI subprocess, dedicated `/api/geo/*` endpoints, separate `geo_*` DB tables)
Built: ✅ Yes (custom TypeScript rule engine integrated into module registry at `/api/modules/analyze`)
Reason: Spec proposed a Python subprocess model wrapping open-source GEO CLI tools. What was built is a fully custom, zero-dependency TypeScript implementation consistent with the app's module registry pattern.

---

**AI Bot Access (robots.txt, 3 tiers)**
Specified: ✅ Yes — 22 AI bots across 3 tiers
Built: ✅ Yes — 13 bots across 3 tiers; custom robots.txt parser with wildcard `*` inheritance; tier1: GPTBot, ClaudeBot, Google-Extended, Amazonbot, CCBot, Meta-ExternalAgent; tier2: OAI-SearchBot, PerplexityBot, YouBot, anthropic-ai; tier3: ChatGPT-User, Claude-User, Perplexity-User

---

**llms.txt analysis**
Specified: ✅ Yes — present, H1, blockquote, sections, links, depth checks
Built: ✅ Yes — all 6 checks: present, H1 (#), blockquote (>), sections (##), link count, depth flag (5+ links AND 2+ sections); 500-char preview passed to Claude

---

**JSON-LD schema checks**
Specified: ✅ Yes — WebSite, Organization, FAQPage, Article, sameAs
Built: ✅ Yes — all 5 types checked; Organization `sameAs` array presence detected; 4 items: geo-schema-faq, geo-schema-org, geo-schema-website, geo-schema-article

---

**AI Discovery endpoints**
Specified: ✅ Yes — `/.well-known/ai.txt`, `/ai/summary.json`, `/ai/faq.json`, `/ai/service.json`
Built: ✅ Yes — all 4 fetched in parallel with null-check for 200 status
Known issue: no JSON content validation — soft 404s returning HTML body counted as present

---

**Content citability signals**
Specified: ✅ Yes — statistics, external citations, lists/tables, H1 specificity, FAQ structure
Built: ✅ Yes — stats count (regex), list item count, table count, FAQ heading detection, H1 extracted
Known issue: external link count is always wrong — placeholder.com filter bug means all absolute links counted as external; `geo-content-citations` receives inflated count

---

**Freshness signals**
Specified: ✅ Yes — dateModified, html lang, RSS/Atom
Built: ✅ Yes — `article:modified_time`, `og:updated_time`, `dateModified` in JSON-LD, html `lang`, RSS/Atom `<link>` tag; 3 items: geo-signals-lang, geo-signals-modified, geo-signals-rss

---

**Entity Clarity category**
Specified: ✅ Yes — mentioned in spec overview
Built: ✅ Yes — 4 items: geo-entity-wikipedia (Claude training knowledge), geo-entity-sameas-depth (authoritative directories in sameAs), geo-entity-nap (brand name consistency across title/H1/schema), geo-entity-about (About page linked from site)

---

**Brand Sentiment in AI outputs**
Specified: ✅ Yes — what AI engines say about the brand, accuracy, competitor defaults
Built: ✅ Yes — 4 items using Claude's own training knowledge: geo-sentiment-known, geo-sentiment-framing, geo-sentiment-use-cases, geo-sentiment-competitors
Known limitation: reflects Claude's knowledge only — not ChatGPT, Perplexity, or Gemini

---

**Competitor Citation Gap**
Specified: ✅ Yes — described as sub-category within GEO module
Built: ✅ Yes (as separate module) — `geo-competitor-gap` is a standalone dynamic module (order 11); 3 items also inside main GEO under `competitor-citation` category: geo-competitor-share, geo-competitor-compare, geo-competitor-diff

---

**Auto-fix code generation (llms.txt, schema, robots.txt)**
Specified: ✅ Yes — spec calls for auto-generated ready-to-deploy file content
Built: ❌ No — actions describe what to do but generate no file content
Reason: Not implemented; noted in GEO_MODULE_FINDINGS.md as a medium-term improvement (llms.txt generator, schema snippet output)

---

**Citability Score (0–100, separate dimension)**
Specified: ✅ Yes — separate Citability Score based on 47 methods (quotation, statistics, fluency, citations, etc.)
Built: ❌ No — single weighted score only: sum(verified item weights) / 53 × 100; no separate citability dimension

---

**Dedicated API endpoints (`/api/geo/*`)**
Specified: ✅ Yes — `POST /api/geo/audit`, `GET /api/geo/score/:url`, `POST /api/geo/fix`
Built: ❌ No — uses `POST /api/modules/analyze` with `type: 'geo'`, consistent with all other modules

---

**Dedicated DB tables (`geo_audits`, `geo_issues`, `geo_fix_history`, `geo_competitor_scores`)**
Specified: ✅ Yes
Built: ❌ No — uses shared `module_items` table, consistent with all other modules

---

**Historical GEO score tracking**
Specified: ✅ Yes — track score per run, show trend
Built: ❌ No — last analysis result only; no history stored

---

**Meta tags audited in GEO**
Specified: ✅ Yes — spec includes meta tags (/14 points) as one of 7 GEO scoring dimensions
Built: ❌ No — meta tags handled by SEO module; GEO module does not audit title, description, canonical, Open Graph

---

**Estimated effort per fix**
Specified: ✅ Yes — "5 minutes", "15 minutes" per action item in spec output
Built: ❌ No — actions describe what to do without effort estimates

---

**CI/CD GitHub Actions integration**
Specified: ✅ Yes — `Auriti-Labs/geo-optimizer-skill@v1` action, SARIF upload
Built: ❌ No — not applicable to the SaaS implementation approach

---

**Perplexity API for real-world sentiment**
Specified: ❌ No (improvement recommendation only, not in original spec)
Built: ❌ No — noted in GEO_MODULE_FINDINGS.md as medium-term improvement, gated on `PERPLEXITY_API_KEY`

---

## Module 11 — GEO Competitor Gap

Dynamic companion module to GEO Audit. No dedicated spec file — competitor comparison described as a sub-feature of GEO-Standalone-Module.md. Reuses all rule engine infrastructure from geo/agent.ts. Fetches user site + up to 3 competitors in parallel, pre-computes structural signals for all sites, passes side-by-side comparison to Claude Sonnet which generates gap findings across 6 categories.

---

**Module structure (dynamic)**
Specified: N/A
Built: ✅ Yes — dynamic module (order 11, `unlockThreshold: 80`); 6 categories: llms-txt-gap, schema-gap, robots-gap, content-gap, technical-gap, discovery-gap; Claude generates items per category based on structural comparison

---

**User site + up to 3 competitor sites fetched in parallel**
Specified: N/A
Built: ✅ Yes — reuses `fetchGeoData` from geo/fetcher.ts; all sites fetched simultaneously; each fetches 7 URLs (homepage, robots.txt, llms.txt, 4 AI discovery endpoints)

---

**Rule findings pre-computed for all sites**
Specified: N/A
Built: ✅ Yes — reuses `buildRuleFindings` from geo/agent.ts; produces identical rule output per site: bots, llms.txt structure, all 4 schema types, freshness signals, discovery endpoints, page content signals

---

**Side-by-side comparison table passed to Claude**
Specified: N/A
Built: ✅ Yes — `formatFindings` formats each site's findings into a labelled block; all blocks concatenated; 18 signals per site: llms.txt link/section count, all 4 schema types, tier 1+2 bot status, stats count, FAQ headings, list items, lang, freshness date, RSS, all 4 discovery endpoints

---

**6 gap categories with targeted instructions**
Specified: N/A
Built: ✅ Yes — each category has focused prompt guidance: llms-txt-gap (link/section count delta), schema-gap (per-type presence diff), robots-gap (only flag explicit allow vs user block — not-mentioned treated as equal), content-gap (meaningful count deltas only), technical-gap (lang/freshness/RSS), discovery-gap (per-endpoint presence)

---

**Smart gap detection (no false positives for equal-failure cases)**
Specified: N/A
Built: ✅ Yes — robots-gap prompt instructs Claude to skip bots everyone equally ignores; content-gap specifies meaningfulness threshold; parity confirmed with `verified: true` item when no gaps exist

---

**Auto-population of `competitor_urls` from registry**
Specified: N/A
Built: ✅ Yes — route.ts auto-populates competitor_urls from competitor registry if user hasn't entered URLs manually

---

**Unlock threshold**
Specified: N/A
Built: ✅ Yes — `unlockThreshold: 80`; requires GEO Audit score ≥ 80 to unlock

---

**Per-competitor numeric GEO score comparison**
Specified: ✅ Yes — GEO spec response schema shows `competitor_comparison: { competitor1: { score: 82, band: "Excellent" } }`
Built: ❌ No — structural signals compared but no numeric GEO score computed per competitor; Claude describes gaps qualitatively without a score delta

---

**Skipped competitor notification**
Specified: N/A
Built: ❌ No — failed competitor fetches silently dropped; if 1 of 3 fails user receives no notification; `skippedCompetitors` array not returned
Reason: Noted in GEO_MODULE_FINDINGS.md #8 as a known issue

---

**Not auto-seeded for existing users**
Specified: N/A
Built: ❌ Known gap — module added after some users completed onboarding; existing users need manual SQL insert (documented in GEO_MODULE_FINDINGS.md #7)

---

## Module 13 — User Analytics

Dynamic module. Connects to user's existing PostHog account via API key + Project ID stored in brandIntegrations. Fetches MAU, DAU, sessions, new users, pageviews, top 20 events, weekly trend (12 weeks), and funnel data via HogQL + PostHog Funnel API. Claude Haiku generates 5 categories of findings: traffic, engagement, conversion, growth, funnel.

Note: Spec describes building a self-hosted analytics platform with custom SDKs for users' apps. What was built is a PostHog integration that reads from an existing account — fundamentally different architecture.

---

**MAU / DAU metrics**
Specified: ✅ Yes — count unique device_ids with sessions in last 24h and last 30 days
Built: ✅ Yes — HogQL `count(DISTINCT person_id)` over last 1 day and last 30 days; DAU/MAU ratio computed; sessions30d also fetched

---

**New users tracking**
Specified: ✅ Yes — count of install events in time period
Built: ✅ Yes — `count(DISTINCT person_id) WHERE person.created_at > now() - INTERVAL 30 DAY`; new users as % of MAU computed

---

**Funnel analysis with bottleneck detection**
Specified: ✅ Yes — user-defined funnels, drop-off % per step, bottleneck flag at >40% drop
Built: ✅ Yes — PostHog `/insights/funnel/` API; per-step conversion and drop-off rate; average conversion time in hours; overall first-to-last rate; bottleneck = lowest step conversion; 14-day conversion window

---

**Actionable recommendations (insights engine)**
Specified: ✅ Yes — specific recommendations per bottleneck type
Built: ✅ Yes — Claude Haiku generates `action` per finding citing exact event names and step counts; 5 categories: traffic, engagement, conversion, growth, funnel

---

**AI-powered insights from metrics**
Specified: ✅ Yes — LLM call with funnel data and bottleneck list
Built: ✅ Yes — Claude Haiku receives MAU, DAU, sessions, new users, pageviews, weekly trend, top 20 events, funnel breakdown; generates structured findings with narrative + action

---

**Top events analysis**
Specified: ❌ Not in spec
Built: ✅ Yes — top 20 events by count over last 30 days; used for conversion event detection and auto-funnel step detection

---

**Weekly user trend (12-week)**
Specified: ❌ Not in spec
Built: ✅ Yes — HogQL weekly breakdown for last 84 days; last 4 weeks vs prior 4 weeks percentage change computed

---

**Auto-detected funnel from top events**
Specified: ❌ Not in spec
Built: ✅ Yes — when no funnel_steps configured, scans top events for 20 conversion-pattern keywords (signup, purchase, subscribed, trial_started, etc.); builds $pageview → match steps funnel automatically

---

**SDK for embedding in users' apps (iOS, Android, React Native, Flutter)**
Specified: ✅ Yes — core spec deliverable; Aptabase/OpenPanel SDKs
Built: ❌ No
Reason: Architecture pivoted to reading from existing PostHog; no SDK needed or built

---

**Self-hosted backend (OpenPanel / PostHog Docker)**
Specified: ✅ Yes — full Docker Compose setup in spec
Built: ❌ No
Reason: PostHog cloud API used instead; no self-hosting infrastructure

---

**ClickHouse + Redis event storage**
Specified: ✅ Yes — ClickHouse for events, PostgreSQL for metadata
Built: ❌ No — PostHog's own ClickHouse used transparently; no owned data layer

---

**Real-time concurrent users**
Specified: ✅ Yes — unique sessions with is_active = true in last 5 minutes
Built: ❌ No — DAU (last 24h) is closest approximation; no real-time window query

---

**Cohort retention (Day 1 / Day 7 / Day 30)**
Specified: ✅ Yes — % of users who return after N days
Built: ❌ No — PostHog retention insight API not queried

---

**Attribution tracking (campaign → install linking)**
Specified: ✅ Yes — LinkForty / smart links for campaign attribution
Built: ❌ No
Reason: Architecture uses PostHog; attribution not a HogQL query; LinkForty not deployed

---

**CSV / PDF export**
Specified: ✅ Yes — Phase 6 feature
Built: ❌ No

---

**Email alerts for metric changes**
Specified: ✅ Yes — Phase 6 feature
Built: ❌ No

---

**Custom dashboard with charts (Recharts / Chart.js)**
Specified: ✅ Yes — custom Next.js dashboard connecting to ClickHouse
Built: ❌ No — uses generic ModuleDashboard component; no dedicated analytics charts or graphs

---

## Module 14 — Business Stage Analysis

Dynamic module. Single-page fetch + Cheerio extraction + regex keyword matching. Claude Haiku classifies archetype (HVP/EBP/PEH) and growth stage (0–10 through 250–500), then generates a 5-item personalised playbook: classification, concern, insight, actions, red-flag. Stage matrix fully embedded in system prompt.

---

**Core concept: HVP / EBP / PEH archetypes + 5 stage ranges**
Specified: ✅ Yes — HVP (SaaS/D2C), EBP (Enterprise/B2B), PEH (Premium Experience/Hospitality); stages 0–10 through 250–500
Built: ✅ Yes — all 3 archetypes and all 5 stage ranges implemented exactly as specified; same signal set

---

**Stage matrix (concern / insight / actions / red_flag per archetype × stage)**
Specified: ✅ Yes — `stage_matrix.json` as a separate data file
Built: ✅ Yes — all 15 entries (3 × 5) embedded directly in system prompt; functionally identical; no separate JSON file

---

**Heuristic rules for archetype classification**
Specified: ✅ Yes — pricing visibility, retreat/wellness keywords, enterprise/compliance keywords, self-serve CTAs
Built: ✅ Yes — 9 self-serve patterns, 12 enterprise patterns, 17 PEH patterns; regex matched against title + meta + hero + body + nav; keyword matches passed to Claude as structured signals

---

**Stage proxy signals (logo count, testimonials, customer claims)**
Specified: ✅ Yes — client logo count drives stage bucket; "500+" / "100+" claims = 250–500
Built: ✅ Yes — `clientLogoCount` via CSS class patterns; `testimonialCount` via testimonial/review/quote/blockquote classes; `customerClaims` via numeric + entity regex; `hasBetaOrEarlyAccess`, `hasCaseStudyLinks`, `hasPressPage`, `hasTeamPage` all detected

---

**LLM enrichment of playbook**
Specified: ✅ Yes — optional; Llama 3 / Ollama suggested
Built: ✅ Yes — always on; Claude Haiku generates personalised narratives per category citing specific website evidence

---

**5 output categories (classification, concern, insight, actions, red-flag)**
Specified: ✅ Yes — concern, insight, actions, red_flag in spec; classification inferred
Built: ✅ Yes — exactly 5 items enforced; classification item added beyond spec to surface archetype + stage label explicitly

---

**Navigation signal extraction**
Specified: ✅ Yes — detect /pricing, /solutions, /retreats in nav
Built: ✅ Yes — `hasPricingPage`, `hasBookingFlow`, `hasDemoRequest` from all `a[href]`; nav links extracted as "text → href" pairs (up to 20)

---

**Hero copy extraction**
Specified: ✅ Yes
Built: ✅ Yes — `[class*="hero"]`, `[class*="banner"]`, `[class*="above-fold"]`, first section/header; first 1000 chars

---

**Analytics detection**
Specified: ❌ Not in spec
Built: ✅ Yes — GTM, gtag, PostHog, Segment detected; passed to Claude (relevant to HVP 10–50 red flag)

---

**Review widget detection**
Specified: ❌ Not in spec
Built: ✅ Yes — G2, Capterra, Trustpilot, reviews.io, GetApp checked in raw HTML

---

**Playwright JS rendering**
Specified: ✅ Yes — required for JS-rendered pages
Built: ❌ No — plain fetch + Cheerio only; JS-rendered SPAs return near-empty content
Reason: Playwright cannot run on Vercel serverless; consistent constraint across all modules

---

**`@knowledgesdk/mcp` ML classification**
Specified: ✅ Yes — ML backup to heuristics
Built: ❌ No — heuristics only; Claude resolves ambiguity
Reason: Not installed; Claude classification is functionally superior

---

**Redis caching (7-day TTL per URL)**
Specified: ✅ Yes
Built: ❌ No — no caching; every analysis re-fetches and re-calls Claude
Reason: Redis not in stack; results already persisted in module_items; re-analysis is user-triggered

---

**Dedicated DB tables (`brands`, `analyses`, `cache`)**
Specified: ✅ Yes
Built: ❌ No — uses shared `module_items` table, consistent with all other modules

---

**Dedicated API endpoints (`POST /api/analyze`, `GET /api/analyze/{id}`)**
Specified: ✅ Yes
Built: ❌ No — uses `POST /api/modules/analyze` with `type: 'business-stage'`; no retrieve-by-ID endpoint

---

**Python FastAPI microservice + Docker**
Specified: ✅ Yes — separate Python service
Built: ❌ No — TypeScript integrated into Next.js app
Reason: Full-stack TypeScript app; no Python runtime available
