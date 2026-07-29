export interface ConflictEntry {
  moduleType: string
  slug: string
}

export interface ConflictGroup {
  topic: string
  entries: ConflictEntry[]
}

/**
 * Client-side lookup: every slug that participates in a cross-module conflict → topic label.
 * Covers ALL related slugs (not just entry points), so expanding any sub-check (e.g.
 * h1.single, title.keyword) also surfaces the cross-module notice.
 */
export const SLUG_TOPIC: Record<string, string> = {
  // Title Tag
  'page-title-set': 'Title Tag', 'title.present': 'Title Tag', 'title.length': 'Title Tag',
  'title.keyword': 'Title Tag', 'title.unique': 'Title Tag', 'title.brand': 'Title Tag',
  'has-title': 'Title Tag',
  // Meta Description
  'description.present': 'Meta Description', 'description.length': 'Meta Description',
  'description.keyword': 'Meta Description', 'description.cta': 'Meta Description',
  'description.unique': 'Meta Description', 'meta-description': 'Meta Description',
  // H1 Heading
  'value-prop-exists': 'H1 Heading', 'h1.exists': 'H1 Heading', 'h1.single': 'H1 Heading',
  'h1.keyword': 'H1 Heading', 'h1.length': 'H1 Heading', 'h1.title_match': 'H1 Heading',
  'has-h1': 'H1 Heading', 'geo-structure-h1': 'H1 Heading',
  // Mobile Viewport
  'mobile-viewport': 'Mobile Viewport', 'mobile.viewport': 'Mobile Viewport',
  'viewport-meta': 'Mobile Viewport', 'viewport-configured': 'Mobile Viewport',
  // Canonical URL
  'canonical.present': 'Canonical URL', 'canonical.same_domain': 'Canonical URL',
  'canonical.self': 'Canonical URL', 'canonical.resolves': 'Canonical URL',
  'canonical': 'Canonical URL',
  // Open Graph
  'og.title': 'Open Graph Tags', 'og.description': 'Open Graph Tags', 'og.image': 'Open Graph Tags',
  'og.url': 'Open Graph Tags', 'og.type': 'Open Graph Tags', 'og-tags': 'Open Graph Tags',
  // Image Alt Text
  'alt.present': 'Image Alt Text', 'alt.not_empty': 'Image Alt Text', 'alt.decorative': 'Image Alt Text',
  'alt.filename': 'Image Alt Text', 'alt.descriptive': 'Image Alt Text', 'alt.length': 'Image Alt Text',
  'alt.keyword_stuffing': 'Image Alt Text', 'alt.context': 'Image Alt Text',
  'image-alt-text': 'Image Alt Text',
  // robots.txt
  'robots.exists': 'robots.txt', 'robots.no_block': 'robots.txt', 'robots-txt': 'robots.txt',
  'geo-robots-tier1': 'robots.txt', 'geo-robots-tier2': 'robots.txt', 'geo-robots-tier3': 'robots.txt',
  // HTTPS / SSL
  'ssl-active': 'HTTPS / SSL', 'https.enforced': 'HTTPS / SSL', 'https.ssl_valid': 'HTTPS / SSL',
  'https.hsts': 'HTTPS / SSL', 'uses-https': 'HTTPS / SSL', 'ssl-valid': 'HTTPS / SSL',
  // XML Sitemap
  'sitemap.exists': 'XML Sitemap', 'sitemap.valid': 'XML Sitemap', 'sitemap-xml': 'XML Sitemap',
  // Search Indexing
  'no-noindex': 'Search Indexing (noindex)', 'robots.noindex': 'Search Indexing (noindex)',
  // Privacy Policy
  'privacy-policy': 'Privacy Policy', 'has-privacy-page': 'Privacy Policy',
  // Contact Page
  'contact-accessible': 'Contact Page', 'has-contact-page': 'Contact Page',
}

/**
 * Static map of overlapping elements checked across multiple modules.
 * When a user is viewing an item in one module, this map surfaces what
 * other modules say about the same element.
 */
export const CONFLICT_GROUPS: ConflictGroup[] = [
  {
    topic: 'Title Tag',
    entries: [
      { moduleType: 'foundation', slug: 'page-title-set' },
      { moduleType: 'seo', slug: 'title.present' },
      { moduleType: 'website', slug: 'has-title' },
    ],
  },
  {
    topic: 'Meta Description',
    entries: [
      { moduleType: 'seo', slug: 'description.present' },
      { moduleType: 'website', slug: 'meta-description' },
    ],
  },
  {
    topic: 'H1 Heading',
    entries: [
      { moduleType: 'foundation', slug: 'value-prop-exists' },
      { moduleType: 'seo', slug: 'h1.exists' },
      { moduleType: 'website', slug: 'has-h1' },
      { moduleType: 'geo', slug: 'geo-structure-h1' },
    ],
  },
  {
    topic: 'Mobile Viewport',
    entries: [
      { moduleType: 'foundation', slug: 'mobile-viewport' },
      { moduleType: 'seo', slug: 'mobile.viewport' },
      { moduleType: 'website', slug: 'viewport-meta' },
    ],
  },
  {
    topic: 'Canonical URL',
    entries: [
      { moduleType: 'seo', slug: 'canonical.present' },
      { moduleType: 'website', slug: 'canonical' },
    ],
  },
  {
    topic: 'Open Graph Tags',
    entries: [
      { moduleType: 'seo', slug: 'og.title' },
      { moduleType: 'website', slug: 'og-tags' },
    ],
  },
  {
    topic: 'Image Alt Text',
    entries: [
      { moduleType: 'seo', slug: 'alt.present' },
      { moduleType: 'website', slug: 'image-alt-text' },
    ],
  },
  {
    topic: 'robots.txt',
    entries: [
      { moduleType: 'seo', slug: 'robots.exists' },
      { moduleType: 'website', slug: 'robots-txt' },
      { moduleType: 'geo', slug: 'geo-robots-tier1' },
    ],
  },
  {
    topic: 'HTTPS / SSL',
    entries: [
      { moduleType: 'foundation', slug: 'ssl-active' },
      { moduleType: 'seo', slug: 'https.enforced' },
      { moduleType: 'website', slug: 'uses-https' },
    ],
  },
  {
    topic: 'XML Sitemap',
    entries: [
      { moduleType: 'seo', slug: 'sitemap.exists' },
      { moduleType: 'website', slug: 'sitemap-xml' },
    ],
  },
  {
    topic: 'Search Indexing (noindex)',
    entries: [
      { moduleType: 'foundation', slug: 'no-noindex' },
      { moduleType: 'seo', slug: 'robots.noindex' },
    ],
  },
  {
    topic: 'Privacy Policy',
    entries: [
      { moduleType: 'foundation', slug: 'privacy-policy' },
      { moduleType: 'website', slug: 'has-privacy-page' },
    ],
  },
  {
    topic: 'Contact Page',
    entries: [
      { moduleType: 'foundation', slug: 'contact-accessible' },
      { moduleType: 'website', slug: 'has-contact-page' },
    ],
  },
]
