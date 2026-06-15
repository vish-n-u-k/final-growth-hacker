import type { ModuleDefinition } from '../types'

export const WEBSITE_MODULE: ModuleDefinition = {
  type: 'website',
  name: 'Website Audit',
  description: 'Rule-based audit across UX, speed, mobile, trust, conversion, forms, and technical health. Identifies issues and generates prioritised fixes.',
  order: 1,
  unlockThreshold: 70, // Foundation must score ≥ 70 to unlock this
  requirements: [
    {
      key: 'website_url',
      label: 'Your website URL',
      type: 'url',
      placeholder: 'yourdomain.com',
    },
  ],
  systemPrompt: `You are a senior growth consultant reviewing website audit findings. For each failing check, write 1–2 sentences explaining the business impact — why it matters for growth, conversions, or trust. Be specific to the site. Never generic.`,
  categories: [
    // ── 1. UX & UI ────────────────────────────────────────────────────────────
    {
      slug: 'ux',
      label: 'UX & UI',
      order: 1,
      subCategories: [
        {
          slug: 'ux-checks',
          label: 'Page Fundamentals',
          order: 1,
          items: [
            {
              slug: 'has-title',
              label: 'Page has a descriptive title tag',
              prompt: 'Checked by rule engine — not used for Claude analysis.',
              order: 1,
              weight: 3,
              fixable: true,
            },
            {
              slug: 'has-h1',
              label: 'Page has exactly one H1 heading',
              prompt: 'Checked by rule engine.',
              order: 2,
              weight: 2,
              fixable: true,
            },
            {
              slug: 'viewport-meta',
              label: 'Viewport meta tag is present and correct',
              prompt: 'Checked by rule engine.',
              order: 3,
              weight: 3,
              fixable: true,
            },
            {
              slug: 'no-inline-styles',
              label: 'Minimal use of inline styles',
              prompt: 'Checked by rule engine.',
              order: 4,
              weight: 1,
            },
          ],
        },
      ],
    },

    // ── 2. Navigation & Structure ─────────────────────────────────────────────
    {
      slug: 'nav',
      label: 'Navigation & Structure',
      order: 2,
      subCategories: [
        {
          slug: 'nav-checks',
          label: 'Navigation',
          order: 1,
          items: [
            {
              slug: 'has-nav-landmark',
              label: 'Page has a <nav> landmark element',
              prompt: 'Checked by rule engine.',
              order: 1,
              weight: 2,
              fixable: true,
            },
            {
              slug: 'internal-links',
              label: 'Page has internal links for navigation',
              prompt: 'Checked by rule engine.',
              order: 2,
              weight: 2,
            },
            {
              slug: 'descriptive-link-text',
              label: 'Links use descriptive anchor text',
              prompt: 'Checked by rule engine.',
              order: 3,
              weight: 1,
            },
            {
              slug: 'external-link-safety',
              label: 'External links are safely attributed',
              prompt: 'Checked by rule engine.',
              order: 4,
              weight: 1,
              fixable: true,
            },
          ],
        },
      ],
    },

    // ── 3. Page Speed ─────────────────────────────────────────────────────────
    {
      slug: 'speed',
      label: 'Page Speed',
      order: 3,
      subCategories: [
        {
          slug: 'speed-checks',
          label: 'Performance',
          order: 1,
          items: [
            {
              slug: 'response-time',
              label: 'Server responds within 2 seconds',
              prompt: 'Checked by rule engine.',
              order: 1,
              weight: 3,
            },
            {
              slug: 'page-size',
              label: 'HTML payload is under 1MB',
              prompt: 'Checked by rule engine.',
              order: 2,
              weight: 2,
            },
            {
              slug: 'compression',
              label: 'Responses are compressed (gzip/Brotli)',
              prompt: 'Checked by rule engine.',
              order: 3,
              weight: 2,
            },
            {
              slug: 'image-dimensions',
              label: 'Images have explicit width and height attributes',
              prompt: 'Checked by rule engine.',
              order: 4,
              weight: 1,
            },
          ],
        },
      ],
    },

    // ── 4. Mobile Friendliness ────────────────────────────────────────────────
    {
      slug: 'mobile',
      label: 'Mobile Friendliness',
      order: 4,
      subCategories: [
        {
          slug: 'mobile-checks',
          label: 'Mobile Compatibility',
          order: 1,
          items: [
            {
              slug: 'viewport-configured',
              label: 'Viewport is configured for mobile',
              prompt: 'Checked by rule engine.',
              order: 1,
              weight: 3,
              fixable: true,
            },
            {
              slug: 'no-fixed-width',
              label: 'No fixed-width elements that overflow on mobile',
              prompt: 'Checked by rule engine.',
              order: 2,
              weight: 2,
            },
            {
              slug: 'has-media-queries',
              label: 'Responsive CSS media queries are present',
              prompt: 'Checked by rule engine.',
              order: 3,
              weight: 1,
            },
          ],
        },
      ],
    },

    // ── 5. Trust Signals ──────────────────────────────────────────────────────
    {
      slug: 'trust',
      label: 'Trust Signals',
      order: 5,
      subCategories: [
        {
          slug: 'trust-checks',
          label: 'Security & Trust',
          order: 1,
          items: [
            {
              slug: 'uses-https',
              label: 'Site is served over HTTPS',
              prompt: 'Checked by rule engine.',
              order: 1,
              weight: 3,
            },
            {
              slug: 'ssl-valid',
              label: 'SSL certificate is valid and not expiring soon',
              prompt: 'Checked by rule engine.',
              order: 2,
              weight: 3,
            },
            {
              slug: 'security-headers',
              label: 'Security headers are set',
              prompt: 'Checked by rule engine.',
              order: 3,
              weight: 2,
            },
            {
              slug: 'has-privacy-page',
              label: 'Privacy policy page is linked',
              prompt: 'Checked by rule engine.',
              order: 4,
              weight: 2,
              fixable: true,
            },
            {
              slug: 'has-contact-page',
              label: 'Contact page is linked',
              prompt: 'Checked by rule engine.',
              order: 5,
              weight: 1,
              fixable: true,
            },
          ],
        },
      ],
    },

    // ── 6. Conversion (CRO) ───────────────────────────────────────────────────
    {
      slug: 'cro',
      label: 'Conversion (CRO)',
      order: 6,
      subCategories: [
        {
          slug: 'cro-checks',
          label: 'Calls to Action',
          order: 1,
          items: [
            {
              slug: 'has-cta',
              label: 'Page has at least one call-to-action',
              prompt: 'Checked by rule engine.',
              order: 1,
              weight: 3,
            },
            {
              slug: 'cta-action-language',
              label: 'CTAs use strong, benefit-led action language',
              prompt: 'Checked by rule engine.',
              order: 2,
              weight: 2,
            },
            {
              slug: 'above-fold-cta',
              label: 'A CTA is visible above the fold',
              prompt: 'Checked by rule engine.',
              order: 3,
              weight: 2,
            },
            {
              slug: 'social-proof',
              label: 'Social proof signals are present',
              prompt: 'Checked by rule engine.',
              order: 4,
              weight: 3,
            },
          ],
        },
      ],
    },

    // ── 7. Forms & CTAs ───────────────────────────────────────────────────────
    {
      slug: 'forms',
      label: 'Forms & CTAs',
      order: 7,
      subCategories: [
        {
          slug: 'forms-checks',
          label: 'Form Quality',
          order: 1,
          items: [
            {
              slug: 'form-labels',
              label: 'All form inputs have labels',
              prompt: 'Checked by rule engine.',
              order: 1,
              weight: 2,
              fixable: true,
            },
            {
              slug: 'form-not-too-long',
              label: 'Forms are not excessively long',
              prompt: 'Checked by rule engine.',
              order: 2,
              weight: 2,
            },
            {
              slug: 'submit-button',
              label: 'All forms have a submit button',
              prompt: 'Checked by rule engine.',
              order: 3,
              weight: 3,
              fixable: true,
            },
            {
              slug: 'placeholder-not-label',
              label: 'Inputs do not rely on placeholder text as a label',
              prompt: 'Checked by rule engine.',
              order: 4,
              weight: 1,
            },
          ],
        },
      ],
    },

    // ── 8. Technical Health ───────────────────────────────────────────────────
    {
      slug: 'tech',
      label: 'Technical Health',
      order: 8,
      subCategories: [
        {
          slug: 'tech-checks',
          label: 'Technical SEO & Metadata',
          order: 1,
          items: [
            {
              slug: 'meta-description',
              label: 'Meta description is present and well-sized',
              prompt: 'Checked by rule engine.',
              order: 1,
              weight: 3,
              fixable: true,
            },
            {
              slug: 'canonical',
              label: 'Canonical URL tag is set',
              prompt: 'Checked by rule engine.',
              order: 2,
              weight: 2,
              fixable: true,
            },
            {
              slug: 'og-tags',
              label: 'Open Graph tags are present',
              prompt: 'Checked by rule engine.',
              order: 3,
              weight: 2,
              fixable: true,
            },
            {
              slug: 'image-alt-text',
              label: 'All images have alt text',
              prompt: 'Checked by rule engine.',
              order: 4,
              weight: 2,
            },
            {
              slug: 'robots-txt',
              label: 'robots.txt is accessible',
              prompt: 'Checked by rule engine.',
              order: 5,
              weight: 2,
              fixable: true,
            },
            {
              slug: 'sitemap-xml',
              label: 'sitemap.xml is accessible',
              prompt: 'Checked by rule engine.',
              order: 6,
              weight: 2,
              fixable: true,
            },
            {
              slug: 'structured-data',
              label: 'Structured data (JSON-LD) is present',
              prompt: 'Checked by rule engine.',
              order: 7,
              weight: 1,
              fixable: true,
            },
            {
              slug: 'lang-attr',
              label: 'HTML lang attribute is declared',
              prompt: 'Checked by rule engine.',
              order: 8,
              weight: 2,
              fixable: true,
            },
          ],
        },
      ],
    },
  ],
}
