# Content Audit Module – Integration Specification

## 1. Overview
The **Content Audit Module** evaluates a website’s content across seven key areas:
- **Content Gap Analysis** – topics competitors cover but you don’t.
- **Foundational Inventory** – breadth and depth of your content library.
- **Business Alignment & Audience Fit** – how well content speaks to your target audience and supports business goals.
- **Quality & Substance** – readability, multimedia, links, and overall value.
- **Blog Topic Ideas** – generate actionable blog post suggestions based on gaps and trends.
- **Content Calendar** – provide a structured editorial plan with downloadable Excel (CSV) export.
- **Content Categories** – identify core content pillars and underrepresented areas to focus on.

For each page, the module assigns a **verdict** (Keep, Refresh, Consolidate, Repurpose, Remove) and **urgency** (High, Medium, Low), along with a detailed **reason** and actionable recommendations. The output is a structured JSON report, designed to be rendered in a UI similar to the screenshot provided.

---

## 2. Module Architecture
[ Frontend / API Call ]
|
v
[ Content Audit Service ]

Input validation
URL discovery (sitemap / crawl)
Parallel page fetching
HTML parsing & metadata extraction
Analysis (7 categories)
Verdict assignment
Aggregation & output
|
v
[ JSON Response ]



The module is stateless, accepts a POST request with the required parameters, and returns a JSON report.

---

## 3. Input Parameters (API Request)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `website_url` | string | Yes | Base URL of the site to audit (e.g., `https://example.com`). |
| `target_audience` | string | Yes | Description of the ideal customer (e.g., "Enterprise CTOs"). |
| `business_goals` | string | No | Business objective (e.g., "Increase free trial sign‑ups"). Used for CTA checks. |
| `competitor_urls` | array of strings | No | List of competitor homepage URLs for gap analysis. If not provided, the module will fall back to Google search for related keywords. |
| `max_pages` | integer | No | Maximum number of pages to audit (default 50). |
| `additional_keywords` | array of strings | No | Extra keywords to consider for gap analysis. |

---

## 4. Output Format (JSON)

The response is a JSON object with the following structure:

```json
{
  "summary": {
    "total_pages": 45,
    "avg_word_count": 620,
    "avg_readability": 55,
    "verdict_counts": {
      "Keep": 12,
      "Refresh": 18,
      "Consolidate": 5,
      "Repurpose": 7,
      "Remove": 3
    }
  },
  "gap_analysis": {
    "missing_topics": ["agile", "sprint planning", "retrospectives"],
    "competitor_keywords_analysed": 35
  },
  "categories": [
    {
      "name": "Content Gap Analysis",
      "findings": [ ... ]
    },
    {
      "name": "Foundational Inventory",
      "findings": [ ... ]
    },
    {
      "name": "Business Alignment & Audience Fit",
      "findings": [ ... ]
    },
    {
      "name": "Quality & Substance",
      "findings": [ ... ]
    },
    {
      "name": "Blog Topic Ideas",
      "findings": [ ... ]
    },
    {
      "name": "Content Calendar",
      "findings": [
        {
          "title": "Suggested 30‑Day Editorial Calendar",
          "severity": "Low",
          "auto_fixable": true,
          "description": "A balanced mix of content stages.",
          "action": "Download the Excel file below for a week‑by‑week plan.",
          "hasDownload": true   // indicates a downloadable file is available
        }
      ]
    },
    {
      "name": "Content Categories",
      "findings": [ ... ]
    }
  ],
  "page_audit": [
    {
      "url": "https://example.com/page1",
      "title": "Home",
      "word_count": 150,
      "readability": 45,
      "alignment": 0.2,
      "quality": 0.15,
      "verdict": "Remove",
      "urgency": "High",
      "reason": "Thin content with no images or links.",
      "action": "Either expand this page to at least 500 words with images and internal links, or no‑index and 301 redirect to a more relevant page."
    }
    // ... one entry per audited page
  ]
}

5. Detailed Category Logic

5.1. Content Gap Analysis

Goal: Identify topics your content does not cover but competitors do.

Implementation:

Extract keywords from each page’s body_text using YAKE (unsupervised keyword extraction). Keep top 10 keywords per page.
Build a global set of your keywords (union of all page keywords).
Extract keywords from competitor homepages (or from Google search results for your target topics) using the same method → competitor keywords.
Missing topics = competitor_keywords - your_keywords.
For each missing keyword that appears in ≥2 competitor sources, generate a finding.
Finding Template:

{
  "title": "Missing content on '[keyword]'",
  "severity": "Important",  // or "Critical" if keyword has high search volume / is a core differentiator
  "auto_fixable": true,
  "description": "Competitors like [Competitor Name] cover '[keyword]' extensively, but your site has zero mentions. This is a gap for users searching for that topic.",
  "action": "Create a comprehensive pillar page targeting '[keyword]' with sub‑topics A, B, C. Aim for at least 1,500 words and include internal links to related content."
}

5.2. Foundational Inventory

Goal: Assess breadth and depth of your content library.

Checks:

Total pages – if < 10, flag “Thin content library”.
Average word count – if < 500, flag “Content is generally shallow”.
Content age – if most pages are > 2 years old without updates, flag “Stale content”.
Content type diversity – check for presence of blogs, case studies, product pages, about page. Missing a key type is a gap.
Findings:

For average word count:

{
  "title": "Average word count is below recommended 800 (currently 420)",
  "severity": "Important",
  "auto_fixable": true,
  "description": "Your content averages 420 words per page, which is below the 800‑word benchmark for in‑depth SEO. Shallow content may rank poorly.",
  "action": "Identify the 5 pages with the lowest word count and expand them to at least 800 words each, adding examples and visuals."
}

5.3. Business Alignment & Audience Fit

Goal: Measure how well each page speaks to the target audience and supports business goals.

Checks:

Audience term mentions: Count how many times target audience terms (e.g., “CTO”, “manager”, “enterprise”) appear in body_text and meta_description. If < 3 mentions on a page, flag.
Semantic similarity: Compute TF‑IDF cosine similarity between the audience description and the page’s body_text. Threshold: < 0.3 → flag.
Goal‑oriented CTA: Check if the page contains a call‑to‑action that matches the business goal (e.g., “Start free trial” for “increase sign‑ups”). Use a list of goal‑aligned phrases provided or auto‑detected.
Findings:

For low mentions:
{
  "title": "Target audience 'ecommerce store owners' mentioned only 0 times",
  "severity": "Critical",
  "auto_fixable": true,
  "description": "Your ideal customer is 'ecommerce store owners', yet this term doesn't appear anywhere on the page. Visitors won't feel you understand their world.",
  "action": "Add phrases like 'for ecommerce store owners' to your headline, introduction, and at least one sub‑heading."
}

For missing CTA:

{
  "title": "No CTA aligned with business goal (drive demos)",
  "severity": "Important",
  "auto_fixable": true,
  "description": "Your business goal is to drive product demos, but this page lacks a prominent demo request button or link.",
  "action": "Add a 'Request a Demo' button above the fold and link to your demo scheduling page."
}

5.4. Quality & Substance

Goal: Evaluate page quality.

Checks:

Word count: < 300 → Thin; 300–800 → Acceptable; > 800 → Good.
Readability (Flesch Reading Ease): < 40 → Hard; 40–60 → OK; > 60 → Good.
Images count: 0 → Poor; 1–2 → OK; ≥3 → Good.
Internal links: < 3 → Poor; ≥5 → Good.
External links: 0 → No authority; ≥2 → Good.
Grammar/Spelling: Use basic spell checker (e.g., pyspellchecker). Flag if > 5 errors per 1000 words.
Findings:

For thin content:

{
  "title": "Page '[Title]' has only 150 words and 0 images",
  "severity": "Critical",
  "auto_fixable": true,
  "description": "This page is extremely thin, which hurts SEO and user engagement.",
  "action": "Expand the content to at least 500 words, add 2–3 relevant screenshots or diagrams, and include a few internal links to related articles."
}

For low readability:

{
  "title": "Readability score is 32 – too complex for your audience",
  "severity": "Important",
  "auto_fixable": true,
  "description": "The text is written at a college‑graduate level, but your target audience (project managers) may prefer simpler language.",
  "action": "Shorten sentences, replace jargon with plain English, and aim for a Flesch score above 50."
}
5.5. Blog Topic Ideas

Goal: Generate a list of specific blog post topics that are aligned with audience interests, competitor gaps, and trending industry themes.

Implementation:

Use the missing_topics from Gap Analysis as primary seed topics.
Enrich with additional keywords from additional_keywords and high‑volume search terms (optional).
For each topic, generate a title and a brief outline (e.g., using a template or LLM integration if available).
Prioritize topics that have high search volume, low competition, or strong business relevance.
Findings:

The module produces at least one finding with a list of recommended blog topics. Each finding includes:

Title: e.g., "10 Blog Topics Based on Gap Analysis"
Severity: Low (since these are proactive suggestions, not urgent fixes)
Auto‑fixable: True (writing content is a user action)
Description: Explains the origin of the topics (gaps, trends, audience needs)
Action: Lists specific topic ideas with brief context or suggested angle.
Finding Template:

{
  "title": "10 Blog Topics Based on Gap Analysis",
  "severity": "Low",
  "auto_fixable": true,
  "description": "Leverage missing competitor topics and audience interests to generate high‑potential blog posts.",
  "action": "Consider these topics: 'Agile for Enterprise CTOs', 'Sprint Planning Pitfalls', 'Retrospective Techniques That Work', 'Kanban vs Scrum for Large Teams', 'Scrum Master Career Path'. Each should include real‑world examples and actionable advice."
}

5.6. Content Calendar

Goal: Provide a structured, actionable editorial calendar that helps the user plan content creation over a defined period (e.g., 30 days).

Implementation:

Use the generated blog topics and content category priorities to build a schedule.
Assign each topic a target publication date, content format (blog, video, case study, etc.), and status (e.g., Draft, Review, Final).
Provide a downloadable Excel file (CSV format) with columns: Date, Topic, Category, Status, Priority.
The calendar should balance content stages: awareness, consideration, decision, and retention.
Finding:

A single finding per audit, containing a description and a hasDownload flag set to true. The download link/button is part of the UI action.

Finding Template:

{
  "title": "Suggested 30‑Day Editorial Calendar",
  "severity": "Low",
  "auto_fixable": true,
  "description": "A balanced mix of awareness, consideration, and decision‑stage content to support your funnel.",
  "action": "Download the Excel file below for a week‑by‑week plan with topics, formats, and target keywords.",
  "hasDownload": true
}

Downloadable File Specification:

Format: CSV with .xls extension (compatible with Excel).
Columns: Date (YYYY-MM-DD), Topic, Category, Status (Draft/Review/Final), Priority (High/Medium/Low).
Contains at least 10 entries covering a 30‑day period.

5.7. Content Categories

Goal: Identify the key content pillars (core themes) the business should focus on, and highlight underrepresented areas that need more investment.

Implementation:

Cluster existing pages by topic using keyword extraction and TF‑IDF to detect main themes.
Compare with competitor categories and industry standards.
Generate a list of recommended categories (e.g., "Agile Methodologies", "Leadership & Team Management", "Product Strategy", "Tools & Technology").
For each category, assess current coverage (number of pages, average quality, alignment) and flag gaps.
Findings:

Two types of findings:

Core Pillars – list of recommended categories with suggested content volume.
Underrepresented Categories – categories that have low coverage but high importance.
Finding Templates:

{
  "title": "Core Content Pillars to Focus On",
  "severity": "Important",
  "auto_fixable": true,
  "description": "Based on audience needs and competitor landscape, these four categories will drive the most impact.",
  "action": "1. Agile Methodologies (Scrum, Kanban, SAFe) – 2. Leadership & Team Management – 3. Product Strategy – 4. Tools & Technology. Aim for at least 5 pillar pages per category, with supporting blog posts and case studies."
},
{
  "title": "Underrepresented Categories",
  "severity": "Critical",
  "auto_fixable": true,
  "description": "Your content currently lacks depth in 'Product Strategy' and 'Tools & Technology'.",
  "action": "Prioritize creating comprehensive guides on product roadmap planning and project management software comparisons."
}

6. Verdict Assignment Logic

For each page, compute:

quality_score (0–1) using weighted metrics (see pseudocode).
alignment = cosine similarity between audience description and page body (if audience provided).
Then apply the following decision tree:

IF word_count < 200 OR quality_score < 0.2:
    verdict = "Remove"
    urgency = "High"
    reason = "Thin content or very low quality."

ELSE IF word_count < 500 AND quality_score < 0.4:
    verdict = "Refresh"
    urgency = "Medium"
    reason = "Low word count and quality; update with more substance."

ELSE IF quality_score < 0.3:
    verdict = "Remove"
    urgency = "High"
    reason = "Very low quality, no images or links."

ELSE IF alignment < 0.3:
    verdict = "Repurpose"
    urgency = "Medium"
    reason = "Low audience alignment; consider repurposing for a different channel."

ELSE IF quality_score < 0.6 AND word_count < 800:
    verdict = "Refresh"
    urgency = "Medium"
    reason = "Good topic but needs more depth and visual elements."

ELSE:
    # Cannibalization check: count other pages sharing ≥3 keywords with this page
    overlap_count = count_other_pages_with_keyword_overlap(page, all_pages, threshold=3)
    IF overlap_count > 2:
        verdict = "Consolidate"
        urgency = "High"
        reason = f"Cannibalizes with {overlap_count} other pages covering similar topics. Merge into a pillar."
    ELSE IF quality_score > 0.7 AND alignment > 0.6:
        verdict = "Keep"
        urgency = "Low"
        reason = "High quality and strong audience fit."
    ELSE:
        verdict = "Repurpose"
        urgency = "Medium"
        reason = "Good quality but could be turned into a different format for better reach."

Urgency may be escalated based on additional signals (e.g., high backlink count, high traffic data if available). For now, we use the above logic.

7. Auto‑Fixable Flag

Auto‑fixable = True if the action can be performed by the user without developer assistance (e.g., editing CMS content, adding images, updating meta tags, creating new pages, internal linking). It is False if the fix requires code changes (e.g., migrating from SPA to SSR, implementing server‑side rendering, fixing JavaScript‑only rendering). In our implementation, we mark most copy, metadata, and content structure issues as auto‑fixable. Technical issues like “JavaScript‑only SPA” are flagged as non‑auto‑fixable.

8. Tools & Dependencies (All Free/Open‑Source)

Tool	Purpose
requests	Fetch HTML
beautifulsoup4	Parse HTML
lxml	Faster XML parsing (sitemap)
spaCy (en_core_web_sm)	Tokenization, NER (optional)
nltk (VADER)	Sentiment (optional)
textstat	Readability (Flesch)
yake	Keyword extraction
scikit-learn	TF‑IDF vectorization and cosine similarity
pyspellchecker	Basic spelling check
googlesearch-python	Fetch competitor keywords (no API key)
wikipedia-api	(optional) Knowledge Graph check
python-dateutil	Parse dates
Install via pip install requests beautifulsoup4 lxml spacy nltk textstat yake scikit-learn pyspellchecker googlesearch-python python-dateutil

9. Implementation Steps (Pseudocode)

def content_audit(website_url, target_audience, competitor_urls=None, business_goals=None, max_pages=50):
    # 1. Discover page URLs
    page_urls = get_sitemap_urls(website_url) or crawl_for_internal_links(website_url)
    page_urls = page_urls[:max_pages]
    if not page_urls:
        raise Exception("No pages found to audit.")

    # 2. Fetch and parse each page
    pages = []
    for url in page_urls:
        try:
            html = fetch_page(url)
            page_data = parse_page(html, url)
            pages.append(page_data)
        except Exception as e:
            continue

    # 3. Competitor keywords
    competitor_keywords = []
    if competitor_urls:
        for comp_url in competitor_urls:
            try:
                comp_html = fetch_page(comp_url)
                comp_data = parse_page(comp_html, comp_url)
                competitor_keywords.extend(extract_keywords(comp_data['body_text']))
            except:
                pass

    # 4. Global keyword sets
    all_our_keywords = set()
    for p in pages:
        all_our_keywords.update(extract_keywords(p['body_text']))
    missing_topics = [k for k in set(competitor_keywords) if k not in all_our_keywords]

    # 5. Prepare category findings (7 categories)
    findings = {
        "gap": [],
        "inventory": [],
        "alignment": [],
        "quality": [],
        "blog_topics": [],
        "calendar": [],
        "categories": []
    }

    # 6. Foundational inventory checks
    # ... (same as before)

    # 7. Per‑page analysis (alignment, quality, verdict)
    # ... (same as before)

    # 8. Generate Blog Topic Ideas
    blog_topics = generate_blog_topics(missing_topics, pages, target_audience)
    findings["blog_topics"].append({
        "title": "10 Blog Topics Based on Gap Analysis",
        "severity": "Low",
        "auto_fixable": True,
        "description": "Leverage missing competitor topics and audience interests.",
        "action": "Consider topics: " + ", ".join(blog_topics[:10])
    })

    # 9. Generate Content Calendar (with download flag)
    findings["calendar"].append({
        "title": "Suggested 30‑Day Editorial Calendar",
        "severity": "Low",
        "auto_fixable": True,
        "description": "A balanced mix of content stages to support your funnel.",
        "action": "Download the Excel file below for a week‑by‑week plan.",
        "hasDownload": True
    })

    # 10. Generate Content Categories
    core_pillars, underrepresented = identify_content_categories(pages, missing_topics)
    findings["categories"].append({
        "title": "Core Content Pillars to Focus On",
        "severity": "Important",
        "auto_fixable": True,
        "description": "Based on audience needs and competitor landscape...",
        "action": "1. " + ", ".join(core_pillars) + ". Aim for at least 5 pillar pages per category."
    })
    if underrepresented:
        findings["categories"].append({
            "title": "Underrepresented Categories",
            "severity": "Critical",
            "auto_fixable": True,
            "description": f"Your content lacks depth in {', '.join(underrepresented)}.",
            "action": "Prioritize creating comprehensive guides in these areas."
        })

    # 11. Build output
    return {
        "summary": { ... },
        "gap_analysis": { ... },
        "categories": [
            {"name": "Content Gap Analysis", "findings": findings["gap"]},
            {"name": "Foundational Inventory", "findings": findings["inventory"]},
            {"name": "Business Alignment & Audience Fit", "findings": findings["alignment"]},
            {"name": "Quality & Substance", "findings": findings["quality"]},
            {"name": "Blog Topic Ideas", "findings": findings["blog_topics"]},
            {"name": "Content Calendar", "findings": findings["calendar"]},
            {"name": "Content Categories", "findings": findings["categories"]}
        ],
        "page_audit": pages
    }

10. API Endpoint

Endpoint: POST /api/content-audit

Request Body (JSON):

{
  "website_url": "https://example.com",
  "target_audience": "Enterprise CTOs",
  "business_goals": "Increase demos",
  "competitor_urls": ["https://asana.com", "https://monday.com"],
  "max_pages": 50
}

Response: JSON as described in section 4.

Error Responses:

400 Bad Request – missing required parameters.
500 Internal Server Error – fetching/crawling failure.

11. Performance Considerations

Use parallel fetching (e.g., asyncio + aiohttp) to speed up page retrieval.
Cache HTML responses to avoid re‑fetching during development.
Respect robots.txt and set reasonable delays.
Limit max pages to avoid timeout (default 50, configurable).
Use streaming parser for large sitemaps.

12. Extensibility

The module is designed to be extended:

Add more checks (e.g., social media sharing data, backlink analysis) by adding new functions and including them in the category findings.
Support for Google Analytics data (if provided) to adjust urgency based on actual traffic.
Integration with CMS APIs to automatically apply fixes (auto‑fixable items can be pushed as tasks).

13. Example Partial Output

{
  "summary": {
    "total_pages": 8,
    "avg_word_count": 340,
    "avg_readability": 48,
    "verdict_counts": {"Keep": 1, "Refresh": 3, "Consolidate": 2, "Repurpose": 1, "Remove": 1}
  },
  "gap_analysis": {
    "missing_topics": ["agile", "sprint", "retrospective"],
    "competitor_keywords_analysed": 25
  },
  "categories": [
    {
      "name": "Content Gap Analysis",
      "findings": [ ... ]
    },
    {
      "name": "Blog Topic Ideas",
      "findings": [
        {
          "title": "10 Blog Topics Based on Gap Analysis",
          "severity": "Low",
          "auto_fixable": true,
          "description": "Leverage missing competitor topics and audience interests.",
          "action": "Consider topics: 'Agile for Enterprise CTOs', 'Sprint Planning Pitfalls', ..."
        }
      ]
    },
    {
      "name": "Content Calendar",
      "findings": [
        {
          "title": "Suggested 30‑Day Editorial Calendar",
          "severity": "Low",
          "auto_fixable": true,
          "description": "A balanced mix of content stages.",
          "action": "Download the Excel file below for a week‑by‑week plan.",
          "hasDownload": true
        }
      ]
    },
    {
      "name": "Content Categories",
      "findings": [
        {
          "title": "Core Content Pillars to Focus On",
          "severity": "Important",
          "auto_fixable": true,
          "description": "Based on audience needs and competitor landscape...",
          "action": "1. Agile Methodologies, 2. Leadership & Team Management, 3. Product Strategy, 4. Tools & Technology."
        }
      ]
    }
  ],
  "page_audit": [ ... ]
}

14. Developer Handoff Checklist

Implement the data collection pipeline (sitemap/crawl, fetch, parse).
Implement keyword extraction (YAKE) and TF‑IDF similarity.
Implement the seven category analysers (including new Blog Topic Ideas, Content Calendar, Content Categories).
Implement the content calendar CSV generation and expose download endpoint or provide base64‑encoded CSV in the response.
Expose REST API endpoint.
Add error handling and logging.
Write unit tests for each component.
Document configuration options (max_pages, timeouts, etc.).
Ensure compliance with free/open‑source licenses.
Provide sample requests and responses for frontend integration.
End of specification.