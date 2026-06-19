import type { ModuleDefinition } from '../types'

export const SEO_MODULE: ModuleDefinition = {
  type: 'seo',
  name: 'SEO Audit',
  description: 'Rule-based SEO audit across meta tags, headings, images, internal links, structured data, and technical performance. Deterministic checks with AI-generated impact narratives.',
  order: 2,
  unlockThreshold: 0,
  dynamic: false,
  requirements: [
    {
      key: 'website_url',
      label: 'Your website URL',
      type: 'url',
      placeholder: 'yourdomain.com',
    },
  ],
  systemPrompt: `You are a senior SEO specialist reviewing rule-engine findings for a website. For each failing check, write 1–2 sentences of specific business impact — why this issue hurts search rankings, click-through rates, or organic traffic for this site. Be concrete and direct.`,
  categories: [
    // ── 1. Meta Tags ──────────────────────────────────────────────────────────
    {
      slug: 'meta-tags',
      label: 'Meta Tags',
      order: 1,
      subCategories: [
        {
          slug: 'title-tag',
          label: 'Title Tag',
          order: 1,
          items: [
            { slug: 'title.present',  label: 'Title tag is present',                  prompt: 'Rule engine check.', order: 1, weight: 3, fixable: true, fixType: 'value' },
            { slug: 'title.length',   label: 'Title is 50–60 characters',             prompt: 'Rule engine check.', order: 2, weight: 2, fixable: true, fixType: 'value' },
            { slug: 'title.keyword',  label: 'Primary keyword appears in title',      prompt: 'Rule engine check.', order: 3, weight: 2, fixable: true, fixType: 'value' },
            { slug: 'title.unique',   label: 'Title is unique across site',           prompt: 'Rule engine check.', order: 4, weight: 2 },
            { slug: 'title.brand',    label: 'Brand name included in title',          prompt: 'Rule engine check.', order: 5, weight: 1, fixable: true, fixType: 'value' },
          ],
        },
        {
          slug: 'meta-description',
          label: 'Meta Description',
          order: 2,
          items: [
            { slug: 'description.present',  label: 'Meta description is present',                      prompt: 'Rule engine check.', order: 1, weight: 3, fixable: true, fixType: 'value' },
            { slug: 'description.length',   label: 'Description is 140–155 characters',               prompt: 'Rule engine check.', order: 2, weight: 2, fixable: true, fixType: 'value' },
            { slug: 'description.keyword',  label: 'Primary keyword in meta description',             prompt: 'Rule engine check.', order: 3, weight: 2, fixable: true, fixType: 'value' },
            { slug: 'description.cta',      label: 'Description includes call-to-action language',   prompt: 'Rule engine check.', order: 4, weight: 1, fixable: true, fixType: 'value' },
            { slug: 'description.unique',   label: 'Description is unique across site',               prompt: 'Rule engine check.', order: 5, weight: 1 },
          ],
        },
        {
          slug: 'canonical-tag',
          label: 'Canonical Tag',
          order: 3,
          items: [
            { slug: 'canonical.present',      label: 'Canonical tag is present',                       prompt: 'Rule engine check.', order: 1, weight: 3, fixable: true, fixType: 'template' },
            { slug: 'canonical.same_domain',  label: 'Canonical points to same domain',               prompt: 'Rule engine check.', order: 2, weight: 2, fixable: true, fixType: 'template' },
            { slug: 'canonical.self',         label: 'Canonical is self-referencing',                 prompt: 'Rule engine check.', order: 3, weight: 2, fixable: true, fixType: 'template' },
            { slug: 'canonical.resolves',     label: 'Canonical URL resolves with HTTP 200',         prompt: 'Rule engine check.', order: 4, weight: 2 },
          ],
        },
        {
          slug: 'indexability',
          label: 'Indexability',
          order: 4,
          items: [
            { slug: 'robots.noindex', label: 'Page is not blocked from indexing', prompt: 'Rule engine check.', order: 1, weight: 3, fixable: true, fixType: 'template' },
          ],
        },
        {
          slug: 'open-graph',
          label: 'Open Graph',
          order: 5,
          items: [
            { slug: 'og.title',       label: 'og:title is present',                      prompt: 'Rule engine check.', order: 1, weight: 2, fixable: true, fixType: 'template' },
            { slug: 'og.description', label: 'og:description is present',               prompt: 'Rule engine check.', order: 2, weight: 2, fixable: true, fixType: 'template' },
            { slug: 'og.image',       label: 'og:image is present and accessible',      prompt: 'Rule engine check.', order: 3, weight: 2, fixable: true },
            { slug: 'og.url',         label: 'og:url matches canonical URL',            prompt: 'Rule engine check.', order: 4, weight: 1, fixable: true, fixType: 'template' },
            { slug: 'og.type',        label: 'og:type is declared',                     prompt: 'Rule engine check.', order: 5, weight: 1, fixable: true, fixType: 'template' },
          ],
        },
      ],
    },

    // ── 2. Headings ───────────────────────────────────────────────────────────
    {
      slug: 'headings',
      label: 'Headings',
      order: 2,
      subCategories: [
        {
          slug: 'h1-tag',
          label: 'H1 Tag',
          order: 1,
          items: [
            { slug: 'h1.exists',       label: 'H1 heading is present',                       prompt: 'Rule engine check.', order: 1, weight: 3 },
            { slug: 'h1.single',       label: 'Exactly one H1 on the page',                 prompt: 'Rule engine check.', order: 2, weight: 2 },
            { slug: 'h1.keyword',      label: 'H1 shares keyword context with title',       prompt: 'Rule engine check.', order: 3, weight: 2 },
            { slug: 'h1.length',       label: 'H1 is 20–70 characters',                     prompt: 'Rule engine check.', order: 4, weight: 1 },
            { slug: 'h1.title_match',  label: 'H1 and title use complementary wording',     prompt: 'Rule engine check.', order: 5, weight: 1 },
          ],
        },
        {
          slug: 'heading-hierarchy',
          label: 'Heading Hierarchy',
          order: 2,
          items: [
            { slug: 'hierarchy.skipped',     label: 'No skipped heading levels (H1→H3 etc.)', prompt: 'Rule engine check.', order: 1, weight: 2 },
            { slug: 'hierarchy.h2_exists',   label: 'H2 headings structure the content',      prompt: 'Rule engine check.', order: 2, weight: 2 },
            { slug: 'hierarchy.descriptive', label: 'All headings have descriptive text',      prompt: 'Rule engine check.', order: 3, weight: 2 },
            { slug: 'hierarchy.nesting',     label: 'Heading content nesting is logical',      prompt: 'Rule engine check.', order: 4, weight: 1 },
          ],
        },
        {
          slug: 'content-outline',
          label: 'Content Outline',
          order: 3,
          items: [
            { slug: 'outline.coverage',       label: 'Headings cover main subtopics',                    prompt: 'Rule engine check.', order: 1, weight: 1 },
            { slug: 'outline.questions',      label: 'Question-based headings used where relevant',      prompt: 'Rule engine check.', order: 2, weight: 1 },
            { slug: 'outline.lsi',            label: 'Headings include semantic keywords',               prompt: 'Rule engine check.', order: 3, weight: 1 },
            { slug: 'outline.length_balance', label: 'All headings are under 120 characters',            prompt: 'Rule engine check.', order: 4, weight: 1 },
          ],
        },
      ],
    },

    // ── 3. Images ─────────────────────────────────────────────────────────────
    {
      slug: 'images',
      label: 'Images',
      order: 3,
      subCategories: [
        {
          slug: 'alt-text',
          label: 'Alt Text',
          order: 1,
          items: [
            { slug: 'alt.present',          label: 'All images have alt attributes',                   prompt: 'Rule engine check.', order: 1, weight: 3, fixable: true, fixType: 'template' },
            { slug: 'alt.not_empty',        label: 'Content images have descriptive alt text',         prompt: 'Rule engine check.', order: 2, weight: 2, fixable: true, fixType: 'patch' },
            { slug: 'alt.decorative',       label: 'Decorative images use empty alt (alt="")',         prompt: 'Rule engine check.', order: 3, weight: 1 },
            { slug: 'alt.filename',         label: 'Alt text is not filename-style',                   prompt: 'Rule engine check.', order: 4, weight: 2 },
            { slug: 'alt.descriptive',      label: 'Alt text accurately describes the image',          prompt: 'Rule engine check.', order: 5, weight: 1 },
            { slug: 'alt.length',           label: 'Alt text is 5–125 characters',                    prompt: 'Rule engine check.', order: 6, weight: 1 },
            { slug: 'alt.keyword_stuffing', label: 'Alt text has no keyword stuffing',                 prompt: 'Rule engine check.', order: 7, weight: 2 },
            { slug: 'alt.context',          label: 'Alt text complements surrounding content',          prompt: 'Rule engine check.', order: 8, weight: 1 },
          ],
        },
        {
          slug: 'image-assets',
          label: 'Image Assets',
          order: 2,
          items: [
            { slug: 'image.filesize',   label: 'Images are under 500KB',                      prompt: 'Rule engine check.', order: 1, weight: 2 },
            { slug: 'image.dimensions', label: 'Images have explicit width and height',       prompt: 'Rule engine check.', order: 2, weight: 2, fixable: true },
            { slug: 'image.lazyload',   label: 'Below-fold images use lazy loading',          prompt: 'Rule engine check.', order: 3, weight: 1, fixable: true, fixType: 'template' },
            { slug: 'image.format',     label: 'Images use modern format (WebP/AVIF)',        prompt: 'Rule engine check.', order: 4, weight: 1 },
          ],
        },
      ],
    },

    // ── 4. Internal Links ─────────────────────────────────────────────────────
    {
      slug: 'internal-links',
      label: 'Internal Links',
      order: 4,
      subCategories: [
        {
          slug: 'link-structure',
          label: 'Link Structure',
          order: 1,
          items: [
            { slug: 'links.orphan',         label: 'No orphan pages without inbound links',    prompt: 'Rule engine check.', order: 1, weight: 2 },
            { slug: 'links.depth',          label: 'Key pages reachable within 3 clicks',      prompt: 'Rule engine check.', order: 2, weight: 2 },
            { slug: 'links.homepage_links', label: 'Homepage has adequate internal links',     prompt: 'Rule engine check.', order: 3, weight: 2 },
            { slug: 'links.broken',         label: 'No broken internal links',                 prompt: 'Rule engine check.', order: 4, weight: 3 },
          ],
        },
        {
          slug: 'anchor-text',
          label: 'Anchor Text',
          order: 2,
          items: [
            { slug: 'anchor.diversity',    label: 'Anchor text is diverse per target page',    prompt: 'Rule engine check.', order: 1, weight: 1 },
            { slug: 'anchor.descriptive',  label: 'Links use descriptive anchor text',         prompt: 'Rule engine check.', order: 2, weight: 2 },
            { slug: 'anchor.exact_match',  label: 'Exact-match anchors not overused',          prompt: 'Rule engine check.', order: 3, weight: 1 },
            { slug: 'anchor.branded',      label: 'Brand name appears in some anchors',        prompt: 'Rule engine check.', order: 4, weight: 1 },
          ],
        },
        {
          slug: 'page-authority',
          label: 'Page Authority Flow',
          order: 3,
          items: [
            { slug: 'pagerank.deep',        label: 'Deep pages receive internal link equity',   prompt: 'Rule engine check.', order: 1, weight: 1 },
            { slug: 'pagerank.nav',         label: 'Navigation covers all key page types',      prompt: 'Rule engine check.', order: 2, weight: 2 },
            { slug: 'pagerank.contextual',  label: 'Contextual links within main content',      prompt: 'Rule engine check.', order: 3, weight: 2 },
            { slug: 'pagerank.injection',   label: 'Internal link injection plan in place',     prompt: 'Rule engine check.', order: 4, weight: 1 },
          ],
        },
      ],
    },

    // ── 5. Schema ─────────────────────────────────────────────────────────────
    {
      slug: 'schema',
      label: 'Schema & Rich Results',
      order: 5,
      subCategories: [
        {
          slug: 'structured-data',
          label: 'Structured Data',
          order: 1,
          items: [
            { slug: 'schema.present',          label: 'JSON-LD structured data is present',       prompt: 'Rule engine check.', order: 1, weight: 2, fixable: true, fixType: 'value' },
            { slug: 'schema.valid',            label: 'All JSON-LD blocks are valid JSON',        prompt: 'Rule engine check.', order: 2, weight: 3 },
            { slug: 'schema.type',             label: 'Schema type matches page content',         prompt: 'Rule engine check.', order: 3, weight: 2 },
            { slug: 'schema.required-fields',  label: 'Required schema fields are present',      prompt: 'Rule engine check.', order: 4, weight: 2 },
            { slug: 'schema.twitter-card',     label: 'Twitter Card meta tags are present',      prompt: 'Rule engine check.', order: 5, weight: 1, fixable: true, fixType: 'template' },
          ],
        },
      ],
    },

    // ── 6. Technical ──────────────────────────────────────────────────────────
    {
      slug: 'technical',
      label: 'Technical SEO',
      order: 6,
      subCategories: [
        {
          slug: 'core-web-vitals',
          label: 'Core Web Vitals',
          order: 1,
          items: [
            { slug: 'cwv.lcp',         label: 'LCP is under 2.5 seconds',            prompt: 'Rule engine check.', order: 1, weight: 3 },
            { slug: 'cwv.cls',         label: 'CLS is under 0.1',                    prompt: 'Rule engine check.', order: 2, weight: 3 },
            { slug: 'cwv.fid',         label: 'Total Blocking Time is under 100ms',  prompt: 'Rule engine check.', order: 3, weight: 2 },
            { slug: 'lighthouse.score', label: 'Lighthouse performance score is 80+', prompt: 'Rule engine check.', order: 4, weight: 2 },
          ],
        },
        {
          slug: 'security',
          label: 'Security',
          order: 2,
          items: [
            { slug: 'https.enforced',  label: 'HTTP requests redirect to HTTPS',  prompt: 'Rule engine check.', order: 1, weight: 3 },
            { slug: 'https.ssl_valid', label: 'SSL certificate is valid',         prompt: 'Rule engine check.', order: 2, weight: 3 },
            { slug: 'https.hsts',      label: 'HSTS header is set',               prompt: 'Rule engine check.', order: 3, weight: 2 },
          ],
        },
        {
          slug: 'mobile-readiness',
          label: 'Mobile Readiness',
          order: 3,
          items: [
            { slug: 'mobile.viewport', label: 'Mobile viewport meta tag is correct', prompt: 'Rule engine check.', order: 1, weight: 3, fixable: true, fixType: 'template' },
          ],
        },
        {
          slug: 'crawlability',
          label: 'Crawlability',
          order: 4,
          items: [
            { slug: 'robots.exists',   label: 'robots.txt is accessible',              prompt: 'Rule engine check.', order: 1, weight: 2 },
            { slug: 'robots.no_block', label: 'robots.txt does not block CSS or JS',   prompt: 'Rule engine check.', order: 2, weight: 3 },
            { slug: 'sitemap.exists',  label: 'sitemap.xml is accessible',             prompt: 'Rule engine check.', order: 3, weight: 2 },
            { slug: 'sitemap.valid',   label: 'Sitemap URLs all return 200',           prompt: 'Rule engine check.', order: 4, weight: 1 },
          ],
        },
        {
          slug: 'http-errors',
          label: 'HTTP Errors',
          order: 5,
          items: [
            { slug: 'http.4xx', label: 'No 4xx errors in internal links', prompt: 'Rule engine check.', order: 1, weight: 2 },
            { slug: 'http.5xx', label: 'No server errors (5xx)',           prompt: 'Rule engine check.', order: 2, weight: 3 },
          ],
        },
        {
          slug: 'performance',
          label: 'Performance',
          order: 6,
          items: [
            { slug: 'perf.render_blocking', label: 'Render-blocking resources are minimised', prompt: 'Rule engine check.', order: 1, weight: 2 },
            { slug: 'perf.images',          label: 'Responsive images (srcset/WebP) in use',  prompt: 'Rule engine check.', order: 2, weight: 1 },
            { slug: 'perf.js_size',         label: 'JavaScript bundle is appropriately sized', prompt: 'Rule engine check.', order: 3, weight: 2 },
            { slug: 'perf.ttfb',            label: 'Server TTFB is under 200ms',              prompt: 'Rule engine check.', order: 4, weight: 2 },
            { slug: 'perf.root_cause',      label: 'No obvious performance bottlenecks',      prompt: 'Rule engine check.', order: 5, weight: 1 },
          ],
        },
      ],
    },
  ],
}
