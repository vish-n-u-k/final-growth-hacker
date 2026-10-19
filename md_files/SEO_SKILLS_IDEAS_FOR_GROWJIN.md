# What the rampstack-seo skills suggest we add to the Growjin app

Written 2026-10-19 on branch `dev`.

**Question this answers:** the rampstack-seo plugin has 12 skills. Which of their ideas are worth building into Growjin's own modules (SEO Health Audit, GEO, Content Audit, Competitor, Today/Reminders)?

**Supporting evidence:** `md_files/FREKTO_SEO_IMPLEMENTATION_PLAN.md` is a live audit of frekto.ai done with these skills. It is not the deliverable; it is used below to check which ideas would have caught real problems.

---

## 1. How this was done, and its limits

- The skills are methodology documents (a `SKILL.md` plus reference files). They contain no executable tools and no data sources. Anything that needs Ahrefs, SERP, volume or backlink data cannot be built from the skills alone.
- **App claims were checked by reading the code and grepping it** (files under `web/lib/audit`, `web/lib/modules/*`), not by running the app. Items I could not confirm are marked "verify".
- Frekto is the only site I tested against. One site is not a benchmark.

### What was read

| Skill | Relevant to the app? | Read |
|---|---|---|
| `seo-technical` | Yes, high | SKILL.md in full + audit-template + migration-checklist |
| `seo-onpage` | Yes, high | SKILL.md in full + all 3 references |
| `seo-site-health-audit` | Yes (prioritisation) | SKILL.md in full + issue-impact-table |
| `seo-aeo-geo` | Yes (GEO module) | SKILL.md in full + both references |
| `seo-content-audit` | Yes (Content Audit module) | SKILL.md in full + both references |
| `seo-keyword` | Yes (SEO keyword items, GSC) | SKILL.md in full + both references |
| `seo-competitor` | Yes (Competitor modules) | SKILL.md in full + both references |
| `seo-traffic-diagnosis` | Yes (Today / "What changed") | SKILL.md in full + checklist |
| `programmatic-seo` | Partly (detecting scaled thin pages) | SKILL.md in full; quality-control reference first 60 lines; other 9 references by section headings only |
| `content-strategy` | Partly (Publishing Plan) | SKILL.md; references by section headings only |
| `content-and-copy` | Marginal (blog generation QA) | SKILL.md; references by section headings only |
| `skill-creation-walkthrough` | No (about writing skills) | Section headings only |

---

## 2. What the app already does well (don't rebuild)

- **GEO module:** llms.txt checks (heading, summary line, sections, links, depth), per-tier AI bot rules in robots.txt, JSON-LD (FAQ, organization, website, article), entity signals (Wikipedia/Wikidata, sameAs), citation signals, freshness, competitor llms/schema/bot gap.
- **SEO module:** title/description/canonical/OG, headings, alt text, schema validity, sitemap URL sampling (25 pages, flags redirects and 4xx), homepage broken links, uniqueness of titles and descriptions across the sampled pages, indexing state from Search Console.
- **Content Audit:** fixed-rule verdicts per page (Keep / Refresh / Consolidate / Repurpose / Remove), thin-page and duplicate-title-pair detection.
- **Rendering:** detects JavaScript-shell pages and skips body checks instead of faking results.

---

## 3. Recommendations

Priority: **P1** = clear gap, high value, and it would have caught a real problem on frekto.ai. **P2** = valuable. **P3** = nice to have or blocked on data.
Effort: S = under a day, M = a few days, L = a week or more.

### A. SEO Health Audit: new checks (`web/lib/audit/seo-audit.ts`, `web/lib/modules/seo/definition.ts`)

| ID | Add | Source skill | Why / current state | Frekto | Pri | Effort |
|---|---|---|---|---|---|---|
| A1 | **Soft-404 test:** request a random non-existent path on the site; pass only if it returns 404/410. Fail if 200 with the homepage's title or canonical. | seo-technical (layer 6, audit template §2) | No such check exists in `lib/`. | Found: unknown URLs return 200 with homepage content | P1 | S |
| A2 | **Canonical points to a redirect / disagrees with final URL.** Fetch the canonical with `redirect: 'manual'`; any 3xx fails. Also compare canonical with the sitemap `<loc>` and with the trailing-slash variant. | seo-technical (layer 2 "mixed signals"); issue-impact-table ("Canonical points to redirect": HIGH, effort S) | `canonical.resolves` uses `headRequest()` with `redirect: 'follow'`, so a canonical that redirects still reports HTTP 200 and passes. | Found on 3 pages | P1 | S–M |
| A3 | **`X-Robots-Tag: noindex` response header.** | seo-technical; issue-impact-table (HIGH) | `seo-audit.ts:328` has a stub: `const xRobotsNoindex = false // Would need response headers`. The header is never read in the rule engine (only Search Console's state text mentions it). | Not present on Frekto | P1 | S |
| A4 | **Sitemap hygiene.** (a) Read every `Sitemap:` line in robots.txt, not just `/sitemap.xml`. (b) Listed URLs should be indexable and canonical-equal. (c) Flag `lastmod` that is identical on every URL. (d) Note multiple/segmented sitemaps. | seo-technical (layer 1 and template "XML sitemap(s)"); programmatic-seo (crawl budget) | `url-discovery.ts` has no robots.txt handling; `seo-audit.ts` only checks `/sitemap.xml` and no robots `Sitemap:` directive. | The second sitemap `/b/sitemap.xml` (31 generated URLs) is invisible to the app | P1 | M |
| A5 | **Redirect hygiene.** (a) http→https and www→apex each a single hop; flag a host that errors (www 522). (b) Mixed trailing-slash policy across sampled pages. (c) Count internal links that point at redirecting URLs. (d) Redirect chains over 1 hop. | seo-technical (template §2 "Redirect chains", §7 "Trailing slash", "www consolidated"); seo-onpage ("links to canonical URLs, not redirects") | `sitemap.valid` flags redirecting sitemap URLs only; `https.enforced` exists. No www check, no slash-policy check, no internal-link-to-redirect check. | www returns 522; `/pricing/` vs `/about` conventions mixed; 10 internal link targets 308 | P1 | M |
| A6 | **Per-page inbound internal links and orphan detection** across the sampled/crawled pages: flag pages with under 2 inbound links, and sitemap URLs that nothing links to. | seo-onpage dim 5; seo-technical layer 4 | Internal-link checks look at the homepage only. | 4 blog posts have 1 inbound link (just the blog index) | P2 | M |
| A7 | **Site-wide title and description quality** over the sampled pages: share over 60 / under 30 characters, missing descriptions, and a shared boilerplate suffix that pushes titles over the limit. | seo-onpage dims 1–2, title-and-meta-patterns | `title.unique` / `description.unique` check duplicates only. | 16 of 18 blog titles over 60 chars because of the ", Frekto Blog" suffix | P2 | S |
| A8 | **Conflicting duplicate head tags:** more than one `canonical`, `robots`, `twitter:card`, `og:title` with different values. | seo-technical (indexability: no mixed signals) | Not checked (Cheerio `.attr()` reads only the first). | Two different `twitter:title` sets on the homepage | P2 | S |
| A9 | **BreadcrumbList schema** on nested pages; `WebSite` + `SearchAction` on home. | seo-technical layer 5; seo-onpage dim 8; seo-aeo-geo | Zero references to BreadcrumbList in `web/lib`. | Present on the site; app can't tell | P2 | S |
| A10 | **Scaled / programmatic page-set detector.** If a sitemap bucket (URL prefix or ID-like slugs such as `post_1792…`) has more than ~30 URLs, sample up to 20 and check: word count under 300, unique title/H1, schema present, 10+ internal links, near-duplicate text. Warn "noindex thin pages" and "segment sitemaps". | programmatic-seo (quality control at scale, crawl budget, failure thresholds: halt if over 5% of sample fails) | Not covered. | `/b/` pages: 168 and 223 words in the 2 sampled | P2 | M |
| A11 | **Core Web Vitals upgrade:** use INP (Google replaced FID with INP), and prefer field data (CrUX `loadingExperience` in the PageSpeed response) over lab numbers; thresholds LCP 2.5s, INP 200ms, CLS 0.1 at the 75th percentile. | seo-technical layer 6, audit template §5, issue-impact-table | `cwv.fid` is labelled "TBT"; `psi.ts` has no field-data usage. | CWV not measurable in my audit (API quota) | P2 | S–M |
| A12 | **Mixed content** (http:// resources on https pages). | seo-technical layer 6 | Not checked. | n/a | P3 | S |
| A13 | **hreflang validation** only when `rel="alternate" hreflang` exists (self-reference, reciprocal, x-default). | seo-technical (international) | Not checked. | n/a (no hreflang) | P3 | M |
| A14 | **Raw vs rendered check:** title, meta and canonical injected by JavaScript only. | seo-technical layer 3 | `render.no_js` checks body content only. | n/a | P3 | M |

### B. Existing code that disagrees with the skills (bugs / accuracy)

| ID | Issue | Where | Fix | Pri | Effort |
|---|---|---|---|---|---|
| B1 | **Meta-description regex stops at an apostrophe.** `[^"']*` cuts the text at the first `'`, so descriptions like "Don't miss…" are truncated before the uniqueness comparison. (I made the same mistake in my first pass on Frekto, which is how I noticed.) | `web/lib/audit/url-discovery.ts:41-42` (`extractPageMeta`) | Parse the head with Cheerio, or match each quote type separately. | P1 | S |
| B2 | `canonical.resolves` and `robots.noindex` shortcuts | `seo-audit.ts:309-319`, `:328` | Same as A2 and A3. | P1 | S |
| B3 | **"Page depth (within 3 clicks)" passes on URL path depth** when a sitemap is used ("Sitemap URL structure shows all 37 pages within 3 path levels"). Path depth is not click depth, and the skill defines the rule as reachable within 3 clicks. | `seo-audit.ts:728` area | When no crawl ran, report as "Not checked" or run the BFS on the sample. | P2 | S–M |
| B4 | **`pagerank.nav` failed on frekto.ai** ("missing product, about, contact") although the homepage links to `/about`, `/contact`, `/features`, `/pricing`. I did not read this check's logic. | `seo-audit.ts` (verify) | Verify the matching rule against link href, not just nav element text. | P2 | S |
| B5 | Meta-description target is 140–155; the skill says 150–160 in the checklist and 140–160 in the patterns guide. Not a bug. | `description.length` | Consider 140–160. | P3 | S |

### C. GEO module (`web/lib/modules/geo/`)

| ID | Add | Source | Current state | Frekto | Pri | Effort |
|---|---|---|---|---|---|---|
| C1 | **llms.txt link liveness and consistency.** Check each linked URL returns 200 (guide: dead links "actively damage credibility"). Compare llms.txt positioning words with the homepage title/H1. Mention optional `llms-full.txt` as info, not a failure. | seo-aeo-geo (llms-txt-guide) | `geo-llms-links` only counts links in `[name](url)` form. | llms.txt says "small, local businesses… retail shops", homepage says solo founders and agencies | P2 | S–M |
| C2 | **Article schema author as a Person** with `sameAs`; publisher present; flag `dateModified` equal to `datePublished` on every post; visible date plus schema date. | seo-aeo-geo layers 2–3 | `geo-schema-article` exists; grep finds no Person/author-type check. | Authors are `Organization: "Frekto Team"`; modified = published on all 18 | P2 | S |
| C3 | **Extractable-structure checks on blog posts:** share of H2/H3 phrased as questions, answer-first opening under each heading, tables/numbered steps for how-to. | seo-aeo-geo layer 1; extraction-friendly-patterns | `geo-structure-faq-content` checks only for FAQ-style Q&A on the homepage or FAQ page. | 0 question H2s on the post checked | P2 | M |
| C4 | **FAQPage/HowTo schema must match visible content** (the skill calls manufactured FAQ blocks a failure pattern). | seo-aeo-geo failure patterns | `geo-schema-faq` checks presence. | n/a | P3 | M |
| C5 | **Priority-query list with quarterly re-test and history** (10–20 queries, record who gets cited). | seo-aeo-geo workflow steps 2–3, 6 | `geo-competitor-share` is a single check. | n/a | P3 | L |

### D. Content Audit (`web/lib/modules/content-audit/`)

| ID | Add | Source | Current state | Pri | Effort |
|---|---|---|---|---|---|
| D1 | **Performance inputs for verdicts:** GSC clicks, impressions, average position per URL, plus referring domains when available. Use the skill's tiers (performing / decaying / dormant) and decision tree (traffic → decay → update; no traffic + backlinks → redirect; else delete with 410). | seo-content-audit (scoring inputs, decision matrix, audit-template) | `content-audit` fetcher/agent have no GSC or backlink data (0 references); verdicts come from word count, freshness and title similarity. The SEO module already integrates GSC, so the data path exists. | P1 | M |
| D2 | **Cannibalization at query level:** two or more of the site's URLs ranking for the same query; rotating URLs; then the resolution tree (merge / differentiate / redirect / noindex) and merge-winner ranking (position, backlinks, URL quality, inbound links, age). | seo-content-audit; cannibalization-resolution | Only `duplicatePairs()` on title similarity. | P1 | M |
| D3 | **Safety rules before "Remove":** never recommend deleting a page with backlinks or internal links in; pick a 301 target (not the homepage); prefer 410 for intentional deletes; do redirects before merges before updates before deletes. | seo-content-audit | "Remove" verdict has no such guard (verify the wording in the agent). | P2 | S |
| D4 | **Publishing Plan on pillars:** 3–5 pillars, cornerstone plus supporting pieces, pillar rotation, reserved refresh slots, cadence matched to capacity. | content-strategy (5 layers, calendar) | Plan exists; I did not read how it is built (verify). | P2 | M |
| D5 | **Blog-idea briefs** (reader, goal, angle, structure, sources, SEO fields) and a 10-pass edit checklist as the QA gate for AI-generated drafts. | content-and-copy references (headings only read) | Not applicable to audits; relevant to any blog generator. | P3 | S–M |

### E. Keyword items and Search Console (`web/lib/modules/seo/keyword-fetchers.ts`, `gsc-indexing.ts`)

| ID | Add | Source | Current state | Frekto | Pri | Effort |
|---|---|---|---|---|---|---|
| E1 | **Split branded vs non-branded queries**, and drop brand misspellings from "top queries" and "quick wins". | seo-keyword (clean misspellings); seo-traffic-diagnosis layer 2 | `kw-ranking` items surface whatever GSC returns. | Top query is the misspelling "fraktok" (and it is the "quick win") | P1 | S |
| E2 | **Intent label per query** (informational / navigational / commercial / transactional) and a check that the landing page type matches (e.g. "X alternatives" → a comparison page, not a blog post). | seo-keyword (intent-classification-guide) | `kw-intent-match` compares one keyword with one page. | "buffer ai" ranks 20th with zero clicks | P2 | M |
| E3 | **Quick-win rule from the skill:** average position 5–20 *and* impressions over ~100/month. | seo-keyword (keyword-research-template) | Positions 4–20; I did not find an impression floor (verify). | | P3 | S |
| E4 | **Clusters and a priority score** (opportunity + strategic fit − difficulty). | seo-keyword | Needs volume/difficulty data the app doesn't have. | | P3 (blocked) | L |

### F. Competitor modules

| ID | Add | Source | Current state | Pri | Effort |
|---|---|---|---|---|---|
| F1 | **Technical comparison table** (CWV, schema types, sitemap quality, llms.txt, internal links per page) beside the existing gaps. | seo-competitor (angle 4, audit template) | GEO gap covers llms/schema/bots/content. No CWV or link-density comparison. | P2 | M |
| F2 | **"Search competitors" discovery:** domains that appear 5+ times in the top 10 for the site's priority queries, alongside direct/indirect/aspirational. | seo-competitor, content-gap-method step 1 | Needs a SERP data source. | P3 (blocked) | M–L |
| F3 | **Backlink gap** (domains linking to two or more competitors but not you). | seo-competitor angle 3 | `backlinks` module is a definition only; needs a backlink data source. | P3 (blocked) | L |
| F4 | **"Clusters to skip" list with reasons** in gap reports. | content-gap-method step 6 | Not present. | P3 | S |

### G. Prioritisation, Today, and "What changed"

| ID | Add | Source | Current state | Pri | Effort |
|---|---|---|---|---|---|
| G1 | **Rank fixes by traffic tier × mechanism × effort → P0–P3** (Tier 1 = top 10% of pages by organic traffic from GSC; "real mechanism" = indexability, crawlability, rendering, CWV, links; length warnings are low). | seo-site-health-audit | Items carry a flat weight 1–3. How Today ranks fixes I did not read (verify). | P1 | M |
| G2 | **Group findings into fix clusters** that share one change: "16 titles share a suffix", "10 links point to redirects", "3 canonicals lack the slash". One task, not 28 items. | seo-site-health-audit ("high-leverage clusters") | Not present. | P2 | M |
| G3 | **"What changed" in the skill's order:** confirm the change is real (GSC vs analytics), localise (branded/non-branded, device, country, page), then technical regressions (robots, canonical, noindex, redirects, deploy date), then external. End with a one-sentence hypothesis; state two hypotheses when evidence is mixed. | seo-traffic-diagnosis | `daily/diagnosis.ts` works from PostHog segments and signals; no GSC segmentation found. | P2 | M |
| G4 | **Per-run diff alerts:** robots.txt changed, noindex appeared, canonical changed, sitemap count dropped, certificate near expiry. | seo-technical monitoring list; traffic-diagnosis layer 4 | Runs are stored; no diffing found (verify). | P2 | M |
| G5 | **Down-weight cosmetic items** (title/description length, H1 on low-traffic pages) so the headline score isn't driven by them. | seo-site-health-audit mechanism tiers | `title.length` and `description.length` are weight 2. | P3 | S |

### H. Not worth building

- **Log-file analysis** (no access to customer server logs).
- **Migration checklist as a feature:** it is a service playbook. At most, a future "verify my redirect map" tool.
- **Designing a programmatic-SEO program** (data sources, templates, refresh): consulting-level. Only the detection and quality-control sampling (A10) fits an audit.
- **`skill-creation-walkthrough`:** about authoring skills, not auditing sites.
- **Building a Wikipedia entity:** the skill itself says not to force it.
- **Voice/tone editing** from `content-and-copy` inside the audit modules.

---

## 4. What the new checks would have caught on frekto.ai

| Real problem on frekto.ai | Caught today by Growjin? | Caught by |
|---|---|---|
| Unknown URLs return 200 with homepage content | No | A1 |
| 3 canonicals point to URLs that redirect back | No | A2 |
| Second sitemap with 31 generated post pages | No | A4, A10 |
| www returns 522; mixed slash convention; 10 redirecting internal link targets | No | A5 |
| 16 blog titles too long, 2 too short | No (homepage title only) | A7 |
| Duplicate, conflicting Twitter tags | No | A8 |
| 4 posts with a single inbound link | No | A6 |
| llms.txt positioning out of date | No | C1 |
| Author is an organisation; modified = published | No | C2 |
| Top query is a brand misspelling | Shown, but not separated | E1 |
| Index status, queries, positions | **Yes (Search Console)** | already in the app |

---

## 5. Suggested build order

1. **Quick wins in the rule engine (about 2–3 days):** A1, A3, B1, E1. Four small changes with clear tests.
2. **Redirect and canonical correctness (about a week):** A2, A5, A4 (this one also needs `url-discovery.ts` to read robots.txt).
3. **Content Audit with real traffic data:** D1, D2, then D3.
4. **Prioritisation:** G1, G2 (the biggest change to what users see).
5. **GEO depth:** C1–C3.
6. **Everything P3** and the blocked data-source items when those integrations exist.

## 6. Implementation notes for the P1 items

- **A1:** `fetch(origin + '/__growjin_probe_' + randomHex, {redirect:'manual'})`. Pass on 404/410. If 200, compare `<title>` and canonical to the homepage; if equal → fail with "soft 404". A 3xx to the homepage is also a soft-404 pattern; report it separately.
- **A2:** replace `headRequest(canonical)` with a manual-redirect fetch. Fail on any 3xx with the `Location`. Also build the trailing-slash/non-slash twin of the page URL and check the canonical equals the 200 version.
- **A3:** the headers are already passed into `checkTechnical()`; read `x-robots-tag` there and feed `robots.noindex`.
- **A4:** in `discoverAllUrls`, fetch `/robots.txt`, collect `Sitemap:` lines, union them with `/sitemap.xml`, then parse each (including index files). Tag each URL with its `sitemapName` (already a field) so a bucket like `/b/` can be reported.
- **A5:** one `fetch` per host variant with `redirect: 'manual'`; classify as 200, single 301/308 to the final host, chain, or error. Trailing slash: among the sampled URLs, count slash vs no-slash finals; if both exceed 20%, report "mixed".
- **B1:** use Cheerio on the fetched head (already a dependency) instead of regexes.
- **D1:** reuse the Search Console fetcher from the SEO module; map GSC page URLs to the content pages the audit already lists.
- **E1:** brand terms already exist (`brand_name`, `brand_keywords` options in `runSeoAudit`). Treat a query as branded if it contains the brand or is within edit distance 2 of it; show both groups separately.
- **G1:** needs a tier per URL from GSC clicks (top 10% = Tier 1) and a static table mapping each item slug to mechanism (high/low) and effort (S/M/L) — the `issue-impact-table.md` file is a ready starting point.

## 7. Open questions for you

1. Should the app run the new site-wide checks (A5, A6, A10) automatically, or only when a site has fewer than N pages? The current audit samples 25 pages.
2. Is it acceptable for A1 to send a request to a made-up URL on the customer's site? It is one harmless GET, but some firewalls log or rate-limit unusual paths.
3. Does the app have a source for referring-domain data (needed for D1's backlink input and F3)? If not, D1 can still ship with GSC data only.
