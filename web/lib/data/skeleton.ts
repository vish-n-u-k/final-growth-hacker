export interface SkeletonItem {
  slug: string
  label: string
  /** Passed to Claude — tells it exactly what to look for in the HTML/fetched data */
  prompt: string
  order: number
  /** Scoring weight: 3 = critical, 2 = important, 1 = minor */
  weight: 1 | 2 | 3
}

export interface SkeletonSubCategory {
  slug: string
  label: string
  order: number
  items: SkeletonItem[]
}

export interface SkeletonCategory {
  slug: string
  label: string
  order: number
  subCategories: SkeletonSubCategory[]
}

export interface SkeletonChannel {
  type: 'website' | 'ios' | 'android' | 'shopify'
  categories: SkeletonCategory[]
}

// ─────────────────────────────────────────────────────────────────────────────
// WEBSITE SKELETON
// ─────────────────────────────────────────────────────────────────────────────

export const WEBSITE_SKELETON: SkeletonChannel = {
  type: 'website',
  categories: [
    // ── 1. ON-PAGE SEO ───────────────────────────────────────────────────────
    {
      slug: 'on-page-seo',
      label: 'On-Page SEO',
      order: 1,
      subCategories: [
        {
          slug: 'title-tags',
          label: 'Title Tags',
          order: 1,
          items: [
            {
              slug: 'title-tag-exists',
              label: 'Page has a title tag',
              prompt: 'Check if the homepage <title> tag exists and is non-empty. Report the current title text.',
              order: 1,
              weight: 3,
            },
            {
              slug: 'title-tag-length',
              label: 'Title tag is 50–60 characters',
              prompt: 'Check the character length of the <title> tag. Google truncates titles over 60 chars. Report the exact length and full title text, and suggest a trimmed version if needed.',
              order: 2,
              weight: 2,
            },
            {
              slug: 'title-tag-keyword',
              label: 'Title tag contains the primary keyword',
              prompt: 'Based on the page content, identify the primary keyword the page is targeting. Check if it appears in the <title> tag. Report your finding.',
              order: 3,
              weight: 2,
            },
            {
              slug: 'title-tag-unique',
              label: 'Title tag is not generic',
              prompt: 'Check if the title tag is descriptive and specific, not a placeholder like "Home", "Welcome", or just the brand name with no context.',
              order: 4,
              weight: 2,
            },
          ],
        },
        {
          slug: 'meta-descriptions',
          label: 'Meta Descriptions',
          order: 2,
          items: [
            {
              slug: 'meta-desc-exists',
              label: 'Homepage has a meta description',
              prompt: 'Check if a <meta name="description"> tag exists with non-empty content. Report the current description text.',
              order: 1,
              weight: 3,
            },
            {
              slug: 'meta-desc-length',
              label: 'Meta description is 150–160 characters',
              prompt: 'Check the character length of the meta description. Google truncates beyond ~160 chars. Report the exact length and suggest edits if too long or too short.',
              order: 2,
              weight: 1,
            },
            {
              slug: 'meta-desc-compelling',
              label: 'Meta description includes a clear value proposition',
              prompt: 'Read the meta description and assess whether it clearly describes what the product does and why a user should click. Report what is missing if anything.',
              order: 3,
              weight: 2,
            },
          ],
        },
        {
          slug: 'headings',
          label: 'Heading Structure',
          order: 3,
          items: [
            {
              slug: 'h1-exists',
              label: 'Page has exactly one H1 tag',
              prompt: 'Count all <h1> tags on the page. There should be exactly one. Report how many exist and their text content.',
              order: 1,
              weight: 3,
            },
            {
              slug: 'h1-keyword',
              label: 'H1 contains the primary keyword',
              prompt: 'Based on the page content, identify the primary keyword. Check if it appears in the H1. Report the current H1 text.',
              order: 2,
              weight: 2,
            },
            {
              slug: 'heading-hierarchy',
              label: 'Headings follow logical order (H1 → H2 → H3)',
              prompt: 'List the heading tags (H1–H4) in order and check if they follow a logical hierarchy with no skipped levels (e.g. H1 then H3 with no H2). Report any issues.',
              order: 3,
              weight: 1,
            },
          ],
        },
        {
          slug: 'content',
          label: 'Page Content',
          order: 4,
          items: [
            {
              slug: 'word-count',
              label: 'Homepage has meaningful content (200+ words)',
              prompt: 'Estimate the visible word count of the main content area (exclude nav, footer, boilerplate). Report the approximate count. 200+ is acceptable for a landing page.',
              order: 1,
              weight: 2,
            },
            {
              slug: 'keyword-in-intro',
              label: 'Primary keyword appears early in the page content',
              prompt: 'Check if the primary keyword appears within the first 100 words of the main body content. Report where it first appears.',
              order: 2,
              weight: 1,
            },
            {
              slug: 'image-alt-text',
              label: 'All images have descriptive alt text',
              prompt: 'Find all <img> tags. Check how many are missing alt attributes or have empty/generic alt text (like "image" or "photo"). Report the count of missing/poor alt texts and list the src values.',
              order: 3,
              weight: 2,
            },
          ],
        },
        {
          slug: 'url-links',
          label: 'URLs & Internal Links',
          order: 5,
          items: [
            {
              slug: 'url-descriptive',
              label: 'URL is clean, short, and descriptive',
              prompt: 'Evaluate the homepage URL slug. Check for excessive parameters, underscores instead of hyphens, or non-descriptive paths.',
              order: 1,
              weight: 1,
            },
            {
              slug: 'internal-linking',
              label: 'Page has at least 3 internal links',
              prompt: 'Count all internal links (same domain) on the page excluding nav and footer. Report the count. Pages should have at least 3 contextual internal links.',
              order: 2,
              weight: 1,
            },
          ],
        },
      ],
    },

    // ── 2. TECHNICAL SEO ─────────────────────────────────────────────────────
    {
      slug: 'technical-seo',
      label: 'Technical SEO',
      order: 2,
      subCategories: [
        {
          slug: 'crawlability',
          label: 'Crawlability',
          order: 1,
          items: [
            {
              slug: 'robots-txt',
              label: 'robots.txt exists and is not blocking key pages',
              prompt: 'Fetch /robots.txt from the domain. Check if it exists and if it is accidentally blocking important paths like / or /sitemap.xml. Report the contents.',
              order: 1,
              weight: 2,
            },
            {
              slug: 'xml-sitemap',
              label: 'XML sitemap exists at /sitemap.xml',
              prompt: 'Fetch /sitemap.xml from the domain. Check if it exists and is valid XML. Report how many URLs it contains if accessible.',
              order: 2,
              weight: 2,
            },
            {
              slug: 'canonical-tag',
              label: 'Canonical tag is correctly set',
              prompt: 'Check for a <link rel="canonical"> tag on the homepage. Report the href value and whether it correctly points to the preferred URL.',
              order: 3,
              weight: 3,
            },
            {
              slug: 'noindex-check',
              label: 'Page is not accidentally set to noindex',
              prompt: 'Check for <meta name="robots" content="noindex"> or X-Robots-Tag headers that would prevent indexing. Report if found.',
              order: 4,
              weight: 3,
            },
          ],
        },
        {
          slug: 'site-structure',
          label: 'Site Structure & Security',
          order: 2,
          items: [
            {
              slug: 'https',
              label: 'Site runs on HTTPS',
              prompt: 'Check if the site URL uses https://. Report the protocol in use.',
              order: 1,
              weight: 3,
            },
            {
              slug: 'www-redirect',
              label: 'www and non-www redirect to one canonical version',
              prompt: 'Check the URL — note which version is canonical (www or non-www). Flag if both versions appear to be accessible without redirect based on available information.',
              order: 2,
              weight: 1,
            },
            {
              slug: 'mobile-viewport',
              label: 'Page has a mobile viewport meta tag',
              prompt: 'Check for <meta name="viewport"> tag. It should contain "width=device-width". Report the current value.',
              order: 3,
              weight: 2,
            },
          ],
        },
        {
          slug: 'structured-data',
          label: 'Structured Data & Social',
          order: 3,
          items: [
            {
              slug: 'schema-org',
              label: 'Schema.org structured data is implemented',
              prompt: 'Check for JSON-LD, Microdata, or RDFa structured data in the HTML. Report what schema types are found (e.g. Organization, WebSite, Product).',
              order: 1,
              weight: 2,
            },
            {
              slug: 'og-tags',
              label: 'Open Graph tags are set for social sharing',
              prompt: 'Check for og:title, og:description, og:image, and og:url meta tags. Report which are present and which are missing.',
              order: 2,
              weight: 2,
            },
            {
              slug: 'twitter-card',
              label: 'Twitter Card meta tags are configured',
              prompt: 'Check for twitter:card, twitter:title, twitter:description, and twitter:image meta tags. Report which are present and missing.',
              order: 3,
              weight: 1,
            },
          ],
        },
      ],
    },

    // ── 3. CONTENT QUALITY ───────────────────────────────────────────────────
    {
      slug: 'content-quality',
      label: 'Content Quality',
      order: 3,
      subCategories: [
        {
          slug: 'messaging',
          label: 'Messaging & Clarity',
          order: 1,
          items: [
            {
              slug: 'value-proposition',
              label: 'Homepage clearly explains what the product does',
              prompt: 'Read the hero section and above-the-fold content. Assess whether a first-time visitor can understand what the product does and who it is for within 5 seconds. Report what is clear and what is confusing.',
              order: 1,
              weight: 3,
            },
            {
              slug: 'cta-present',
              label: 'Clear call-to-action is visible above the fold',
              prompt: 'Check for a primary CTA button or link in the hero/above-the-fold area. Report the CTA text and whether it is prominent.',
              order: 2,
              weight: 2,
            },
            {
              slug: 'target-audience',
              label: 'Target audience is clearly addressed',
              prompt: 'Check if the page copy speaks directly to a specific audience (e.g. "for solopreneurs", "for Shopify stores"). Report how well-defined the audience targeting is.',
              order: 3,
              weight: 2,
            },
          ],
        },
        {
          slug: 'trust-signals',
          label: 'Trust & Social Proof',
          order: 2,
          items: [
            {
              slug: 'social-proof',
              label: 'Social proof is present (testimonials, reviews, user count)',
              prompt: 'Check for testimonials, review scores, user counts, logos, or any form of social proof on the page. Report what is found.',
              order: 1,
              weight: 2,
            },
            {
              slug: 'trust-signals',
              label: 'Trust signals are present (security, guarantees, press)',
              prompt: 'Check for trust signals like security badges, money-back guarantees, press mentions, or partner logos. Report what is found.',
              order: 2,
              weight: 1,
            },
          ],
        },
        {
          slug: 'media',
          label: 'Media & Assets',
          order: 3,
          items: [
            {
              slug: 'image-file-names',
              label: 'Images have descriptive file names',
              prompt: 'Check the src attributes of <img> tags. Flag any that use generic names like IMG_1234.jpg, image1.png, or screenshot.png. Report the count of poorly named images.',
              order: 1,
              weight: 1,
            },
            {
              slug: 'lazy-loading',
              label: 'Images use lazy loading',
              prompt: 'Check if <img> tags below the fold use loading="lazy" attribute. Report the count of images missing this attribute.',
              order: 2,
              weight: 1,
            },
          ],
        },
      ],
    },
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Flat list of all items for a channel type — used when seeding channel_items */
export function getAllItems(channel: SkeletonChannel): SkeletonItem[] {
  return channel.categories.flatMap((cat) =>
    cat.subCategories.flatMap((sub) => sub.items),
  )
}

/** Look up a category by slug */
export function getCategoryBySlug(channel: SkeletonChannel, slug: string) {
  return channel.categories.find((c) => c.slug === slug)
}

/** All item slugs for a given category slug */
export function getItemSlugsByCategory(channel: SkeletonChannel, categorySlug: string): string[] {
  const cat = getCategoryBySlug(channel, categorySlug)
  if (!cat) return []
  return cat.subCategories.flatMap((sub) => sub.items.map((i) => i.slug))
}

/** Map of slug → item for fast lookup */
export function getItemMap(channel: SkeletonChannel): Record<string, SkeletonItem> {
  return Object.fromEntries(getAllItems(channel).map((item) => [item.slug, item]))
}

export const CHANNEL_SKELETONS: Record<string, SkeletonChannel> = {
  website: WEBSITE_SKELETON,
}
