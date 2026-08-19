import type { ModuleDefinition } from '../types'

export const WEBSITE_MODULE: ModuleDefinition = {
  type: 'website',
  name: 'Website Audit',
  tagline: 'turn your website into a sales tool',
  description: 'Turns visitors into paying customers.',
  order: 2,
  unlockThreshold: 80,
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
              label: 'Title tag',
              prompt: 'Checked by rule engine — not used for Claude analysis.',
              order: 1,
              weight: 3,
              fixable: true,
              fixType: 'patch',
            },
            {
              slug: 'has-h1',
              label: 'H1 heading',
              prompt: 'Checked by rule engine.',
              order: 2,
              weight: 2,
              fixable: true,
              fixType: 'patch',
            },
            {
              slug: 'viewport-meta',
              label: 'Mobile viewport tag',
              prompt: 'Checked by rule engine.',
              order: 3,
              weight: 3,
              fixable: true,
              fixType: 'patch',
            },
          ],
        },
        {
          slug: 'accessibility-checks',
          label: 'Accessibility & WCAG',
          order: 2,
          items: [
            {
              slug: 'accessibility-score',
              label: 'Accessibility score',
              prompt: 'Checked by rule engine (Google Lighthouse accessibility audit).',
              order: 1,
              weight: 2,
              fixGuide: [
                'This score summarises every accessibility check Lighthouse ran on the page — fix the individual findings below (contrast, font size, tap targets, accessible names) and the score will rise automatically',
                'Re-run this audit after making changes to see the updated score',
              ],
            },
            {
              slug: 'color-contrast',
              label: 'Color contrast',
              prompt: 'Checked by rule engine (Google Lighthouse accessibility audit, WCAG 1.4.3).',
              order: 2,
              weight: 3,
              fixGuide: [
                'Find the low-contrast text — usually light gray text on a white/light background, or light text on a light-colored button',
                'Body text needs at least a 4.5:1 contrast ratio against its background; large text (18px+, or 14px+ bold) needs at least 3:1',
                'Use a contrast checker such as webaim.org/resources/contrastchecker to test your exact colors before and after',
                'Darken the text color or lighten the background until the ratio passes — small adjustments are usually enough',
              ],
            },
            {
              slug: 'font-size',
              label: 'Legible font sizes',
              prompt: 'Checked by rule engine (Google Lighthouse SEO/mobile-friendliness audit).',
              order: 3,
              weight: 2,
              fixGuide: [
                'Set a base body font size of at least 16px in your CSS (e.g. html { font-size: 16px; })',
                'Avoid any text below 12px anywhere on the page, especially in footers, captions, and mobile nav menus',
                'Check the page on an actual mobile viewport (or Chrome DevTools device mode) — text that looks fine on desktop can be too small on mobile',
              ],
            },
            {
              slug: 'tap-targets',
              label: 'Tap target sizing',
              prompt: 'Checked by rule engine (Google Lighthouse audit, WCAG 2.5.5).',
              order: 4,
              weight: 2,
              fixGuide: [
                'Make every clickable button, link, and icon at least 48x48px on mobile — add padding if the visible icon/text is smaller',
                'Leave at least 8px of spacing between adjacent tap targets (e.g. social icons, nav items) so users don\'t mis-tap',
                'Pay special attention to mobile nav menus, footer links, and icon-only buttons — these are the most common offenders',
              ],
            },
            {
              slug: 'accessible-names',
              label: 'Buttons & links have accessible names',
              prompt: 'Checked by rule engine (Google Lighthouse accessibility audit, WCAG 4.1.2).',
              order: 5,
              weight: 3,
              fixGuide: [
                'Icon-only buttons (hamburger menu, search, close, social icons) need an aria-label describing what they do, e.g. <button aria-label="Open menu">',
                'Links that only contain an image need alt text on the image, or an aria-label on the link itself',
                'Never leave a button or link with no visible text and no aria-label — screen reader users will hear nothing useful',
              ],
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
              label: 'Navigation structure',
              prompt: 'Checked by rule engine.',
              order: 1,
              weight: 2,
              fixable: true,
              fixType: 'patch',
            },
            {
              slug: 'internal-links',
              label: 'Internal links',
              prompt: 'Checked by rule engine.',
              order: 2,
              weight: 2,
            },
            {
              slug: 'descriptive-link-text',
              label: 'Link anchor text',
              prompt: 'Checked by rule engine.',
              order: 3,
              weight: 1,
            },
            {
              slug: 'external-link-safety',
              label: 'External link safety',
              prompt: 'Checked by rule engine.',
              order: 4,
              weight: 1,
              fixable: true,
              fixType: 'patch',
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
              label: 'Server response time',
              prompt: 'Checked by rule engine.',
              order: 1,
              weight: 3,
            },
            {
              slug: 'page-size',
              label: 'Page file size',
              prompt: 'Checked by rule engine.',
              order: 2,
              weight: 2,
            },
            {
              slug: 'compression',
              label: 'Response compression',
              prompt: 'Checked by rule engine.',
              order: 3,
              weight: 2,
            },
            {
              slug: 'image-dimensions',
              label: 'Image dimension attributes',
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
              label: 'Mobile viewport configuration',
              prompt: 'Checked by rule engine.',
              order: 1,
              weight: 3,
              fixable: true,
              fixType: 'patch',
            },
            {
              slug: 'no-fixed-width',
              label: 'Horizontal overflow on mobile',
              prompt: 'Checked by rule engine.',
              order: 2,
              weight: 2,
            },
            {
              slug: 'has-media-queries',
              label: 'Responsive layout',
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
              label: 'HTTPS',
              prompt: 'Checked by rule engine.',
              order: 1,
              weight: 3,
            },
            {
              slug: 'ssl-valid',
              label: 'SSL certificate validity',
              prompt: 'Checked by rule engine.',
              order: 2,
              weight: 3,
            },
            {
              slug: 'security-headers',
              label: 'Security response headers',
              prompt: 'Checked by rule engine.',
              order: 3,
              weight: 2,
            },
            {
              slug: 'has-privacy-page',
              label: 'Privacy policy link',
              prompt: 'Checked by rule engine.',
              order: 4,
              weight: 2,
              fixable: true,
              fixType: 'patch',
              partialFix: 'Adds a Privacy Policy link to your footer. Your /privacy-policy page must already exist — the agent cannot create the page content.',
            },
            {
              slug: 'has-contact-page',
              label: 'Contact page link',
              prompt: 'Checked by rule engine.',
              order: 5,
              weight: 1,
              fixable: true,
              fixType: 'patch',
              partialFix: 'Adds a Contact link to your footer. Your /contact page must already exist — the agent cannot create the page content.',
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
              label: 'Call-to-action',
              prompt: 'Checked by rule engine.',
              order: 1,
              weight: 3,
            },
            {
              slug: 'cta-action-language',
              label: 'CTA button language',
              prompt: 'Checked by rule engine.',
              order: 2,
              weight: 2,
            },
            {
              slug: 'above-fold-cta',
              label: 'Above-fold call-to-action',
              prompt: 'Checked by rule engine.',
              order: 3,
              weight: 2,
            },
            {
              slug: 'social-proof',
              label: 'Social proof signals',
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
              label: 'Form input labels',
              prompt: 'Checked by rule engine.',
              order: 1,
              weight: 2,
              fixable: true,
              fixType: 'patch',
            },
            {
              slug: 'form-not-too-long',
              label: 'Form length',
              prompt: 'Checked by rule engine.',
              order: 2,
              weight: 2,
            },
            {
              slug: 'submit-button',
              label: 'Form submit button',
              prompt: 'Checked by rule engine.',
              order: 3,
              weight: 3,
              fixable: true,
              fixType: 'patch',
            },
            {
              slug: 'placeholder-not-label',
              label: 'Form field labels vs placeholders',
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
              label: 'Meta description',
              prompt: 'Checked by rule engine.',
              order: 1,
              weight: 3,
              fixable: true,
              fixType: 'patch',
            },
            {
              slug: 'canonical',
              label: 'Canonical URL',
              prompt: 'Checked by rule engine.',
              order: 2,
              weight: 2,
              fixable: true,
              fixType: 'patch',
            },
            {
              slug: 'og-tags',
              label: 'Social sharing preview (Open Graph)',
              prompt: 'Checked by rule engine.',
              order: 3,
              weight: 2,
              fixable: true,
              fixType: 'patch',
              upgradeInput: {
                key: 'og_image_url',
                label: 'OG Image URL',
                placeholder: 'https://yourdomain.com/og-image.jpg',
                setupInstructions: 'Agent sets og:title and og:description from page content but cannot determine og:image. Save your OG image URL in Settings → Brand Assets to get a complete fix.',
              },
            },
            {
              slug: 'image-alt-text',
              label: 'Image alt text',
              prompt: 'Checked by rule engine.',
              order: 4,
              weight: 2,
            },
            {
              slug: 'robots-txt',
              label: 'robots.txt',
              prompt: 'Checked by rule engine.',
              order: 5,
              weight: 2,
              fixable: true,
            },
            {
              slug: 'sitemap-xml',
              label: 'sitemap.xml',
              prompt: 'Checked by rule engine.',
              order: 6,
              weight: 2,
              fixable: true,
              partialFix: 'Creates a skeleton sitemap.xml with your root URL only. Does not auto-discover other pages — extend it manually after the fix is applied.',
            },
            {
              slug: 'structured-data',
              label: 'Rich results markup (JSON-LD)',
              prompt: 'Checked by rule engine.',
              order: 7,
              weight: 1,
              fixable: true,
              fixType: 'patch',
              upgradeInput: {
                key: 'logo_url',
                label: 'Logo URL',
                placeholder: 'https://yourdomain.com/logo.png',
                setupInstructions: 'Agent creates a basic Organisation schema with name and URL but cannot determine your logo. Save your logo URL in Settings → Brand Assets to include it in the JSON-LD.',
              },
            },
            {
              slug: 'lang-attr',
              label: 'HTML language attribute',
              prompt: 'Checked by rule engine.',
              order: 8,
              weight: 2,
              fixable: true,
              fixType: 'patch',
            },
          ],
        },
      ],
    },
  ],
}
