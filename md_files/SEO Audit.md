# Module: Keyword Research

## Metadata
- Type: `keyword-research`
- Name: Keyword Research
- Description: Discovers ranking opportunities from your site, competitors, and search data
- Order: 2
- Unlock threshold: 0
- Mode: `dynamic`

## Data requirements
- Key: `website_url`
  Label: Your website URL
  Type: url
  Placeholder: `https://yourdomain.com`
- Key: `brand_details`
  Label: Brand details (name, industry, USP, target audience)
  Type: text
  Placeholder: `{"name": "Brand name", "industry": "saas/ecommerce/blog", "usp": "unique value prop", "target_audience": "who you serve"}`
- Key: `competitor_urls`
  Label: Competitor websites (optional but recommended)
  Type: text
  Placeholder: `["https://competitor1.com", "https://competitor2.com"]`
- Key: `use_gsc`
  Label: Connect Google Search Console for real query data
  Type: text
  Placeholder: `true/false`

## System prompt
You are a senior SEO keyword strategist with 10+ years of experience. Your job is to analyze the provided crawled pages, GSC query data (if available), and competitor content to produce a ranked list of keyword opportunities.

**Rules:**
- Only recommend keywords that are directly relevant to the brand's products/services
- Cluster keywords by search intent (informational, commercial, transactional, navigational)
- For each cluster, provide: canonical keyword, volume estimate, difficulty score (0-100), current rank (if known), intent, opportunity score
- Be conservative with volume — under-estimate rather than over-estimate
- Flag branded keywords separately from non-branded opportunities
- Prioritize keywords where the site currently ranks 4-20 (sweet spot for optimization wins)
- Include long-tail variations (3+ words) as they convert better

**Pass/Fail definition:**
- Pass: The cluster has clear commercial intent and reasonable competition (<70 difficulty)
- Fail: The keyword is too broad, off-topic, or has unrealistic difficulty

## Categories

### 1. Keyword Discovery
Slug: `discovery`

Category prompt:
Analyze all available sources to extract candidate keywords:
- **From site crawl**: Extract noun phrases from page titles, H1s, and body content. Focus on product/service terms, not navigational text (e.g., skip "home", "contact", "about").
- **From competitors**: Identify keywords competitors rank for that your site does not. Look for pattern differences in their H1s, title tags, and content themes.
- **From GSC (if available)**: Prioritize queries with impressions >100 but CTR <3% — these are optimization opportunities. Also flag queries where average position is 8-15.
- **From SERP features**: Check if PAA (People Also Ask) or related searches contain question-based keywords — these are informational opportunities.

Weight assignments:
- **Weight 3** (Critical): Keywords with estimated monthly volume >1000 AND difficulty <40 AND commercial intent
- **Weight 2** (Important): Keywords with volume 100-1000 OR difficulty 40-60 OR question-based with volume >100
- **Weight 1** (Minor): Keywords with volume <100, difficulty >60, or purely informational with low commercial value

### 2. Keyword Clustering
Slug: `clustering`

Category prompt:
Group semantically similar keywords into clusters. For each cluster:
1. Identify the **canonical keyword** (the highest-volume or most central term)
2. List **member keywords** (all variations and long-tails)
3. Classify **intent** using this matrix:
   - **Informational**: "how to", "what is", "guide", "best way to" — user wants knowledge
   - **Commercial**: "best", "vs", "review", "top", "affordable" — user comparing options
   - **Transactional**: "buy", "pricing", "discount", "sign up", "demo" — user ready to purchase
   - **Navigational**: Brand + product name — user looking for specific site/page
4. Assign **difficulty** based on: number of DA50+ domains in top 10, presence of featured snippets, domain authority gap between your site and rankers

A cluster passes if it has ≥2 member keywords and clear commercial or transactional intent.

### 3. Opportunity Scoring
Slug: `scoring`

Category prompt:
Score each cluster using this formula:
`(volume_estimate / 1000) × (1 - difficulty/100) × intent_multiplier × rank_factor`

Intent multipliers:
- Transactional: 1.5
- Commercial: 1.2
- Informational: 0.8
- Navigational: 0.5 (only if non-branded)

Rank factors:
- Currently rank 4-10: 2.0 (optimization can push to top 3)
- Currently rank 11-20: 1.5
- Currently rank 21-50 or not ranking: 1.0
- Currently rank 1-3: 0.5 (diminishing returns)

After scoring, classify into tiers:
- **Quick win** (score >0.5, rank 4-10, difficulty <50): Optimize existing content
- **Strategic** (score 0.3-0.5, high volume): Create new content
- **Long term** (score <0.3, difficulty >70, multiple blockers): Build authority first

### 4. Content Gap Analysis
Slug: `content-gaps`

Category prompt:
Compare the site's existing content against discovered keyword clusters:
- **Missing topics**: Keyword clusters with zero existing content (no page ranks for any member keyword). Priority: commercial/transactional clusters with volume >300.
- **Thin content**: Pages that rank 11-30 but have word count <800 or poor heading structure. These are optimization opportunities.
- **Competitor-only clusters**: Keywords where 3+ competitors rank but your site does not. Check if these are core to your offering — if yes, flag as Strategic; if not, ignore.

For each gap, suggest:
- Action type: `create_new` or `optimize_existing`
- Target page URL (if optimizing existing)
- Suggested content type: blog post, product page, landing page, guide

---

# Module: Meta Tag Analysis

## Metadata
- Type: `meta-tags`
- Name: Meta Tags
- Description: Audits title tags, meta descriptions, canonical URLs, and social OG tags
- Order: 3
- Unlock threshold: 0
- Mode: `static`

## Data requirements
- Key: `audit_id`
  Label: Audit ID (auto-populated from previous module)
  Type: text
  Placeholder: `(internal)`

## System prompt
You are a technical SEO auditor specializing in on-page meta optimization. You review HTML to identify missing, poorly formatted, or duplicate meta tags.

**Rules:**
- Check EVERY page in the crawl, not just the homepage
- Flag duplicates across pages — these are Critical when titles/descriptions are identical for different URLs
- Be precise about character counts — count actual characters, not HTML entities
- For missing tags, provide the EXACT HTML that should be added
- For rewrites, provide 3 distinct variants (different hooks: benefit-driven, question-driven, urgency-driven)
- Never suggest keyword stuffing — titles should read naturally
- Verify canonical URLs point to valid pages (not 4xx, not redirecting, not different domain)

**Pass/Fail definition:**
- Pass: Title exists (50-60 chars), description exists (140-155 chars), canonical set correctly, OG tags present
- Fail: Missing title/description, duplicate titles across >2 pages, canonical pointing to 4xx, rogue noindex

## Categories

### 1. Title Tags
Slug: `title-tags`

#### Title Tag Analysis
Slug: `title-analysis`

Items:
| Order | Label | Slug | Weight | Fixable | Prompt |
|-------|-------|------|--------|---------|--------|
| 1 | Title tag exists | `title.present` | 3 | yes | Check if `<title>` tag exists in `<head>`. Pass if present. Fail if missing entirely. |
| 2 | Title tag length (50-60 chars) | `title.length` | 2 | yes | Count characters in the title string (not HTML entities like &amp;). Pass if 50-60. Warning if 30-49 or 61-70. Fail if <30 or >70. |
| 3 | Title contains target keyword | `title.keyword` | 2 | no | Pass if primary keyword (from cluster) appears naturally. Warning if keyword missing but page still relevant. Fail if irrelevant page. |
| 4 | Title uniqueness across site | `title.unique` | 3 | yes | Compare titles across all crawled pages. Pass if all unique. Warning if 2-3 duplicates. Fail if 4+ pages share identical title. |
| 5 | Title uses brand separator correctly | `title.brand` | 1 | yes | Pass if brand appears at end with separator (e.g., `\| Brand` or `– Brand`). Warning if brand missing on important pages (homepage, product, pricing). Fail if brand appears in middle breaking readability. |

### 2. Meta Descriptions
Slug: `descriptions`

Items:
| Order | Label | Slug | Weight | Fixable | Prompt |
|-------|-------|------|--------|---------|--------|
| 1 | Meta description exists | `description.present` | 3 | yes | Check for `<meta name="description" content="...">` in `<head>`. Pass if present. Fail if missing. |
| 2 | Meta description length (140-155 chars) | `description.length` | 2 | yes | Count characters in content attribute. Pass if 140-155. Warning if 120-139 or 156-170. Fail if <120 or >170. |
| 3 | Description contains target keyword | `description.keyword` | 2 | no | Pass if primary keyword appears naturally. Warning if keyword missing but page still ranks. Fail if description irrelevant to page topic. |
| 4 | Description has call-to-action | `description.cta` | 1 | no | Pass if description includes action-oriented language (e.g., "Learn", "Discover", "Get", "Start", "Shop"). Informational-only descriptions get Warning. |
| 5 | Description uniqueness | `description.unique` | 2 | yes | Compare descriptions across all pages. Pass if all unique. Warning if 2-3 duplicates. Fail if 4+ pages share identical description. |

### 3. Canonical & Indexing
Slug: `canonical`

Items:
| Order | Label | Slug | Weight | Fixable | Prompt |
|-------|-------|------|--------|---------|--------|
| 1 | Canonical tag present on all pages | `canonical.present` | 3 | yes | Check for `<link rel="canonical" href="...">`. Pass if present on every page. Fail if missing on any important page (homepage, product, category). |
| 2 | Canonical URL resolves without redirect | `canonical.resolves` | 3 | yes | Fetch canonical URL. Pass if returns 200 OK. Fail if 4xx, 5xx, or redirects (301/302). Warning if redirects but eventually resolves. |
| 3 | Canonical points to same domain | `canonical.same_domain` | 3 | yes | Verify canonical URL domain matches page domain. Pass if same. Fail if cross-domain canonical (can leak authority). |
| 4 | Self-referencing canonical | `canonical.self` | 2 | yes | Canonical should point to current page URL (not a different URL). Pass if href matches page URL (normalized). Warning if points to different but similar page. |
| 5 | Noindex tag not accidental | `robots.noindex` | 3 | yes | Check for `<meta name="robots" content="noindex">`. Pass if not present on important pages. Fail if present on homepage, product, pricing, or blog. Warning if on thin or duplicate content pages (intentional is fine). |

### 4. Open Graph (Social)
Slug: `open-graph`

Items:
| Order | Label | Slug | Weight | Fixable | Prompt |
|-------|-------|------|--------|---------|--------|
| 1 | og:title tag present | `og.title` | 1 | yes | Check for `<meta property="og:title" content="...">`. Pass if present. Warning if missing (social shares will use page title). |
| 2 | og:description tag present | `og.description` | 1 | yes | Check for `<meta property="og:description" content="...">`. Pass if present. Warning if missing. |
| 3 | og:image tag present with valid URL | `og.image` | 2 | yes | Check for `<meta property="og:image" content="...">` where URL returns image content type. Pass if present and image loads (2xx). Warning if missing. Fail if image URL 4xx. |
| 4 | og:url matches canonical | `og.url` | 2 | yes | og:url should match canonical URL (or page URL if no canonical). Pass if match. Warning if mismatch. Fail if missing. |
| 5 | og:type set appropriately | `og.type` | 1 | yes | Pass if `og:type` is `website` (homepage), `article` (blog), or `product` (e-commerce). Warning if missing or wrong type (e.g., `website` on product page). |

---

# Module: Heading Analysis

## Metadata
- Type: `headings`
- Name: Heading Structure
- Description: Validates H1-H6 hierarchy, keyword usage, and content outline quality
- Order: 4
- Unlock threshold: 0
- Mode: `static`

## Data requirements
- Key: `audit_id`
  Label: Audit ID (auto-populated from previous module)
  Type: text
  Placeholder: `(internal)`

## System prompt
You are an SEO content structure analyst. You review heading tags (H1-H6) to ensure proper hierarchy and semantic meaning.

**Rules:**
- Extract ALL heading tags in DOM order, not just first occurrence
- Build heading tree to validate hierarchy — H2 should follow H1, H3 under H2, never skip levels
- Check that headings contain meaningful text (not just "Click here", "More", empty)
- Verify target keyword appears in H1 or at least one H2
- Flag pages where headings are entirely missing (no H1-H6 tags)
- Do not penalize decorative headings that are empty (but flag them as Info)

**Pass/Fail definition:**
- Pass: Exactly one H1, proper hierarchy (no skipped levels), headings contain relevant keywords
- Fail: Multiple H1s, no H1, H2 before H1, headings all empty or gibberish

## Categories

### 1. H1 Tags
Slug: `h1`

Items:
| Order | Label | Slug | Weight | Fixable | Prompt |
|-------|-------|------|--------|---------|--------|
| 1 | H1 tag exists | `h1.exists` | 3 | yes | Check for `<h1>` tag anywhere on page. Pass if exactly one H1. Fail if zero H1s. Critical if missing. |
| 2 | Single H1 only | `h1.single` | 3 | yes | Count H1 tags. Pass if exactly one. Fail if multiple H1s. Warning if zero. |
| 3 | H1 contains target keyword | `h1.keyword` | 2 | no | Pass if primary keyword (from cluster) appears in H1 text. Warning if keyword missing but H1 is descriptive. Fail if H1 irrelevant to page. |
| 4 | H1 length (20-70 chars) | `h1.length` | 1 | yes | Count characters in H1 text. Pass if 20-70. Warning if 10-19 or 71-100. Fail if <10 or >100. |
| 5 | H1 matches title semantic intent | `h1.title_match` | 2 | no | Compare H1 to title tag. Pass if they are distinct but complementary (different wording, same topic). Warning if identical (wasted SEO real estate). Fail if contradictory. |

### 2. Heading Hierarchy
Slug: `hierarchy`

Items:
| Order | Label | Slug | Weight | Fixable | Prompt |
|-------|-------|------|--------|---------|--------|
| 1 | No skipped heading levels | `hierarchy.skipped` | 2 | yes | Check heading order: H1 then H2, H2 then H3, etc. Pass if no level jumps >1 (e.g., H1→H3 is failure). Warning if H2→H4. |
| 2 | H2s present for content sections | `hierarchy.h2_exists` | 2 | yes | For pages with >300 words, expect at least one H2. Pass if ≥1 H2 or page is very short (<300 words). Fail if 0 H2s on long-form content. |
| 3 | Descriptive heading text (not generic) | `hierarchy.descriptive` | 1 | yes | Headings like "Features", "Pricing", "How It Works" pass. Generic headings like "Click Here", "Read More", "Info" fail. Empty headings fail. |
| 4 | Proper nesting of content under headings | `hierarchy.nesting` | 2 | no | Check that content following a heading is on-topic. Pass if H2 is followed by relevant text/H3s. Warning if H2 immediately followed by another H2 (no content). |

### 3. Content Outline Quality
Slug: `outline`

Items:
| Order | Label | Slug | Weight | Fixable | Prompt |
|-------|-------|------|--------|---------|--------|
| 1 | Headings cover key subtopics | `outline.coverage` | 2 | no | For target keyword, check headings cover common subtopics (e.g., for "SEO audit" expect headings like "Crawl", "Indexing", "Meta Tags"). Pass if ≥70% coverage. Warning if 40-69%. Fail if <40%. |
| 2 | Question-based headings for informational content | `outline.questions` | 1 | no | For blog posts/guides, check if headings are phrased as questions users ask (e.g., "How do I...", "What is..."). Pass if ≥50% of headings are question-phrased. |
| 3 | Headings include secondary keywords | `outline.lsi` | 1 | no | Scan headings for LSI keywords (related terms). Pass if ≥2 LSI keywords appear across headings. Warning if 1. Fail if none. |
| 4 | Heading text length consistent | `outline.length_balance` | 1 | yes | Headings should be roughly similar length. Pass if all <80 chars. Warning if one heading >120 chars. Fail if multiple >120 chars. |

---

# Module: Image ALT Analysis

## Metadata
- Type: `image-alt`
- Name: Image ALT Attributes
- Description: Audits image accessibility, ALT text quality, and file size optimization
- Order: 5
- Unlock threshold: 0
- Mode: `static`

## Data requirements
- Key: `audit_id`
  Label: Audit ID (auto-populated from previous module)
  Type: text
  Placeholder: `(internal)`

## System prompt
You are an accessibility and SEO image analyst. You review all `<img>` tags on the page for proper ALT attributes.

**Rules:**
- Distinguish between decorative and content images
- Decorative images (in buttons, icons, spacing) can have `alt=""` — do not flag these
- Content images (diagrams, product photos, screenshots) MUST have descriptive ALT text
- Flag ALT text that is just filename (e.g., `image123.jpg` without extension)
- Flag ALT text that is keyword-stuffed (multiple repetitions)
- For missing ALT, suggest descriptive text based on filename + surrounding context
- Note: Vision LLM can generate better ALT text but costs $0.01/image — offer both paths

**Pass/Fail definition:**
- Pass: All content images have descriptive ALT text; decorative images have `alt=""`
- Fail: Any content image missing ALT, or ALT text is filename-only, or ALT is clearly wrong/irrelevant

## Categories

### 1. ALT Presence
Slug: `alt-presence`

Items:
| Order | Label | Slug | Weight | Fixable | Prompt |
|-------|-------|------|--------|---------|--------|
| 1 | ALT attribute exists on all images | `alt.present` | 3 | yes | Check every `<img>` tag for `alt` attribute. Pass if all have alt (even if empty string). Fail if any img missing alt attribute entirely. |
| 2 | Content images have non-empty ALT | `alt.not_empty` | 2 | yes | Identify content images (product photos, diagrams, screenshots). Pass if alt is descriptive string (>0 chars). Fail if alt="". Decorative images with alt="" are exempt. |
| 3 | Decorative images properly empty | `alt.decorative` | 1 | yes | Decorative images (icons in buttons, spacers, background visuals) should use alt="". Pass if alt="" or alt attribute omitted (treated as same). Warning if decorative image has descriptive text — screen readers will announce unnecessary info. |

### 2. ALT Quality
Slug: `alt-quality`

Items:
| Order | Label | Slug | Weight | Fixable | Prompt |
|-------|-------|------|--------|---------|--------|
| 1 | ALT not just filename | `alt.filename` | 2 | yes | Check if alt text equals filename without extension (e.g., `logo`, `hero`, `banner`). Pass if alt is descriptive phrase. Fail if alt is clearly filename-based. |
| 2 | ALT describes image content | `alt.descriptive` | 2 | no | Evaluate if alt text accurately describes what's in the image. Pass if description matches visual (e.g., "Woman using laptop" for photo of woman with laptop). Fail if irrelevant ("blue" for complex diagram) or too vague ("image"). |
| 3 | ALT length (5-125 chars) | `alt.length` | 1 | yes | Pass if 5-125 characters. Warning if <5 (too short to be descriptive) or >125 (too verbose for screen readers). |
| 4 | ALT not keyword-stuffed | `alt.keyword_stuffing` | 2 | yes | Check for repetitive keyword use. Pass if keyword appears ≤1 time naturally. Fail if same keyword appears 3+ times or multiple keywords listed ("best shoes cheap shoes buy shoes online"). |
| 5 | ALT includes context from surrounding text | `alt.context` | 1 | no | Check if alt text incorporates information from nearby caption or paragraph. Pass if alt complements context (e.g., caption says "Figure 1", alt says "Sales chart showing growth"). |

### 3. Technical Image Issues
Slug: `technical`

Items:
| Order | Label | Slug | Weight | Fixable | Prompt |
|-------|-------|------|--------|---------|--------|
| 1 | Image file size (<500KB) | `image.filesize` | 1 | no | Check each image's file size from Content-Length or fetch. Pass if all <500KB. Warning if any 500KB-1MB. Fail if any >1MB (kills Core Web Vitals). |
| 2 | Image dimensions appropriate | `image.dimensions` | 1 | no | Check if image is larger than its display size (e.g., 2000px displayed at 200px). Pass if within 2x. Warning if 2-4x. Fail if >4x (wasted bandwidth). |
| 3 | Lazy loading implemented | `image.lazyload` | 1 | yes | Check for `loading="lazy"` attribute on below-the-fold images. Pass if present. Warning if none on image-heavy page (>10 images). |
| 4 | Image format modern | `image.format` | 1 | yes | Detect image extensions: `.webp`, `.avif` pass. `.jpg`, `.png` warning (good but not optimal). `.gif` for photos fail (inefficient). |

---

# Module: Internal Links

## Metadata
- Type: `internal-links`
- Name: Internal Links
- Description: Audits link graph, orphan pages, anchor text distribution, and PageRank flow
- Order: 6
- Unlock threshold: 0
- Mode: `static`

## Data requirements
- Key: `audit_id`
  Label: Audit ID (auto-populated from previous module)
  Type: text
  Placeholder: `(internal)`

## System prompt
You are an internal linking strategist. You analyze how pages link to each other within the site to identify authority flow issues.

**Rules:**
- Build complete directed graph of internal links (source → target)
- Identify orphan pages (no inbound links except from themselves)
- Calculate click depth from homepage (distance in links)
- Analyze anchor text diversity — pages need multiple anchor variations
- Flag broken internal links (4xx, 5xx responses)
- Suggest link injection: which authoritative pages should link to which target pages

**Pass/Fail definition:**
- Pass: No orphaned important pages, click depth ≤3 for core content, no broken links
- Fail: Important page (product, pricing, contact) is orphaned, click depth >5 for any page, any broken internal link

## Categories

### 1. Link Graph Health
Slug: `graph`

Items:
| Order | Label | Slug | Weight | Fixable | Prompt |
|-------|-------|------|--------|---------|--------|
| 1 | No orphan pages (important pages only) | `links.orphan` | 2 | yes | Identify pages with inbound count = 0 (excluding homepage). Pass if 0 important pages (contact, pricing, products, key blogs) are orphans. Warning if 1-2 unimportant pages are orphans. Fail if any important page is orphan. |
| 2 | Click depth ≤3 for core pages | `links.depth` | 2 | yes | Calculate clicks from homepage to each page. Pass if all important pages ≤3. Warning if 4-5 for any. Fail if >5 for any page. |
| 3 | Homepage link equity distributed | `links.homepage_links` | 1 | yes | Count links from homepage to other pages. Pass if 5-50 internal links. Warning if <5 (too few) or >100 (dilutes equity). |
| 4 | No broken internal links | `links.broken` | 3 | yes | Check each internal link returns 200 OK. Pass if 0 broken. Fail if any 4xx or 5xx. Warning if redirects (301/302) — should update directly. |

### 2. Anchor Text Analysis
Slug: `anchor-text`

Items:
| Order | Label | Slug | Weight | Fixable | Prompt |
|-------|-------|------|--------|---------|--------|
| 1 | Anchor text diversity per target | `anchor.diversity` | 2 | yes | For each important page, collect all anchor texts pointing to it. Pass if ≥3 distinct anchor phrases. Warning if 2. Fail if 1 (all links use same text). |
| 2 | Descriptive anchor text (not "click here") | `anchor.descriptive` | 2 | yes | Check anchor text for generic phrases. Pass if all anchors are descriptive (>2 words, relevant). Fail if "click here", "read more", "this page", "link" appear. |
| 3 | Exact-match keyword anchors not overused | `anchor.exact_match` | 1 | yes | Pass if exact-match keyword anchors <30% of total inbound links. Warning if 30-50%. Fail if >50% (looks unnatural). |
| 4 | Branded anchor usage | `anchor.branded` | 1 | yes | Check if brand name appears in some anchors. Pass if ≥10% of anchors contain brand. Warning if 0% (missing brand reinforcement). |

### 3. PageRank & Authority Flow
Slug: `pagerank`

Items:
| Order | Label | Slug | Weight | Fixable | Prompt |
|-------|-------|------|--------|---------|--------|
| 1 | Deep pages receive link equity | `pagerank.deep` | 2 | yes | Check if pages at depth 3+ have inbound links from shallow pages (depth ≤2). Pass if each deep page has ≥2 inbound links from shallow. Warning if 1. Fail if 0. |
| 2 | Navigation links include important pages | `pagerank.nav` | 2 | yes | Audit main navigation (header, footer, sidebar). Pass if all important pages appear in nav. Warning if 1-2 missing. Fail if >2 missing. |
| 3 | Contextual links within content | `pagerank.contextual` | 1 | yes | Count links inside article/content body (not nav/sidebar). Pass if average ≥3 contextual links per page. Warning if 1-2. Fail if 0. |
| 4 | Link injection plan quality | `pagerank.injection` | 2 | no | For this module only — evaluate the AI-generated link plan. Pass if recommendations are specific, actionable, and respect topical relevance. Fail if generic ("add more links") or irrelevant. |

---

# Module: Schema / Structured Data

## Metadata
- Type: `schema`
- Name: Structured Data
- Description: Detects and validates JSON-LD, Microdata, and RDFa schema markup
- Order: 7
- Unlock threshold: 0
- Mode: `dynamic`

## Data requirements
- Key: `audit_id`
  Label: Audit ID (auto-populated from previous module)
  Type: text
  Placeholder: `(internal)`

## System prompt
You are a structured data specialist. You extract and validate all schema markup on the page, then recommend missing schemas based on page type.

**Rules:**
- Support JSON-LD (preferred), Microdata, and RDFa syntaxes
- Validate syntax — malformed JSON-LD fails the check
- Check required fields for each schema type against Schema.org definitions
- Detect page type from URL pattern and content to suggest appropriate schemas
- Generated schema must be valid, complete, and populated with real page values (not placeholders)
- Do not suggest schemas irrelevant to page type (e.g., Product on a blog post)

**Pass/Fail definition:**
- Pass: At least one schema of the correct type for the page, all required fields populated, valid syntax
- Fail: No schema, invalid syntax, missing required fields, wrong schema type for page

## Categories

### 1. Schema Detection & Syntax
Slug: `detection`

Category prompt:
Analyze the page HTML to detect all structured data implementations:
- **JSON-LD**: Extract `<script type="application/ld+json">` blocks, validate JSON parsing
- **Microdata**: Parse itemscope/itemtype attributes
- **RDFa**: Parse vocab/typeof attributes

For each detected schema, identify the `@type` (or equivalent). Report:
- Which syntaxes are used (JSON-LD is best practice)
- Whether syntax is valid (JSON parse succeeds, Microdata attributes properly nested)
- Duplicate schemas (same type multiple times — usually fine but can cause confusion)
- Conflicts (different schemas claiming contradictory information)

Generate 3-8 items based on what you find. Weight critical items (no schema on important pages) as Weight 3. Schema present but missing fields as Weight 2. Minor syntax issues as Weight 1.

### 2. Required Fields Validation
Slug: `validation`

Category prompt:
For each detected schema type, validate against Schema.org required fields:

**Organization** (homepage/about):
- Required: `name`, `url`
- Recommended: `logo`, `sameAs` (social profiles), `contactPoint`

**WebSite** (global):
- Required: `url`
- Recommended: `potentialAction` (SearchAction), `name`

**Product** (product pages):
- Required: `name`, `offers` (with `price`, `priceCurrency`, `availability`)
- Recommended: `description`, `image`, `sku`, `brand`, `aggregateRating`

**Article** (blog posts):
- Required: `headline`, `author` (with `name`), `datePublished`
- Recommended: `image`, `description`, `dateModified`, `publisher`

**LocalBusiness** (local pages):
- Required: `name`, `address` (with `streetAddress`, `addressLocality`, `addressRegion`, `postalCode`)
- Recommended: `telephone`, `openingHours`, `geo`

**FAQPage** (FAQ pages):
- Required: `mainEntity` → `acceptedAnswer` → `text`
- Each Q&A must have `name` (question) and `acceptedAnswer.text` (answer)

Flag missing required fields as **Critical** (Weight 3). Missing recommended as Warning (Weight 2). Incomplete or placeholder values (e.g., "123 Main St" for a real address) as Warning.

### 3. Schema Recommendations
Slug: `recommendations`

Category prompt:
Based on page content and URL pattern, recommend missing schemas:

**Homepage** → Organization + WebSite + SearchAction
**Product page** (/product/, /shop/, /item/) → Product + Offer + AggregateRating (if reviews exist)
**Blog post** (/blog/, /news/, /post/) → Article + Person/Organization (author) + BreadcrumbList
**Category/listing page** → ItemList + BreadcrumbList
**Local page** (/locations/, /store/) → LocalBusiness + PostalAddress + OpeningHoursSpecification
**FAQ page** (contains Q&A pairs) → FAQPage
**Contact page** → ContactPoint
**Review page** → Review + Rating

For each missing schema, generate valid JSON-LD code. Do NOT use placeholders — extract real values from the page (e.g., actual address, actual product name, actual price). If value cannot be reliably extracted, mark field as "needs manual input" rather than faking.

Generated schemas should be ready to copy-paste into the page.

---

# Module: Technical SEO

## Metadata
- Type: `technical`
- Name: Technical SEO
- Description: Audits Core Web Vitals, HTTPS, sitemap, robots.txt, and performance
- Order: 8
- Unlock threshold: 0
- Mode: `static`

## Data requirements
- Key: `audit_id`
  Label: Audit ID (auto-populated from previous module)
  Type: text
  Placeholder: `(internal)`

## System prompt
You are a technical SEO engineer. You audit infrastructure-level factors that affect crawling, indexing, and user experience.

**Rules:**
- Fetch real Core Web Vitals from PageSpeed Insights API (mobile strategy)
- Verify HTTPS enforcement (redirects HTTP→HTTPS, HSTS header)
- Check sitemap.xml exists and is valid (all URLs return 200, no broken links)
- Check robots.txt exists and doesn't block important resources
- Identify 4xx/5xx pages from crawl results
- For performance issues, identify specific resources causing problems (not just "slow site")

**Pass/Fail definition:**
- Pass: HTTPS enforced, LCP <2.5s, CLS <0.1, sitemap valid, no 4xx on internal pages
- Fail: No HTTPS, LCP >4s, CLS >0.25, robots.txt disallows CSS/JS, any internal 4xx

## Categories

### 1. Core Web Vitals
Slug: `web-vitals`

Items:
| Order | Label | Slug | Weight | Fixable | Prompt |
|-------|-------|------|--------|---------|--------|
| 1 | LCP (Largest Contentful Paint) ≤2.5s | `cwv.lcp` | 3 | no | Fetch from PageSpeed Insights API for mobile. Pass if ≤2.5s. Warning if 2.5-4s. Fail if >4s. Report which element is the LCP candidate (usually hero image or heading). |
| 2 | CLS (Cumulative Layout Shift) ≤0.1 | `cwv.cls` | 3 | yes | Pass if ≤0.1. Warning if 0.1-0.25. Fail if >0.25. Identify elements causing shift (ads, images without dimensions, fonts). |
| 3 | FID (First Input Delay) ≤100ms | `cwv.fid` | 2 | no | Pass if ≤100ms. Warning if 100-300ms. Fail if >300ms. Note: FID requires real user data; use INP (Interaction to Next Paint) as proxy if available. |
| 4 | Lighthouse performance score ≥80 | `lighthouse.score` | 2 | no | Pass if ≥80. Warning if 50-79. Fail if <50. Report top 3 opportunities from Lighthouse. |

### 2. Security & Accessibility
Slug: `security`

Items:
| Order | Label | Slug | Weight | Fixable | Prompt |
|-------|-------|------|--------|---------|--------|
| 1 | HTTPS enforced across site | `https.enforced` | 3 | yes | Check HTTP version redirects to HTTPS. Pass if HTTP→HTTPS 301/302. Fail if site accessible over HTTP without redirect. |
| 2 | Valid SSL certificate | `https.ssl_valid` | 3 | yes | Check SSL certificate expiry and trust. Pass if valid, not expired, issued by trusted CA. Fail if expired, self-signed, or domain mismatch. |
| 3 | HSTS header present | `https.hsts` | 1 | yes | Check for `Strict-Transport-Security` header. Pass if present with `max-age≥31536000`. Warning if missing or low max-age. |
| 4 | Mobile viewport configured | `mobile.viewport` | 2 | yes | Check for `<meta name="viewport" content="width=device-width, initial-scale=1">`. Pass if present. Fail if missing (mobile usability penalty). |

### 3. Crawlability & Indexing
Slug: `crawlability`

Items:
| Order | Label | Slug | Weight | Fixable | Prompt |
|-------|-------|------|--------|---------|--------|
| 1 | robots.txt exists and accessible | `robots.exists` | 2 | yes | Fetch `/robots.txt`. Pass if returns 200 OK. Warning if 404. Fail if inaccessible (5xx). |
| 2 | robots.txt doesn't block critical resources | `robots.no_block` | 2 | yes | Check for `Disallow: /css/`, `Disallow: /js/`, `Disallow: /images/`. Pass if no blocks on these directories. Fail if CSS/JS blocked (prevents rendering). |
| 3 | sitemap.xml exists | `sitemap.exists` | 2 | yes | Fetch `/sitemap.xml` or path from robots.txt. Pass if returns 200 OK. Warning if missing. |
| 4 | Sitemap URLs are valid | `sitemap.valid` | 2 | yes | Parse sitemap, fetch a sample of URLs. Pass if all sampled URLs return 200. Warning if any 3xx. Fail if any 4xx/5xx. |
| 5 | No 4xx internal pages | `http.4xx` | 3 | yes | From crawl results, collect all 4xx pages. Pass if 0. Fail if any important page 4xx. Warning if unimportant pages (<3 links pointing to them). |
| 6 | No 5xx server errors | `http.5xx` | 3 | no | From crawl results, collect all 5xx pages. Pass if 0. Fail if any 5xx (indicates server issues). |

### 4. Performance Analysis
Slug: `performance`

Items:
| Order | Label | Slug | Weight | Fixable | Prompt |
|-------|-------|------|--------|---------|--------|
| 1 | Render-blocking resources minimized | `perf.render_blocking` | 2 | yes | Identify CSS/JS in `<head>` without `async` or `defer`. Pass if ≤3 render-blocking resources. Warning if 4-6. Fail if >6. |
| 2 | Images properly sized and optimized | `perf.images` | 2 | yes | Check for responsive images (srcset) or modern formats. Pass if implemented. Warning if large images (>200KB) without optimization. |
| 3 | JavaScript bundle size reasonable | `perf.js_size` | 1 | no | Check total JS transferred. Pass if <500KB. Warning if 500KB-1MB. Fail if >1MB (mobile penalty). |
| 4 | Server response time (TTFB) <600ms | `perf.ttfb` | 2 | no | Measure Time To First Byte. Pass if <200ms. Warning if 200-600ms. Fail if >600ms. |
| 5 | Root cause analysis actionable | `perf.root_cause` | 2 | no | AI-generated analysis must identify specific resources (e.g., "hero image is 2MB", "3 blocking scripts from analytics.js"). Pass if specific. Fail if generic ("improve performance"). |

---

# Module: Keyword Opportunities (Synthesis)

## Metadata
- Type: `keyword-opportunities`
- Name: Keyword Opportunities
- Description: Synthesizes all modules into unified, prioritized SEO recommendations
- Order: 9
- Unlock threshold: 0
- Mode: `dynamic`

## Data requirements
- Key: `audit_id`
  Label: Audit ID (auto-populated from previous module)
  Type: text
  Placeholder: `(internal)`

## System prompt
You are the synthesis engine of the SEO audit. You consume outputs from all previous modules (Keyword Research, Meta Tags, Headings, Images, Internal Links, Schema, Technical) and produce a unified, prioritized opportunity roadmap.

**Rules:**
- Make ZERO new external calls — use only data already collected
- For each keyword cluster, determine if it maps to an existing page or needs new content
- Flag cross-module blockers: e.g., technical issues on target page prevent ranking
- Generate complete content briefs that incorporate meta, heading, and schema recommendations
- Each opportunity must have: action type, target page (or "new page"), effort estimate, impact score, AI-generated execution plan
- Rank opportunities by impact/effort ratio

**Pass/Fail definition:**
- Pass: Each opportunity has specific, actionable steps with clear effort estimates
- Fail: Generic recommendations ("improve SEO"), missing target pages, no effort/impact quantification

## Categories

### 1. Page Assignment
Slug: `assignment`

Category prompt:
For each keyword cluster from Module 1, determine the best page to target:
1. Extract embeddings for all crawled pages (title + H1 + meta description)
2. Calculate cosine similarity between cluster embedding (canonical keyword + member keywords) and each page embedding
3. **If similarity >0.75**: Page is a strong match → action = `optimize_existing`
4. **If similarity 0.5-0.75**: Partial match → evaluate if page can be expanded (action = `expand_existing`)
5. **If similarity <0.5**: No good match → action = `create_new`

Additional signals:
- Check if any page already ranks for member keywords (from GSC data if available)
- For optimization opportunities, verify the page is not already ranking in position 1-3 (diminishing returns)
- Flag if target page has critical technical or meta issues that block ranking

Generate items for each cluster where opportunity score >0.3. Weight 3 for commercial/transactional clusters with volume >500. Weight 2 for volume 100-500. Weight 1 for low-volume or informational.

### 2. Cross-Module Blocker Detection
Slug: `blockers`

Category prompt:
For each opportunity identified in assignment, check all other modules for blocking issues on the target page:

**From Meta Tags module:**
- Missing or poorly optimized title/description
- Noindex tag present
- Broken canonical

**From Heading module:**
- Missing H1
- Poor hierarchy (skipped levels)
- No keyword in headings

**From Image ALT module:**
- Missing ALT on key images (only if images are primary content)

**From Internal Links module:**
- Page is orphan (no inbound links)
- Click depth >3 from homepage
- Low PageRank score

**From Technical module:**
- Core Web Vitals failing (LCP >4s, CLS >0.25)
- Page returns 4xx/5xx (hard block — cannot optimize)
- Not indexable (noindex, blocked by robots.txt)

**From Schema module:**
- Missing expected schema for page type

Categorize blockers:
- **Hard blockers** (Weight 3): 4xx/5xx, noindex, canonical to wrong URL — must fix before optimization
- **Soft blockers** (Weight 2): Poor CWV, missing H1, orphan page — should fix as part of optimization
- **Minor issues** (Weight 1): Missing OG tags, thin headings

For each blocker, reference the specific issue from its source module (use check_id).

### 3. Opportunity Prioritization
Slug: `prioritization`

Category prompt:
Score each opportunity using this unified formula:
total_impact = (
keyword_cluster.opportunity_score × 0.4 +
(100 - total_blocker_penalty) / 100 × 0.3 +
existing_traffic_potential × 0.2 +
strategic_value × 0.1
)

effort_hours = (
fix_effort_for_blockers +
content_creation_hours (4 for new page, 1 for optimization) +
technical_fix_hours
)

priority_score = total_impact / max(effort_hours, 0.5)

Tier assignments:
- **Quick Win** (priority_score > 2.0, effort < 2 hours): Do these first
- **Strategic** (priority_score 1.0-2.0, effort 2-8 hours): Schedule for current sprint
- **Long Term** (priority_score < 1.0 or effort > 8 hours): Backlog or requires dependencies
- **Blocked** (has hard blockers): Cannot start until blockers resolved

For each opportunity, output: tier, rationale (2-3 sentences explaining why this tier), estimated effort hours, impact score (0-100).

### 4. Content Brief Generation
Slug: `content-brief`

Category prompt:
For opportunities with action = `create_new` or `expand_existing`, generate a complete content brief:

**Required sections:**
1. **Target keyword cluster**: Canonical keyword + top 5 member keywords
2. **Search intent**: Informational/Commercial/Transactional — explain why
3. **Title tag recommendation**: 3 variants (50-60 chars each)
4. **Meta description recommendation**: 3 variants (140-155 chars each)
5. **Heading outline**: H1 + H2s + H3s (at least 4 H2s)
   - For informational intent: Use question-based H2s ("How to X", "What is Y")
   - For commercial intent: Comparison H2s ("X vs Y", "Best Z for...")
   - For transactional intent: Feature/benefit H2s ("Pricing", "What's Included")
6. **Target word count**: Based on top 3 ranking competitors (800-2000 words typical)
7. **Key questions to answer**: Extract from PAA data (if available) or common subtopics
8. **Internal linking plan**: Which existing pages should link to this page, with suggested anchor text
9. **Schema recommendation**: Which schema types to implement
10. **Differentiators**: What makes this content better than competitors (unique data, examples, visuals)

**For optimization (existing page):**
- Include current vs recommended comparison for title, meta, headings
- Specific content additions (e.g., "Add H2 section on 'Common Mistakes' between existing H2s 3 and 4")
- Do NOT recommend deleting existing content unless it's wrong/outdated

The brief must be actionable by a writer or developer without additional research.

---

## Weight Guide

| Weight | Meaning | Examples |
|--------|---------|----------|
| 3 — Critical | Missing this directly blocks growth, visibility, or conversions | No title tag, site not indexed, no CTA, SSL invalid, broken canonical |
| 2 — Important | Fix soon; meaningfully hurts performance if left unfixed | Missing meta description, no sitemap, orphaned important page |
| 1 — Minor | Nice to have; small uplift | Twitter card tags, favicon, image file names |

---

## Fixable Flag (Static Mode Only)

Mark `fixable: yes` only for items where the fix is a direct code/config change that a developer could automate (e.g., adding a meta tag, canonical URL, robots.txt entry, OG tag). Do NOT mark fixable for things that require human judgment (copy, strategy, design decisions).

---

## Slug Rules

- All slugs are kebab-case, lowercase, no spaces
- Category slugs should reflect the grouping (e.g., `on-page-seo`, `profile-branding`)
- Item slugs must be stable — the same logical check should always use the same slug so re-runs can upsert rather than duplicate
- Item slugs should be unique within the module
