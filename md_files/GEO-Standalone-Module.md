# Generative Engine Optimization (GEO) – Standalone Module Integration Guide for Growth Hacker App

## 1. Overview

### 1.1 What is GEO?

**Generative Engine Optimization (GEO)** is the practice of optimizing websites so that AI-powered search engines — ChatGPT, Perplexity, Google AI Overviews, Gemini, and Claude — can **read, understand, and cite** your content in their generated answers.

Unlike traditional SEO, which optimizes for ranking in search result lists, GEO optimizes for **citation and inclusion** within AI-generated responses. A site can rank #1 on Google and still be invisible to AI systems.

### 1.2 GEO as a Standalone Module

GEO is built as an **independent, self-contained module** within the Growth Hacker App. It does *not* live under the existing SEO module. Instead, it:

- Runs alongside the SEO module as a peer service.
- Consumes the same core input data (Website Details, Brand Details, Competitor Details).
- Maintains its own dedicated API endpoints, database tables, and background workers.
- Offers its own user interface section/tab, separate from the SEO dashboard.

| Aspect | SEO Module | GEO Module (Standalone) |
| :--- | :--- | :--- |
| **Purpose** | Optimize for traditional search engines (Google, Bing) | Optimize for AI-generated answers (ChatGPT, Perplexity, Gemini) |
| **Core Metric** | Keyword rankings, backlinks, organic traffic | AI citation frequency, citability score, brand mention sentiment |
| **Key Checks** | Meta tags, backlinks, keyword density, load speed | `llms.txt`, AI bot access, structured citability, entity clarity |
| **Output** | Ranking reports, backlink audits | AI visibility score, fix code for AI-ready content |

---

## 2. How GEO Integrates into the Growth Hacker App

### 2.1 High-Level System Diagram

┌─────────────────────────────────────────────────────────────────────────┐
│ Growth Hacker App │
│ │
│ ┌─────────────────────┐ ┌─────────────────────────────────────┐ │
│ │ SEO Module │ │ GEO Module (NEW) │ │
│ │ (Categories 1-9) │ │ ┌───────────────────────────────┐ │ │
│ │ │ │ │ GEO Analysis Engine │ │ │
│ │ • Keyword Research │ │ │ • AI Bot Access Check │ │ │
│ │ • Meta Tags │ │ │ • llms.txt Validation │ │ │
│ │ • Heading Analysis │ │ │ • Entity Clarity │ │ │
│ │ • ... (etc.) │ │ │ • Citation-Friendliness │ │ │
│ └──────────┬──────────┘ │ │ • Schema for LLMs │ │ │
│ │ │ │ • Competitor Citation Gap │ │ │
│ │ │ └──────────────┬────────────────┘ │ │
│ │ │ │ │ │
│ └──────────────────┼─────────────────┘ │ │
│ │ │ │
│ ┌────────────────────┼────────────────────┐ │ │
│ │ │ │ │ │
│ ▼ ▼ ▼ │ │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ │ │
│ │ Website │ │ Brand │ │ Competitor │ │ │
│ │ Details │ │ Details │ │ Details │ │ │
│ └─────────────┘ └─────────────┘ └─────────────┘ │ │
│ │
└─────────────────────────────────────────────────────────────────────────┘


### 2.2 Module Boundaries

| Component | Owned By GEO | Shared with SEO |
| :--- | :--- | :--- |
| Input data (Website, Brand, Competitor) | ❌ No (read-only access) | ✅ Yes |
| Analysis engine | ✅ Yes (geo-optimizer-skill, etc.) | ❌ No |
| API endpoints (`/api/geo/*`) | ✅ Yes | ❌ No |
| Database tables (`geo_*`) | ✅ Yes | ❌ No |
| Background workers / cron jobs | ✅ Yes | ❌ No |
| UI section / dashboard | ✅ Yes | ❌ No |

---

## 3. Recommended Open-Source Tool Stack (All Free & MIT-Licensed)

All tools below are **exclusive to the GEO module** and require no dependency on your existing SEO toolchain.

### 3.1 Primary Audit Engine (Python)

**`geo-optimizer-skill`** – The most comprehensive open-source GEO audit engine.

- **Audits against 47 research-backed methods** (Princeton KDD 2024, AutoGEO ICLR 2026)
- **Scoring**: 0–100 composite score + separate Citability Score (0–100)
- **Checks**: robots.txt (22 AI bots), llms.txt, JSON-LD schema, meta tags, content citability, signals, AI discovery endpoints
- **Output formats**: text, JSON, HTML, SARIF, JUnit, GitHub Actions annotations
- **Auto-fix**: Can generate missing files (robots.txt, llms.txt, schema, meta)

```bash
pip install geo-optimizer-skill

3.2 Lightweight Audit (Python)

geo-audit – Zero-dependency, ~200-line CLI tool.

20-point audit across 4 dimensions: Entity Clarity, Citation-friendliness, Structure for extraction, Structured data coverage
Grading: A (17–20), B (14–16), C (11–13), D (8–10), F (<8)
Output: Human-readable report with prioritized fixes

python3 geo-audit.py https://yoursite.com

3.3 Developer-First Toolkit (Python)

georankpy – Developer-first GEO toolkit.

6-dimension audit: Semantic Clarity, Metadata Completeness, Chunk Retrievability, Schema Quality, Entity Richness, llms.txt Quality
Generates /llms.txt files
Flask/Django middleware for easy integration
3.4 Comprehensive CLI Toolkit (Node.js / TypeScript)

geo-ai-search-optimization – The most comprehensive open-source CLI toolkit with 55+ commands and 18+ analysis dimensions.

Full TypeScript support, zero dependencies
18+ dimensions: Citability, E-E-A-T, Readability, Heading Structure, Schema Validation, Platform Readiness, Content Freshness, and more
Auto-fix: Generates fix code for meta tags, JSON-LD, robots.txt, llms.txt
Compare: Side-by-side comparison of two pages
REST API: Built-in API server (can be run as a microservice)
Dashboard: Interactive HTML dashboard
Programmatic API: Full import support

npm install -g geo-ai-search-optimization
# Or without installing:
npx geo-ai-search-optimization diagnose https://example.com

3.5 Linter with Auto-Fix Loop (Node.js)

@ijonis/geo-lint – The first open-source linter for GEO with 97 rules.

97 rules: 36 GEO-specific, 34 SEO, 14 content quality, 10 technical, 3 i18n
Autonomous lint-fix loop: Run linter → read JSON violations → fix using each violation's suggestion → re-lint until clean
JSON output for AI agent consumption
Claude Code skill available

npm install -D @ijonis/geo-lint
npx geo-lint --format=json

3.6 CI/CD Integration (GitHub Action)

GEO Optimizer Audit – Official GitHub Action.

Runs geo audit in CI/CD pipeline
Fails build if GEO score drops below configurable threshold
Uploads results as SARIF to GitHub Security tab

- uses: Auriti-Labs/geo-optimizer-skill@v1
  with:
    url: https://yoursite.com
    min-score: 70
    format: sarif

4. Logic Flow: The 5-Phase Pipeline (Standalone)

This pipeline runs independently within the GEO module. It does not rely on outputs from the SEO module.

Phase 1: Data Ingestion

Input: URL (or list of URLs), brand name, competitor URLs (provided via the app's shared data layer).

Actions:

Fetch the target URL(s)
Parse HTML to extract DOM
Check for special files at well-known paths: /robots.txt, /llms.txt, /.well-known/ai.txt
(Optional) Crawl sitemap for full-site audit
Tool Integration:

geo-optimizer-skill handles fetching and parsing internally.
For custom crawling, the module can use pyseoanalyzer (Python) or native fetch.

Phase 2: Multi-Dimensional Analysis & Scoring

Actions: Run the audit engine on the fetched content.

geo-optimizer-skill checks:

Area	Points	What It Looks For
robots.txt	/18	22 AI bots across 3 tiers (training, search, user)
llms.txt	/18	Present, H1 + blockquote, sections, links, depth
Schema JSON-LD	/22	WebSite, Organization, FAQPage, Article, 5+ attributes, sameAs
Meta Tags	/14	Title, description, canonical, Open Graph
Content	/14	H1, statistics, external citations, heading hierarchy, lists/tables
Signals	/8	html lang, RSS/Atom feed, dateModified freshness
AI Discovery	/6	.well-known/ai.txt, /ai/summary.json, /ai/faq.json, /ai/service.json
Scoring Bands:

86–100: Excellent
68–85: Good
36–67: Foundation
0–35: Critical
Citability Score (0–100) measures content quality across 47 methods: Quotation +41%, Statistics +33%, Fluency +29%, Cite Sources +27%, and 38 more.

Command:

geo audit --url https://example.com --format json

Phase 3: Issue Detection & Violation Mapping

Actions: Parse JSON output to extract violations with suggestions.

Sample JSON Output (from geo-optimizer-skill --format json):

{
  "score": 68,
  "band": "Good",
  "citability_score": 72,
  "checks": {
    "robots_txt": { "score": 12, "max": 18, "issues": [...] },
    "llms_txt": { "score": 0, "max": 18, "issues": ["MISSING_LLMS_TXT"] },
    "schema": { "score": 14, "max": 22, "issues": [...] },
    "meta_tags": { "score": 10, "max": 14, "issues": [...] },
    "content": { "score": 8, "max": 14, "issues": [...] },
    "signals": { "score": 6, "max": 8, "issues": [...] },
    "ai_discovery": { "score": 2, "max": 6, "issues": [...] }
  },
  "recommendations": [
    "Create /llms.txt file",
    "Add FAQPage schema",
    "Add 2-3 external citations"
  ]
}

Phase 4: Prioritization & Action Plan Generation

Actions: Rank violations by severity and produce a prioritized list.

Severity Mapping:

Critical: Missing llms.txt, blocked AI bots, no schema
High: Low citability score, missing author attribution, stale content
Medium: Weak heading structure, low entity clarity
Low: Missing Open Graph tags, incomplete meta descriptions
Tool Integration: Use geo-optimizer-skill's built-in prioritization or implement custom logic based on JSON output.

Phase 5: Fix Code Generation

Actions: Generate ready-to-deploy fix code.

For Node.js backend:

npx geo-ai-search-optimization auto-fix https://example.com

This generates fix code for:

Meta tags (title, description)
JSON-LD schema
robots.txt
llms.txt
For llms.txt generation:

geo llms --base-url https://yoursite.com --output ./public/llms.txt

or

npx geo-ai-search-optimization init-llms .

For schema generation:

geo schema --type faq --url https://yoursite.com

5. API Design for the GEO Module

All endpoints are scoped under /api/geo/ to clearly separate them from the SEO module (/api/seo/).

5.1 Endpoint: POST /api/geo/audit

Request:

{
  "url": "https://example.com",
  "brand_name": "Example Brand",
  "competitor_urls": ["https://competitor1.com", "https://competitor2.com"],
  "options": {
    "include_sitemap": false,
    "format": "json"
  }
}

Response:

{
  "success": true,
  "data": {
    "url": "https://example.com",
    "geo_score": 68,
    "band": "Good",
    "citability_score": 72,
    "dimensions": {
      "robots_txt": { "score": 12, "max": 18, "status": "warning" },
      "llms_txt": { "score": 0, "max": 18, "status": "critical" },
      "schema": { "score": 14, "max": 22, "status": "warning" },
      "meta_tags": { "score": 10, "max": 14, "status": "ok" },
      "content": { "score": 8, "max": 14, "status": "warning" },
      "signals": { "score": 6, "max": 8, "status": "ok" },
      "ai_discovery": { "score": 2, "max": 6, "status": "warning" }
    },
    "actionable_insights": [
      {
        "priority": "critical",
        "category": "llms_txt",
        "title": "Missing /llms.txt File",
        "description": "No llms.txt file found at the root of the domain.",
        "fix": "Run: geo llms --base-url https://example.com --output ./public/llms.txt",
        "code_snippet": "# llms.txt content...",
        "estimated_effort": "5 minutes"
      },
      {
        "priority": "high",
        "category": "schema",
        "title": "Missing FAQPage Schema",
        "description": "No FAQPage JSON-LD schema detected.",
        "fix": "Add FAQPage schema to your page.",
        "code_snippet": "<script type=\"application/ld+json\">...</script>",
        "estimated_effort": "15 minutes"
      }
    ],
    "competitor_comparison": {
      "competitor1": { "score": 82, "band": "Excellent" },
      "competitor2": { "score": 55, "band": "Foundation" }
    }
  }
}

5.2 Endpoint: GET /api/geo/score/:url

Returns just the GEO score and band for dashboard widgets.

5.3 Endpoint: POST /api/geo/fix

Generates fix code for a specific URL.

Request:

{
  "url": "https://example.com",
  "fix_type": "llms_txt" // or "schema", "robots_txt", "meta"
}

Response:

{
  "success": true,
  "data": {
    "fix_type": "llms_txt",
    "code": "# llms.txt content...",
    "file_path": "/llms.txt"
  }
}

6. Integration Code Examples (Standalone)

6.1 Python Backend Integration (Flask/Django)

Create a dedicated service file for the GEO module, e.g., geo_service.py.

import subprocess
import json

class GEOService:
    """Standalone service for GEO analysis."""
    
    @staticmethod
    def run_audit(url: str) -> dict:
        """
        Run geo-optimizer-skill audit and return structured results.
        """
        try:
            result = subprocess.run(
                ["geo", "audit", "--url", url, "--format", "json"],
                capture_output=True,
                text=True,
                timeout=60
            )
            
            if result.returncode != 0:
                return {"error": result.stderr}
            
            audit_data = json.loads(result.stdout)
            
            return {
                "score": audit_data.get("score"),
                "band": audit_data.get("band"),
                "citability_score": audit_data.get("citability_score"),
                "dimensions": audit_data.get("checks", {}),
                "recommendations": audit_data.get("recommendations", [])
            }
        except Exception as e:
            return {"error": str(e)}
    
    @staticmethod
    def generate_llms_txt(base_url: str, output_dir: str) -> str:
        """
        Generate llms.txt file for a website.
        """
        result = subprocess.run(
            ["geo", "llms", "--base-url", base_url, "--output", f"{output_dir}/llms.txt"],
            capture_output=True,
            text=True
        )
        return result.stdout

    @staticmethod
    def compare_with_competitors(url: str, competitor_urls: list) -> dict:
        """
        Compare GEO scores with competitors.
        """
        results = {}
        for comp_url in competitor_urls:
            results[comp_url] = GEOService.run_audit(comp_url)
        return results

6.2 Node.js Backend Integration (Express)

Create a dedicated router for GEO endpoints.

// routes/geo.js
import express from 'express';
import { 
  diagnose, 
  fullPageAudit, 
  generateAutoFix, 
  generateLlmsTxt 
} from 'geo-ai-search-optimization';

const router = express.Router();

// Full audit endpoint
router.post('/audit', async (req, res) => {
  const { url, competitor_urls } = req.body;
  
  try {
    const diagnosis = await diagnose(url);
    const audit = await fullPageAudit(url);
    
    const comparisons = await Promise.all(
      (competitor_urls || []).map(async (compUrl) => {
        const compAudit = await fullPageAudit(compUrl);
        return { url: compUrl, score: compAudit.compositeScore };
      })
    );
    
    res.json({
      success: true,
      data: {
        score: diagnosis.score,
        quickWins: diagnosis.quickWins,
        dimensions: audit.dimensions,
        compositeScore: audit.compositeScore,
        competitors: comparisons
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Auto-fix endpoint
router.post('/fix', async (req, res) => {
  const { url, fix_type } = req.body;
  
  try {
    let result;
    if (fix_type === 'llms_txt') {
      result = await generateLlmsTxt(url);
    } else {
      result = await generateAutoFix(url);
    }
    
    res.json({
      success: true,
      data: {
        fix_type,
        code: result
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Score-only endpoint
router.get('/score/:url', async (req, res) => {
  try {
    const diagnosis = await diagnose(req.params.url);
    res.json({
      success: true,
      data: {
        score: diagnosis.score,
        band: diagnosis.band
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

6.3 Database Schema Extension

Create dedicated tables for the GEO module. These are separate from SEO tables.

-- GEO Audits table
CREATE TABLE geo_audits (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id),  -- Link to your app's project
    url VARCHAR(2048) NOT NULL,
    geo_score INTEGER,
    citability_score INTEGER,
    band VARCHAR(20),
    audit_json JSONB,
    recommendations JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- GEO Issues table (for tracking individual violations)
CREATE TABLE geo_issues (
    id SERIAL PRIMARY KEY,
    audit_id INTEGER REFERENCES geo_audits(id) ON DELETE CASCADE,
    category VARCHAR(50),  -- e.g., 'llms_txt', 'schema', 'robots_txt'
    priority VARCHAR(20),  -- 'critical', 'high', 'medium', 'low'
    title VARCHAR(255),
    description TEXT,
    fix_suggestion TEXT,
    code_snippet TEXT,
    estimated_effort VARCHAR(50),
    is_fixed BOOLEAN DEFAULT FALSE
);

-- GEO Fix History (for tracking applied fixes)
CREATE TABLE geo_fix_history (
    id SERIAL PRIMARY KEY,
    issue_id INTEGER REFERENCES geo_issues(id),
    fix_applied BOOLEAN DEFAULT FALSE,
    applied_at TIMESTAMP,
    applied_by INTEGER REFERENCES users(id),  -- if you have user tracking
    notes TEXT
);

-- Competitor GEO scores (for comparison dashboards)
CREATE TABLE geo_competitor_scores (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id),
    competitor_url VARCHAR(2048) NOT NULL,
    geo_score INTEGER,
    band VARCHAR(20),
    audit_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

7. Output: Actionable Insights Per Sub-Category

Every sub-category outputs specific, implementable fixes, not just scores. These are generated by the GEO module's analysis engine.

Sub-Category	Sample Insight
Entity Clarity	"H1 is 'AI Marketing Tips' but Title is 'Best Marketing Tools 2026'. Fix: Rewrite title to match H1: 'AI Marketing Tips: A Complete Guide'"
Citation-Friendliness	"Zero external citations found. Fix: Add at least 2 authoritative cited statistics or quotes from recognized experts."
Content Freshness	"Last modified date missing. Fix: Add <meta property=\"article:modified_time\" content=\"2026-06-19\"> to <head>."
llms.txt	"File missing at /llms.txt. Fix: Run geo llms --base-url https://yoursite.com --output ./public/llms.txt"
AI Bot Access	"ClaudeBot blocked in robots.txt. Fix: Add User-agent: ClaudeBot Allow: /"
Answer-Ready Structure	"Long paragraphs with no bullet points. Fix: Convert 300-word section into a 3-point bullet list under H3."
Competitor Gap	"Competitor cited for 'remote team' use-case. Fix: Add dedicated 'Remote Team Use-Case' section."
Brand Sentiment	"AI output says 'expensive compared to alternatives'. Fix: Add ROI Calculator or cost-benefit table with schema."
8. CI/CD Integration (Optional for the Module)

Add to your .github/workflows/geo.yml to run GEO audits automatically. This is independent of any SEO workflow.

name: GEO Audit

on:
  push:
    branches: [main, staging]
  schedule:
    - cron: '0 0 * * 1'  # Weekly on Monday

jobs:
  geo-audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Install geo-optimizer-skill
        run: pip install geo-optimizer-skill
      
      - name: Run GEO Audit
        uses: Auriti-Labs/geo-optimizer-skill@v1
        with:
          url: https://yoursite.com
          min-score: 70
          format: sarif
      
      - name: Upload SARIF to GitHub Security
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: geo-audit.sarif

9. Developer Testing Checklist

Install geo-optimizer-skill: pip install geo-optimizer-skill
Test single URL audit: geo audit --url https://example.com --format json
Test JSON output parsing
Test sitemap audit: geo audit --sitemap https://example.com/sitemap.xml --format json
Test llms.txt generation: geo llms --base-url https://example.com --output ./llms.txt
(Optional) Install geo-ai-search-optimization: npm install -g geo-ai-search-optimization
Test Node.js diagnosis: npx geo-ai-search-optimization diagnose https://example.com
Test auto-fix: npx geo-ai-search-optimization auto-fix https://example.com
Verify all 8 sub-categories produce actionable insights
Test competitor comparison endpoint
Test CI/CD integration with GitHub Action
Confirm GEO module endpoints are under /api/geo/ (not /api/seo/geo/)
Confirm GEO database tables use geo_* prefix
10. UI Placement Suggestion

In the Growth Hacker App navigation, add a new top-level section for GEO:

Dashboard
├── SEO
│   ├── Keyword Research
│   ├── Meta Tags
│   ├── Backlinks
│   └── ... (existing 9 categories)
├── GEO  <-- NEW ENTRY
│   ├── AI Visibility Score
│   ├── llms.txt Status
│   ├── AI Bot Access
│   ├── Competitor Citation Gap
│   ├── Actionable Fixes
│   └── History
└── Settings

11. References

Resource	Link
geo-optimizer-skill (PyPI)	https://pypi.org/project/geo-optimizer-skill/
geo-optimizer-skill (GitHub)	https://github.com/Auriti-Labs/geo-optimizer-skill
geo-audit (PyPI)	https://pypi.org/project/geo-audit/
geo-ai-search-optimization (npm)	https://www.npmjs.com/package/geo-ai-search-optimization
@ijonis/geo-lint (npm)	https://www.npmjs.com/package/@ijonis/geo-lint
Princeton KDD 2024 Paper	https://arxiv.org/abs/2311.09735
AutoGEO ICLR 2026 Paper	https://arxiv.org/abs/2510.11438
12. Summary

The Generative Engine Optimization (GEO) module is built as a standalone, independent service within the Growth Hacker App. It:

Operates alongside the SEO module, not under it.
Shares core inputs (Website, Brand, Competitor) but processes them independently.
Uses dedicated API endpoints (/api/geo/*), database tables (geo_*), and background workers.
Analyzes across 8 GEO dimensions using research-backed, open-source tools.
Outputs prioritized, code-level actionable insights for improving AI search visibility.
All tools used are free and open-source (MIT-licensed). The dual Python + Node.js approach provides maximum flexibility, with the Python tools serving as the primary audit engine and the Node.js tools providing auto-fix and REST API capabilities.

