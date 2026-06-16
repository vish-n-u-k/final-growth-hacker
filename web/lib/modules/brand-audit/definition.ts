import type { ModuleDefinition } from '../types'

export const BRAND_AUDIT_MODULE: ModuleDefinition = {
  type: 'brand-audit',
  name: 'Brand Audit',
  description: 'Evaluate brand positioning, messaging, voice, consistency, audience fit, trust signals, AI visibility, differentiation, and overall brand strength.',
  order: 5,
  unlockThreshold: 0,
  dynamic: true,
  requirements: [
    {
      key: 'website_url',
      label: 'Your website URL',
      type: 'url',
      placeholder: 'https://yourbusiness.com',
      required: true,
    },
    {
      key: 'brand_name',
      label: 'Brand / Company name',
      type: 'text',
      placeholder: 'Acme Inc.',
      required: true,
    },
    {
      key: 'industry',
      label: 'Industry',
      type: 'text',
      placeholder: 'e.g. SaaS, E-commerce, Healthcare',
      required: false,
    },
    {
      key: 'target_audience',
      label: 'Target audience',
      type: 'text',
      placeholder: 'e.g. Shopify sellers, Enterprise CTOs',
      required: false,
    },
    {
      key: 'usp',
      label: 'Your unique selling proposition',
      type: 'text',
      placeholder: 'e.g. No expertise required, AI-powered video ads',
      required: false,
    },
    {
      key: 'brand_voice',
      label: 'Desired brand voice',
      type: 'text',
      placeholder: 'e.g. Professional, friendly, direct',
      required: false,
    },
    {
      key: 'social_handles',
      label: 'Social media handles or URLs (optional)',
      type: 'text',
      placeholder: 'instagram.com/yourbrand, linkedin.com/company/yourbrand',
      required: false,
    },
  ],
  systemPrompt: `You are an expert brand strategist and communications auditor embedded in a growth audit tool. Your tone is direct, specific, and consultant-like.

You receive pre-processed data: crawled page content, NLP scores (readability, sentiment), trust signal counts, Wikidata result, TF-IDF keywords, and USP similarity scores. Use this data to generate specific findings — never generic advice.

Rules:
1. Only report what you can verify from the data provided. Never fabricate findings.
2. Every finding must reference specific data: cite exact scores, exact copy phrases, exact missing elements.
3. Slug format: {category-slug}-{short-descriptor} e.g. brand-positioning-vague-h1
4. Weight: 3 = directly blocks trust, conversions, or discovery | 2 = measurably hurts performance | 1 = nice-to-have
5. verified: true = passes best practice or user is ahead | verified: false = gap exists, action needed
6. fixable: true ONLY if the fix is a direct code change — adding an H1, rewriting a meta description, adding OG tags, adding JSON-LD schema markup, adding a privacy/terms link to the footer. fixable: false for everything else (create social accounts, install pixels, strategic rewrites, external platform actions, brand voice changes)
7. All action steps must be completable by a non-technical person within a week`,
  categories: [
    {
      slug: 'brand-positioning',
      label: 'Brand Positioning',
      order: 1,
      prompt: `Analyse whether a visitor can understand "what you do" and "for whom" within 5 seconds of landing on the homepage.

Using the H1, meta description, first paragraph, and top TF-IDF keywords provided: determine if the brand occupies a clear, distinct position. Check if the industry and target audience are explicitly mentioned or clearly implied. Compare against the provided "industry" and "target_audience" inputs.

Pass condition: positioning is specific, audience is identifiable, above the fold.
Fail condition: generic ("We build software"), audience missing, buried below fold.

Generate 3–5 findings. Weight 3 if no positioning statement exists. Weight 2 if buried or generic. Weight 1 if present but could be more specific.`,
    },
    {
      slug: 'messaging-value-prop',
      label: 'Messaging & Value Prop',
      order: 2,
      prompt: `Assess whether the USP is prominently featured, clearly articulated, and benefit-driven rather than feature-dumped.

Using the hero text, readability score (Flesch Reading Ease), benefit language count, feature language count, CTA texts, and the provided "usp" input: check if the USP appears in the hero section; assess if language leads with outcomes (save time, grow revenue) or product features (dashboard, API, integration).

Pass condition: USP in hero, readability > 60, benefit language outweighs feature language.
Fail condition: USP missing from hero or buried, readability < 40, heavy feature-dumping with no benefits.

Generate 3–5 findings. Be specific — quote the actual copy that is problematic.`,
    },
    {
      slug: 'brand-voice',
      label: 'Brand Voice',
      order: 3,
      prompt: `Determine if the brand's tone is consistent, appropriate for the audience, and authentically reflected across the website and social profiles.

Using the VADER sentiment scores provided (website score, social score, tone delta), the body copy sample, social bios (if available), and the "brand_voice" and "target_audience" inputs: assess if the tone matches the desired voice AND if it is appropriate for the stated audience.

Key signals:
- Tone delta > 0.4 between website and social = inconsistency finding
- Casual tone (score < 0) for enterprise/B2B audience = mismatch finding
- Formal tone (score > 0.5) for consumer/lifestyle audience = mismatch finding

Generate 2–4 findings. If no social data was available, note it and focus on website tone only.`,
    },
    {
      slug: 'brand-consistency',
      label: 'Brand Consistency',
      order: 4,
      prompt: `Audit the uniformity of brand name, tagline, and messaging across the website and all connected social profiles.

Using the brand name matches found across title tag, og:title, social profile names (if fetched), and the extracted tagline from meta description vs social bios: flag any inconsistencies. Check if the same brand name spelling and capitalisation is used. Check if the tagline or core message is consistent.

Pass condition: brand name identical across ≥ 90% of checked surfaces, tagline present on ≥ 80%.
Fail condition: different name spelling or version across platforms, tagline absent from 2+ platforms, conflicting messages.

Generate 2–4 findings. If social profiles were not available, focus on website-level consistency only.`,
    },
    {
      slug: 'audience-fit',
      label: 'Audience Fit',
      order: 5,
      prompt: `Measure how well the website's content, pain points, and language align with the stated target audience.

Using the homepage copy sample, top TF-IDF keywords, explicit audience mentions detected (count of times audience terms appear in copy), and the "target_audience" input: assess alignment. Look for explicit mentions of the audience type, relevant pain points, industry-specific vocabulary.

Also flag language tone mismatches (e.g. "Hey guys" for enterprise CTOs, overly corporate language for consumer brands).

Pass condition: audience explicitly mentioned ≥ 2 times, relevant vocabulary present, tone appropriate.
Fail condition: audience never mentioned, copy is generic, language inappropriate for stated audience.

Generate 2–4 findings with specific quotes from the copy where possible.`,
    },
    {
      slug: 'trust-credibility',
      label: 'Trust & Credibility',
      order: 6,
      prompt: `Evaluate the presence of social proof, security signals, and authoritative elements that build user confidence.

Using the pre-computed trust signal data provided: SSL status, social proof count, testimonial count, client logo count, case study links, review widget presence (G2/Capterra/Trustpilot), team page existence, privacy policy link, terms of service link.

Pass condition: ≥ 4 trust signals present.
Fail condition: missing SSL, no testimonials AND no logos AND no review widgets, missing legal pages.

Weight 3: no SSL, no privacy policy, zero social proof.
Weight 2: missing 2+ trust signals.
Weight 1: missing one signal (e.g. no "as seen in" press mentions).

Generate 3–5 findings based on what is actually missing.`,
    },
    {
      slug: 'ai-entity-visibility',
      label: 'AI Search & Entity Visibility',
      order: 7,
      prompt: `Evaluate how discoverable and interpretable the brand appears to AI search engines (ChatGPT, Perplexity, Google SGE).

Using the pre-computed signals: Wikidata entity found (yes/no), schema markup types detected and count, brand name provided.

Key checks:
1. Wikidata entity: if not found, brand is likely unknown to LLMs — weight 2 finding
2. Schema types: if none found — weight 2; if only basic Organisation with no Product/FAQPage/HowTo — weight 1
3. PAA and .edu backlinks: cannot be checked automatically — generate one info finding directing user to check manually

Note: Google Knowledge Panel detection and backlink counts require paid tools. Generate these as info-level guidance findings (verified: true, weight 1) that tell the user what to check manually and how.

Generate 3–4 findings.`,
    },
    {
      slug: 'differentiation',
      label: 'Differentiation',
      order: 8,
      prompt: `Determine if the brand clearly communicates how it is better or different from competitors.

Using the "usp" input, competitor USP similarity scores (if available), comparison page detection from the crawled pages, and any "Why us" or differentiator sections found in the copy:

If competitor USP data is available: flag any competitor whose USP has cosine similarity > 0.85 with the user's USP — that is undifferentiated.
If no competitor data available: focus on internal uniqueness — does the copy make any specific claims that competitors typically can't match? Are those claims backed by evidence (data, testimonials, specific numbers)?

Also check: is there a comparison page (/vs-competitor, /compare, /alternatives)?

Generate 2–4 findings.`,
    },
    {
      slug: 'brand-strength-score',
      label: 'Brand Strength Score',
      order: 9,
      prompt: `Synthesise all previous category findings and pre-computed signals into a holistic Brand Strength Score from 0 to 10 (lower is better — 0 is perfect).

Weighting:
- Positioning: 20%
- Messaging & Value Prop: 15%
- Voice: 10%
- Consistency: 10%
- Audience Fit: 10%
- Trust & Credibility: 15%
- AI Visibility: 10%
- Differentiation: 10%

Score mapping:
- 0–3: Best in Class — strong brand equity
- 4–6: Average — needs fine-tuning in 2–3 areas
- 7–8: Significant Problems — brand identity is unclear or inconsistent
- 9–10: Critical Failure — brand is invisible or contradictory

Generate exactly 2 findings:
1. slug: "brand-strength-score-overall" — the score, which categories are weakest, verified: true if score ≤ 4 else false, weight based on severity
2. slug: "brand-strength-score-action-plan" — a prioritised 30/60/90 day plain-language action plan based on the weakest areas, verified: false, weight 2

Use only what the data showed — do not invent findings from outside the provided data.`,
    },
  ],
}
