Growth Hacker: SEO Audit Modules — Complete Developer Handoff

Modules covered:

Keyword Research
Meta Tag Analysis
Heading Analysis
Image ALT Analysis
Internal Links
Schema/Structured Data
Technical SEO
Keyword Opportunities (Synthesis)
Parent app: Growth Hacker
Last updated: June 2026

Table of Contents

Overview & Shared Infrastructure
Architecture & Tech Stack
Project Structure
Unified Database Schema
Module 1: Keyword Research
Module 2: Meta Tag Analysis
Module 3: Heading Analysis
Module 4: Image ALT Analysis
Module 5: Internal Links
Module 6: Schema / Structured Data
Module 7: Technical SEO
Module 8: Keyword Opportunities (Synthesis)
API Contracts
Job Queue Design
Rate Limits, Caching, & Cost Model
Testing Strategy & Acceptance Criteria
Environment Variables
Sprint Plan
Open Questions
1. Overview & Shared Infrastructure

The SEO Audit section consists of eight sub-modules. Their job is simple: given a website URL plus brand and competitor context, produce a ranked list of actionable opportunities for the user.

The entire system is designed to run on free and open-source tools only. No paid SEO APIs (Ahrefs, Semrush) are required. This trades some data precision for zero-marginal-cost operation.

Critical reuse: Modules 2–6 do not re-crawl the user's site. They consume the crawled_pages table that Module 1 already populated. This is the single biggest cost saver — one crawl, eight audits.

Shared Infrastructure

All eight modules share the same infrastructure:

Backend framework: FastAPI (Python 3.11+)
Database: PostgreSQL 15+ with pgvector extension
Cache: Redis 7+
Job queue: Celery + Redis (queues: crawl, scrape, default)
Browser automation: Playwright + httpx
NLP: spaCy 3.x with en_core_web_md
Embeddings: sentence-transformers (all-MiniLM-L6-v2)
Clustering: scikit-learn (HDBSCAN)
LLM: Anthropic Claude API (recommended) or self-hosted Llama 3 8B
Observability: Sentry
Orchestration Pattern

The audits table gets status values for each module. The main pipeline runs Module 1 first (since it owns the crawl), then fans out modules 2–7 in parallel, then runs Module 8 as the synthesis step.

python
@app.task
def run_full_audit(audit_id: str):
    pipeline = chain(
        run_keyword_research.s(audit_id),     # Module 1 — owns the crawl
        group(
            run_meta_tag_audit.s(audit_id),    # Module 2
            run_heading_audit.s(audit_id),     # Module 3
            run_image_alt_audit.s(audit_id),   # Module 4
            run_internal_link_audit.s(audit_id),  # Module 5
            run_schema_audit.s(audit_id),      # Module 6
            run_technical_audit.s(audit_id),   # Module 7
        ),
        run_opportunity_synthesis.s(audit_id),  # Module 8 — depends on all above
        finalize_audit.s(audit_id),
    )
    pipeline.apply_async()
Full audit time target: Under 7 minutes p95 for a site with <100 pages.

Shared Issue Model

Every module emits issues conforming to this shape, stored in a single global audit_issues table.

python
class Issue(BaseModel):
    module: Literal["meta", "heading", "image_alt", "internal_links", "schema", "technical", "keyword"]
    page_url: Optional[str]           # null for site-wide issues
    severity: Literal["critical", "warning", "info", "passing"]
    check_id: str                      # e.g., "meta.title_length"
    title: str                         # human-readable, ≤60 chars
    description: str                   # 1-2 sentences
    current_value: Optional[str]
    suggested_value: Optional[str]
    fix_effort_minutes: int            # estimated time to fix
    impact_score: int                  # 0-100
    related_keyword: Optional[str]     # if relevant to a specific keyword
    ai_suggestion: Optional[dict]      # populated by AI features
Module Score Model

Each module returns a 0–100 health score.

python
def compute_module_score(issues: list[Issue]) -> int:
    if not issues:
        return 100
    penalty = sum({
        "critical": 15,
        "warning": 5,
        "info": 1,
        "passing": 0,
    }[i.severity] for i in issues)
    return max(0, 100 - penalty)
The overall SEO Health Score is the weighted average of all eight modules:

python
MODULE_WEIGHTS = {
    'meta': 0.15,
    'heading': 0.10,
    'image_alt': 0.05,
    'internal_links': 0.10,
    'schema': 0.10,
    'technical': 0.25,
    'keyword_research': 0.15,
    'keyword_opportunities': 0.10,
}
2. Architecture & Tech Stack

Pipeline Architecture (Module 1)

Module 1 is structured as a nine-stage pipeline. Stages 2, 4, and 6 run sub-jobs in parallel.

text
INPUT          → URL + Brand + Competitor URLs
COLLECT        → Site crawler  |  GSC API  |  Competitor crawler        (parallel)
SEED EXTRACT   → spaCy NLP + GSC queries
EXPAND         → Autocomplete  |  PAA  |  Reddit  |  Wikipedia          (parallel)
POOL           → Dedupe + normalize
ENRICH         → Keyword Planner  |  SERP scraper  |  pytrends          (parallel)
CLUSTER        → sentence-transformers + HDBSCAN
SCORE          → LLM intent classification + opportunity formula
OUTPUT         → Persist + notify
Tech Stack Summary

Layer	Choice	Reason
Backend framework	FastAPI (Python 3.11+)	ML/NLP heavy; keeps stack uniform.
Database	PostgreSQL 15+ with pgvector	Vector storage for embeddings.
Cache	Redis 7+	Keyword metrics, rate-limit counters, job state.
Job queue	Celery + Redis	Battle-tested, clean integration.
Browser automation	Playwright	More reliable for modern SPAs.
NLP	spaCy 3.x	Fast noun phrase/entity extraction.
Embeddings	sentence-transformers (all-MiniLM-L6-v2)	Runs on CPU, 384-dim vectors.
Clustering	scikit-learn (HDBSCAN)	Density-based, no need to specify k.
LLM	Claude API or self-hosted Llama 3	Claude for quality; self-hosted to eliminate cost.
Scraping helpers	httpx, beautifulsoup4, pytrends, praw	All open source.
3. Project Structure

text
/growth_hacker
├── /seo_audit
│   ├── api/
│   │   ├── routes.py              # FastAPI routes
│   │   └── schemas.py             # Pydantic models
│   ├── collectors/
│   │   ├── site_crawler.py
│   │   ├── gsc_client.py
│   │   └── competitor_crawler.py
│   ├── extractors/
│   │   └── seed_extractor.py
│   ├── expanders/
│   │   ├── autocomplete.py
│   │   ├── paa_scraper.py
│   │   ├── reddit_client.py
│   │   └── wikipedia_client.py
│   ├── enrichers/
│   │   ├── keyword_planner.py
│   │   ├── serp_scraper.py
│   │   └── trends_client.py
│   ├── audits/                     # Modules 2-7
│   │   ├── meta_audit.py
│   │   ├── heading_audit.py
│   │   ├── image_alt_audit.py
│   │   ├── internal_link_audit.py
│   │   ├── schema_audit.py
│   │   ├── technical_audit.py
│   │   └── opportunity_synthesis.py  # Module 8
│   ├── processors/
│   │   ├── pool.py
│   │   ├── cluster.py
│   │   └── scorer.py
│   ├── jobs/
│   │   ├── celery_app.py
│   │   ├── pipeline.py
│   │   └── tasks.py
│   ├── db/
│   │   ├── models.py
│   │   ├── migrations/
│   │   └── repository.py
│   ├── config.py
│   └── tests/
│       ├── unit/
│       └── integration/
4. Unified Database Schema

sql
-- Core audit record
CREATE TABLE audits (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    url             TEXT NOT NULL,
    brand_details   JSONB NOT NULL,
    competitor_urls TEXT[] NOT NULL DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'pending',
        -- pending | crawling | extracting | expanding | enriching | clustering | scoring | complete | failed
    error_message   TEXT,
    started_at      TIMESTAMPTZ DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    CONSTRAINT valid_status CHECK (status IN (...))
);
CREATE INDEX idx_audits_user_status ON audits(user_id, status);

-- Crawled page content
CREATE TABLE crawled_pages (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_id       UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
    source         TEXT NOT NULL,             -- 'user_site' | 'competitor'
    url            TEXT NOT NULL,
    html           TEXT,
    text_content   TEXT,
    title          TEXT,
    h1             TEXT,
    crawled_at     TIMESTAMPTZ DEFAULT NOW(),
    status_code    INT
);
CREATE INDEX idx_crawled_audit ON crawled_pages(audit_id);

-- GSC query data
CREATE TABLE gsc_queries (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_id     UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
    query        TEXT NOT NULL,
    impressions  INT NOT NULL,
    clicks       INT NOT NULL,
    ctr          NUMERIC(5,4),
    position     NUMERIC(5,2)
);

-- Seed keywords
CREATE TABLE seed_keywords (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_id   UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
    keyword    TEXT NOT NULL,
    source     TEXT NOT NULL,    -- 'site' | 'gsc' | 'competitor'
    weight     NUMERIC(5,3) DEFAULT 1.0
);

-- Expanded keyword candidates
CREATE TABLE expanded_keywords (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_id        UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
    keyword         TEXT NOT NULL,
    seed_keyword_id UUID REFERENCES seed_keywords(id),
    source          TEXT NOT NULL
);

-- Keyword metrics (global cache)
CREATE TABLE keyword_metrics (
    keyword         TEXT PRIMARY KEY,
    volume_bucket   TEXT,
    volume_estimate INT,
    difficulty      INT,
    trend_data      JSONB,
    serp_features   JSONB,
    fetched_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Keyword clusters
CREATE TABLE keyword_clusters (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_id            UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
    canonical_keyword   TEXT NOT NULL,
    member_keywords     TEXT[] NOT NULL,
    cluster_embedding   vector(384),
    intent              TEXT,
    opportunity_score   NUMERIC(8,2),
    current_rank        NUMERIC(5,2),
    content_type        TEXT,
    ai_outline          JSONB
);

-- Unified audit issues
CREATE TABLE audit_issues (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_id            UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
    module              TEXT NOT NULL,
    page_url            TEXT,
    severity            TEXT NOT NULL,
    check_id            TEXT NOT NULL,
    title               TEXT NOT NULL,
    description         TEXT NOT NULL,
    current_value       TEXT,
    suggested_value     TEXT,
    fix_effort_minutes  INT,
    impact_score        INT,
    related_keyword     TEXT,
    ai_suggestion       JSONB,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Module 2: Meta audit
CREATE TABLE meta_audits (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_id              UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
    page_id               UUID NOT NULL REFERENCES crawled_pages(id),
    title                 TEXT, title_length INT, description TEXT,
    og_title TEXT, og_description TEXT, canonical_url TEXT,
    score INT, ai_rewrites JSONB
);

-- Module 3: Heading audit
CREATE TABLE heading_audits (
    id UUID PRIMARY KEY, audit_id UUID, page_id UUID,
    heading_tree JSONB, hierarchy_valid BOOLEAN, score INT, ai_outline JSONB
);

-- Module 4: Image ALT audit
CREATE TABLE image_audits (
    id UUID PRIMARY KEY, audit_id UUID, page_id UUID,
    image_url TEXT, current_alt TEXT, alt_status TEXT,
    suggested_alt TEXT, surrounding_context TEXT
);

-- Module 5: Internal links
CREATE TABLE internal_links (
    id UUID PRIMARY KEY, audit_id UUID, source_url TEXT, target_url TEXT,
    anchor_text TEXT, status_code INT
);
CREATE TABLE link_analysis (
    id UUID PRIMARY KEY, audit_id UUID, page_url TEXT,
    inbound_count INT, is_orphan BOOLEAN, pagerank_score NUMERIC,
    suggested_inbound_links JSONB
);

-- Module 6: Schema audit
CREATE TABLE schema_audits (
    id UUID PRIMARY KEY, audit_id UUID, page_id UUID,
    detected_schemas JSONB, missing_schemas TEXT[],
    ai_generated_schemas JSONB
);

-- Module 7: Technical audit
CREATE TABLE technical_audits (
    id UUID PRIMARY KEY, audit_id UUID,
    lcp_mobile_ms INT, cls_mobile NUMERIC, lighthouse_score_mobile INT,
    https BOOLEAN, sitemap_present BOOLEAN, pages_with_4xx JSONB,
    performance_root_causes JSONB, score INT
);

-- Module 8: Final opportunities
CREATE TABLE keyword_opportunities (
    id UUID PRIMARY KEY, audit_id UUID, cluster_id UUID,
    priority_tier TEXT, action_type TEXT, target_existing_page_id UUID,
    rationale TEXT, estimated_effort_hours NUMERIC,
    content_brief JSONB, internal_link_plan JSONB, score NUMERIC
);
5. Module 1: Keyword Research

Purpose

Produce a ranked list of keyword opportunities from a website URL plus brand and competitor context.

Stage-by-Stage Implementation

Stage 1 — Inputs: Receive URL, brand details, competitor URLs. Create audit record.

Stage 2 — Collect (Parallel):

Site crawler: Playwright + httpx. BFS crawl to depth 3, max 100 pages. Extract text_content, title, h1.
GSC client: Google Search Console API. Fetch last 90 days of query data. Store top 1000 queries.
Competitor crawler: Homepage + up to 10 highest-link pages. Store with source='competitor'.
Stage 3 — Seed Extraction:

python
def extract_seeds(text: str) -> list[tuple[str, float]]:
    doc = nlp(text)
    candidates = []
    for chunk in doc.noun_chunks:
        if 2 <= len(chunk.text.split()) <= 4:
            candidates.append((chunk.text.lower(), 1.0))
    for ent in doc.ents:
        if ent.label_ in ("PRODUCT", "ORG"):
            candidates.append((ent.text.lower(), 1.5))
    return candidates
Aggregate across pages, weight by frequency, take top 80. Add all GSC queries as seeds. Add top 30 competitor noun phrases.

Stage 4 — Expand (Parallel):

Autocomplete: https://suggestqueries.google.com/complete/search?q={seed}. Also alphabet suffix/prefix queries.
People Also Ask: Playwright to load Google SERP, extract PAA questions.
Reddit: praw search for seed, extract post titles and top comments.
Wikipedia: MediaWiki API to extract internal links from seed's page.
Stage 5 — Pool: Deduplicate and normalize keywords. Drop empty, <3 chars, >80 chars, or 90%+ stopwords.

Stage 6 — Enrich (Parallel):

Keyword Planner: Google Ads API for volume buckets.
SERP scraper: Compute difficulty score based on top 10 results.
pytrends: 12-month interest-over-time.
Stage 7 — Cluster:

python
embeddings = model.encode(keywords)
clusterer = HDBSCAN(min_cluster_size=2, metric='cosine')
labels = clusterer.fit_predict(embeddings)
Stage 8 — Score:

Intent classification: LLM prompt for informational/commercial/transactional/navigational.
Opportunity formula:
python
def opportunity_score(cluster) -> float:
    volume_weight = cluster.volume_estimate or 0
    difficulty_factor = (100 - cluster.difficulty) / 100
    intent_match = INTENT_MATCH_MAP[cluster.intent][business_model]
    if cluster.current_rank and 4 <= cluster.current_rank <= 20:
        rank_factor = 2.0
    else:
        rank_factor = 1.0
    return volume_weight * difficulty_factor * intent_match * rank_factor
Stage 9 — Output: Persist results, notify frontend.

6. Module 2: Meta Tag Analysis

Checks Performed (18 checks)

Check ID	Rule	Severity
meta.title_present	<title> exists	Critical
meta.title_length	50–60 chars	Warning
meta.title_keyword	Contains target keyword	Warning
meta.title_unique	No duplicate titles	Critical
meta.description_present	Exists	Critical
meta.description_length	140–155 chars	Warning
meta.description_keyword	Contains keyword	Warning
meta.og_title	Present	Warning
meta.canonical_present	Set	Critical
meta.robots_noindex	Not accidentally noindex	Critical
Implementation Logic

python
def extract_meta(html: str) -> dict:
    soup = BeautifulSoup(html, 'lxml')
    title = soup.title.string.strip() if soup.title else None
    description = soup.find('meta', attrs={'name': 'description'})
    canonical = soup.find('link', rel='canonical')
    return {
        'title': title,
        'description': description['content'] if description else None,
        'canonical': canonical['href'] if canonical else None,
    }
AI Features

One LLM call per failing tag, generating 3 rewrite variants. Batch up to 10 pages per call.

Acceptance Criteria

Audits all pages for all 18 checks
Returns 3 rewrite variants for every failing title/description
Runs in under 30 seconds for a 100-page site
7. Module 3: Heading Analysis

Checks Performed

Check ID	Rule	Severity
heading.h1_exists	At least one H1	Critical
heading.h1_single	Exactly one H1	Critical
heading.hierarchy_valid	No skipped levels	Warning
heading.h1_keyword	Contains target keyword	Warning
heading.headings_have_text	Headings contain text	Critical
Implementation Logic

python
def extract_heading_tree(html: str) -> list[dict]:
    soup = BeautifulSoup(html, 'lxml')
    flat = []
    for tag in soup.find_all(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']):
        flat.append({'level': int(tag.name[1]), 'text': tag.get_text(strip=True)})
    return build_tree(flat)

def build_tree(flat: list[dict]) -> list[dict]:
    root = []; stack = [(0, root)]
    for h in flat:
        while stack and stack[-1][0] >= h['level']:
            stack.pop()
        h['children'] = []
        stack[-1][1].append(h)
        stack.append((h['level'], h['children']))
    return root
AI Features

LLM generates recommended heading outline with H1 and H2 sections for pages with structure issues.

8. Module 4: Image ALT Analysis

Checks Performed

Check ID	Rule	Severity
image.alt_present	alt attribute exists	Critical
image.alt_not_empty	Not "" unless decorative	Warning
image.alt_not_filename	Not the filename	Warning
image.alt_descriptive	Looks descriptive	Info
image.file_size	<500KB	Info
Implementation Logic

python
def classify_decorative(img_tag, filename: str) -> bool:
    parent = img_tag.parent
    if parent.name in ('button', 'a') and parent.get_text(strip=True):
        return True
    if img_tag.get('width') and int(img_tag['width']) < 40:
        return True
    return False

def classify_alt_status(alt: str, filename: str) -> str:
    if alt is None: return 'missing'
    if alt == '': return 'empty_intentional'
    if alt == filename.split('.')[0].replace('-', ' '):
        return 'filename'
    return 'good'
AI Features

Two paths: Vision LLM (Claude Haiku, ~$0.01/image) for image-aware alt text, or text-only LLM using filename + surrounding context for zero-cost path.

9. Module 5: Internal Links

Checks Performed

Check ID	Rule	Severity
links.no_orphans	Important pages have inbound links	Warning
links.click_depth	Important pages within 3 clicks	Warning
links.no_broken_internal	No 4xx/5xx internal links	Critical
links.anchor_diversity	Diversity score > 0.4	Info
Implementation Logic

python
import networkx as nx

def build_link_graph(audit_id: str) -> nx.DiGraph:
    G = nx.DiGraph()
    for link in fetch_internal_links(audit_id):
        G.add_edge(link.source_url, link.target_url)
    return G

def find_orphans(G: nx.DiGraph, homepage_url: str) -> list[str]:
    return [n for n in G.nodes if G.in_degree(n) == 0 and n != homepage_url]
AI Features

LLM generates link injection plan: suggests which source pages should link to target pages, with anchor text and rationale.

10. Module 6: Schema / Structured Data

Checks Performed

Check ID	Rule	Severity
schema.organization	Organization schema on homepage	Critical
schema.breadcrumb	BreadcrumbList present	Warning
schema.product (e-commerce)	Product schema on product pages	Critical
schema.valid_jsonld	All JSON-LD is valid JSON	Critical
schema.required_fields	Required fields are populated	Critical
Site-Type Schema Mapping

python
EXPECTED_SCHEMAS = {
    'saas': ['Organization', 'WebSite', 'SoftwareApplication', 'FAQPage'],
    'ecommerce': ['Organization', 'WebSite', 'Product', 'Offer', 'AggregateRating'],
    'blog': ['Organization', 'WebSite', 'Article', 'Person'],
    'local_business': ['LocalBusiness', 'PostalAddress', 'OpeningHoursSpecification'],
}
Implementation Logic

python
import extruct

def extract_all_schema(html: str, url: str) -> dict:
    return extruct.extract(html, base_url=url,
        syntaxes=['json-ld', 'microdata', 'rdfa'])

def validate_schema(schema_obj: dict, schema_type: str) -> list[str]:
    required = SCHEMA_ORG_REQUIRED_FIELDS.get(schema_type, [])
    return [f"Missing: {f}" for f in required if f not in schema_obj]
AI Features

LLM generates valid JSON-LD schema for missing types, populated with real page values.

11. Module 7: Technical SEO

Checks Performed (16 checks)

Check ID	Rule	Severity
tech.cwv_lcp_mobile	LCP < 2.5s	Critical if >4s
tech.cwv_cls_mobile	CLS < 0.1	Critical if >0.25
tech.https	Site over HTTPS	Critical
tech.sitemap_present	/sitemap.xml exists	Warning
tech.no_4xx_internal	No 4xx on internal pages	Critical
tech.mobile_viewport	Viewport meta tag	Warning
Implementation Logic

python
PAGESPEED_API = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"

async def fetch_cwv(url: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.get(PAGESPEED_API, params={'url': url, 'strategy': 'mobile'})
        data = resp.json()
        metrics = data.get('loadingExperience', {}).get('metrics', {})
        return {
            'lcp_ms': metrics.get('LARGEST_CONTENTFUL_PAINT_MS', {}).get('percentile'),
            'cls': metrics.get('CUMULATIVE_LAYOUT_SHIFT_SCORE', {}).get('percentile', 0) / 100,
            'lighthouse_score': data['lighthouseResult']['categories']['performance']['score'] * 100,
        }
AI Features

LLM performs root cause analysis: identifies specific resources causing performance issues, suggests ranked fixes with effort estimates.

12. Module 8: Keyword Opportunities (Synthesis)

Purpose

Zero new external calls. Synthesizes outputs from Modules 1–7 to produce unified, prioritized recommendations for the Roadmap.

Implementation Logic

python
def synthesize_opportunities(audit_id: str):
    clusters = fetch_keyword_clusters(audit_id)
    pages = fetch_crawled_pages(audit_id)
    page_embeddings = embed_pages(pages)
    
    opportunities = []
    for cluster in clusters:
        # Page assignment
        best_match_page, similarity = find_best_page_match(cluster, page_embeddings)
        action_type = 'optimize_existing' if similarity > 0.75 else 'create_new'
        
        # Cross-module blockers
        blockers = []
        if best_match_page:
            tech_issues = fetch_critical_tech_issues(audit_id, best_match_page.url)
            if tech_issues:
                blockers.append({'module': 'technical', 'issues': tech_issues})
        
        # Priority tier
        if cluster.current_rank and 4 <= cluster.current_rank <= 10 and cluster.difficulty < 50:
            tier = 'quick_win'
        elif cluster.difficulty > 70 or len(blockers) > 2:
            tier = 'long_term'
        else:
            tier = 'strategic'
        
        # AI content brief
        brief = generate_content_brief(cluster, best_match_page)
        
        opportunities.append({...})
    
    return opportunities
AI Features

LLM generates complete content briefs including title tag, meta description, H1, H2 sections with key questions, target word count, differentiators, and internal linking suggestions.

13. API Contracts

POST /api/audits

Start a new full SEO audit.

Request:

json
{
  "url": "https://vidyback.com",
  "brand_details": {
    "name": "Vidyback",
    "industry": "ecommerce_saas",
    "usp": "AI-powered product video maker for Shopify",
    "target_audience": "small ecommerce store owners"
  },
  "competitor_urls": ["https://animoto.com", "https://kapwing.com"],
  "use_gsc": true
}
Response: 202 Accepted

json
{
  "audit_id": "9f8c2e1a-...",
  "status": "pending",
  "estimated_completion_seconds": 420
}
GET /api/audits/{audit_id}

Poll audit status.

Response:

json
{
  "audit_id": "9f8c2e1a-...",
  "status": "enriching",
  "progress": { "stage": "enriching", "percent_complete": 62 },
  "started_at": "2026-06-15T10:30:00Z"
}
GET /api/audits/{audit_id}/keywords

Return final opportunity table (Module 8 output).

GET /api/audits/{audit_id}/issues

Return all issues across all modules, filtered by module and severity.

POST /api/audits/{audit_id}/roadmap-tasks

Send an issue or opportunity to the roadmap.

14. Job Queue Design

Celery with three queues:

crawl — Playwright-heavy, long-running. 2 workers.
scrape — SERP and PAA scraping. Throttled, 4 workers.
default — Everything else. 8 workers.
python
@app.task
def run_audit(audit_id: str):
    collect = group(crawl_site.s(audit_id), fetch_gsc.s(audit_id), crawl_competitors.s(audit_id))
    pipeline = chain(
        collect,
        extract_seeds.s(audit_id),
        group(expand_autocomplete.s(audit_id), expand_paa.s(audit_id), ...),
        pool_keywords.s(audit_id),
        group(enrich_volume.s(audit_id), enrich_difficulty.s(audit_id), ...),
        cluster_keywords.s(audit_id),
        score_clusters.s(audit_id),
        finalize_audit.s(audit_id),
    )
    pipeline.apply_async()
15. Rate Limits, Caching & Cost Model

Rate Limits & Caching

Tool	Free limit	Caching
Google Autocomplete	~100 RPS	7 days per seed
Google Search Console	1,200 queries/day	24 hours per user-property
Google Keyword Planner	15,000 ops/day	30 days per keyword
Reddit API	60 req/min	7 days per query
Wikipedia API	200 req/sec	30 days per page
pytrends	IP rate-limited	14 days per keyword
PageSpeed Insights	400 queries/day	No caching (real-time)
Cost Model per Full Audit

Module	Compute	LLM (Claude)	Other
1. Keyword Research	$0.02	$0.30	$0.05-0.15 (proxy)
2. Meta Tags	$0.001	$0.05	—
3. Heading	$0.001	$0.03	—
4. Image ALT	$0.002	$0.10	—
5. Internal Links	$0.005	$0.04	—
6. Schema	$0.002	$0.06	—
7. Technical	$0.005	$0.04	—
8. Synthesis	$0.003	$0.20	—
Total	~$0.04	~$0.82	~$0.05-0.15
~$0.90–1.00 per full audit with Claude. ~$0.10 per full audit with self-hosted Llama 3.

16. Testing Strategy & Acceptance Criteria

Testing Strategy

Unit tests: Each collector, expander, enricher with vcrpy fixtures. Target 80% line coverage in processors/.
Integration tests: End-to-end against a known small site. Asserts completion under 7 minutes and ≥20 opportunities.
Manual QA: Run against SaaS, ecommerce, blog sites. Inspect top 20 opportunities for relevance.
Acceptance Criteria (All Modules)

Full audit for <100 page site completes under 7 minutes (p95)
Returns at least 20 keyword opportunities per audit
Pipeline gracefully degrades if GSC not connected
All free-tool integrations respect rate limits for 30 consecutive days
Cost per audit stays under $1.00 with Claude API
Opportunity scores correlate with manual SEO expert ranking (Spearman > 0.7)
Sentry error rate under 1% of audits in production
Module-Specific Criteria

Meta: 3 rewrite variants per failing tag
Heading: Catches all hierarchy mistakes
Image ALT: >90% accuracy identifying decorative images
Internal Links: Link injection plan >70% approval in QA
Schema: Generated schema passes Google's Rich Results Test
Technical: Root cause analysis produces actionable fixes
Synthesis: Page assignment >85% precision
17. Environment Variables

bash
# Database
DATABASE_URL=postgresql://user:pass@host/keyword_research
REDIS_URL=redis://host:6379/0

# Google APIs
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_ADS_DEVELOPER_TOKEN=...
GOOGLE_ADS_CUSTOMER_ID=...

# Reddit
REDDIT_CLIENT_ID=...
REDDIT_CLIENT_SECRET=...
REDDIT_USER_AGENT="GrowthHacker:keyword-research:v1.0"

# LLM
ANTHROPIC_API_KEY=...           # if using Claude
# OR
LLAMA_MODEL_ENDPOINT=...        # if self-hosting

# Proxy (for SERP/PAA scraping)
PROXY_PROVIDER=brightdata
PROXY_USERNAME=...
PROXY_PASSWORD=...

# Module 7 (Technical SEO)
PAGESPEED_API_KEY=              # Optional; works without key
LIGHTHOUSE_LOCAL_FALLBACK=true

# Module 4 (Image ALT)
USE_VISION_LLM=false            # Default off

# Observability
SENTRY_DSN=...
LOG_LEVEL=INFO
18. Sprint Plan (12 Weeks)

Sprint	Weeks	Focus	Deliverables