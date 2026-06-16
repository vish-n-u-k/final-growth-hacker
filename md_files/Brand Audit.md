# Module: Brand Audit

## Metadata
- Type: `brand-audit`
- Name: Brand Audit
- Description: Evaluate brand positioning, messaging, voice, consistency, audience fit, trust signals, AI visibility, differentiation, and overall brand strength.
- Order: 4
- Unlock threshold: None (available from start)
- Mode: dynamic

---

## Data requirements

| Key | Label | Type | Placeholder | Source |
| :--- | :--- | :--- | :--- | :--- |
| `website_url` | Your website URL | `url` | `https://yourbusiness.com` | User input / Brand Details |
| `brand_name` | Brand / Company Name | `text` | `Acme Inc.` | Brand Details (auto-filled) |
| `industry` | Industry | `text` | `SaaS, Project Management` | Brand Details (auto-filled) |
| `target_audience` | Target Audience Description | `text` | `Enterprise CTOs, Marketing Managers` | Brand Details (auto-filled) |
| `usp` | Unique Selling Proposition / Value Prop | `text` | `White-glove onboarding, 99.9% uptime` | Brand Details (auto-filled) |
| `brand_voice` | Desired Brand Voice (tone) | `text` | `Professional, authoritative, helpful` | Brand Details (auto-filled) |
| `social_handles` | Social Media Handles (optional) | `text` | `@acme, linkedin.com/company/acme` | Social Media Details (auto-filled) |
| `competitor_usps` | Competitor USPs (from Competitor Audit) | `json` | `[{"name":"Monday.com","usp":"Work OS"}]` | Competitor Audit (auto-filled if available) |

---

## System prompt

You are an expert brand strategist and communications auditor for a growth audit tool. Your tone is direct, actionable, and consultant-like.

You will receive:
- The user's website URL and its crawled HTML/text.
- Brand details (name, industry, target audience, USP, desired voice).
- Social media handles / profiles (if provided).
- Competitor USPs (if Competitor Audit data is available).

Your job is to produce a dynamic checklist covering **9 categories**:
1. Brand Positioning
2. Messaging & Value Prop
3. Brand Voice
4. Brand Consistency
5. Audience Fit
6. Trust & Credibility
7. AI Search & Entity Visibility
8. Differentiation
9. Brand Strength Score

**Rules:**
1. Only report what you can verify from freely available data (no paid APIs). Use the following free/open-source tools:
   - `requests` + `beautifulsoup4` – HTML crawling
   - `spaCy` – NER, noun-chunk extraction, tokenization
   - `nltk.sentiment.vader` (VADER) – sentiment analysis for voice consistency
   - `textstat` – readability scores (Flesch-Kincaid)
   - `googlesearch-python` – Knowledge Graph, PAA, .edu backlink counts (no API key)
   - `wikipedia-api` or `requests` to Wikidata – check Knowledge Graph existence
   - `yake` – keyword extraction
   - `scikit-learn` (TF-IDF) – semantic similarity (USP vs. competitors, audience fit)

2. For each category, generate **3–8 actionable findings**. Each finding must include:
   - A short, specific title
   - A clear explanation in plain English (no jargon)
   - A direct action step (what the user should do)
   - An impact score (High / Medium / Low) based on potential traffic, leads, or conversions
   - A weight (Critical=3 / Important=2 / Minor=1)

3. Never give generic advice like "improve your branding." Always point to exact elements (e.g., "rewrite your H1 to include your industry and audience").

4. For pass/fail: each finding is considered "fail" if a gap exists (competitor has it, user doesn't, OR user falls below a best-practice threshold). "Pass" means no actionable gap.

5. All recommendations must be something a layman can understand and act on within a week.

6. For **Brand Strength Score**, aggregate all previous categories into a weighted composite score (0–10) and map it to the scoring guide.

---

## Categories

### 1. Brand Positioning
**Slug:** `brand-positioning`

**Category prompt:**
Analyze the user's website to evaluate if the brand occupies a clear, distinct, and relevant space in the market. Determine if a visitor can understand "what you do" and "for whom" within 5 seconds of landing on the homepage.

**Logic:**
- Scrape the **homepage H1**, **meta description**, and the full **"About Us" / "Company" page** text.
- Use `spaCy` noun-chunk extraction to identify the core "category" (e.g., "project management software") and "audience" (e.g., "for remote teams").
- Compare extracted positioning against the user-provided `industry` and `target_audience` using TF-IDF cosine similarity.
- **Pass** if the extracted category and audience match the provided details with similarity >0.7.
- **Fail** if positioning is generic (e.g., "We are a software company") or the H1 is missing or vague.

**Actionable output:**
> *"Your H1 is 'The Best Platform.' It doesn't mention your industry or audience. Action: Rewrite H1 to 'Project Management for Remote Teams — [YourTool].'"*

**Weight guide:**
- **Critical (3):** No clear positioning statement anywhere on the homepage.
- **Important (2):** Positioning exists but is buried below the fold.
- **Minor (1):** Positioning is clear but could be more specific.

---

### 2. Messaging & Value Prop
**Slug:** `messaging-value-prop`

**Category prompt:**
Assess whether the Unique Selling Proposition (USP) is prominently featured, clearly articulated, and benefit-driven (not feature-dumped).

**Logic:**
- Take the user-provided `usp` and check if it (or a close semantic variant) appears in the **hero section**, **first paragraph**, and **primary CTA button**.
- Calculate the **Flesch Reading Ease** score (via `textstat`) for the hero text – aim for >60 (plain English).
- Check if the language is benefit-driven vs. feature-dumping using a simple regex dictionary:
  - Benefit triggers: `"save time"`, `"grow revenue"`, `"increase productivity"`, `"simplify"`, `"empower"`
  - Feature triggers: `"dashboard"`, `"API"`, `"integration"`, `"reporting"` (flag if >3 features without benefits)
- **Pass** if USP is present in hero, readability >60, and benefit language outweighs feature language.

**Actionable output:**
> *"Your USP 'White-glove onboarding' is buried in the footer. Action: Move it to the hero section and rephrase as 'Get started in 1 hour with our dedicated onboarding team.'"*

**Weight guide:**
- **Critical (3):** USP is missing entirely from the website.
- **Important (2):** USP is present but hidden or poorly worded.
- **Minor (1):** USP is clear but could be more benefit-oriented.

---

### 3. Brand Voice
**Slug:** `brand-voice`

**Category prompt:**
Determine if the brand's tone is consistent, appropriate for the audience, and authentically reflected across the website and social media platforms.

**Logic:**
- Crawl **website copy** (all visible text from `<p>`, `<h1>`, `<h2>`, `<li>`) and **social media bios** / pinned posts (from provided handles, using `requests` + `bs4` to scrape public profile pages).
- Run **VADER sentiment analysis** (from `nltk`) on both datasets to compute a "tone vector" (positive/negative/neutral + emotional intensity).
- Compare the website's tone against the user's `desired_brand_voice` (e.g., "professional") via keyword matching.
- Calculate a **"Tone Volatility"** score: if the website sentiment is +0.8 but social profiles are -0.3, flag inconsistency.
- **Pass** if tone matches desired voice AND varies <0.3 across platforms.

**Actionable output:**
> *"Your website sounds formal and corporate, but your LinkedIn posts are casual and playful. Action: Align your social copy with your website's professional tone — or vice versa, but pick one and stick to it."*

**Weight guide:**
- **Critical (3):** Tone is inappropriate for the target audience (e.g., casual for enterprise CTOs).
- **Important (2):** Tone varies significantly across platforms (>0.5 sentiment shift).
- **Minor (1):** Tone is consistent but doesn't fully match the desired voice.

---

### 4. Brand Consistency
**Slug:** `brand-consistency`

**Category prompt:**
Audit the uniformity of brand name, tagline, and visual identity (logo) across the website and all connected social profiles.

**Logic:**
- Extract **Brand Name** from the `<title>` tag, `og:title`, and the homepage text (via `spaCy` NER for "ORG").
- Extract **Tagline** from the `og:description` and meta description.
- Scrape social profile names and bios (from provided handles).
- Run exact-match or fuzzy-string matching (Levenshtein distance) to verify brand name and tagline are consistent across all platforms.
- Check if the same `og:image` (logo) is used across the website and social share previews.
- **Pass** if the brand name is identical across ≥90% of platforms and tagline is present on ≥80% of platforms.

**Actionable output:**
> *"Your website tagline is 'Simplify Work,' but your LinkedIn tagline is 'Project Management Tool.' Action: Update LinkedIn to match your website tagline exactly."*

**Weight guide:**
- **Critical (3):** Brand name is different across platforms.
- **Important (2):** Tagline is missing on 2+ platforms.
- **Minor (1):** Minor formatting differences (e.g., case sensitivity).

---

### 5. Audience Fit
**Slug:** `audience-fit`

**Category prompt:**
Measure how well the website's content, pain points, and language align with the actual target demographic.

**Logic:**
- Take the user-provided `target_audience` (e.g., "Enterprise CTOs struggling with churn").
- Extract key job titles, industries, and pain points from the audience description using `spaCy` NER.
- Crawl the website's **blog posts** and **landing pages** to extract frequently mentioned terms.
- Use TF-IDF to measure the semantic overlap between the audience description and the website copy.
- Also check for explicit audience mentions (e.g., "for CTOs", "enterprise-ready").
- **Pass** if overlap is >0.6 AND the primary audience term appears ≥3 times in the copy.
- **Fail** if the copy uses casual slang ("Hey guys") for a professional audience.

**Actionable output:**
> *"Your target audience is 'Enterprise CTOs,' but your homepage says 'Hey guys, check out our tool.' Action: Replace casual language with professional, business-focused phrasing."*

**Weight guide:**
- **Critical (3):** Content is completely misaligned with the target audience.
- **Important (2):** Content is partially aligned but uses inappropriate language.
- **Minor (1):** Minor mismatches (e.g., missing one industry term).

---

### 6. Trust & Credibility
**Slug:** `trust-credibility`

**Category prompt:**
Evaluate the presence of social proof, security signals, and authoritative elements that build user confidence.

**Logic:**
- Scan with `bs4` + Regex for:
  - **Review platforms**: Mentions of "Trustpilot," "G2," "Capterra," "Google Reviews" (or widget detection).
  - **Security**: SSL certificate validation (check `https` and cert expiry via `requests`).
  - **Legal pages**: Presence of `/privacy-policy` and `/terms-of-service` links.
  - **Social proof**: Count of client logos in the hero/footer, number of testimonials, case studies, and "As seen on" media mentions.
  - **Team page**: Presence of an "About" page with photos and LinkedIn links.
- **Pass** if ≥4 of these signals are present.

**Actionable output:**
> *"No Privacy Policy or Terms of Service found. Action: Add these legal pages immediately — they're essential for trust and compliance."*

**Weight guide:**
- **Critical (3):** No SSL, no Privacy Policy, no social proof at all.
- **Important (2):** Missing 2+ trust signals (e.g., no testimonials, no client logos).
- **Minor (1):** Missing one trust signal (e.g., no "As seen on" mentions).

---

### 7. AI Search & Entity Visibility
**Slug:** `ai-entity-visibility`

**Category prompt:**
Evaluate how discoverable, interpretable, and "trustworthy" the brand appears to Large Language Models (ChatGPT, Perplexity, Google SGE) and AI search engines. Use only free proxy heuristics — do not scrape ChatGPT/Perplexity directly.

**Logic (4 proxy heuristics):**

| # | Test | Free Tool / Logic | Pass Condition | Weight |
| :--- | :--- | :--- | :--- | :--- |
| 1 | **Knowledge Graph Existence** | `wikipedia-api` + `requests` to Wikidata; `googlesearch-python` to check Knowledge Panel snippet | Wikidata entry OR Knowledge Panel exists | 35% |
| 2 | **Structured Data Readiness** | `bs4` + Regex for `<script type="application/ld+json">`; check for `Organization`, `Product`, `FAQPage`, `HowTo` | ≥2 relevant Schema types present | 25% |
| 3 | **Authoritative Citations** | `googlesearch-python` count results for `site:*.edu "brandname"` and `site:*.gov "brandname"` | ≥3 unique `.edu`/`.gov` backlinks | 25% |
| 4 | **PAA / SGE Presence** | `googlesearch-python` + `bs4` scrape "People Also Ask" boxes for `"{brand} {industry}"` | Brand appears in ≥1 PAA query | 15% |

**Actionable output:**
> *"No Knowledge Graph detected. Action: Create a Wikidata entry and submit your brand to Google's Knowledge Panel via 'Suggest an edit.'"*

**Weight guide:**
- **Critical (3):** No Knowledge Graph, no Schema, zero authoritative citations.
- **Important (2):** Missing 2 of the 4 heuristics.
- **Minor (1):** Missing one heuristic (e.g., no PAA presence).

---

### 8. Differentiation
**Slug:** `differentiation`

**Category prompt:**
Determine if the brand clearly communicates how it is better or different from competitors identified in the Competitor Audit.

**Logic:**
- Pull the `competitor_usps` list from the Competitor Audit module (if available). If not available, skip competitor comparison and focus on internal uniqueness.
- Extract the user's USP and positioning statements.
- Use **scikit-learn TF-IDF cosine similarity** to compare the user's USP vector against each competitor's USP vector.
- If similarity >0.85 with any competitor, flag as "undifferentiated."
- Scan the website for explicit comparison pages (e.g., `/vs-monday`, `/vs-asana`) or "Why us?" sections.
- **Pass** if there is a clear, unique differentiator AND at least one competitor comparison page exists.

**Actionable output:**
> *"Your USP 'Easy project management' is identical to Competitor X. Action: Add a 'Why [YourTool] vs. Competitors' table to your pricing page highlighting your unique 'White-glove onboarding' feature."*

**Weight guide:**
- **Critical (3):** No differentiation from competitors, no comparison content.
- **Important (2):** Differentiation exists but is not prominently featured.
- **Minor (1):** Differentiation is clear but competitor comparison pages are missing.

---

### 9. Brand Strength Score
**Slug:** `brand-strength-score`

**Category prompt:**
Provide a holistic, weighted composite score (0–10) summarizing the overall health of the brand's perception and communication.

**Logic:**
- This is an **aggregator**. Take the normalized scores (0–10) from the previous 8 categories.
- **Weighting:**
  - Positioning: 20%
  - Messaging & Value Prop: 15%
  - Voice: 10%
  - Consistency: 10%
  - Audience Fit: 10%
  - Trust & Credibility: 15%
  - AI Visibility: 10%
  - Differentiation: 10%
- Calculate the weighted average.
- Map to scoring guide:
  - **0–4:** Best in Class — excellent brand equity
  - **5–7:** Average — needs fine-tuning
  - **8–9:** Significant Problems — brand identity is confusing
  - **10:** Critical Failure — brand is invisible or contradictory

**Actionable output:**
> *"Your Brand Strength Score is 7.2/10 (Average). Weaknesses: AI Visibility and Differentiation. Action: Prioritize the recommendations from those categories first to jump to >8.0."*

**Weight guide (for individual findings within this category):**
- **Critical (3):** Score <3 — immediate action required.
- **Important (2):** Score 3–6 — needs improvement.
- **Minor (1):** Score 6–8 — fine-tuning.

---

## Logic & integrations (for developer)

This module runs on the backend using only free/open-source tools. Implement the following pipeline:

### 1. Data Collection
- Use `requests` + `beautifulsoup4` to crawl:
  - Homepage (full HTML)
  - About Us / Company page
  - Pricing page
  - Blog index (first 5 posts)
  - Privacy Policy / Terms pages (if exist)
- Use `requests` + `bs4` to scrape social media bios and public profile info from provided handles (respect robots.txt, add delays).
- Use `googlesearch-python` (no API key) for:
  - Knowledge Panel detection
  - .edu / .gov backlink counting
  - PAA (People Also Ask) scraping
- Use `wikipedia-api` or `requests` to Wikidata to check Knowledge Graph existence.

### 2. Text Processing & NLP
- `spaCy` (en_core_web_sm) for:
  - Named Entity Recognition (brand name, audience job titles)
  - Noun-chunk extraction (positioning, category)
  - Tokenization
- `nltk.sentiment.vader` (VADER) for:
  - Sentiment scoring of website copy vs social copy
  - Tone volatility calculation
- `textstat` for:
  - Flesch Reading Ease score (hero text)
- `yake` for:
  - Keyword extraction from blog and landing pages
- `scikit-learn` (TfidfVectorizer) for:
  - Semantic similarity (USP vs. competitor USPs)
  - Audience fit (target_audience vs. website copy overlap)

### 3. Scoring Engine
- For each category, convert raw metrics into a 0–10 score using rule-based thresholds (see category logic above).
- Generate findings for any metric that falls below the "pass" threshold.
- Assign weight (3=critical, 2=important, 1=minor) based on business impact.

### 4. AI Processing
- Pass all collected data (HTML snippets, sentiment scores, keyword sets, Schema data, Knowledge Graph status, .edu counts) to the system prompt via the AI (Claude or equivalent).
- The AI returns a structured JSON with categories, findings, weights, and action steps.

### 5. Output Formatting
- Each finding becomes a checklist item with:
  - `status` (pass/fail)
  - `weight` (1–3)
  - `action_text`
  - `impact_score` (High/Medium/Low)
  - `title`
  - `description`
- Aggregate the Brand Strength Score (0–10) and include it as a separate field.
- Store results in database with module type `brand-audit`.

### 6. Dependencies
- Requires `website_url`, `brand_name`, `industry`, `target_audience`, `usp`, `brand_voice` from Brand Details.
- Optionally uses `social_handles` from Social Media Details.
- Optionally uses `competitor_usps` from Competitor Audit (if completed and unlocked).

---

## Slug rules
- All slugs: kebab-case, lowercase, no spaces.
- Category slugs (9 total):
  - `brand-positioning`
  - `messaging-value-prop`
  - `brand-voice`
  - `brand-consistency`
  - `audience-fit`
  - `trust-credibility`
  - `ai-entity-visibility`
  - `differentiation`
  - `brand-strength-score`
- Item slugs (generated dynamically by AI) must be stable: use pattern `{category-slug}-{short-descriptor}` (e.g., `ai-entity-visibility-no-knowledge-graph`).

---

## Weight guide (applies to AI-generated items)

| Weight | Value | Criteria |
| :--- | :--- | :--- |
| **Critical (3)** | Directly blocks trust, conversions, or discovery | No SSL, no Privacy Policy, no Knowledge Graph, USP missing from hero, tone completely misaligned with audience. |
| **Important (2)** | Measurably hurts perception | Inconsistent voice across platforms, low readability, missing Schema, no competitor differentiation. |
| **Minor (1)** | Nice-to-have | Missing a single social platform, minor tagline mismatch, missing PAA presence. |

---

## Scoring guide (for Brand Strength Score)

| Score Range | Label | Meaning |
| :--- | :--- | :--- |
| 0–4 | Best in Class | Excellent brand equity, strong positioning, and trust signals. |
| 5–7 | Average | Good foundation but needs fine-tuning in 2–3 areas. |
| 8–9 | Significant Problems | Brand identity is confusing or inconsistent. |
| 10 | Critical Failure | Brand is invisible, contradictory, or lacks trust signals. |

---

## Fixable flag
This module is dynamic, so `fixable` is not used at item level. However, the AI should prioritize actions that are directly fixable by the user without external help (e.g., rewriting copy, adding Schema, updating social bios). Strategic changes (e.g., "change your brand positioning") are still actionable but noted as requiring human judgment.

---

## Dependencies diagram (visual reference)
┌─────────────────────────────────────────────────────────────────┐
│ BRAND AUDIT MODULE │
├─────────────────────────────────────────────────────────────────┤
│ │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐ │
│ │ Brand │ │ Website │ │ Social Media │ │
│ │ Details │──▶│ Details │──▶│ Details │ │
│ │ (USP, Voice, │ │ (Pages, Copy,│ │ (Handles, Bios) │ │
│ │ Audience) │ │ Structure) │ │ │ │
│ └──────────────┘ └──────────────┘ └──────────────────┘ │
│ │ │ │ │
│ └────────────────┼─────────────────────┘ │
│ │ │
│ ┌──────▼──────┐ │
│ │ Competitor │ (optional) │
│ │ Audit Data │ │
│ │ (USPs) │ │
│ └─────────────┘ │
│ │
│ ┌───────────────────────────────────────────────────────────┐ │
│ │ 9 Categories Processed via NLP + Heuristics + Scoring │ │
│ │ - Website crawling (requests + bs4) │ │
│ │ - NLP: spaCy (NER), VADER (sentiment), textstat │ │
│ │ - Semantic: scikit-learn (TF-IDF), yake (keywords) │ │
│ │ - AI visibility: googlesearch-python, wikipedia-api │ │
│ └───────────────────────────────────────────────────────────┘ │
│ │ │
│ ┌────────▼────────┐ │
│ │ Brand Strength │ │
│ │ Score (0–10) │ │
│ └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘


---

## Tool compliance (100% free / open-source)

| Tool | License | Purpose |
| :--- | :--- | :--- |
| `requests` | Apache 2.0 | HTTP crawling |
| `beautifulsoup4` | MIT | HTML parsing |
| `spaCy` | MIT | NER, noun-chunks, tokenization |
| `nltk` (VADER) | Apache 2.0 | Sentiment analysis |
| `textstat` | MIT | Readability scores |
| `googlesearch-python` | MIT | Google search scraping (no API key) |
| `wikipedia-api` | MIT | Wikipedia/Wikidata checks |
| `yake` | BSD | Keyword extraction |
| `scikit-learn` | BSD | TF-IDF vectorization and similarity |

No paid APIs, no proprietary services, and all tools are already in the existing stack.

