import type { ModuleDefinition } from '../types'

export const SEO_MODULE: ModuleDefinition = {
  type: 'seo',
  name: 'SEO Audit',
  description: 'Deep audit of on-page SEO, technical SEO, and content quality — items generated specifically for your site.',
  order: 2,
  unlockThreshold: 70,
  dynamic: true,
  requirements: [
    {
      key: 'website_url',
      label: 'Your website URL',
      type: 'url',
      placeholder: 'yourdomain.com',
    },
  ],
  systemPrompt: `You are an expert SEO analyst auditing a real website. Your job is to generate only the issues and wins that are actually present on this specific site — not a generic checklist every site gets.

Rules:
- Only generate items for things you can directly verify from the HTML, robots.txt, and sitemap provided
- Use exact values: actual title text, character counts, number of missing alt tags, exact robots.txt lines
- Do not generate passing items unless the pass is genuinely noteworthy (e.g. excellent structured data implementation)
- Weight: 3 = critical (directly hurts ranking or indexing), 2 = important (fix soon), 1 = minor (nice to have)
- Generate 3–8 items per category, only what you actually find
- Slugs must be kebab-case and stable — the same issue on a re-run should produce the same slug`,
  categories: [
    {
      slug: 'on-page-seo',
      label: 'On-Page SEO',
      order: 1,
      prompt: `Audit on-page SEO for this specific site. Check: title tag (does it exist, exact character count, does it contain the primary keyword, is it descriptive or generic), meta description (exists, exact character length, does it communicate value), H1 (exists, contains keyword, is there exactly one), heading hierarchy (H1→H2→H3 logical flow, any skipped levels), image alt text (how many images are missing alt or have empty/generic alt), internal link count (excluding nav/footer), keyword appearance in first 100 words of body. Generate items only for issues or notable wins you actually observe.`,
    },
    {
      slug: 'technical-seo',
      label: 'Technical SEO',
      order: 2,
      prompt: `Audit technical SEO for this specific site. Check: robots.txt (exists, is it blocking any important paths like / or /sitemap), XML sitemap (exists at /sitemap.xml, how many URLs it contains), canonical tag (set correctly, points to right URL), noindex meta tag (accidentally blocking indexing), HTTPS (protocol in use), mobile viewport meta tag (width=device-width present), structured data / schema.org (what types are implemented via JSON-LD or Microdata), Open Graph tags (og:title, og:description, og:image, og:url — which are missing), Twitter Card tags (which are missing). Generate items only for what you actually find in the provided data.`,
    },
    {
      slug: 'content-quality',
      label: 'Content Quality',
      order: 3,
      prompt: `Audit content quality for this specific site. Check: can a first-time visitor understand what the product does within 5 seconds (value proposition clarity), is there a clear primary CTA above the fold and what is its exact text, does the copy address a specific target audience or is it generic, is there social proof (testimonials, review counts, user count, logos — what specifically), are there trust signals (security badges, guarantees, press mentions), approximate word count of real content excluding nav/footer/boilerplate, does the copy sound unique to this product or like generic SaaS filler. Generate items only for what you actually observe.`,
    },
  ],
}
