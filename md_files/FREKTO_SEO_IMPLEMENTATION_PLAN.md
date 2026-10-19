# frekto.ai — SEO Implementation Plan

Audited 2026-10-19 against the live site. Skills actually invoked: `rampstack-seo:seo-technical` and `rampstack-seo:seo-onpage`. Frameworks only read from the skill files and applied by hand (skill not invoked): `seo-aeo-geo` (SKILL.md plus one reference), `seo-site-health-audit` (issue-impact table only) and `seo-content-audit` (first part of SKILL.md). `programmatic-seo`, `seo-keyword`, `seo-competitor` and `seo-traffic-diagnosis` were not used; the `/b/` pages finding rests on general pSEO reasoning, not that skill. Checks were run with curl and scripts: all 37 URLs in `sitemap.xml`, 31 URLs in `/b/sitemap.xml` (sampled 2), `robots.txt`, `llms.txt`, and 69 unique internal link targets.

**Where to implement:** the frekto.ai site code is **not** in this repo (this repo is Growjin). Every fix below is written to be stack-agnostic. The 308 trailing-slash redirects are typical of Next.js, so Next.js hints are given where they apply.

**Growjin vs this audit:** Growjin scored the SEO module 95/100. Everything in P0 and P1 below is something Growjin has no check for. See "How this compares with Growjin" at the end.

---

## Priority summary

| ID | Fix | Priority | Effort |
|----|-----|----------|--------|
| 1 | Real 404 status for unknown URLs (currently soft 404) | P0 | S |
| 2 | One trailing-slash convention; canonicals, sitemap and internal links all agree | P0 | M |
| 3 | Decide the fate of the `/b/` auto-generated post pages and second sitemap | P0 | S–M |
| 4 | Fix `www.frekto.ai` (returns 522) | P1 | S |
| 5 | Titles: shorten 16 blog titles, lengthen `/faq/` and `/pricing/`, fix homepage title | P1 | S |
| 6 | Homepage: duplicate Twitter tags, keyword in H1 area | P1 | S |
| 7 | Internal links: lift the weakest blog posts, stop linking to redirecting URLs | P1 | S |
| 8 | AI-search (AEO/GEO): author entity, question headings, llms.txt corrections | P2 | M |
| 9 | Measure Core Web Vitals (could not be measured in this audit) | P2 | S |
| 10 | Content and keyword follow-ups (need Search Console data to confirm) | P2 | M |

---

## P0 — fix first (these affect indexing)

### 1. Soft 404: unknown URLs return HTTP 200 with the homepage

**Evidence.** `GET /this-page-does-not-exist-xyz` → `200`, full homepage HTML, `<meta name="robots" content="index, follow…">`, canonical `https://frekto.ai/`.

**Why it matters.** Any mistyped, removed or spam-linked URL becomes an indexable duplicate of the homepage. Google reports these as soft 404s and it wastes crawl budget.

**How to fix.**
- Make the catch-all route return status **404** with a small 404 page that links to the homepage, `/features/`, `/pricing/` and `/blog/`.
- The 404 page should be `noindex`, with no canonical tag.
- Next.js: unknown routes should hit `app/not-found.tsx`. If the site is a SPA or static host with a rewrite-everything-to-index rule (`/* /index.html 200`), remove that rule or change it to a real 404 for non-matching paths. On Cloudflare Pages/Netlify that rule is the usual cause.

**Verify.**
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://frekto.ai/this-page-does-not-exist-xyz   # expect 404
```

### 2. Trailing-slash and canonical inconsistency

**Evidence (all verified):**
- `/features` is in `sitemap.xml` without a slash, and returns **308** to `/features/`. Its canonical is `https://frekto.ai/features` (no slash), which redirects back to the page. A canonical that points at a redirect is a loop.
- `/how-to-connect-claude-to-frekto-mcp/` (sitemap has the slash) serves canonical **without** the slash, which 308s back to the slash version.
- `/cookie-policy/` (sitemap has the slash) has canonical `/cookie-policy` (no slash), which 308s back.
- The site mixes conventions: `/pricing/`, `/faq/`, `/comparison/`, `/vs-*`, `/blog/…/` use a slash, while `/about`, `/contact`, `/privacy`, `/terms`, `/disclaimer` do not (`/about/` 308s to `/about`).
- Internal links hit the redirect: the site links to `/features`, `/pricing`, `/blog`, `/refund-policy`, `/vs-buffer`, `/vs-canva`, `/vs-freelancer`, `/vs-hootsuite`, `/social-media-agency-alternatives`, `/how-to-connect-claude-to-frekto-mcp` — all of which 308.
- Growjin's Search Console data shows `/how-to-connect-claude-to-frekto-mcp/` as "unknown to Google" and `/faq/` as "Discovered – currently not indexed". Mixed signals like these are a plausible contributor, but this is not proven.

**How to fix.** Pick **one** convention for the whole site. Recommended: **trailing slash everywhere**, because most key pages already use it.
1. Next.js: set `trailingSlash: true` in `next.config.js` so the redirect rule is uniform. Otherwise enforce it in the router/CDN.
2. Generate canonicals from **one helper** that always builds the final URL (slash included) from the same function that builds the sitemap and internal links. Do not hand-write canonicals.
3. Update `sitemap.xml` so every `<loc>` is the final, 200-status URL (no `/features`, no `/about` without slash if you choose slashes).
4. Update nav, footer and in-content links to the final URL so no click triggers a 308.
5. Keep the 308 redirects for the old variants (don't remove them, external links exist).

**Verify.**
```bash
# every sitemap URL should be 200 with 0 redirects and a canonical equal to itself
for u in $(curl -s https://frekto.ai/sitemap.xml | grep -o '<loc>[^<]*' | sed 's/<loc>//'); do
  c=$(curl -s -o /tmp/p.html -w "%{http_code} %{num_redirects}" "$u")
  canon=$(grep -o 'rel="canonical" href="[^"]*' /tmp/p.html | sed 's/.*href="//')
  [ "$canon" = "$u" ] && ok=OK || ok="MISMATCH($canon)"
  echo "$c $ok $u"
done
```
Expected: every line `200 0 OK`.

### 3. The `/b/` auto-generated post pages and second sitemap

**Evidence.** `robots.txt` lists a second sitemap, `https://frekto.ai/b/sitemap.xml`: **31 URLs**, `lastmod` of today, the hub `/b/frekto` with `changefreq=daily`, and posts at URLs such as `/b/frekto/p/post_1792387061768_9616` and `/b/frekto/p/ph_cron_sched_1792373203225_jg0i`. The two pages sampled are 168 words (hub, title "Frekto — posts") and 223 words (a post, title "Turn blog posts into videos, add voice-overs — Frekto"), both indexable with self-canonicals. The `ph_cron_sched_…` URLs look like scheduler test output.

**Why it matters.** These are thin, programmatically generated pages that grow daily (the `programmatic-seo` skill's main failure pattern: scaled pages with little unique value dilute the site's quality signals and burn crawl budget). I have not confirmed whether Google indexes them. Check Search Console → Pages first.

**How to fix.** Choose deliberately:
- **Option A (recommended): keep them out of the index.** Add `<meta name="robots" content="noindex, follow">` to `/b/*`, and remove the `Sitemap: …/b/sitemap.xml` line from `robots.txt`.
- **Option B: keep them indexed.** Only if each page has unique value (full caption, image, topic, date, link back to the product). Then: use readable slugs (not `post_1792…`), meaningful `<title>` and meta description, drop the `ph_cron_sched_*` test posts, and make `lastmod` reflect real content changes only.
- Do **not** block `/b/` with robots.txt `Disallow` — Google can't see a `noindex` on a blocked page. Use the meta tag.

**Verify.** `curl -s https://frekto.ai/b/frekto | grep -i robots` shows `noindex`; `robots.txt` no longer lists the `/b/` sitemap. In Search Console, remove the sitemap and watch the `/b/` count fall.

---

## P1 — next

### 4. `www.frekto.ai` returns 522

**Evidence.** `https://www.frekto.ai/` → **522** (Cloudflare "connection timed out to origin").

**How to fix.** In Cloudflare: add a proxied DNS record for `www` (CNAME to `frekto.ai`, orange cloud on), then a Redirect Rule: *If hostname equals `www.frekto.ai` → 301 to `https://frekto.ai${uri}`*. Also confirm `http://frekto.ai` redirects to https (not testable from the audit environment).

**Verify.** `curl -sI https://www.frekto.ai/` → `301` with `location: https://frekto.ai/`.

### 5. Titles

**Evidence.**
- All 18 blog titles end in `, Frekto Blog` and 16 of them exceed 60 characters (range 63–85), so Google will truncate them. Example (85): "The Best AI Tool for Agencies Managing Social Media for Multiple Clients, Frekto Blog".
- `/faq/` title is 14 characters, `/pricing/` 18. Too short to carry any keyword.
- Homepage: "Easiest AI Social Media Automation Tool: Business | Frekto" — "Business" at the end reads like a leftover template word.

**How to fix.**
- Blog template: drop the `, Frekto Blog` suffix (or shorten it to `| Frekto`) and write titles ≤ 60 characters. Drafts (character counts verified):

| Page | Draft title | Chars |
|------|-------------|-------|
| Homepage | Frekto: AI Social Media Automation Tool for Small Business | 58 |
| `/pricing/` | Frekto Pricing: Free, Creator, Pro & Agency Plans | 49 |
| `/faq/` | Frekto FAQ: AI Social Media Automation Questions | 48 |
| `/blog/automate-instagram-posts-brand-voice/` | Automate Instagram Posts Without Losing Your Brand Voice | 56 |
| `/blog/ai-tool-for-agencies/` | The Best AI Tool for Agencies Managing Social Media Clients | 59 |
| `/blog/batch-a-month-of-branded-posts/` | How to Create a Month of Branded Social Posts in an Hour | 56 |

- Apply the same rule to the remaining blog titles: primary phrase first, ≤ 60 characters, brand last (or omit it).
- Meta descriptions are fine (all pages 90–164 characters, none missing). Leave them.

### 6. Homepage tags and H1

**Evidence.**
- Two `twitter:card` tags and two *different* `twitter:title` / `twitter:description` / `twitter:image` sets in the same `<head>` ("Easiest AI Social Media Automation Tool: Business | Frekto" and "Automate Your Small Business Social Media with AI | Frekto").
- The H1 ("Frekto posts every day. You approve it from your inbox.") doesn't contain the target phrase "AI social media automation tool". (Growjin also flags this. It is a real but modest issue.)

**How to fix.**
- Keep one set of Twitter/OG tags; delete the duplicate block (usually a hard-coded block next to a framework-generated one).
- Don't rewrite the brand H1. Instead add the phrase to the first sentence directly under the H1, e.g. "Frekto is an AI social media automation tool that writes, designs and schedules your posts…". That is also the answer-first sentence AI engines extract (see 8).

### 7. Internal linking

**Evidence.** Inbound internal links per page (unique pages linking to it): `/blog/ai-tool-for-agencies/`, `/blog/automate-instagram-posts-brand-voice/`, `/blog/batch-a-month-of-branded-posts/` and `/blog/hashtag-strategy-for-small-business/` each have **1** (only the blog index). Also see item 2 for links to redirecting URLs.

**How to fix.**
- Add 2–3 contextual "related" links inside each post to sibling posts. Natural pairs: Instagram ↔ LinkedIn automation posts; content calendar ↔ batch-a-month ↔ stay-consistent; agencies post ↔ `/social-media-agency-alternatives/`.
- Link from `/features/` and the `/vs-*` pages to the most relevant posts, and from posts to `/features/` and `/pricing/` with descriptive anchors.
- Optional: a "Related posts" block (3 links) in the blog template solves this site-wide.

**Verify.** Re-run the inbound-link count; no sitemap page should have fewer than 3.

*Not a bug:* the 12 links to `/cdn-cgi/l/email-protection#…` return 404 to a crawler. That is Cloudflare's email-obfuscation feature (a script decodes them in browsers). No action needed.

---

## P2 — improve

### 8. AI search (AEO/GEO), per the 5-layer framework

What's already good: `llms.txt` exists (1.7 KB); `robots.txt` allows all crawlers; content is server-rendered (homepage has ~1,600 words in the raw HTML); blog posts have Article + BreadcrumbList schema with `datePublished`, `dateModified` and an author; the homepage has WebSite, Organization, SoftwareApplication, FAQPage and HowTo schema.

Gaps and fixes:
1. **Author is an Organization ("Frekto Team"), not a person.** AI engines and Google weight named experts. Add a real author with a `Person` schema (`name`, `jobTitle`, `sameAs` LinkedIn/X) on posts, plus a short bio box. Also add `sameAs` links (X, Instagram, LinkedIn, Product Hunt etc.) to the Organization schema.
2. **No question-style headings or tables** in the blog post I checked (`/blog/ai-tool-for-agencies/`; the other 17 were not checked for this). The `/vs-*` and agency-alternatives pages do have tables and some question headings. Rewrite section headings as the question people ask ("How many hashtags should a small business use?") and put a 1–2 sentence direct answer first, then detail. Add a comparison table to "Apps that auto-post to social media".
3. **`dateModified` equals `datePublished` on every post.** Update it only when you actually revise a post, and show "Last updated" on the page.
4. **`llms.txt` is out of sync with the site.** It says Frekto is for "small, local businesses… retail shops", while the homepage targets solo founders and agencies. It lists only Homepage, Pricing, Blog, Contact, Privacy. Update the positioning line and add `/features/`, `/comparison/`, `/vs-buffer/`, `/vs-canva/`, `/vs-hootsuite/`, `/vs-feedhive/`, `/vs-freelancer/`, `/social-media-agency-alternatives/`, `/faq/` and `/how-to-connect-claude-to-frekto-mcp/`. Keep the platform list consistent with the product (Instagram, Facebook, LinkedIn, Pinterest, YouTube) everywhere.
5. **Article images are hot-linked from `images.pexels.com`.** Self-host the hero images (also helps load speed and avoids broken schema images if Pexels changes).
6. **Test actual AI visibility quarterly.** Pick 10–20 queries ("best AI social media scheduling tool for small business", "Buffer alternative with AI", "how to automate Instagram posts") and record whether ChatGPT, Perplexity, Gemini and Google AI Overviews cite frekto.ai. I could not do this from the audit environment.

### 9. Core Web Vitals — not measured

Google's PageSpeed API returned `429 quota exceeded` during the audit, so LCP/INP/CLS are unmeasured. TTFB from the audit machine was ~0.6s (Growjin reports 239ms from its own server; different vantage points, not a conflict). Homepage details that were checked: 7 images, all with `alt` and width/height, 5 of 7 lazy-loaded; no render-blocking head scripts.

**To do.** Run PageSpeed Insights (mobile) on `/`, `/pricing/`, one blog post; check the Core Web Vitals report in Search Console for field data. Targets: LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1.

### 10. Content and keyword follow-ups (verify with Search Console before acting)

I had no keyword-volume or backlink tool in this session, so these are hypotheses from page content and from Growjin's Search Console data:
- **Possible cannibalization cluster:** "stay consistent posting", "how daily posting helps solopreneurs", "how an inactive account hurts your brand" and "batch a month of branded posts" all argue the same thing. In Search Console, filter by query for each pair. If two pages split impressions for one query and neither ranks in the top 10, merge the weaker into the stronger and 301 it. Don't merge on a hunch.
- **Brand misspelling:** Growjin's Search Console data shows "fraktok" (and similar) leading impressions at position ~5.3. Make sure the homepage and `/about` name "Frekto" clearly and consider an `alternateName` on the Organization schema.
- **"buffer ai" ranks 20th with zero clicks.** `/vs-buffer/` is the target page. Check its title/H1/first paragraph include "Buffer alternative" and "Buffer AI", and add the page to the comparison hub.
- **Missing explainers (also flagged by Growjin):** a "What is AI social media automation?" page and a "How to schedule social media posts" page. Both match informational queries your product pages can't rank for. Write them answer-first (see 8.2), link to `/features/` and `/pricing/`.
- **Competitor analysis was not run** (needs SERP/backlink data). Next step: pull the top 3 results for "AI social media automation tool" and "Buffer alternative", compare content depth and referring domains.

---

## Suggested order of work

1. **Day 1:** items 1, 3, 4 (all small, all stop damage).
2. **Week 1:** items 2, 5, 6, 7.
3. **Week 2–3:** items 8, 9.
4. **Ongoing:** item 10, after Search Console confirms the cannibalization and ranking data.

## After deploying — Search Console checklist
- [ ] Re-submit `sitemap.xml` (final-URL version); remove `/b/sitemap.xml` if Option A in item 3.
- [ ] URL Inspection → "Request indexing" for `/faq/` and `/how-to-connect-claude-to-frekto-mcp/`.
- [ ] Pages report: confirm soft-404 count falls and `/b/` pages drop out.
- [ ] After 2–4 weeks, check "Crawled/Discovered – not indexed" for the 4 pages Growjin listed as not indexed.
- [ ] Re-run the verify commands in items 1, 2, 4.

---

## How this compares with Growjin

| | Growjin | Skills audit |
|---|---|---|
| Soft 404 | no check | found (critical) |
| Canonical points at a redirect | checks homepage canonical only | found on 3 pages |
| Mixed trailing-slash convention | no check | found site-wide |
| Second sitemap with thin generated pages | not looked at | found |
| `www` host broken | no check | found |
| Duplicate Twitter tags | marks "Twitter Card set" as pass | found |
| Title length across the site | homepage only; "unique title" passes without running | 16 blog titles too long, 2 too short |
| Broken/redirecting links | "requires a crawler" (counted as pass) | crawled 69 targets |
| Google index status, queries, positions | **yes (Search Console)** | no access |
| Re-runs on a schedule and tracks the score | **yes** | one-off |
| Core Web Vitals | not measured | not measured (API quota) |

Two Growjin findings looked wrong: `pagerank.nav` says navigation is missing about/contact pages, but the homepage links to `/about`, `/contact`, `/features` and `/pricing`; and many of the 26 "failing" items are keyword ideas (`kw-*`), not defects, which makes the 95 hard to interpret.

**What the skills did not cover:** competitor SERP/backlink analysis, keyword volumes, Core Web Vitals, real AI-citation testing, and Google's actual index state. Those need Search Console, a SERP/backlink tool, and manual AI queries.
