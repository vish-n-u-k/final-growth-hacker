# UX Audit System — Architecture & Spec

Reference pattern: findings are structured as **Headline → Current State → Reasoning (with evidence) → Action → Generate AI Draft → Skip**, grouped into categories with a completion progress bar (e.g. "Content Strategy 5/8 — 67%").

This doc defines: (1) the end-to-end architecture, (2) every category/sub-check the UX Audit should cover, (3) which tool powers each check, and (4) the logic/output schema so it can be integrated directly.

---

## 1. High-Level Architecture

```
┌─────────────┐     ┌──────────────┐     ┌───────────────────┐     ┌──────────────────┐     ┌─────────────┐
│   Input     │ --> │   Crawl &    │ --> │   Analysis Layer   │ --> │  Findings Engine   │ --> │   Output    │
│  (URL)      │     │   Render     │     │ (Deterministic +   │     │ (score, group,     │     │  (JSON →    │
│             │     │              │     │  AI Judgment)      │     │  dedupe, prioritize)│    │   UI cards) │
└─────────────┘     └──────────────┘     └───────────────────┘     └──────────────────┘     └─────────────┘
```

### Stage 1 — Crawl & Render
- **Tool:** Playwright (headless Chromium/Firefox/WebKit)
- Renders the page fully (post-JS), captures:
  - Full DOM snapshot
  - Computed CSS styles per element
  - Screenshot: desktop (1440px) + mobile (375px) viewports
  - Console errors / network failures
  - Basic sitemap crawl (2–3 levels deep) for site-wide checks (nav, dead links)

### Stage 2 — Analysis Layer (two tracks, run in parallel)

**Track A: Deterministic checks** (no AI, rule-based, high trust, instant)
- axe-core (accessibility)
- Custom DOM/CSS parsers (touch targets, spacing, contrast math, breakpoints)
- Lighthouse (performance, CLS, load metrics)
- Link crawler (dead links, redirect chains)

**Track B: AI judgment checks** (needs screenshot + DOM context, subjective/contextual)
- LLM call (vision-capable) per page: hero clarity, CTA hierarchy, copy scannability, visual hierarchy, empty-state quality, trust signals
- Flagged in the UI as "AI-assessed" vs. "Automated check" so users calibrate trust

### Stage 3 — Findings Engine
- Normalizes both tracks into one schema (see §4)
- Deduplicates overlapping findings (e.g. axe-core contrast + LLM "text hard to read" on the same element → merge)
- Assigns severity (Critical / Important / Moderate / Low)
- Groups into categories, computes per-category progress (X/Y checks passed)
- Attaches "Action" text — deterministic checks get templated actions; AI checks get LLM-generated specific actions

### Stage 4 — Output
- JSON payload → rendered as cards in your existing UI pattern (headline, current state, reasoning, action, Generate AI Draft, Skip)
- "Generate AI Draft" button calls LLM again, this time to produce the actual fix (copy rewrite, code snippet, alt text suggestion, etc.) — deferred/on-demand, not run for every check up front (cost control)

---

## 2. Tool Stack Summary

| Layer | Tool | License | Cost | Purpose |
|---|---|---|---|---|
| Rendering | Playwright | Apache 2.0 | Free | Load JS-rendered pages, screenshots, DOM extraction |
| Accessibility | axe-core | MPL 2.0 | Free | WCAG violation detection with element-level specificity |
| Performance | Lighthouse (Node API, self-hosted) | Apache 2.0 | Free | CLS, load time, image optimization, Core Web Vitals |
| Link/crawl | Custom crawler (built on Playwright) or `sitemapper` | Open source | Free | Sitemap traversal, dead link detection |
| Contrast math | `wcag-contrast` or custom (color math) | Open source | Free | Deterministic contrast ratio calculation |
| AI judgment + draft generation | Claude API (vision-capable model) | Anthropic API | Usage-based | Subjective checks + draft content generation |
| Queue/orchestration | Your existing backend (e.g. BullMQ/Celery) | — | — | Runs crawl → analysis → findings as an async job per audit |

**Only paid component:** LLM API calls. Everything else runs on your own infrastructure at zero licensing cost.

---

## 3. UX Audit — Full Category & Sub-Check List

Each sub-check below includes: **what it checks**, **tool/method**, and **check type** (Deterministic = rule-based / AI = judgment-based).

### 3.1 Accessibility
| Check | Method | Type |
|---|---|---|
| Color contrast (text vs. background) | axe-core + custom contrast ratio calc | Deterministic |
| Alt text presence on meaningful images | axe-core + DOM parse | Deterministic |
| Alt text *quality* (descriptive vs. filename/empty) | LLM review of alt attributes | AI |
| Form label association (`<label for>`) | axe-core | Deterministic |
| Heading hierarchy (h1→h6, no skipped levels) | DOM parse | Deterministic |
| Keyboard navigation / tab order | Playwright keyboard simulation + axe-core | Deterministic |
| Visible focus states on interactive elements | Computed style check on `:focus` | Deterministic |
| ARIA labels on icon-only buttons | axe-core | Deterministic |
| Color-not-only-indicator (e.g. red/green without icon/text) | LLM visual review | AI |
| Skip-to-content link presence | DOM parse | Deterministic |

### 3.2 Touch & Interaction (Mobile)
| Check | Method | Type |
|---|---|---|
| Touch target size (≥44×44px) | Computed bounding box on interactive elements | Deterministic |
| Spacing between touch targets (≥8px) | DOM geometry calc | Deterministic |
| Hover-only interactions (breaks on touch devices) | CSS rule parse (`:hover` without `:focus`/tap alt) | Deterministic |
| Loading/disabled state on form submit buttons | Playwright interaction test | Deterministic |
| Cursor affordance (`pointer`) on clickable non-link/button elements | Computed style check | Deterministic |

### 3.3 Layout & Responsiveness
| Check | Method | Type |
|---|---|---|
| Horizontal scroll on mobile viewport | Playwright viewport test (scrollWidth > viewportWidth) | Deterministic |
| Breakpoint coverage (does layout break between 320–1440px) | Multi-viewport screenshot diffing | Deterministic |
| Fixed-width containers causing overflow | CSS parse for fixed `px` widths | Deterministic |
| Viewport meta tag present & correct | HTML head parse | Deterministic |
| Cumulative Layout Shift (CLS) | Lighthouse | Deterministic |
| Safe-area/notch handling (mobile web) | CSS `env(safe-area-inset-*)` presence check | Deterministic |

### 3.4 Visual Hierarchy & Clarity
| Check | Method | Type |
|---|---|---|
| Primary CTA prominence above the fold | LLM visual review of hero screenshot | AI |
| Competing CTAs (multiple equally-weighted actions) | LLM visual review | AI |
| Font size/line-height readability (body ≥16px, 1.5 line-height) | Computed style check | Deterministic |
| Icon consistency (style/stroke/sizing) | LLM visual review of icon set | AI |
| Whitespace/spacing rhythm consistency | LLM visual review or spacing-token audit | AI |
| Text-to-background legibility beyond raw contrast (busy background images) | LLM visual review | AI |

### 3.5 Navigation & Information Architecture
| Check | Method | Type |
|---|---|---|
| Nav depth / findability (how many clicks to key pages) | Site crawl + graph depth calc | Deterministic |
| Dead links (404s) | Crawl + HTTP status check | Deterministic |
| Broken redirect chains | Crawl + redirect trace | Deterministic |
| Breadcrumb presence on deep pages | DOM parse | Deterministic |
| Nav label clarity (jargon vs. plain language) | LLM review of nav text | AI |
| Search functionality presence (for content-heavy sites) | DOM parse for search input | Deterministic |
| Mobile nav pattern (hamburger usability, overlay behavior) | Playwright interaction test + screenshot | AI + Deterministic |

### 3.6 Forms & Conversion
| Check | Method | Type |
|---|---|---|
| Placeholder-only labels (disappear on input) | DOM parse (label vs. placeholder attr) | Deterministic |
| Inline error message presence & placement | Playwright form-submit simulation | Deterministic |
| Error message clarity/specificity | LLM review of error copy | AI |
| Number of form fields (friction audit) | DOM count | Deterministic |
| Progressive disclosure on long/multi-step forms | LLM review of form structure | AI |
| CTA button copy clarity ("Submit" vs. specific action) | LLM review | AI |
| Required-field indication | DOM parse | Deterministic |

### 3.7 Performance-as-UX
| Check | Method | Type |
|---|---|---|
| Largest Contentful Paint (LCP) | Lighthouse | Deterministic |
| Total Blocking Time (TBT) | Lighthouse | Deterministic |
| Image format optimization (WebP/AVIF usage) | Lighthouse + asset scan | Deterministic |
| Lazy loading on below-fold images | DOM parse (`loading="lazy"` attr) | Deterministic |
| Render-blocking resources | Lighthouse | Deterministic |

### 3.8 Content & Clarity
| Check | Method | Type |
|---|---|---|
| Copy scannability (paragraph length, headings) | LLM review of page text | AI |
| Jargon vs. audience-appropriate language | LLM review (needs ICP context as input) | AI |
| Empty state design (search-no-results, empty cart/dashboard) | LLM visual review (requires triggering state via Playwright) | AI + Deterministic |
| 404 page quality (helpful vs. generic) | Crawl + LLM review | AI |

### 3.9 Trust & Credibility
| Check | Method | Type |
|---|---|---|
| Contact info / support visibility | DOM parse + LLM review | AI |
| Testimonials/social proof presence near conversion points | LLM visual review | AI |
| Security/trust badges at checkout (if e-commerce) | DOM parse + LLM visual review | AI |
| Consistent branding (logo, color usage across pages) | LLM visual review across sampled pages | AI |

---

## 4. Finding Object Schema

```json
{
  "id": "a11y-contrast-hero-001",
  "category": "Accessibility",
  "check_type": "deterministic",
  "title": "Hero CTA text fails contrast requirements",
  "severity": "critical",
  "page_url": "https://example.com/",
  "current_state": "Hero CTA text is #999999 on #FFFFFF background, measured contrast ratio 2.3:1.",
  "reasoning": "WCAG AA requires 4.5:1 contrast for normal text. Sub-threshold contrast excludes users with low vision and fails automated accessibility audits that many procurement teams run pre-purchase.",
  "action": "Change hero CTA text color to #333333 or darker to meet the 4.5:1 minimum against the current white background.",
  "evidence": {
    "element_selector": ".hero-cta",
    "screenshot_url": "s3://.../hero-desktop.png",
    "measured_value": "2.3:1",
    "required_value": "4.5:1"
  },
  "can_generate_ai_draft": true,
  "skip_reasons": ["Not relevant to my business", "Intentional design choice", "Already planned"],
  "status": "open"
}
```

---

## 5. Scoring & Prioritization Logic

- **Severity weights:** Critical = 4, Important = 3, Moderate = 2, Low = 1
- **Category score** = (weighted points resolved) / (total weighted points possible) × 100
- **Overall audit score** = average of category scores, or weighted by category importance if you want certain categories (e.g. Accessibility, Conversion) to count more
- **Sort order within category:** severity desc, then by whether `can_generate_ai_draft` is true (actionable items surface first)

---

## 6. Job Pipeline (for dev implementation)

1. `POST /audit` with URL → creates async job
2. **Crawl step:** Playwright renders target page(s) (homepage + N key pages, or user-specified pages), captures DOM/CSS/screenshots at 2 viewports
3. **Deterministic step:** run axe-core, Lighthouse, and custom parsers in parallel against captured DOM/CSS/screenshots — fast, no LLM cost
4. **AI judgment step:** batch screenshots + relevant DOM excerpts into structured prompts per category (one LLM call per category per page, not per individual check, to control cost) — LLM returns findings matching the schema in §4
5. **Merge & dedupe:** combine both tracks into single findings list, run overlap detection (same element flagged by both tracks → merge into one finding, cite both sources)
6. **Persist:** store findings + evidence in DB, generate category progress stats
7. **Serve:** frontend fetches findings, renders as cards per existing UI pattern
8. **On-demand:** "Generate AI Draft" triggers a separate, scoped LLM call only when user clicks it (not pre-generated for all findings — cost control)

---

## 7. Notes for the Developer

- Run Lighthouse via its **Node API locally**, not the hosted PageSpeed Insights API — same engine, no rate limits, no external dependency.
- Batch AI judgment calls **per category per page**, not per check — reduces LLM calls from ~30 to ~9 per page audited.
- Cache deterministic check results per page snapshot; only re-run AI judgment calls if the page content has changed since the last audit (hash the DOM).
- Store the `skip_reasons` selections — feed back into a per-account suppression list so recurring audits don't resurface dismissed categories.
- Vision-capable LLM calls need both the screenshot *and* relevant DOM/CSS excerpts in the prompt — screenshots alone lose information like exact hex values and computed spacing.
