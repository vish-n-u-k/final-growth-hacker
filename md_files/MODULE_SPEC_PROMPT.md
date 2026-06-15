# Prompt: Generate a Module Spec for the Growth Hacker App

Copy and paste everything below this line into Claude chat.

---

## Your task

You are helping build a modular growth audit tool. I need you to generate a structured `.md` specification file for a new audit module. A developer will use this file to wire it directly into the app — so every field must be precise, complete, and developer-ready. No placeholders, no hand-waving.

Read all the context below carefully. Then ask me the questions at the bottom **one section at a time**, waiting for my answer before continuing. If any answer is unclear or incomplete, ask a follow-up before moving on. Once you have everything, produce the final `.md` file.

---

## App context

The app runs a series of audit modules for a business. Each module checks a specific domain (website SEO, competitor landscape, social media, Google Ads, email, etc.). Modules unlock in sequence — the user must reach a score threshold on the previous module before the next one becomes available.

Every module produces a scored checklist. Items can be:
- Evaluated automatically (by fetching public data and running checks)
- Checked manually by the user (toggling a checkbox in the dashboard)
- Flagged as informational (checks that require a full crawl, external API, or human judgment — these are surfaced as guidance, not scored failures)

### Module chain so far
```
Foundation (0) → Website Audit (1) → SEO Audit (2) → Competitor Audit (3) → [next module here]
```

---

## Three module modes

### Mode A — Rule Engine + AI Narratives (static items, deterministic checks)
Used by: Website Audit, SEO Audit.

The checklist items are **fixed and defined in advance**. A deterministic JavaScript rule engine (using Cheerio, fetch, TLS, etc.) makes every pass/fail decision from the fetched data. Claude is called **once at the end**, only to write 1–2 sentence business-impact narratives for failing items. Claude does NOT make any pass/fail decisions.

Choose this mode when:
- The checks are always the same regardless of the business
- Each check has a clear, objective pass/fail condition (e.g. "title tag is 50–60 chars" — measurable in code)
- You want consistent, reproducible results that don't vary between runs on the same data

### Mode B — AI Evaluates Static Items (static items, Claude decides)
Used by: Foundation Audit.

The checklist items are **fixed and defined in advance**. Claude receives the fetched data and evaluates each pre-defined item, deciding pass/fail and writing a detail sentence. No separate rule engine.

Choose this mode when:
- The checks are always the same across businesses
- But the pass/fail condition requires judgment Claude is better at (e.g. "Does the homepage clearly explain the value proposition?" — subjective)

### Mode C — AI Generates Items Dynamically (Claude generates items + evaluates)
Used by: Competitor Audit.

The category structure is fixed, but Claude generates the actual checklist items based on what it finds. No pre-defined item slugs. Claude decides what to surface, how to label it, and whether it passes or fails.

Choose this mode when:
- Findings are highly variable between businesses (one competitor is weak on SEO, another on pricing, another on social — you can't predict what will matter)
- A fixed checklist would miss the point

---

## How data flows through a module

Every module has three files:

1. **fetcher** — fetches raw data from the web (HTML, API response, XML, etc.) and returns a structured object
2. **agent** — receives the fetched data and produces results per item (using rule engine + Claude, or Claude alone)
3. **definition** — declares the module metadata, requirements, categories, and items (static modes) or category prompts (dynamic mode)

The spec you produce must give the developer everything they need to write all three files without making assumptions.

---

## Requirement input types

These are the input fields shown to the user before analysis can run:

| Type | Use when |
|------|----------|
| `url` | Single URL (e.g. website homepage) |
| `text` | Single free-text value (e.g. brand name, target keyword) |
| `url_list` | Multiple URLs, one per line (e.g. competitor URLs) |
| `text_list` | Multiple text values, comma-separated (e.g. target keywords) |

Mark each requirement as `required: yes` or `required: no` (optional requirements are shown but analysis can run without them).

---

## Info-level items (important concept)

Some checks cannot be done from a single page fetch. They require:
- A full site crawl (e.g. finding orphan pages, checking all internal links)
- An external API with credentials (e.g. Google PageSpeed Insights, Facebook Graph API)
- Human judgment (e.g. "does this design feel trustworthy?")

These items should still appear in the checklist as **info-level** — they surface guidance and recommended next steps, but they always count as "passed" so they don't penalise the score for something the system can't check. The finding text should tell the user what to check manually and how.

In the spec, mark these items as: `Level: info`

---

## Fixable flag — precise definition

Mark `Fixable: yes` **only** when all three of these are true:
1. The fix is a change to a single HTML tag, meta tag, or JSON-LD block (e.g. adding `<title>`, updating `<meta name="description">`, adding OG tags, fixing canonical href)
2. The fix could be made as an automated GitHub PR with no human judgment required
3. The change is safe to apply without knowing anything about the site's framework or CMS

**Do not mark fixable for:** copy changes, design decisions, adding pages, configuring servers, changing URL structures, anything that requires knowing the tech stack, or anything structural.

---

## Weight guide

| Weight | Meaning | Examples |
|--------|---------|---------|
| 3 — Critical | Directly blocks ranking, indexing, or conversions. Fix immediately. | No title tag, noindex on live page, SSL invalid, no CTA |
| 2 — Important | Meaningfully hurts performance if left. Fix soon. | Missing meta description, no sitemap, weak heading structure |
| 1 — Minor | Nice to have. Small uplift when fixed. | Twitter card tags, image lazy loading, brand in title |

---

## Output format

Produce a `.md` file with exactly this structure. Do not add or remove sections.

```
# Module: [Name]

## Metadata
- Type: [slug] — lowercase kebab-case (e.g. seo, google-ads, email-marketing)
- Name: [Display name shown in the dashboard]
- Description: [One sentence. What does this module audit?]
- Order: [Integer — position in module sequence]
- Unlock threshold: [0–100 — score the previous module must reach]
- Mode: [A — Rule Engine + AI Narratives | B — AI Evaluates Static | C — AI Dynamic]

## Requirements
[Every input the module needs from the user before it can run.]

- Key: [machine_key]
  Label: [Human-readable label shown in UI]
  Type: [url | text | url_list | text_list]
  Required: [yes | no]
  Placeholder: [Example value]

## Data fetching

### What to fetch
[List every HTTP request the fetcher must make. For each one:]
- URL pattern: [e.g. the page itself, {origin}/robots.txt, an API endpoint]
- Method: [GET | HEAD | POST]
- Auth required: [none | API key (env var name) | OAuth | user-provided credential]
- Format returned: [HTML | JSON | XML | plain text | binary]
- How much to use: [full response | first N chars | specific fields]
- Timeout: [recommended ms]

### What to do if fetch fails
[Describe the fallback for each fetch. Options: throw error and abort analysis | return partial result | mark affected items as info-level | show specific error message to user]

### Structured result shape
[Show the TypeScript interface the fetcher returns. Be exact — the agent depends on this.]

```typescript
interface [ModuleName]FetchResult {
  // ...
}
```

## System prompt
[The AI persona and rules. Sent to Claude as the system prompt for this module's analysis.
Specify:
- Role and expertise Claude takes on
- Tone (direct, consultant, technical, etc.)
- Core rules (e.g. only report what you can verify, reference exact values, no generic advice)
- What "pass" means vs "fail" vs "info" in this context
- Any output format constraints]

## Categories

[For each category, follow the format for your chosen mode:]

---

### [N]. [Category Label]
Slug: [category-slug]

[MODE A or B — Static items:]

#### [Sub-category Label]
Slug: [sub-category-slug]

Items:
| Slug | Label | Weight | Level | Fixable | Check logic (rule engine) | Pass condition | Fail condition |
|------|-------|--------|-------|---------|--------------------------|----------------|----------------|
| [kebab.slug] | [Short checklist label] | [1/2/3] | [good/bad/ok/info] | [yes/no] | [Exact code logic: what field/attribute/value to read from the fetched data] | [What the result looks like when passing] | [What the result looks like when failing + what fix text to return] |

[MODE C — Dynamic items:]

Category prompt:
[Detailed instructions for Claude for this category. Include:
- What signals to look for in the fetched data
- What constitutes a finding worth surfacing (specific, not generic)
- How to weight findings (critical/important/minor)
- What "verified: true" means here (a genuine positive, not absence of a problem)
- Slug format to use (e.g. "competitor-[signal]-[finding]")]

---

## Edge cases
[Describe how the module should behave in unusual situations. For each:]
- Scenario: [what happens]
  Handling: [what the fetcher/agent should do]

## Known limitations
[List checks that CANNOT be done automatically with a single page fetch and why. For each:]
- Check: [what would ideally be checked]
  Reason it's info-level: [why it can't be automated]
  Guidance text: [what the info-level finding text should say to the user]
```

---

## Questions — ask these in order, one section at a time

Before writing the spec, ask me the following. Wait for my full answer before moving to the next question. If something is ambiguous, ask a follow-up.

---

**1. Module topic**
What does this module audit? Give me:
- A short description of what it covers
- Who the target audience is (the business owner? their developer? their marketing team?)
- What outcome the user should have after completing this module (what do they know / what have they fixed?)

---

**2. Position and unlock**
- Where in the module sequence does this sit? (Current chain: Foundation → Website → SEO → Competitor → ?)
- What score does the previous module need to reach before this one unlocks? (Use 0 if it should always be available or unlock immediately)

---

**3. Mode selection**
Based on the module topic, I'll suggest a mode — but confirm with me:
- Are the checks always the same for every business, or do they vary significantly per site/account?
- For each check, is the pass/fail condition objectively measurable (e.g. a character count, a tag being present) — or does it require judgment?
- Suggested mode: [I will suggest one based on answers above]

---

**4. Data requirements — user inputs**
What does the module need the user to provide before analysis can run?
For each input:
- What is it? (e.g. their Google Ads account ID, their Instagram handle, a list of target keywords)
- Is it a single value or multiple values?
- Is it required or optional?
- Will the system be able to auto-fill it from what was already collected at onboarding (website URL, brand name)?

---

**5. Data fetching**
This is the most critical section. For the module to run automatically, the data must be publicly fetchable or accessible via an API key the user provides.

For each data source the module needs:
- What is the URL or endpoint?
- Is it publicly accessible without auth, or does it need an API key / OAuth token?
  - If API key: which service? What env var name? Is there a free tier?
  - If OAuth: which provider? What scopes are needed?
- What format does it return? (HTML page, JSON API, XML feed, etc.)
- Are there rate limits or bot detection that could block automated fetches?
- What should happen if this fetch fails — abort the whole analysis, or continue with partial data?

If any data source is not publicly accessible and requires credentials the user must provide, flag this — it changes the requirement type to a credential input, not a URL.

---

**6. Checks and categories**
List the top-level categories for this module (aim for 3–6). For each category:
- Category name and what it covers
- The specific checks within it

For each check, tell me:
- What exactly are you checking? (Be specific — reference the exact field, tag, attribute, metric, or value)
- What does a pass look like?
- What does a fail look like? (Include specific thresholds if applicable — e.g. "title under 30 chars = fail")
- How critical is it? (Critical / Important / Minor)
- Can this be checked automatically from the data you described in question 5? Or does it need a full crawl / external API / manual review? (→ info-level)
- Is the fix a simple tag/attribute edit that could be auto-applied as a code change? (→ fixable)

---

**7. AI role**
- For Mode A: What persona should Claude take when writing narratives for failing items? (e.g. "senior Google Ads consultant", "direct response copywriter") What tone? Any rules about what it should or shouldn't say?
- For Mode B: What persona evaluates each item? What data does Claude receive? What does it return per item?
- For Mode C: What persona generates the findings? What makes a finding worth surfacing vs noise? What output format does it return?

---

**8. Edge cases and error handling**
- What should happen if the main data source is unreachable? (e.g. site is down, API rate limit hit, private account)
- Are there any scenarios where the module shouldn't run at all? (e.g. "no ads are active", "no posts in the last 90 days")
- Any checks that behave differently depending on the type of business? (e.g. schema type check differs for e-commerce vs blog)

---

Once you have answers to all 8 sections, write the complete `.md` spec file. Do not summarise, skip items, or leave placeholders. Every check must have a slug, weight, level, check logic, pass condition, and fail condition filled in completely.
