# Foundation Module – Complete Developer Guide  
**For the Growth Hacker App**  
*100% Open‑Source – No Paid APIs*

---

## Table of Contents

1. [Overview & Philosophy](#1-overview--philosophy)
2. [System Architecture Flow](#2-system-architecture-flow)
3. [API Endpoints](#3-api-endpoints)
4. [Data Schema (TypeScript)](#4-data-schema-typescript)
5. [Domain & Hosting – Quick Checklist](#5-domain--hosting--quick-checklist)
6. [AI Inference Engine (Free & Open‑Source)](#6-ai-inference-engine-free--open-source)
7. [Backend Implementation (Node.js)](#7-backend-implementation-nodejs)
8. [Actionable Insights Library (Static JSON)](#8-actionable-insights-library-static-json)
9. [Frontend Integration](#9-frontend-integration)
10. [7‑Category Data Collection & Actionable Insights Logic](#10-7category-data-collection--actionable-insights-logic)
    - [1. Domain & Hosting](#1-domain--hosting)
    - [2. Brand Details](#2-brand-details)
    - [3. Website Details](#3-website-details)
    - [4. Social Media Details](#4-social-media-details)
    - [5. Competitor Details](#5-competitor-details)
    - [6. Analytical Data](#6-analytical-data)
    - [7. Campaign Data](#7-campaign-data)
11. [Unified Execution Flow](#11-unified-execution-flow)
12. [Developer Checklist](#12-developer-checklist)
13. [Testing URLs](#13-testing-urls)
14. [Summary](#14-summary)
15. [Support & Documentation](#15-support--documentation)

---

## 1. Overview & Philosophy

The **Foundation Module** is the input layer of the Growth Hacker App. It accepts a website URL, automatically scrapes, crawls, and analyzes the website across **7 core categories**:

1. Domain & Hosting
2. Brand Details
3. Website Details
4. Social Media Details
5. Competitor Details
6. Analytical Data
7. Campaign Data

### Core Philosophy – URL‑First Automation

- **80% of data** is automatically extracted or inferred from the URL.
- **20%** (internal KPIs like revenue, ad spend, strategic goals) still requires manual input (via OAuth or form fields).
- Every failing check includes an **Actionable Insight** with business impact and a specific recommendation.
- All tools used are **100% free and open‑source** – no paid APIs.

---

## 2. System Architecture Flow
User enters URL
↓
[Foundation Module Backend]
├── Playwright (Headless Browser) → Load & Render Page
├── Cheerio → Extract HTML, Meta Tags, Links, Scripts
├── WHOIS / DNS / SSL Checkers → Domain & Hosting Health
├── Lighthouse CI → Performance Metrics (FCP, LCP, CLS)
├── Local AI Models (HuggingFace Transformers) → Industry, USP, Audience Inference
├── Wappalyzer (open‑source fork) → Detect Technologies
├── 7‑Category Data Collection (parallel)
└── Rule‑Based Recommendation Engine → Generate Actionable Insights
↓
Structured JSON Output (FoundationOutput)
↓
Frontend (Growth Tracker UI)
├── Map results to Level 0 (Foundation) checkboxes
├── Update progress bars & scores
├── Unlock Level 1 if all checks pass
└── Display actionable recommendations to the user


---

## 3. API Endpoints

### `POST /api/foundation/analyze`

**Request**
```json
{
  "url": "https://example.com"
}

Response: FoundationOutput JSON (see Section 4).

Status Codes

200 OK – Analysis completed successfully.
400 Bad Request – Invalid URL or missing parameter.
500 Internal Server Error – Analysis failed (timeout, tool error, etc.).

GET /api/foundation/status/:jobId (Optional – for async jobs)

Response
{
  "status": "pending" | "completed" | "failed",
  "progress": 50   // percentage
}

4. Data Schema (TypeScript)

Your backend must return this exact structure.

interface FoundationOutput {
  // Core metadata
  url: string;
  status: "success" | "partial" | "failed";
  timestamp: string;                 // ISO 8601

  // Fully automated extractions
  autoExtracted: {
    brandName: string;               // from <title> or Schema.org
    industry: string;                // zero-shot classification (e.g., "SaaS")
    inferredUSP: string;             // summarised from Hero section (5‑10 words)
    inferredAudience: string[];      // e.g., ["Designers", "Product Managers"]
    inferredGoal: "Sales" | "Leads" | "Awareness";
    socialLinks: { platform: string; url: string }[];
    detectedCompetitors: string[];
    technologies: string[];          // e.g., ["React", "Nginx", "WordPress"]
    siteMap: string[];               // internal URLs (depth ≤ 2)
  };

  // Domain & Hosting (technical health)
  domainHosting: {
    overallScore: number;            // out of 5
    categories: {
      domain:       { score: number; checks: EnhancedCheck[] };
      accessibility:{ score: number; checks: EnhancedCheck[] };
      performance:  { score: number; checks: EnhancedCheck[] };
      mobileFriendliness: { score: number; checks: EnhancedCheck[] };
      security:     { score: number; checks: EnhancedCheck[] };
      seoBasics:    { score: number; checks: EnhancedCheck[] };
    };
  };

  // Brand & strategy insights (AI‑generated)
  brandInsights: {
    suggestedPositioning: string;
    uspRecommendation: string;
  };

  // Fields that require user input (or OAuth)
  manualInputs: {
    confirmedUSP: string | null;
    confirmedGoal: string | null;
    analyticsOAuthToken: string | null;
    competitorList: string[] | null;
  };
}

// Individual check with actionable insight
interface EnhancedCheck {
  name: string;                     // e.g., "SSL Certificate"
  passed: boolean;
  evidence: string;                 // e.g., "Expires in 120 days"
  businessImpact: string;           // e.g., "85% bounce rate due to 'Not Secure'"
  actionableRecommendation: string; // e.g., "Renew SSL via Let's Encrypt NOW."
  priority: "High" | "Medium" | "Low";
}

5. Domain & Hosting – Quick Checklist

Category	Check	Passing Criteria	Tool Used	If Fails (Actionable Insight)
Domain	Domain Expiry	Expiry > 90 days from today	whoiser	High: Enable auto‑renewal immediately.
WHOIS Privacy	Email/Phone masked	whoiser	Medium: Enable WHOIS Privacy Protection.
DNS Records	A, MX, NS resolve correctly	@oxog/dns	High: Check DNS settings with your hosting provider.
Accessibility	Site Live (200 OK)	HTTP status = 200	axios	Critical: Restart server or disable broken plugins.
SSL Active	Valid certificate, not expired	ssl-checker	Critical: Install Let's Encrypt SSL.
No "noindex"	No <meta name="robots" content="noindex">	Cheerio	High: Remove the noindex meta tag.
Performance	Real Content	> 500 words, no "Coming Soon"	Cheerio + counter	High: Replace placeholder with real product content.
Viewport Meta	<meta name="viewport"> exists	Cheerio	Medium: Add viewport meta tag for mobile.
Page Speed (FCP)	First Contentful Paint < 1.8s	Lighthouse CI	High: Compress images, enable Gzip, upgrade hosting.
Security	Mixed Content	No http:// images/scripts	Cheerio	High: Replace all http:// with https://.
SEO Basics	Title Tag	Length 30–60 characters	Cheerio	Medium: Rewrite title to be concise and include keywords.
Meta Description	Exists and length > 120 chars	Cheerio	Medium: Write a compelling meta description (150–160 chars) with a clear CTA.
6. AI Inference Engine (Free & Open‑Source)

We use local HuggingFace models – no paid APIs.

Inference Task	Model Used	Method
Industry Detection	facebook/bart-large-mnli	Zero‑shot classification against a list of 50 industry labels.
USP Summarization	facebook/bart-large-cnn	Extract Hero section (H1 + adjacent P) and summarise to 5‑10 words.
Audience Detection	spaCy (NER) + Regex	Extract job titles and demographic clues from "About Us" and "Blog".
Goal Inference	Rule‑based	Scan primary CTA buttons: "Buy" → Sales; "Demo" → Leads; "Download" → Awareness.
Installation (Python):

pip install transformers torch spacy
python -m spacy download en_core_web_sm

7. Backend Implementation (Node.js)

Recommended Tech Stack

{
  "dependencies": {
    "playwright": "^1.40.0",
    "cheerio": "^1.0.0-rc.12",
    "whoiser": "^1.17.2",
    "ssl-checker": "^3.0.1",
    "lighthouse": "^11.0.0",
    "axios": "^1.6.0",
    "@xenova/transformers": "^2.0.0",
    "wappalyzer": "^1.0.0",
    "express": "^4.18.2",
    "cors": "^2.8.5"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}

Core Execution Flow (Pseudocode)
class FoundationModule {
  async analyze(url) {
    // 1. Launch headless browser
    const browser = await playwright.chromium.launch();
    const page = await browser.newPage();
    await page.goto(url);
    const html = await page.content();

    // 2. Parse HTML with Cheerio
    const $ = cheerio.load(html);

    // 3. Run all 7 categories in parallel
    const [
      domainData,
      brandData,
      websiteData,
      socialData,
      competitorData,
      analyticsData,
      campaignData
    ] = await Promise.all([
      this.analyzeDomainHosting(url, $, page),
      this.analyzeBrandDetails(url, $),
      this.analyzeWebsiteDetails(url, $, page),
      this.analyzeSocialMedia(url, $),
      this.analyzeCompetitors(url, $),
      this.analyzeAnalytics(url, $, page),
      this.analyzeCampaigns(url, $)
    ]);

    // 4. Build EnhancedCheck objects with insights
    const allChecks = [...domainData, ...brandData, ...websiteData, ...socialData, ...competitorData, ...analyticsData, ...campaignData];

    // 5. Assemble final JSON
    return {
      url,
      status: 'success',
      timestamp: new Date().toISOString(),
      autoExtracted: { ... },
      domainHosting: {
        overallScore: this.calculateOverallScore(allChecks),
        categories: this.groupByCategory(allChecks)
      },
      brandInsights: { ... },
      manualInputs: { ... }
    };
  }
}

8. Actionable Insights Library (Static JSON)

Store this in your backend (insights-library.json). Map each check to the appropriate insight using the check name.

{
  "ssl_expired": {
    "businessImpact": "Browsers show 'Not Secure' – 85% of visitors abandon checkout.",
    "recommendation": "Install a free Let's Encrypt SSL certificate or enable auto-renewal.",
    "priority": "High"
  },
  "viewport_missing": {
    "businessImpact": "Mobile users see a zoomed-out desktop version – 60% of traffic.",
    "recommendation": "Add <meta name='viewport' content='width=device-width, initial-scale=1.0'>.",
    "priority": "Medium"
  },
  "page_speed_slow": {
    "businessImpact": "1s delay = 7% drop in conversions (Amazon data).",
    "recommendation": "Compress images to WebP, enable browser caching, upgrade hosting.",
    "priority": "High"
  },
  "no_index": {
    "businessImpact": "Your site is invisible in Google search results.",
    "recommendation": "Remove <meta name='robots' content='noindex'> from your HTML <head>.",
    "priority": "High"
  },
  "domain_expiring": {
    "businessImpact": "Risk of domain squatting and site downtime.",
    "recommendation": "Enable auto-renewal immediately and update your payment method.",
    "priority": "High"
  },
  "mixed_content": {
    "businessImpact": "Modern browsers block insecure HTTP resources, breaking your layout.",
    "recommendation": "Run a find-and-replace in your database to change all http:// URLs to https://.",
    "priority": "High"
  },
  "title_too_long": {
    "businessImpact": "Google truncates your title, making it unclear in search results.",
    "recommendation": "Rewrite your title to be under 60 characters, including your primary keyword.",
    "priority": "Medium"
  },
  "no_meta_description": {
    "businessImpact": "Google generates a random snippet, which rarely matches user intent.",
    "recommendation": "Write a compelling meta description (150-160 chars) with a clear CTA.",
    "priority": "Medium"
  },
  "no_analytics": {
    "businessImpact": "You have no data on where users drop off or what converts.",
    "recommendation": "Install Google Analytics (free) or Plausible (privacy-friendly) immediately.",
    "priority": "High"
  },
  "no_real_content": {
    "businessImpact": "Visitors cannot understand your value proposition – bounce rate will be 90%+.",
    "recommendation": "Replace 'Coming Soon' or generic text with specific product details, benefits, and customer testimonials.",
    "priority": "High"
  },
  "custom_domain_missing": {
    "businessImpact": "Your site looks unprofessional and shares branding with a generic platform.",
    "recommendation": "Purchase a custom domain ($10/year) and point it to your hosting provider.",
    "priority": "Medium"
  },
  "no_social_presence": {
    "businessImpact": "You're missing opportunities to build community and trust.",
    "recommendation": "Create profiles on 2-3 relevant platforms (LinkedIn, Twitter, YouTube).",
    "priority": "Medium"
  },
  "inactive_social": {
    "businessImpact": "Visitors think your brand is inactive or abandoned.",
    "recommendation": "Post at least 3-4 times per week on each active platform.",
    "priority": "High"
  },
  "competitor_gap": {
    "businessImpact": "You're losing deals to competitors with better features.",
    "recommendation": "Prioritize building missing features in your next sprint.",
    "priority": "High"
  },
  "no_utm_tracking": {
    "businessImpact": "You can't track which campaigns drive conversions.",
    "recommendation": "Add UTM parameters to all marketing links.",
    "priority": "High"
  },
  "poor_core_web_vitals": {
    "businessImpact": "Google ranks you lower – less organic traffic.",
    "recommendation": "Optimize images, reduce JavaScript, use a CDN.",
    "priority": "High"
  },
  "no_sitemap": {
    "businessImpact": "Search engines can't discover all your pages.",
    "recommendation": "Generate and submit a sitemap.xml to Google Search Console.",
    "priority": "Medium"
  },
  "outdated_cms": {
    "businessImpact": "Security vulnerabilities expose your site to hackers.",
    "recommendation": "Update your CMS to the latest version immediately.",
    "priority": "High"
  }
}

9. Frontend Integration

JavaScript Handler

Add this function to your Growth Tracker UI – it maps the backend JSON to the UI elements.

function applyFoundationResults(data) {
  // Map backend checks to UI checkbox IDs
  const mapping = {
    'check_ssl': data.domainHosting.categories.accessibility.checks.find(c => c.name === 'SSL Active')?.passed || false,
    'check_live': data.domainHosting.categories.accessibility.checks.find(c => c.name === 'Website is Live')?.passed || false,
    'check_index': data.domainHosting.categories.accessibility.checks.find(c => c.name === 'Search Engine Indexable')?.passed || false,
    'check_domain': !data.url.includes('netlify.app') && !data.url.includes('vercel.app') && !data.url.includes('pages.dev'),
    'check_content': data.domainHosting.categories.performance.checks.find(c => c.name === 'Real Content')?.passed || false,
    'check_viewport': data.domainHosting.categories.performance.checks.find(c => c.name === 'Viewport Meta Tag')?.passed || false,
    'check_analytics': data.autoExtracted.technologies.some(t => /analytics|gtm|google-analytics|plausible/i.test(t))
  };

  let passedCount = 0;
  const totalTasks = Object.keys(mapping).length;

  // Update each checkbox
  Object.keys(mapping).forEach(id => {
    const taskElement = document.getElementById(id);
    if (!taskElement) return;
    if (mapping[id]) {
      taskElement.classList.add('checked');
      passedCount++;
    } else {
      taskElement.classList.remove('checked');
    }
  });

  // Update progress bar
  const fill = document.getElementById('foundationFill');
  const count = document.getElementById('foundationCount');
  const pct = (passedCount / totalTasks) * 100;
  if (fill) fill.style.width = pct + '%';
  if (count) count.innerText = passedCount + '/' + totalTasks;

  // Update badge, status, gate, and focus message
  const badge = document.getElementById('foundationBadge');
  const status = document.getElementById('foundationStatus');
  const gateText = document.getElementById('gateText');
  const focus = document.getElementById('foundationFocus');

  if (passedCount === totalTasks) {
    if (badge) { badge.innerText = '✓'; badge.style.background = 'linear-gradient(150deg, #4ade80, #2fbf71)'; }
    if (status) { status.innerText = 'Cleared'; status.className = 'pill clear'; }
    if (gateText) gateText.innerText = '✅ All checks passed! Level 1 (Learn) is now unlocked.';
    if (focus) focus.innerText = '✅ All technical foundations are solid. Time to start learning from real users!';
    // Unlock next level
    const nextLevel = document.querySelector('.level.locked');
    if (nextLevel) {
      nextLevel.classList.remove('locked');
      nextLevel.dataset.count = 'active';
      const pill = nextLevel.querySelector('.pill.soon');
      if (pill) pill.innerText = 'Ready';
    }
  } else {
    if (badge) { badge.innerText = '⚠️'; badge.style.background = 'var(--bg-soft)'; }
    if (status) { status.innerText = 'Fix Issues'; status.className = 'pill now'; }
    if (gateText) gateText.innerText = `❌ ${passedCount}/${totalTasks} passed. Fix the failed checks above to unlock the next level.`;
    const failedChecks = Object.keys(mapping).filter(id => !mapping[id]);
    if (failedChecks.length > 0 && focus) {
      const firstFailed = failedChecks[0].replace('check_', '').toUpperCase();
      focus.innerText = `🚨 Action Required: Fix "${firstFailed}" first. Check your SSL / hosting settings.`;
    }
  }
}

Foundation Level HTML

Replace the existing Level 0 (Foundation) in your Growth Tracker HTML with this block:

<!-- LEVEL 0 - FOUNDATION (Auto-Checked) -->
<div class="level active open" data-count="active" id="levelFoundation">
  <div class="level-head" onclick="toggle(this)">
    <div class="level-badge" id="foundationBadge">⏳</div>
    <div class="level-info">
      <div class="name">Technical Foundation <span class="pill now" id="foundationStatus">Scanning...</span></div>
      <div class="range">Domain · Hosting · Accessibility</div>
      <div class="focus" id="foundationFocus">Running SSL, performance, and SEO checks on your URL.</div>
    </div>
    <div class="level-prog"><div class="mini-track"><div class="mini-fill" id="foundationFill" style="width:0%"></div></div><span id="foundationCount">0/7</span></div>
    <svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
  </div>
  <div class="level-body"><div class="tasks" id="foundationTasks">
    
    <div class="task" id="check_ssl">
      <span class="check"><svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#06140c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      <span class="label"><b>SSL Certificate</b> – Secure HTTPS connection</span>
    </div>
    
    <div class="task" id="check_live">
      <span class="check"><svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#06140c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      <span class="label"><b>Site Live</b> – Returns 200 OK (No 404/500)</span>
    </div>
    
    <div class="task" id="check_index">
      <span class="check"><svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#06140c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      <span class="label"><b>Searchable</b> – No "noindex" meta tag blocking Google</span>
    </div>
    
    <div class="task" id="check_domain">
      <span class="check"><svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#06140c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      <span class="label"><b>Custom Domain</b> – Not a generic subdomain (.vercel, .netlify)</span>
    </div>
    
    <div class="task" id="check_content">
      <span class="check"><svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#06140c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      <span class="label"><b>Real Business Content</b> – > 500 words, no "Coming Soon"</span>
    </div>
    
    <div class="task" id="check_viewport">
      <span class="check"><svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#06140c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      <span class="label"><b>Mobile Friendly</b> – Viewport meta tag is set</span>
    </div>
    
    <div class="task" id="check_analytics">
      <span class="check"><svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#06140c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      <span class="label"><b>Tracking Installed</b> – Google Analytics / Plausible detected</span>
    </div>

    <div class="gate" id="foundationGate">
      🚪 <b>Gate:</b> <span id="gateText">Waiting for scan results...</span>
    </div>
  </div></div>
</div>

10. 7‑Category Data Collection & Actionable Insights Logic

Each category follows the same pattern:

Data Collection – using open‑source tools.
Analysis – processing raw data.
Insight Generation – converting findings into actionable recommendations.

1. Domain & Hosting

Data Collected

Field	Source	Tool
Domain registration	WHOIS lookup	whoiser / python-whois
SSL certificate status	SSL handshake	ssl-checker / pyOpenSSL
DNS records (A, MX, NS, TXT)	DNS resolution	dns / @oxog/dns
Server headers & technologies	HTTP response	axios / requests
Hosting provider	IP geolocation + WHOIS	ip + whoiser
Page load time (FCP, LCP, CLS)	Browser rendering	Lighthouse
HTTP status	HTTP request	axios / requests

Collection Flow

Input URL → Extract domain (new URL(url).hostname)
                    ↓
         ┌──────────┴──────────┐
         ↓                     ↓
    WHOIS lookup          SSL check
    (whoiser)            (ssl-checker)
         ↓                     ↓
    DNS resolution       HTTP request
    (dns)                (axios)
         ↓                     ↓
    Lighthouse performance
    (Lighthouse CI)
                    ↓
         Aggregate Results
         → EnhancedCheck[]

Actionable Insights Logic

Condition	Business Impact	Recommendation
SSL expires < 30 days	"Browsers show 'Not Secure' – 85% abandon checkout."	"Renew SSL via Let's Encrypt NOW."
Domain expires < 90 days	"Risk of domain squatting and site downtime."	"Enable auto-renewal immediately."
FCP > 1.8s	"1s delay = 7% drop in conversions."	"Compress images to WebP, enable browser caching."
Mixed content found	"Modern browsers block insecure HTTP resources."	"Replace all http:// URLs with https://."
WHOIS privacy off	"Your personal contact info is publicly exposed."	"Enable WHOIS Privacy Protection."
DNS records missing	"Email delivery and site access may fail."	"Add A, MX, and NS records via your hosting panel."
2. Brand Details

Data Collected

Field	Source	Tool
Brand name	<title>, Schema.org, Open Graph	cheerio / beautifulsoup4
Industry classification	Zero-shot classification	facebook/bart-large-mnli
USP summarization	Hero section (H1 + adjacent P)	facebook/bart-large-cnn
Target audience	NER + regex on "About Us"	spaCy + custom regex
Primary goal	Primary CTA button analysis	Rule-based
Brand voice/tone	Sentiment analysis on copy	transformers sentiment
Tagline	Meta description, hero text	cheerio
Collection Flow

Extract HTML → Cheerio/BeautifulSoup
                    ↓
         ┌──────────┼──────────┐
         ↓          ↓          ↓
    Brand Name    Industry    USP
    (Schema/     (Zero-shot  (BART
     Title)       MNLI)       CNN)
         ↓          ↓          ↓
    Audience      Goal       Tagline
    (spaCy NER   (CTA       (Meta
     + Regex)     Rule)      Desc)
                    ↓
         Aggregate Results

Actionable Insights Logic

Condition	Business Impact	Recommendation
USP is generic/vague	"Visitors cannot differentiate you."	"Add specific, benefit-driven USP (e.g., 'Design 10x faster')."
Target audience too broad	"Marketing spend wasted on irrelevant segments."	"Segment by role/seniority (e.g., 'Senior UX designers in SaaS')."
No clear CTA above fold	"Users don't know what to do – bounce rate increases."	"Add a prominent CTA button above the fold."
Sentiment is neutral/bland	"Brand lacks emotional connection."	"Add emotional triggers (social proof, urgency, benefits)."
Missing Schema.org markup	"Search engines can't understand your brand."	"Add Organization schema with logo, name, description."
No tagline/meta description	"Google generates random snippets in search results."	"Write a compelling meta description (150-160 chars)."

3. Website Details

Data Collected

Field	Source	Tool
Technology stack	HTML, headers, cookies, JS	Wappalyzer
CMS identification	HTML meta, generator tags	Wappalyzer
JavaScript frameworks	Global variables, script tags	Wappalyzer
Analytics tools	Script src patterns	Wappalyzer + regex
Hosting/CDN	Headers, IP	Wappalyzer
Page structure	HTML parsing	cheerio / beautifulsoup4
Mobile responsiveness	Viewport meta, CSS	cheerio + Lighthouse
Sitemap	/sitemap.xml, /robots.txt	axios / requests
Page count	Internal link discovery	cheerio + BFS crawl

Collection Flow
Load page → Playwright/Puppeteer
                    ↓
         ┌──────────┴──────────┐
         ↓                     ↓
   Get HTML + headers     Wappalyzer
   (cheerio)             (tech detection)
         ↓                     ↓
   Sitemap scan          Internal links
   (/sitemap.xml)        (BFS crawl)
         ↓                     ↓
   Mobile check          Lighthouse
   (viewport meta)       (mobile score)
                    ↓
         Aggregate Results

Actionable Insights Logic

Condition	Business Impact	Recommendation
No viewport meta tag	"Mobile users see zoomed-out desktop – 60% of traffic."	"Add <meta name='viewport' content='width=device-width'>."
No sitemap.xml	"Search engines can't discover all your pages."	"Generate and submit a sitemap.xml to Google Search Console."
Outdated CMS version	"Security vulnerabilities expose your site to hackers."	"Update your CMS to the latest version immediately."
No SSL on all pages	"Mixed content warnings break user trust."	"Force HTTPS redirect on all pages."
Missing robots.txt	"Search engines may crawl irrelevant pages."	"Add robots.txt to control crawler access."
No internal linking	"Search engine crawlers can't navigate your site."	"Add internal links between related pages."
4. Social Media Details

Data Collected

Field	Source	Tool
Social profile links	HTML meta, link tags, footer	cheerio + regex
Social platform detection	URL pattern matching	Custom rules
Follower counts	Public APIs (limited)	nitter (Twitter), instagram-scraper
Post frequency	RSS feeds, public profiles	Custom scrapers
Engagement metrics	Public post data	Custom analysis
Platform presence	Link validation	axios / requests

Collection Flow

Extract HTML → Cheerio/BeautifulSoup
                    ↓
   Find social links:
   ├── <link rel="me">
   ├── <meta property="og:see_also">
   ├── Footer/header links
   └── Schema.org "sameAs"
                    ↓
   For each detected platform:
   ├── Validate URL → axios.head()
   ├── Identify platform (Twitter, LinkedIn, Instagram, etc.)
   └── Store: { platform, url, verified: boolean }
                    ↓
   For verified profiles (limited):
   ├── Twitter → nitter.net (scrape)
   ├── Instagram → instagram-scraper
   └── YouTube → RSS feed
                    ↓
   Generate engagement estimates

Actionable Insights Logic

Condition	Business Impact	Recommendation
No social links found	"You're missing opportunities to build community."	"Create profiles on 2-3 relevant platforms (LinkedIn, Twitter)."
Inactive profile (>30 days)	"Visitors think your brand is inactive or abandoned."	"Post at least 3-4 times per week on each active platform."
Missing visual platforms	"Your brand lacks visual storytelling."	"Start a short-form video series on Instagram/YouTube."
No links to website in bio	"Social traffic can't find your website."	"Add a clear CTA link in every social bio."
Low engagement rate	"Content isn't resonating with your audience."	"Share customer case studies and user-generated content."
Platform mismatches	"Your target audience isn't where you're posting."	"Research which platforms your competitors use most."

5. Competitor Details

Data Collected

Field	Source	Tool
Competitor names	"vs" mentions, meta keywords	cheerio + NLP
Competitor URLs	Link analysis	cheerio
Competitor tech stack	Website scan	Wappalyzer
Competitor SEO metrics	Public data	axios + cheerio
Market positioning	Competitor websites	Content analysis
Feature comparison	Website analysis	Rule-based + AI
Pricing (if public)	Pricing page scraping	cheerio

Collection Flow

Detect competitors:
├── "vs [competitor]" mentions in content
├── Meta keywords
├── "Alternatives to" pages
└── Schema.org "competitor" property
                    ↓
   For each detected competitor:
   ├── Validate domain → axios.head()
   ├── Run Wappalyzer → tech stack
   ├── Extract: USP, pricing, features
   └── Store: { name, url, technologies, positioning }
                    ↓
   SWOT analysis:
   ├── Strengths: Feature analysis
   ├── Weaknesses: Missing features, slow performance
   ├── Opportunities: Gaps in their offering
   └── Threats: Their growth, funding, market share

Actionable Insights Logic

Condition	Business Impact	Recommendation
All competitors have feature X	"You're losing deals to competitors."	"Prioritize building feature X in your next sprint."
Competitor has better pricing	"Price-sensitive customers choose them."	"Introduce a freemium tier or competitive pricing."
Competitor has strong SEO	"They capture all organic search traffic."	"Invest in SEO content targeting your category keywords."
No clear differentiation	"Customers see you as a 'me-too' product."	"Define a unique differentiator (speed, UX, price)."
Competitor has more social proof	"Trust signals are lacking on your site."	"Collect and showcase more customer testimonials."
Competitor has better UX	"Users prefer their interface over yours."	"Run user testing and prioritize UX improvements."
6. Analytical Data

Data Collected

Field	Source	Tool
Analytics tools detected	Script tags	Wappalyzer + regex
Google Analytics ID	ga/gtag scripts	Regex
Plausible/Matomo	Script patterns	Regex
Monthly visitors (est.)	Traffic estimation	Industry benchmarks
Bounce rate (est.)	Industry benchmarks	Rule-based
Conversion rate (est.)	Industry benchmarks	Rule-based
Top pages	Sitemap + analytics	Custom
Core Web Vitals	User behavior signals	Lighthouse

Collection Flow

Detect analytics tools:
├── Scan all <script> tags
├── Check for: google-analytics, gtag, plausible, matomo, hotjar
└── Extract IDs (UA-XXXX, G-XXXX)
                    ↓
   Estimate traffic:
   ├── If no API: use industry benchmarks
   └── Based on: industry, page count, content quality
                    ↓
   Run Lighthouse:
   ├── Extract: FCP, LCP, CLS, TTI
   └── Score: Good/Needs Improvement/Poor
                    ↓
   User behavior signals:
   ├── Scroll depth detection (if applicable)
   ├── Time on page estimate
   └── Return visitor estimate

Actionable Insights Logic

Condition	Business Impact	Recommendation
No analytics detected	"You have no data on where users drop off."	"Install Google Analytics (free) or Plausible immediately."
Bounce rate > 60%	"Visitors leave immediately – UX is failing."	"Improve page load speed and add clear value proposition."
Conversion rate < 2%	"You're losing potential customers."	"A/B test your primary CTA, simplify forms, add social proof."
No goal tracking set up	"You can't measure what matters."	"Set up goal tracking for sign-ups, demos, or purchases."
Poor Core Web Vitals	"Google ranks you lower – less organic traffic."	"Optimize images, reduce JavaScript, use a CDN."
No event tracking	"You don't know which features users engage with."	"Set up event tracking for key user interactions."
7. Campaign Data

Data Collected

Field	Source	Tool
UTM parameters detected	URL analysis	Regex
Campaign tracking	Analytics scripts	Custom
Active campaigns	Website analysis	Custom
Marketing channels	Referrer analysis	Custom
Ad spend (est.)	Industry benchmarks	Rule-based
ROI (est.)	Analytics + benchmarks	Rule-based
Campaign performance	Analytics data (if available)	Custom

Collection Flow

Detect campaign tracking:
├── Scan for UTM parameters in internal links
├── Check for: utm_source, utm_medium, utm_campaign
└── Count unique campaigns
                    ↓
   Identify marketing channels:
   ├── Referrer analysis (if available)
   ├── Common: Organic, Direct, Social, Email, Paid
   └── Estimate channel mix
                    ↓
   Campaign performance (estimated):
   ├── Based on: industry benchmarks
   ├── Traffic source → estimated conversion rate
   └── Calculate: estimated ROI
                    ↓
   Marketing mix:
   ├── Channel distribution
   ├── Budget allocation (estimated)
   └── Performance by channel

Actionable Insights Logic

Condition	Business Impact	Recommendation
No UTM parameters detected	"You can't track which campaigns drive conversions."	"Add UTM parameters to all marketing links."
All budget in one channel	"You're over-reliant on a single traffic source."	"Diversify into 2-3 additional channels (SEO, social, email)."
Low ROI on paid channels	"You're wasting ad spend."	"Optimize ad targeting, improve landing page conversion."
No email marketing	"You're missing retention and repeat business."	"Start an email newsletter to nurture leads."
No content marketing	"You're not building organic authority."	"Start a blog with SEO-optimized content."
No attribution model	"You can't connect campaigns to conversions."	"Implement multi-touch attribution (Uber's open-source model)."

11. Unified Execution Flow

User enters URL
                    ↓
┌───────────────────────────────────────────────────────────────┐
│ Phase 1: Website Crawling (Playwright/Puppeteer)             │
│ ├── Load page, render JavaScript                             │
│ ├── Cheerio → Parse HTML, extract content                    │
│ └── Save: HTML, headers, cookies, scripts                    │
└───────────────────────────────────────────────────────────────┘
                    ↓
┌───────────────────────────────────────────────────────────────┐
│ Phase 2: Data Collection (Parallel Execution)                │
│                                                              │
│ ┌───────────────┐ ┌───────────────┐ ┌─────────────────────┐ │
│ │ 1. Domain &    │ │ 2. Brand      │ │ 3. Website Details  │ │
│ │    Hosting     │ │    Details    │ │   Wappalyzer        │ │
│ │   whoiser      │ │   Transformers│ │   Sitemap scan      │ │
│ │   ssl-checker  │ │   spaCy       │ │   Internal links    │ │
│ │   Lighthouse   │ │   CTA rule    │ │   Mobile check      │ │
│ └───────────────┘ └───────────────┘ └─────────────────────┘ │
│                                                              │
│ ┌───────────────┐ ┌───────────────┐ ┌─────────────────────┐ │
│ │ 4. Social      │ │ 5. Competitor │ │ 6. Analytical       │ │
│ │    Media       │ │    Details    │ │    Data             │ │
│ │   Link extract │ │   "vs" detect │ │   GA/Plausible      │ │
│ │   Nitter/IG    │ │   Wappalyzer  │ │   Lighthouse        │ │
│ │   Engagement   │ │   SWOT        │ │   Benchmarks        │ │
│ └───────────────┘ └───────────────┘ └─────────────────────┘ │
│                                                              │
│ ┌───────────────────────────────────────────────────────────┐ │
│ │ 7. Campaign Data                                         │ │
│ │   UTM detection                                          │ │
│ │   Channel analysis                                       │ │
│ │   ROI estimation                                         │ │
│ └───────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
                    ↓
┌───────────────────────────────────────────────────────────────┐
│ Phase 3: Insight Generation                                 │
│ ├── Map each check to insights-library.json                 │
│ ├── Generate business impact statements                     │
│ └── Add priority (High/Medium/Low) and recommendations      │
└───────────────────────────────────────────────────────────────┘
                    ↓
┌───────────────────────────────────────────────────────────────┐
│ Phase 4: Output                                              │
│ └── FoundationOutput JSON (see Section 4)                    │
└───────────────────────────────────────────────────────────────┘

12. Developer Checklist

Set up Node.js/Python environment with all dependencies.
Implement Playwright + Cheerio for website crawling.
Implement WHOIS, SSL, DNS, Lighthouse checks (Category 1).
Implement Transformers + spaCy for brand analysis (Category 2).
Implement Wappalyzer + sitemap crawl (Category 3).
Implement social link extraction + engagement estimation (Category 4).
Implement competitor detection + SWOT analysis (Category 5).
Implement analytics detection + benchmark estimation (Category 6).
Implement UTM detection + campaign analysis (Category 7).
Create insights-library.json and mapping logic.
Implement parallel execution for performance.
Return FoundationOutput JSON conforming to schema.
Update Growth Tracker UI with the new Foundation Level HTML.
Connect frontend to call the API and pass response to applyFoundationResults().
Test with various URLs (see below).
Verify that the Gate unlocks Level 1 when all 7 checks pass.
Implement error handling (timeouts, invalid URLs, network failures).

13. Testing URLs

URL	Expected Outcome
https://example.com	Basic site; many checks will fail
https://strong-daffodil-7ded57.netlify.app/	Netlify subdomain; mixed results
https://www.google.com	All checks should pass
https://github.com	All checks should pass
https://httpbin.org/status/404	"Site Live" check fails
https://wordpress.org	WordPress tech stack detected
https://www.shopify.com	E-commerce industry detected
https://news.ycombinator.com	Minimal design, basic checks

14. Summary

By implementing this Foundation Module you will:

Allow users to start with just a URL – no long forms.
Automatically run technical checks across 7 core categories.
Infer brand strategy (industry, USP, audience) locally – free of charge.
Provide actionable insights for every failing check.
Automatically unlock the next level in the Growth Tracker when all checks pass.
Use only open‑source tools – no paid APIs.
This creates a seamless, automated, and highly engaging user experience.

15. Support & Documentation

Tool	Documentation
Playwright	https://playwright.dev/
Cheerio	https://cheerio.js.org/
Lighthouse	https://github.com/GoogleChrome/lighthouse
HuggingFace Transformers	https://huggingface.co/docs/transformers/index
Whoiser	https://github.com/ValentinH/whoiser
Wappalyzer	https://github.com/AliasIO/wappalyzer
spaCy	https://spacy.io/

End of Document
