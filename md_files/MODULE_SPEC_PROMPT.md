# Prompt: Generate a Module Spec for the Growth Hacker App

Copy and paste everything below this line into Claude chat.

---

## Your task

You are helping build a modular growth audit tool. I need you to generate a structured `.md` specification file for a new audit module. The developer will use this file to wire it into the app — so every field must be precise, complete, and follow the format exactly.

Read all the context below before you start. Then ask me the questions at the bottom, one section at a time, and produce the final `.md` file when you have everything you need.

---

## App context

The app runs a series of audit modules for a business. Each module checks a specific domain (website, SEO, social media, Google Ads, email, etc.). Modules unlock in sequence — the user must reach a score threshold on the previous module before the next one becomes available.

Every module produces a scored checklist that the user works through. Items can be evaluated by AI (by fetching the site/profile/data and analysing it) or checked manually by the user.

---

## Two module modes

### Static mode
The checklist items are fixed and defined in advance. Claude evaluates each pre-defined item and returns a pass/fail with explanation. Good for audits where the checks are always the same regardless of the business (e.g. "Does the site have a title tag?" is always relevant).

### Dynamic mode
Claude generates the checklist items itself based on what it actually finds. The categories are fixed but the items inside them are generated per-site. Good for audits where findings are highly variable (e.g. SEO issues vary per site — one site has a missing meta description, another has duplicate H1s).

---

## Output format I need

Produce a `.md` file with exactly this structure:

```
# Module: [Name]

## Metadata
- Type: [slug] — lowercase kebab-case, used in DB and URLs (e.g. seo, social-instagram, google-ads)
- Name: [Display name shown in the dashboard navigation]
- Description: [One sentence shown below the module name. What does this module audit?]
- Order: [Integer. Position in the module sequence. Foundation=0, Website=1, SEO=2, next is 3, etc.]
- Unlock threshold: [0–100. The score the PREVIOUS module must reach before this one unlocks. Use 0 if always unlocked.]
- Mode: [static | dynamic]

## Data requirements
[List every piece of input the module needs from the user before it can run an analysis.
Format each as:]
- Key: [machine key, e.g. website_url]
  Label: [Human label shown in the UI, e.g. "Your website URL"]
  Type: [url | text]
  Placeholder: [Example value shown in the input field]

## System prompt
[Write the AI persona and rules in full. This is what Claude receives as the system prompt
when it analyses this module. Be specific about:
- The role/persona Claude takes on
- The tone (direct, consultant-style, etc.)
- The rules Claude must follow (e.g. only report what you can verify, be specific, no generic advice)
- What "pass" vs "fail" means in this context]

## Categories
[List all categories. For each category:]

### [Category order]. [Category Label]
Slug: [category-slug]

[IF STATIC MODE — add sub-categories and items:]

#### [Sub-category Label]
Slug: [sub-category-slug]

Items:
| Order | Label | Slug | Weight | Fixable | Prompt |
|-------|-------|------|--------|---------|--------|
| 1 | [Short checklist label] | [kebab-case-slug] | [1/2/3] | [yes/no] | [What Claude checks. Be specific — reference exact HTML tags, attributes, values, or data to look for. Tell Claude what a pass looks like and what a fail looks like.] |
| 2 | ... | ... | ... | ... | ... |

[IF DYNAMIC MODE — add only a category prompt, no items:]

Category prompt:
[Detailed instructions for what Claude should look for within this category.
Tell it: which specific signals to check, what data to reference (HTML, API response, profile page),
what to count or measure, what constitutes a finding worth reporting, and what weight to assign.
Claude will generate 3–8 items per category based on what it actually finds.]
```

---

## Weight guide (for static mode items and dynamic mode item generation)

| Weight | Meaning | Examples |
|--------|---------|---------|
| 3 — Critical | Missing this directly blocks growth, visibility, or conversions | No title tag, site not indexed, no CTA, SSL invalid |
| 2 — Important | Fix soon; meaningfully hurts performance if left unfixed | Missing meta description, no sitemap, low social proof |
| 1 — Minor | Nice to have; small uplift | Twitter card tags, favicon, image file names |

---

## Fixable flag (static mode only)

Mark `fixable: yes` only for items where the fix is a direct code/config change that a developer could automate (e.g. adding a meta tag, canonical URL, robots.txt entry, OG tag). Do NOT mark fixable for things that require human judgment (copy, strategy, design decisions).

---

## Slug rules

- All slugs are kebab-case, lowercase, no spaces
- Category slugs should reflect the grouping (e.g. `on-page-seo`, `profile-branding`)
- Item slugs must be stable — the same logical check should always use the same slug so re-runs can upsert rather than duplicate
- Item slugs should be unique within the module

---

## Questions to ask me before writing the spec

Ask me these in order. Wait for my answer before moving to the next section.

1. **Module topic**: What does this module audit? Give me a short description of what it covers.

2. **Mode**: Should this be static (fixed checklist, same items for every business) or dynamic (Claude generates items based on what it finds)?

3. **Position and unlock**: What order should this module appear in the sequence? What score does the previous module need to reach before this one unlocks? (If this is always available, say 0.)

4. **Data needed**: What information does the module need from the user to run the analysis? (e.g. website URL, Instagram profile URL, Google Ads account ID) For each piece of data, give me the label and an example placeholder.

5. **AI persona**: What role should Claude take when auditing this module? Describe the tone, the standard it holds things to, and any specific rules (e.g. "only report what you can verify from the data fetched", "reference exact values found").

6. **Categories**: List the top-level categories for this module. These are the sections the checklist is grouped into (e.g. "Profile & Branding", "Content Performance", "Engagement"). Aim for 3–6 categories.

7. **Items per category** (if static): For each category, list the specific checks. For each check give me: what it looks for, what a pass looks like, what a fail looks like, and how critical it is (critical/important/minor).

   OR

   **Category focus** (if dynamic): For each category, describe in detail what Claude should look for within it. What signals matter? What should it count or measure? What makes something worth flagging?

8. **Edge cases**: Are there any scenarios the AI should handle specially? (e.g. "if the profile is private, flag all social checks as unverifiable", "if no ads are running, mark the whole module as not applicable")

Once you have all my answers, generate the complete `.md` file following the exact format above. Do not add sections that aren't in the format. Do not summarise or skip items I provided.
