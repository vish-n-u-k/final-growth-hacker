import type { ModuleDefinition } from '../types'

export const FOUNDATION_MODULE: ModuleDefinition = {
  type: 'foundation',
  name: 'Foundation',
  description: 'Verifies your basic digital infrastructure is in place before any marketing or growth work begins.',
  order: 1,
  unlockThreshold: 0, // always unlocked — no threshold required
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
              fixGuide: [
                'Check that your hosting plan is active and not expired',
                'Verify your domain DNS is pointing to the correct hosting server (A record or CNAME)',
                'Check your hosting dashboard for any suspended account notices or deployment errors',
                'If using a static host (Vercel, Netlify), check the deployment logs for build failures',
              ],
            },
            {
              slug: 'ssl-active',
              label: 'HTTPS secure connection',
              prompt: 'Check whether the site URL uses HTTPS. A non-HTTPS site is penalised by Google and flagged as insecure by browsers. Report the protocol in use.',
              order: 2,
              weight: 3,
              fixGuide: [
                'Log in to your hosting control panel (cPanel, Vercel, Netlify, etc.)',
                'Find the SSL/TLS or HTTPS settings — most modern hosts offer free Let\'s Encrypt certificates',
                'Enable "Force HTTPS" or "SSL redirect" so all HTTP traffic redirects to HTTPS',
                'If on a VPS/custom server, install Certbot (certbot.eff.org) to get a free certificate',
                'After enabling, verify by visiting your site with https:// and checking the padlock in the browser',
              ],
            },
            {
              slug: 'custom-domain',
              label: 'Custom domain',
              prompt: 'Check the "Custom domain" value provided above. If it says "No — hosted on [platform]", the site is running on a free hosting subdomain rather than a custom domain. A free subdomain (e.g. myapp.vercel.app) signals to visitors, investors, and partners that the business is not established. If the custom domain value is "Yes", this passes. Report the exact URL and hosting platform if flagged.',
              order: 0,
              weight: 2,
              fixGuide: [
                'Register a domain name at a registrar such as Namecheap, Google Domains, or GoDaddy (typically $10–$15/year)',
                'In your hosting dashboard (Vercel, Netlify, etc.) go to Settings → Domains → Add custom domain',
                'Copy the DNS records shown (usually an A record or CNAME) and add them in your domain registrar\'s DNS settings',
                'DNS propagation takes up to 48 hours — the host will auto-issue an SSL certificate once propagation is complete',
              ],
            },
            {
              slug: 'no-noindex',
              label: 'Search engine indexing',
              prompt: 'Check for <meta name="robots" content="noindex"> or any robots meta tag that would prevent Google from indexing the site. This is a critical mistake that makes the site invisible to search engines. Report what you find.',
              order: 3,
              weight: 3,
              fixable: true,
              fixType: 'patch',
              fixGuide: [
                'Open your site\'s HTML source (right-click → View Source) and search for <meta name="robots"',
                'If you see content="noindex" or content="noindex,nofollow" — remove that meta tag entirely, or change the value to "index,follow"',
                'If using WordPress: Settings → Reading → uncheck "Discourage search engines from indexing this site"',
                'If using another CMS, check its SEO settings panel for a "noindex" toggle',
                'After fixing, use Google Search Console → URL Inspection to request re-indexing',
              ],
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
              label: 'Mobile viewport tag',
              prompt: 'Check for <meta name="viewport"> tag. Without it, the site renders broken on mobile devices. Report the tag value if found.',
              order: 1,
              weight: 2,
              fixable: true,
              fixType: 'patch',
              fixGuide: [
                'Add this tag inside the <head> of your HTML: <meta name="viewport" content="width=device-width, initial-scale=1">',
                'If using a framework (Next.js, Nuxt, etc.) add it in the root layout file inside the <head> component',
                'After adding, open your site on a mobile device or use Chrome DevTools → Toggle Device Toolbar to verify it renders correctly',
              ],
            },
            {
              slug: 'no-placeholder',
              label: 'Homepage content',
              prompt: 'Read the page content. Is this a real, live website with actual content? Or does it appear to be a placeholder, "coming soon", or under construction page? Report what the homepage actually shows.',
              order: 2,
              weight: 3,
              fixGuide: [
                'Replace any "Coming Soon" or placeholder content with real business content — who you are, what you do, who it\'s for',
                'At minimum, publish a headline (H1), a short description paragraph, and one call-to-action',
                'Do not launch ads or share links to your site until real content is live — first impressions are permanent',
              ],
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
              label: 'Google Analytics tracking',
              prompt: 'Check the HTML for Google Analytics GA4 tracking code. Look for gtag.js, G-XXXXXXXX measurement IDs, or Google Tag Manager (GTM) containers which may load GA4. Report what you find. If none is detected, flag this as critical — without analytics, no growth decision can be data-driven.',
              order: 1,
              weight: 3,
              fixable: true,
              assistedInput: {
                key: 'ga4_measurement_id',
                integrationProvider: 'google_analytics',
                setupInstructions: 'Go to analytics.google.com → create a GA4 property → copy your Measurement ID (starts with G-) → save it in Settings → Integrations → Google Analytics.',
              },
              fixGuide: [
                'Go to analytics.google.com → sign in with your Google account → click "Start measuring"',
                'Create an Account and a Property — give the property your business name and select your timezone/currency',
                'Under "Data collection", choose "Web" and enter your website URL to create a data stream',
                'Copy the Measurement ID (starts with G-) shown on the stream details page',
                'Add this snippet to your site\'s <head> tag (replace G-XXXXXXXX with your ID):\n<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXX"></script>\n<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag(\'js\',new Date());gtag(\'config\',\'G-XXXXXXXX\');</script>',
                'Verify by visiting your site and checking GA4 → Reports → Realtime — you should see 1 active user',
              ],
            },
            {
              slug: 'gsc-linked',
              label: 'Google Search Console',
              prompt: 'Check if Google Search Console is verified. Use the gscVerification context field for the HTML meta tag. Also check gscHtmlFilename (HTML file method), gscDnsTxtValue (DNS TXT method), ga4Id (GA4 method — verified if GA4 is installed and linked to the same Google account), and gtmId (GTM method). Mark as verified if ANY of these signals is present. State clearly which method was detected.',
              order: 2,
              weight: 2,
              fixable: true,
              assistedInput: {
                key: 'gsc_verification_code',
                integrationProvider: 'google_search_console',
                setupInstructions: 'Go to search.google.com/search-console → add your property → choose "HTML tag" verification → copy the content value from the meta tag shown → save it in Settings → Integrations → Google Search Console.',
              },
              fixGuide: [
                'Go to search.google.com/search-console → click "Add property" → enter your website URL',
                'Choose the "HTML tag" verification method',
                'Copy only the content="..." value from the meta tag shown (not the whole tag — just the value between the quotes)',
                'Add this tag to your site\'s <head>: <meta name="google-site-verification" content="PASTE_VALUE_HERE">',
                'Click "Verify" in GSC — once confirmed, submit your sitemap under Sitemaps → Add sitemap URL',
              ],
            },
            {
              slug: 'posthog-installed',
              label: 'PostHog analytics',
              prompt: 'Check the HTML scripts for PostHog analytics. Look for posthog-js in script src attributes, posthog.init( calls in inline scripts, or scripts loading from us.posthog.com, eu.posthog.com, or app.posthog.com. Report exactly what you find. If none is detected, flag it as missing — PostHog is essential for tracking user behaviour, funnels, and growth metrics.',
              order: 3,
              weight: 2,
              assistedInput: {
                key: 'posthog_project_id',
                integrationProvider: 'posthog',
                setupInstructions: 'Go to posthog.com → sign up → copy the JS snippet into your site\'s <head> → then get your Personal API Key and Project ID from PostHog → Project Settings and save them in Settings → Integrations → PostHog.',
              },
              fixGuide: [
                'Go to posthog.com → sign up for a free account → create a new project for your product',
                'PostHog will show you a JS snippet — copy it and paste it into your site\'s <head> tag (this uses your phc_... project key)',
                'Call posthog.identify(userId, { email, name }) immediately after a user signs up or logs in — this is what creates a Person record and links their events to an identity',
                'To connect PostHog to this dashboard: PostHog → Settings → Personal API keys → Create personal API key (phx_...) → also note your numeric Project ID from the URL (posthog.com/project/12345)',
                'Save the Personal API key and Project ID in Settings → Integrations → PostHog — your live user count will appear on the dashboard',
              ],
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
              prompt: 'Check the "probedPages.privacyUrl" field first — if it has a value, a privacy policy page was confirmed to exist at that URL and this check passes. If it is null, also scan allLinks and footerLinks for any privacy-related links as a fallback. A privacy policy is legally required in most jurisdictions and required by Google Ads and Meta Ads. Report the URL found or confirm it is missing.',
              order: 1,
              weight: 2,
              fixable: true,
              fixType: 'patch',
              fixGuide: [
                'Generate a free privacy policy at termly.io, privacypolicygenerator.info, or getterms.io — takes under 5 minutes',
                'Create a dedicated /privacy-policy page on your site and paste the generated content',
                'Add a "Privacy Policy" link in your website footer — this is the standard location users and platforms expect',
                'If you run Google or Meta ads, your ad account will require the privacy policy URL during campaign setup',
              ],
            },
            {
              slug: 'contact-accessible',
              label: 'Contact information',
              prompt: 'Check the "probedPages.contactUrl" field first — if it has a value, a contact page was confirmed to exist at that URL and this check passes. If it is null, also scan allLinks, navLinks, and footerLinks for contact links, or look for an email address or phone number in the body text. Report the contact URL found or what contact details are visible.',
              order: 2,
              weight: 2,
              fixGuide: [
                'Add a contact email address in your website footer (e.g. hello@yourdomain.com)',
                'Alternatively, create a /contact page with a form and link to it from the navigation and footer',
                'A phone number or live chat widget also satisfies this — choose whatever matches your support model',
                'Make sure contact info is visible without scrolling on mobile devices',
              ],
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
              fixGuide: [
                'Write a single H1 headline that answers: "What do you do and who is it for?" — e.g. "Accounting software for freelancers" or "Custom furniture made in 2 weeks"',
                'Follow it with a 1–2 sentence subheading that explains the main benefit or outcome — not features',
                'Avoid vague claims like "innovative solutions" or "world-class service" — be specific and concrete',
                'Test it: show your homepage to someone unfamiliar with your business for 5 seconds — can they say back what you do?',
              ],
            },
            {
              slug: 'cta-exists',
              label: 'Call-to-action',
              prompt: 'Check whether the homepage has at least one clear call-to-action button or link (e.g. "Get started", "Sign up free", "Contact us", "Shop now"). Report the CTA text found, or flag as missing if none exists.',
              order: 2,
              weight: 2,
              fixGuide: [
                'Add a prominent button above the fold (visible without scrolling) with a specific action label: "Get started free", "Book a call", "Shop now", "Try it free"',
                'Avoid generic labels like "Click here" or "Learn more" — the button text should tell visitors exactly what happens when they click',
                'Use a contrasting colour so the button stands out from the rest of the page',
                'Place a secondary CTA in the footer or at the end of each section for visitors who scroll',
              ],
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
              fixGuide: [
                'Create profiles on the 2–3 social platforms most relevant to your audience (B2B → LinkedIn; consumer → Instagram/TikTok; developer → Twitter/X)',
                'Use your exact business name as the handle on every platform for brand consistency',
                'Add icon links to each profile in your website footer — link to the profile page, not just the home page of the platform',
                'Make sure the linked profiles are active — an empty or abandoned profile is worse than no link',
              ],
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
              fixGuide: [
                'Create a 512×512px square image with your logo or brand mark (PNG format)',
                'Go to favicon.io or realfavicongenerator.net — upload the image to generate a complete favicon package',
                'Place the generated favicon.ico (and any PNG variants) in your site\'s /public folder',
                'Add this tag to your HTML <head>: <link rel="icon" href="/favicon.ico">',
                'For full browser/device coverage, also add: <link rel="apple-touch-icon" href="/apple-touch-icon.png">',
              ],
            },
            {
              slug: 'business-name-clear',
              label: 'Business name visibility',
              prompt: 'Check whether the business name appears in the page title, header, logo alt text, or prominent heading. Report the name as it appears, or flag if it cannot be identified.',
              order: 2,
              weight: 1,
              fixGuide: [
                'Make sure your logo has an alt attribute with your business name: <img src="/logo.png" alt="YourBrand">',
                'Include your business name in the page <title> tag: <title>YourBrand – Short Description</title>',
                'Your business name should be visible in the site header, either as text or as a logo with a readable alt tag',
              ],
            },
            {
              slug: 'page-title-set',
              label: 'Browser tab title',
              prompt: 'Check the <title> tag. Is it set to something meaningful and specific to this business? Flag if it is empty, says "Untitled", "Home", "WordPress", or any framework default. Report the current title.',
              order: 3,
              weight: 2,
              fixable: true,
              fixType: 'patch',
              fixGuide: [
                'Set your homepage <title> to: "Brand Name – Short Value Proposition" (50–60 characters)',
                'Example: "Acme Accounting – Tax Software for Freelancers" or "Studio Clay – Handmade Ceramics in London"',
                'Avoid generic titles like "Home", "Welcome", "Untitled", or framework defaults like "Create Next App"',
                'In Next.js: export metadata = { title: \'Your Title\' } in app/page.tsx; in WordPress: Settings → General → Site Title and Tagline',
                'The title appears as the browser tab label and as the blue headline in Google search results — make it count',
              ],
            },
          ],
        },
      ],
    },
  ],
}
