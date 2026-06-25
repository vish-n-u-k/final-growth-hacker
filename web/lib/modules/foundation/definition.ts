import type { ModuleDefinition } from '../types'

export const FOUNDATION_MODULE: ModuleDefinition = {
  type: 'foundation',
  name: 'Foundation',
  description: 'Verifies your basic digital infrastructure is in place before any marketing or growth work begins.',
  order: 0,
  unlockThreshold: 0, // always unlocked — first module
  requirements: [
    {
      key: 'website_url',
      label: 'Your website URL',
      type: 'url',
      placeholder: 'yourdomain.com',
    },
  ],
  systemPrompt: `You are a senior digital infrastructure auditor. Your job is to check whether a business has the basic technical and content foundations in place before any marketing activity can be effective.

You are checking fundamentals — not optimizations. The question for each check is: "Does this exist and does it work?" not "Is it perfect?"

Rules:
- Be direct and specific. Reference actual values found (URLs, tag content, presence/absence).
- If something is clearly present and working, it passes.
- If something is missing, broken, or needs attention, it fails.
- When data is unavailable from the HTML, explicitly state it needs manual verification.
- Never give generic advice. Every action must be concrete and immediately actionable.
- Think like a consultant checking if a business is ready to start growing.`,
  categories: [
    // ── 1. DOMAIN & HOSTING ─────────────────────────────────────────────────
    {
      slug: 'domain-hosting',
      label: 'Domain & Hosting',
      order: 1,
      subCategories: [
        {
          slug: 'accessibility',
          label: 'Accessibility',
          order: 1,
          items: [
            {
              slug: 'site-accessible',
              label: 'Website accessibility',
              prompt: 'Check whether the website is returning a successful response (not 404, 500, or any error page). If the HTML was fetched successfully, it passes. Report what you observe.',
              order: 1,
              weight: 3,
            },
            {
              slug: 'ssl-active',
              label: 'SSL certificate (HTTPS)',
              prompt: 'Check whether the site URL uses HTTPS. A non-HTTPS site is penalised by Google and flagged as insecure by browsers. Report the protocol in use.',
              order: 2,
              weight: 3,
            },
            {
              slug: 'custom-domain',
              label: 'Custom domain',
              prompt: 'Check the "Custom domain" value provided above. If it says "No — hosted on [platform]", the site is running on a free hosting subdomain rather than a custom domain. A free subdomain (e.g. myapp.vercel.app) signals to visitors, investors, and partners that the business is not established. If the custom domain value is "Yes", this passes. Report the exact URL and hosting platform if flagged.',
              order: 0,
              weight: 2,
            },
            {
              slug: 'no-noindex',
              label: 'Search engine indexing',
              prompt: 'Check for <meta name="robots" content="noindex"> or any robots meta tag that would prevent Google from indexing the site. This is a critical mistake that makes the site invisible to search engines. Report what you find.',
              order: 3,
              weight: 3,
              fixable: true,
              fixType: 'patch',
            },
          ],
        },
        {
          slug: 'performance',
          label: 'Performance',
          order: 2,
          items: [
            {
              slug: 'mobile-viewport',
              label: 'Mobile viewport meta tag',
              prompt: 'Check for <meta name="viewport"> tag. Without it, the site renders broken on mobile devices. Report the tag value if found.',
              order: 1,
              weight: 2,
              fixable: true,
              fixType: 'patch',
            },
            {
              slug: 'no-placeholder',
              label: 'Homepage content',
              prompt: 'Read the page content. Is this a real, live website with actual content? Or does it appear to be a placeholder, "coming soon", or under construction page? Report what the homepage actually shows.',
              order: 2,
              weight: 3,
            },
          ],
        },
      ],
    },

    // ── 2. ANALYTICS & MEASUREMENT ──────────────────────────────────────────
    {
      slug: 'analytics-measurement',
      label: 'Analytics & Measurement',
      order: 2,
      subCategories: [
        {
          slug: 'tracking',
          label: 'Tracking Setup',
          order: 1,
          items: [
            {
              slug: 'ga4-installed',
              label: 'Google Analytics GA4',
              prompt: 'Check the HTML for Google Analytics GA4 tracking code. Look for gtag.js, G-XXXXXXXX measurement IDs, or Google Tag Manager (GTM) containers which may load GA4. Report what you find. If none is detected, flag this as critical — without analytics, no growth decision can be data-driven.',
              order: 1,
              weight: 3,
              fixable: true,
              assistedInput: {
                key: 'ga4_measurement_id',
                integrationProvider: 'google_analytics',
                setupInstructions: 'Go to analytics.google.com → create a GA4 property → copy your Measurement ID (starts with G-) → save it in Settings → Integrations → Google Analytics.',
              },
            },
            {
              slug: 'gsc-linked',
              label: 'Google Search Console',
              prompt: 'Check for Google Search Console verification meta tags (google-site-verification) in the HTML head. Note: GSC can also be verified via DNS or file — if the meta tag is not found, state it needs manual verification. Report what you find.',
              order: 2,
              weight: 2,
              fixable: true,
              assistedInput: {
                key: 'gsc_verification_code',
                integrationProvider: 'google_search_console',
                setupInstructions: 'Go to search.google.com/search-console → add your property → choose "HTML tag" verification → copy the content value from the meta tag shown → save it in Settings → Integrations → Google Search Console.',
              },
            },
          ],
        },
      ],
    },

    // ── 3. ESSENTIAL PAGES ───────────────────────────────────────────────────
    {
      slug: 'essential-pages',
      label: 'Essential Pages',
      order: 3,
      subCategories: [
        {
          slug: 'required-pages',
          label: 'Required Pages',
          order: 1,
          items: [
            {
              slug: 'privacy-policy',
              label: 'Privacy policy page',
              prompt: 'Look for a link to a privacy policy page in the page content, footer, or navigation. A privacy policy is legally required in most jurisdictions and required by Google Ads, Meta Ads, and other platforms. Report whether a link or reference is found.',
              order: 1,
              weight: 2,
              fixable: true,
              fixType: 'patch',
            },
            {
              slug: 'contact-accessible',
              label: 'Contact information',
              prompt: 'Check whether an email address, phone number, contact form link, or "Contact us" page link is present on the homepage (often in the header, footer, or navigation). Report what contact details or links are found.',
              order: 2,
              weight: 2,
            },
          ],
        },
        {
          slug: 'homepage-content',
          label: 'Homepage Quality',
          order: 2,
          items: [
            {
              slug: 'value-prop-exists',
              label: 'Homepage value proposition',
              prompt: 'Read the above-the-fold content. Can a first-time visitor immediately understand what this business does and who it is for? Report what the homepage says and whether the value proposition is clear.',
              order: 1,
              weight: 3,
            },
            {
              slug: 'cta-exists',
              label: 'Call-to-action',
              prompt: 'Check whether the homepage has at least one clear call-to-action button or link (e.g. "Get started", "Sign up free", "Contact us", "Shop now"). Report the CTA text found, or flag as missing if none exists.',
              order: 2,
              weight: 2,
            },
          ],
        },
      ],
    },

    // ── 4. SOCIAL MEDIA PRESENCE ─────────────────────────────────────────────
    {
      slug: 'social-presence',
      label: 'Social Media Presence',
      order: 4,
      subCategories: [
        {
          slug: 'social-profiles',
          label: 'Social Profiles',
          order: 1,
          items: [
            {
              slug: 'social-presence',
              label: 'Social media profiles linked',
              prompt: 'Check whether the website links to any social media profiles (Instagram, LinkedIn, Twitter/X, Facebook, YouTube, TikTok, Pinterest) — typically in the footer, header, or navigation. Use the "Social media links detected" data provided. Report which platforms are linked and which are absent. Pass if at least 2 profile links are present.',
              order: 1,
              weight: 2,
            },
          ],
        },
      ],
    },

    // ── 5. BRAND BASICS ──────────────────────────────────────────────────────
    {
      slug: 'brand-basics',
      label: 'Brand Basics',
      order: 5,
      subCategories: [
        {
          slug: 'identity',
          label: 'Brand Identity',
          order: 1,
          items: [
            {
              slug: 'favicon-present',
              label: 'Favicon',
              prompt: 'Check the HTML <head> for a <link rel="icon"> or <link rel="shortcut icon"> tag. A missing favicon signals an unfinished or unprofessional website. Report what you find.',
              order: 1,
              weight: 1,
              fixable: true,
              fixType: 'patch',
            },
            {
              slug: 'business-name-clear',
              label: 'Business name visibility',
              prompt: 'Check whether the business name appears in the page title, header, logo alt text, or prominent heading. Report the name as it appears, or flag if it cannot be identified.',
              order: 2,
              weight: 1,
            },
            {
              slug: 'page-title-set',
              label: 'Homepage title tag',
              prompt: 'Check the <title> tag. Is it set to something meaningful and specific to this business? Flag if it is empty, says "Untitled", "Home", "WordPress", or any framework default. Report the current title.',
              order: 3,
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
