# Backlinks Optimization – Technical Specification
## Category 9 of the SEO Audit Module in "Growth Hacker"

---

## 1. Overview

This document provides the complete technical specification for integrating **"Backlinks Optimization"** as Category 9 into the SEO Audit module of the **Growth Hacker** app.

### 1.1 Core Principle

The system is designed as a **Human-in-the-Loop (HITL)** architecture:

- **Machine**: Handles all data collection, analysis, scoring, and insight generation.
- **Human (User)**: Reviews the actionable insights in each sub-category and takes manual action (copying pitches, downloading disavow files, following strategic directives).

### 1.2 Input Dependencies

The system uses the same three dependencies already captured by the Growth Hacker app for the existing 8 categories:

| Dependency | Description | How It Is Used |
| :--- | :--- | :--- |
| **Website Details** | Target domain URL | Fetches the user's own backlink profile |
| **Brand Details** | Brand name, primary keywords, niche | Personalizes outreach emails; filters irrelevant links |
| **Competitor Details** | List of competitor URLs | Runs link gap analysis (who links to competitors but not to the user) |

### 1.3 Output Structure

The category is divided into **6 independent sub-categories**. Each sub-category has its own UI tab, its own actionable insights, and its own export/action buttons. There is **no master action board** – each tab stands alone.

| Sub-Category | Type of Insight | User Action |
| :--- | :--- | :--- |
| **9.1** Backlink Profile Audit | Health score + corrective checklist | Copy/implement recommendations |
| **9.2** Competitor Link Gap | Outreach targets + AI-generated pitches | Copy pitch manually or export CSV |
| **9.3** Toxic Link Detection | List of spam domains + reasoning | Click to generate disavow.txt file |
| **9.4** Lost Link Reclamation | Lost sources + AI-generated reclaim emails | Copy email manually |
| **9.5** Anchor Text Distribution | Single warning + strategic directive | Follow the directive |
| **9.6** Link Building Opportunities | Broken links/resource pages + actions | Copy message or open submission form |

---

## 2. System Architecture

### 2.1 High-Level Data Flow

┌─────────────────────────────────────────────────────────────────────────────┐
│ GROWTH HACKER APP │
│ ┌───────────────────────────────────────────────────────────────────────┐ │
│ │ SEO AUDIT MODULE │ │
│ │ ┌─────────────────────────────────────────────────────────────────┐ │ │
│ │ │ Category 9: Backlinks Optimization │ │ │
│ │ │ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ │ │ │
│ │ │ │ 9.1 │ │ 9.2 │ │ 9.3 │ │ 9.4 │ │ │ │
│ │ │ │ Profile │ │ Link Gap │ │ Toxic │ │ Reclaim │ │ │ │
│ │ │ │ Audit │ │ │ │ Links │ │ │ │ │ │
│ │ │ └───────────┘ └───────────┘ └───────────┘ └───────────┘ │ │ │
│ │ │ ┌───────────┐ ┌───────────┐ │ │ │
│ │ │ │ 9.5 │ │ 9.6 │ │ │ │
│ │ │ │ Anchor │ │ Link │ │ │ │
│ │ │ │ Text │ │ Opport. │ │ │ │
│ │ │ └───────────┘ └───────────┘ │ │ │
│ │ └─────────────────────────────────────────────────────────────────┘ │ │
│ └───────────────────────────────────────────────────────────────────────┘ │
│ ▲ │
│ │ JSON / API │
│ │ │
│ ┌─────────────────────────────────┴─────────────────────────────────────┐ │
│ │ BACKEND PIPELINE (Self-Hosted) │ │
│ │ │ │
│ │ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │ │
│ │ │ Orchestrator │───▶│ DataFetcher │───▶│ Analyzer │ │ │
│ │ │ (Dagu/ │ │ (DataForSEO/ │ │ (Ollama + │ │ │
│ │ │ Kestra/ │ │ Playwright) │ │ Llama 3) │ │ │
│ │ │ Windmill) │ │ │ │ │ │ │
│ │ └──────────────┘ └──────────────┘ └──────────────┘ │ │
│ │ │ │
│ │ ┌──────────────┐ ┌──────────────┐ │ │
│ │ │ Storage │◀───│ Output │ │ │
│ │ │ (PostgreSQL/ │ │ Generator │ │ │
│ │ │ SQLite) │ │ │ │ │
│ │ └──────────────┘ └──────────────┘ │ │
│ └───────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘


### 2.2 Technology Stack (100% Free & Open-Source)

| Layer | Tool | License | Description |
| :--- | :--- | :--- | :--- |
| **Orchestration** | Dagu, Kestra, or Windmill | Open-source | Schedules and orchestrates the entire workflow |
| **Data Collection** | DataForSEO API | Pay-as-you-go | Fetches backlink data (min. $50 deposit, no recurring fees) |
| **Alternative Data** | Playwright + GSC | Free | Browser-based scraping as a free alternative |
| **Data Storage** | PostgreSQL or SQLite | Open-source | Stores raw and processed data |
| **AI Analysis** | Ollama + Llama 3 | Open-source (MIT) | Local LLM for scoring and insight generation |
| **Alternative AI** | Gemini API | Free tier | Cloud-based alternative with generous free quota |
| **Dashboard UI** | OpenSEO (fork) | MIT | Self-hosted SEO dashboard with backlink features |
| **Disavow Generator** | Disavow-Generator | Open-source | Generates Google-compliant disavow.txt files |

---

## 3. Detailed Sub-Category Specifications

### 3.1 Sub-Category 9.1: Backlink Profile Audit

**Purpose:** Provide an overall health assessment of the user's backlink profile with specific corrective actions.

**Logic:**

1. Fetch total backlinks, referring domains, and dofollow/nofollow ratio via DataForSEO API.
2. Compare metrics against industry benchmarks:
   - Dofollow ratio should be between 60–80%.
   - Unique referring domains should be at least 150 for competitive niches.
3. Generate a health score (A–F) based on these comparisons.
4. Output a checklist of actionable corrective steps.

**API Endpoint:** `POST /v3/backlinks/summary/live`

**Sample AI Prompt for Ollama:**

You are an SEO analyst. Analyze the following backlink metrics and provide:

An overall health score (A-F)
A checklist of 3-5 corrective actions
Metrics:

Total Backlinks: {total}
Referring Domains: {domains}
Dofollow Ratio: {dofollow}%
Competitor Average Domains: {competitor_avg}
Output as JSON with keys: "score", "actions" (array of strings).


**UI Output:**
┌─────────────────────────────────────────────────────────────────────────────┐
│ 📊 BACKLINK PROFILE AUDIT │
├─────────────────────────────────────────────────────────────────────────────┤
│ Overall Health Score: B- (Needs Improvement) │
│ │
│ ┌───────────────────┬───────────────────┬───────────────────────────┐ │
│ │ Total Backlinks │ Referring Domains │ Dofollow Ratio │ │
│ │ 1,247 │ 82 │ 95% (Too High) │ │
│ └───────────────────┴───────────────────┴───────────────────────────┘ │
│ │
│ 🔴 ACTIONABLE INSIGHTS: │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ ☐ Your dofollow ratio is 95%. Safe range is 60-80%. │ │
│ │ → Action: Acquire 20+ nofollow links from comments, forums, │ │
│ │ or social profiles to balance this. │ │
│ │ [📋 Copy Action Plan] │ │
│ ├─────────────────────────────────────────────────────────────────────┤ │
│ │ ☐ Only 82 unique domains. Competitors average 150. │ │
│ │ → Action: You need 68 more unique domains. Use the │ │
│ │ "Competitor Link Gap" tab to find them. │ │
│ │ [🔗 Go to 9.2] │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘


---

### 3.2 Sub-Category 9.2: Competitor Link Gap

**Purpose:** Identify websites that link to competitors but not to the user, and provide personalized outreach pitches.

**Logic:**

1. Fetch backlink profiles for all competitors via DataForSEO API.
2. Fetch the user's own backlink profile.
3. Compute the set difference: `(competitor_links) - (user_links)`.
4. Filter results by Domain Authority (DA > 50 recommended).
5. For each target, use Ollama to generate a personalized outreach email.

**API Endpoint:** `POST /v3/backlinks/competitors/live`

**Sample AI Prompt for Pitch Generation:**
You are an expert outreach specialist. Generate a personalized, professional,
and non-salesy email pitch for {target_domain}.

Context:

My website: {user_domain} ({user_brand})
Their website: {target_domain}
They currently link to: {competitor_name}
Why my content is better: {value_proposition}
The email should:

Compliment a specific piece of their content
Briefly introduce my resource
Explain why it adds value to their readers
Be under 150 words
Sound human, not templated
Output only the email body.


**UI Output:**
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🎯 COMPETITOR LINK GAP │
├─────────────────────────────────────────────────────────────────────────────┤
│ Found 12 websites that link to competitors but NOT to you. │
│ │
│ ┌────┬──────────────────────┬─────────┬───────────────────────────────┐ │
│ │ # │ Target Domain │ DA │ AI-Generated Pitch │ │
│ ├────┼──────────────────────┼─────────┼───────────────────────────────┤ │
│ │ 1 │ marketinginsider.com │ 78 │ "Hi [Editor], I saw your post │ │
│ │ │ │ │ on [topic]. We have a │ │
│ │ │ │ │ data-rich guide that fits..."│ │
│ │ │ │ │ [📧 Copy Pitch] │ │
│ ├────┼──────────────────────┼─────────┼───────────────────────────────┤ │
│ │ 2 │ techjournal.com │ 65 │ "Hi [Name], I noticed you │ │
│ │ │ │ │ link to [Comp A]. Here is │ │
│ │ │ │ │ why our tool is a better..." │ │
│ │ │ │ │ [📧 Copy Pitch] │ │
│ └────┴──────────────────────┴─────────┴───────────────────────────────┘ │
│ │
│ [📥 Export All Pitches (CSV)] │
└─────────────────────────────────────────────────────────────────────────────┘


---

### 3.3 Sub-Category 9.3: Toxic Link Detection

**Purpose:** Identify spammy or harmful backlinks and provide a one-click disavow file generator.

**Logic:**

1. Fetch all backlinks pointing to the user's domain.
2. For each backlink, evaluate:
   - Spam score (via DataForSEO's built-in metrics)
   - Niche relevance (compare the linking domain's category to the user's)
   - Anchor text patterns (exact-match overload)
3. Flag links with spam score > 70 or irrelevant niche.
4. Generate a Google-compliant disavow.txt file.

**API Endpoint:** `POST /v3/backlinks/backlinks/live`

**UI Output:**
┌─────────────────────────────────────────────────────────────────────────────┐
│ ☣️ TOXIC LINK DETECTION │
├─────────────────────────────────────────────────────────────────────────────┤
│ 🚨 7 toxic links detected. Submitting these to Google is strongly │
│ recommended to avoid a manual penalty. │
│ │
│ ┌────┬──────────────────────┬──────────┬───────────────────────────────┐ │
│ │ # │ Spam Domain │ Spam Score│ Reasoning │ │
│ ├────┼──────────────────────┼──────────┼───────────────────────────────┤ │
│ │ 1 │ free-gift-cards.xyz │ 97/100 │ Gambling niche. Irrelevant │ │
│ │ │ │ │ to your SaaS brand. │ │
│ ├────┼──────────────────────┼──────────┼───────────────────────────────┤ │
│ │ 2 │ seo-spam-blog.net │ 89/100 │ PBN (private blog network). │ │
│ │ │ │ │ High risk. │ │
│ ├────┼──────────────────────┼──────────┼───────────────────────────────┤ │
│ │ 3 │ clickbait-news.org │ 82/100 │ Fake news site. │ │
│ └────┴──────────────────────┴──────────┴───────────────────────────────┘ │
│ │
│ [📥 Generate Disavow File] → Downloads a ready-to-submit disavow.txt │
│ file for Google. │
└─────────────────────────────────────────────────────────────────────────────┘


**Disavow File Format:**
Google Disavow File - Generated by Growth Hacker

Date: 2026-06-19

domain:free-gift-cards.xyz
domain:seo-spam-blog.net
domain:clickbait-news.org


---

### 3.4 Sub-Category 9.4: Lost Link Reclamation

**Purpose:** Identify backlinks that were lost in the last 60–90 days and provide reclaim emails.

**Logic:**

1. Fetch historical backlink data (compare current vs. 60-day-old snapshot).
2. Identify domains that have removed links to the user.
3. For each lost link, generate a polite reclaim email via Ollama.

**Sample AI Prompt for Reclaim Email:**
You are a professional outreach specialist. Generate a polite, non-pushy
email to request reinstatement of a lost backlink.

Context:

My website: {user_domain}
Their website: {source_domain}
The article where the link was: {article_url}
My content that was linked: {content_title}
The email should:

Be friendly and respectful
Mention that the link was previously there
Explain that the content is still relevant
Ask politely if they would consider restoring it
Be under 120 words
Output only the email body.


**UI Output:**
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🔄 LOST LINK RECLAMATION │
├─────────────────────────────────────────────────────────────────────────────┤
│ You lost 4 backlinks in the last 60 days. Reclaim them now. │
│ │
│ ┌────┬──────────────────────┬──────────┬───────────────────────────────┐ │
│ │ # │ Source Domain │ Lost On │ AI Reclaim Email │ │
│ ├────┼──────────────────────┼──────────┼───────────────────────────────┤ │
│ │ 1 │ techjournal.com │ 15 days │ "Hi Webmaster, we noticed our │ │
│ │ │ │ ago │ link was removed from your │ │
│ │ │ │ │ article [URL]. Could you │ │
│ │ │ │ │ please restore it? It's │ │
│ │ │ │ │ still relevant..." │ │
│ │ │ │ │ [📧 Copy Email] │ │
│ ├────┼──────────────────────┼──────────┼───────────────────────────────┤ │
│ │ 2 │ startupblog.co │ 32 days │ [AI generates another │ │
│ │ │ │ ago │ personalized email] │ │
│ └────┴──────────────────────┴──────────┴───────────────────────────────┘ │
│ │
│ [📥 Export Reclaim List (CSV)] │
└─────────────────────────────────────────────────────────────────────────────┘


---

### 3.5 Sub-Category 9.5: Anchor Text Distribution

**Purpose:** Detect over-optimization risks in anchor text distribution and provide a strategic corrective directive.

**Logic:**

1. Fetch all backlinks with their anchor texts.
2. Classify each anchor into one of three categories:
   - **Branded**: Contains the brand name (e.g., "Growth Hacker")
   - **Generic**: "click here", "learn more", raw URLs
   - **Exact-Match**: Contains the target keyword exactly (e.g., "buy SEO tool")
3. Calculate percentages for each category.
4. If exact-match > 20%, flag as "over-optimization risk" (Google Penguin penalty risk).

**UI Output:**
┌─────────────────────────────────────────────────────────────────────────────┐
│ 📝 ANCHOR TEXT DISTRIBUTION │
├─────────────────────────────────────────────────────────────────────────────┤
│ Current Distribution: │
│ ┌──────────────────────────────────────────────────────────────────────┐ │
│ │ Branded (e.g., "Growth Hacker") ████████████ 45% │ │
│ │ Generic (e.g., "click here") ██████ 20% │ │
│ │ Exact-Match (e.g., "buy SEO tool") ██████████ 35% ⚠️ │ │
│ └──────────────────────────────────────────────────────────────────────┘ │
│ │
│ 🔴 ACTIONABLE INSIGHT: │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ Exact-match anchor text is 35% (safe limit is < 20%). │ │
│ │ → Action: You are at high risk of a Google Penguin penalty. │ │
│ │ Build 10 new backlinks using ONLY branded anchors │ │
│ │ (e.g., "Growth Hacker") or raw URLs (e.g., "growthhacker.com") │ │
│ │ to dilute this percentage. │ │
│ │ Use the "Competitor Link Gap" tab to find targets. │ │
│ │ [🔗 Go to 9.2] │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘


---

### 3.6 Sub-Category 9.6: Link Building Opportunities

**Purpose:** Identify quick-win opportunities: broken links on industry sites and resource pages that accept submissions.

**Logic:**

1. Identify industry-relevant websites (via competitor analysis + search).
2. Scan these sites for broken outgoing links (404 errors).
3. Check if the user has content that could replace the broken link.
4. Also identify "resource" or "tools" pages that list similar tools/guides.
5. Provide the user with the target URL and a suggested action.

**Implementation Options:**

- **Option A**: Use Playwright to crawl target sites and detect 404s.
- **Option B**: Use DataForSEO's On-Page API to detect broken links.

**UI Output:**
┌─────────────────────────────────────────────────────────────────────────────┐
│ ⚡ QUICK-WIN OPPORTUNITIES │
├─────────────────────────────────────────────────────────────────────────────┤
│ Found 8 quick-win opportunities: broken links or resource pages that │
│ accept submissions. │
│ │
│ ┌────┬──────────────────────┬──────────┬───────────────────────────────┐ │
│ │ # │ Target Site │ Type │ Suggested Action │ │
│ ├────┼──────────────────────┼──────────┼───────────────────────────────┤ │
│ │ 1 │ industryhub.com │ Broken │ They have a broken link to a │ │
│ │ │ /resources │ Link │ dead page. Your guide on │ │
│ │ │ │ │ [topic] is the perfect fit. │ │
│ │ │ │ │ [📧 Send Suggestion] │ │
│ ├────┼──────────────────────┼──────────┼───────────────────────────────┤ │
│ │ 2 │ besttools.com │ Resource │ Has a "Best SEO Tools" page. │ │
│ │ │ /best-seo-tools │ Page │ You're missing. They accept │ │
│ │ │ │ │ submissions via form. │ │
│ │ │ │ │ [🔗 Open Submission] │ │
│ └────┴──────────────────────┴──────────┴───────────────────────────────┘ │
│ │
│ [📥 Export All Opportunities (CSV)] │
└─────────────────────────────────────────────────────────────────────────────┘


---

## 4. Implementation Guide

### 4.1 Prerequisites

| Requirement | Details |
| :--- | :--- |
| **Server** | Linux VPS with at least 4GB RAM, 20GB storage |
| **Docker** | For containerized deployment of all services |
| **DataForSEO Account** | $50 minimum deposit, no recurring fees |
| **Domain/SSL** | For production deployment |

### 4.2 Option 1: Using Dagu (Lightweight, Recommended for Startups)

Dagu is a lightweight, single-binary workflow engine with no database dependency.

**Installation:**

```bash
# Download Dagu
curl -L https://github.com/dagu-org/dagu/releases/latest/download/dagu_linux_amd64.tar.gz | tar xz
sudo mv dagu /usr/local/bin/

# Start the web UI
dagu server
# Browse to http://localhost:8080

Workflow Definition (backlink-analysis.yaml):

name: backlink-analysis
schedule: "0 9 * * 1"  # Every Monday at 9 AM

params:
  - name: domain
    value: "{{ .Input.domain }}"
  - name: competitors
    value: "{{ .Input.competitors }}"

steps:
  - name: fetch-user-backlinks
    command: |
      curl -X POST https://api.dataforseo.com/v3/backlinks/summary/live \
        -H "Authorization: Basic {{ .Env.DATAFORSEO_API_KEY }}" \
        -H "Content-Type: application/json" \
        -d '{"target": "{{ .Params.domain }}"}'
    output: user_backlinks.json

  - name: fetch-competitor-backlinks
    command: |
      for comp in {{ .Params.competitors }}; do
        curl -X POST https://api.dataforseo.com/v3/backlinks/summary/live \
          -H "Authorization: Basic {{ .Env.DATAFORSEO_API_KEY }}" \
          -H "Content-Type: application/json" \
          -d '{"target": "'$comp'"}'
      done
    output: competitor_backlinks.json

  - name: analyze-with-ollama
    command: |
      python3 /app/analyze_backlinks.py \
        --user user_backlinks.json \
        --competitors competitor_backlinks.json \
        --output insights.json
    depends:
      - fetch-user-backlinks
      - fetch-competitor-backlinks

  - name: save-to-database
    command: |
      python3 /app/save_insights.py --input insights.json
    depends:
      - analyze-with-ollama

4.3 Option 2: Using Kestra (Enterprise-Grade)

Kestra is a 100% open-source orchestration platform with 600+ plugins.

Installation:
docker run --pull=always --rm -it -p 8080:8080 --user=root \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /tmp:/tmp kestra/kestra:latest server local

Access the UI at http://localhost:8080.

Workflow Definition (backlink-analysis.yml):

id: backlink-analysis
namespace: growth-hacker

tasks:
  - id: fetch-user-backlinks
    type: io.kestra.plugin.core.http.Request
    uri: https://api.dataforseo.com/v3/backlinks/summary/live
    method: POST
    headers:
      Authorization: "Basic {{ secret('DATAFORSEO_API_KEY') }}"
      Content-Type: "application/json"
    body: |
      {"target": "{{ inputs.domain }}"}

  - id: fetch-competitor-backlinks
    type: io.kestra.plugin.core.http.Request
    uri: https://api.dataforseo.com/v3/backlinks/competitors/live
    method: POST
    headers:
      Authorization: "Basic {{ secret('DATAFORSEO_API_KEY') }}"
      Content-Type: "application/json"
    body: |
      {"target": "{{ inputs.domain }}"}

  - id: analyze-with-ollama
    type: io.kestra.plugin.scripts.python.Script
    script: |
      import json
      import requests
      # ... analysis logic ...
    inputFiles:
      user_data: "{{ outputs.fetch-user-backlinks.body }}"
      competitor_data: "{{ outputs.fetch-competitor-backlinks.body }}"

  - id: save-insights
    type: io.kestra.plugin.jdbc.postgresql.Query
    url: jdbc:postgresql://postgres:5432/growth_hacker
    username: "{{ secret('DB_USER') }}"
    password: "{{ secret('DB_PASSWORD') }}"
    sql: |
      INSERT INTO backlink_insights (domain, category, insight, action_type)
      VALUES (?, ?, ?, ?)

4.4 Option 3: Using Windmill (Fastest, Developer-Focused)

Windmill is an open-source developer platform that turns scripts into workflows.

Installation:
git clone https://github.com/windmill-labs/windmill.git
cd windmill
docker-compose up -d

Access at http://localhost:8000.

Python Script for Windmill (backlink_analyzer.py):

import wmill
import requests
import json

@wmill.task
def fetch_backlinks(domain: str, api_key: str) -> dict:
    """Fetch backlinks from DataForSEO API"""
    response = requests.post(
        "https://api.dataforseo.com/v3/backlinks/summary/live",
        headers={"Authorization": f"Basic {api_key}"},
        json={"target": domain}
    )
    return response.json()

@wmill.task
def analyze_with_ollama(data: dict) -> dict:
    """Analyze backlink data using local Ollama"""
    response = requests.post(
        "http://localhost:11434/api/generate",
        json={
            "model": "llama3:8b",
            "prompt": f"Analyze this backlink data and provide insights: {json.dumps(data)}",
            "stream": False
        }
    )
    return response.json()

@wmill.workflow
def backlink_pipeline(domain: str, competitors: list):
    user_data = fetch_backlinks(domain)
    insights = analyze_with_ollama(user_data)
    # Save to database or return to Growth Hacker API
    return insights

4.5 DataForSEO API Integration

Official Python Client:

pip install dataforseo-client
Sample Code:

from dataforseo.client import DataForSeoClient

client = DataForSeoClient(
    login="your_login",
    password="your_password"
)

# Fetch backlinks summary
response = client.post("/v3/backlinks/summary/live", {
    "target": "example.com"
})

# Fetch competitor backlinks
response = client.post("/v3/backlinks/competitors/live", {
    "target": "example.com"
})

# Fetch detailed backlinks
response = client.post("/v3/backlinks/backlinks/live", {
    "target": "example.com",
    "limit": 100
})

Pricing: DataForSEO operates on a pay-as-you-go model with a $50 minimum deposit and no recurring fees. The Backlinks API requires a $100/month commitment.

4.6 Ollama + Llama 3 Setup

Installation:

# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull Llama 3 model
ollama pull llama3:8b

# Run the model
ollama run llama3:8b

API Call from Python:

import requests

def analyze_with_llama(prompt: str) -> str:
    response = requests.post(
        "http://localhost:11434/api/generate",
        json={
            "model": "llama3:8b",
            "prompt": prompt,
            "stream": False
        }
    )
    return response.json()["response"]

System Prompt for Backlink Analysis:

You are a senior SEO analyst with 10+ years of experience. Your task is to
analyze backlink data and provide actionable insights. You must:

1. Score each backlink's quality from A to F based on domain authority,
   relevance, and spam signals.
2. Identify toxic/spammy links that should be disavowed.
3. Identify websites that link to competitors but not to the user.
4. Generate personalized outreach emails for link-building targets.
5. Detect over-optimization in anchor text distribution.

Always output structured data (JSON) when possible.

4.7 Database Schema

PostgreSQL Schema:

-- Table: backlink_insights
CREATE TABLE backlink_insights (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    domain VARCHAR(255) NOT NULL,
    sub_category VARCHAR(20) NOT NULL, -- 'profile_audit', 'link_gap', etc.
    insight_type VARCHAR(20) NOT NULL, -- 'action', 'warning', 'opportunity'
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    action_data JSONB, -- Stores pitches, URLs, etc.
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'actioned', 'dismissed'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: backlink_raw_data
CREATE TABLE backlink_raw_data (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    source_domain VARCHAR(255) NOT NULL,
    target_url TEXT,
    anchor_text TEXT,
    domain_authority INTEGER,
    spam_score INTEGER,
    is_dofollow BOOLEAN,
    first_seen DATE,
    last_seen DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: backlink_audit_history
CREATE TABLE backlink_audit_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    audit_date DATE NOT NULL,
    total_backlinks INTEGER,
    referring_domains INTEGER,
    dofollow_ratio DECIMAL(5,2),
    health_score CHAR(1),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

4.8 API Endpoints for Growth Hacker Integration

The backend pipeline should expose the following REST endpoints for the Growth Hacker frontend:

Endpoint	Method	Description
/api/backlinks/audit	POST	Triggers a new backlink audit for a user
/api/backlinks/profile/{user_id}	GET	Returns 9.1 data (profile audit)
/api/backlinks/link-gap/{user_id}	GET	Returns 9.2 data (competitor link gap)
/api/backlinks/toxic/{user_id}	GET	Returns 9.3 data (toxic links)
/api/backlinks/reclaim/{user_id}	GET	Returns 9.4 data (lost links)
/api/backlinks/anchor/{user_id}	GET	Returns 9.5 data (anchor text)
/api/backlinks/opportunities/{user_id}	GET	Returns 9.6 data (quick-win opportunities)
/api/backlinks/disavow/{user_id}	POST	Generates and returns disavow.txt file
/api/backlinks/insight/{id}/status	PUT	Updates insight status (pending/actioned/dismissed)
5. Alternative Free/Open-Source Tools

If DataForSEO API costs are a concern, here are free alternatives:

Tool	What It Does	How to Use
Playwright + GSC	Free browser-based scraping	Use Playwright to crawl sites and Google Search Console API for own data
Majestic Backlink Checker	Open-source backlink analysis	GitHub tool for analyzing backlinks
OpenSEO	Self-hosted SEO dashboard	MIT-licensed alternative to Semrush/Ahrefs
Python-for-SEO	Collection of SEO scripts	GitHub repo with backlink analysis scripts
DataSEO MCP	Free SEO research tool	Uses Ahrefs free data via MCP
seo-tools-api	NestJS SEO API	Includes backlink checker module
6. Summary

Component	Technology	Cost
Orchestration	Dagu / Kestra / Windmill	Free (Open-source)
Data Collection	DataForSEO API	Pay-as-you-go (~$100/mo)
Alternative Data	Playwright + GSC	Free
AI Analysis	Ollama + Llama 3	Free (Self-hosted)
Storage	PostgreSQL / SQLite	Free (Open-source)
Frontend UI	OpenSEO (fork)	Free (MIT License)
Disavow Generator	Disavow-Generator	Free (Open-source)
Total Monthly Cost: ~$100 (DataForSEO Backlinks API commitment), or $0 if using Playwright + GSC alternative.

7. References

DataForSEO API Documentation: https://docs.dataforseo.com
DataForSEO Pricing: https://dataforseo.com
Ollama + Llama 3: https://ollama.com
Dagu GitHub: https://github.com/dagu-org/dagu
Kestra GitHub: https://github.com/kestra-io/kestra  
Windmill: https://www.windmill.dev
OpenSEO GitHub: https://github.com/jeffryhawchab/openseo
Majestic Backlink Checker: https://github.com/frxxup/majestic-backlink-checker

------------------------
End of Document