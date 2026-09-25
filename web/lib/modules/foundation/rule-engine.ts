import type { ModuleAnalysisResult } from '../types'
import type { FoundationFetchResult } from './fetcher'

function f(
  slug: string,
  verified: boolean,
  detail: string,
  highlight: string,
  narrative: string,
  action: string,
): ModuleAnalysisResult {
  return { slug, verified, detail, highlight, narrative, action }
}

const GENERIC_TITLES = [
  'home', 'untitled', 'welcome', 'create next app', 'vite app',
  'react app', 'my app', 'index', 'new tab', 'localhost', 'wordpress',
]

export function runFoundationRuleEngine(
  data: FoundationFetchResult,
  gscMeta: Record<string, string> = {},
): { results: ModuleAnalysisResult[]; aiSlugs: string[] } {
  const results: ModuleAnalysisResult[] = []
  const e = data.extracted

  // ── site-accessible ──────────────────────────────────────────────────────────
  results.push(e
    ? f('site-accessible', true,
        data.jinaFallback
          ? 'Website is live. Direct scanning was blocked (bot protection active) — content fetched via Jina Reader.'
          : 'Website is live and returning a successful response.',
        'Site is live and accessible',
        'Your site loads correctly for visitors and bots.',
        '')
    : f('site-accessible', false,
        'Website did not return a successful response — it may be down or misconfigured.',
        'Site is not accessible',
        '**All growth activity stops** if the site cannot be reached by visitors or search bots.',
        'Check your hosting dashboard for errors or expired plans and verify your domain DNS settings.')
  )

  if (!e) {
    // Nothing else can be checked — mark remaining items as unverifiable
    const blocked = [
      'ssl-active', 'custom-domain', 'no-noindex', 'mobile-viewport',
      'ga4-installed', 'gsc-linked', 'posthog-installed',
      'gtm-installed', 'meta-pixel-installed', 'tiktok-pixel-installed',
      'privacy-policy', 'contact-accessible', 'value-prop-exists',
      'cta-exists', 'social-presence', 'favicon-present',
      'business-name-clear', 'page-title-set', 'no-placeholder',
    ]
    for (const slug of blocked) {
      results.push(f(slug, false,
        'Could not check — website is not accessible.',
        'Cannot verify',
        'Fix site accessibility first.',
        ''))
    }
    return { results, aiSlugs: [] }
  }

  // ── ssl-active ───────────────────────────────────────────────────────────────
  const isHttps = data.url.startsWith('https://')
  results.push(isHttps
    ? f('ssl-active', true,
        'Site is served over HTTPS — connection is encrypted and secure.',
        'HTTPS is active',
        'Secure connections build visitor trust and are a Google ranking factor.',
        '')
    : f('ssl-active', false,
        'Site is served over HTTP — no SSL certificate is active.',
        'No HTTPS — connection is insecure',
        '**Google penalises HTTP sites** in rankings and browsers show a "Not Secure" warning to visitors.',
        "Enable HTTPS in your hosting dashboard — most hosts offer free Let's Encrypt certificates.")
  )

  // ── custom-domain ────────────────────────────────────────────────────────────
  results.push(data.customDomain
    ? f('custom-domain', true,
        'Site is on a custom domain — not a free hosting subdomain.',
        'Custom domain is set up',
        'A custom domain signals credibility to visitors, investors, and partners.',
        '')
    : f('custom-domain', false,
        `Site is hosted on a free subdomain (${data.hostingPlatform ?? 'free hosting'}) — no custom domain set up.`,
        `Running on ${data.hostingPlatform ?? 'free'} subdomain`,
        '**A free subdomain signals an unestablished business** and reduces trust with visitors and partners.',
        'Register a custom domain (~$12/year) and connect it in your hosting dashboard.')
  )

  // ── no-noindex ───────────────────────────────────────────────────────────────
  const hasNoindex = /noindex/i.test(e.metaRobots)
  results.push(data.jinaFallback
    ? f('no-noindex', true,
        'Could not read HTML head — site blocks automated scanning. Assumed indexable; verify manually in your page source.',
        'Cannot verify — check manually',
        'Open your page source and confirm there is no <meta name="robots" content="noindex"> tag.',
        'View source (Ctrl+U) and search for "noindex" to confirm.')
    : !hasNoindex
      ? f('no-noindex', true,
          'No noindex directive found — search engines can crawl and index this site.',
          'Search engines can index this site',
          'Your pages are eligible to appear in Google search results.',
          '')
      : f('no-noindex', false,
          `noindex directive found in robots meta tag: "${e.metaRobots}" — Google cannot index this site.`,
          'Site is blocked from Google',
          '**This site is invisible to search engines** — no organic traffic is possible while noindex is active.',
          'Remove the <meta name="robots" content="noindex"> tag or change it to "index,follow".')
  )

  // ── mobile-viewport ──────────────────────────────────────────────────────────
  results.push(data.jinaFallback
    ? f('mobile-viewport', true,
        'Could not read HTML head — site blocks automated scanning. Assumed present; verify manually.',
        'Cannot verify — check manually',
        'Open your page source and confirm <meta name="viewport"> exists in the <head>.',
        'View source (Ctrl+U) and search for "viewport" to confirm.')
    : e.metaViewport
      ? f('mobile-viewport', true,
          `Viewport meta tag is set: "${e.metaViewport}".`,
          'Mobile viewport tag is present',
          'The site renders correctly on mobile devices.',
          '')
      : f('mobile-viewport', false,
          'No viewport meta tag found — the site will render incorrectly on mobile devices.',
          'Missing mobile viewport tag',
          '**Over 60% of web traffic is mobile** — without a viewport tag the site appears broken on phones.',
          'Add <meta name="viewport" content="width=device-width, initial-scale=1"> inside your HTML <head>.')
  )

  // ── ga4-installed ────────────────────────────────────────────────────────────
  const hasGa4 = !!(e.ga4Id || e.gtmId || e.hasAnalyticsScript)
  let ga4Detail: string
  if (e.ga4Id) ga4Detail = `Google Analytics GA4 detected (${e.ga4Id}).`
  else if (e.gtmId) ga4Detail = `Google Tag Manager detected (${e.gtmId}) — GA4 may be loaded via GTM.`
  else if (e.hasAnalyticsScript) ga4Detail = 'Analytics script detected (Google Tag Manager or gtag.js).'
  else ga4Detail = 'No Google Analytics GA4 tracking code found in the page HTML.'
  results.push(data.jinaFallback
    ? f('ga4-installed', false,
        'Could not scan scripts — site blocks automated scanning. Check manually whether GA4, GTM, or another analytics tool is installed.',
        'Cannot verify — check manually',
        '**Without analytics you are flying blind** — no data to make growth decisions from.',
        "Go to analytics.google.com to verify your GA4 property is active, or check your site's <head> for a gtag/GTM snippet.")
    : hasGa4
      ? f('ga4-installed', true, ga4Detail, 'Google Analytics is installed',
          'Visitor behaviour can be tracked and growth decisions can be data-driven.', '')
      : f('ga4-installed', false, ga4Detail, 'No analytics tracking found',
          '**Without analytics you are flying blind** — no data to make growth decisions from.',
          "Go to analytics.google.com, create a GA4 property, and add the tracking snippet to your site's <head>.")
  )

  // ── gsc-linked ───────────────────────────────────────────────────────────────
  const gscVerified = !!(
    e.gscVerification ||
    gscMeta['gsc_verification_code'] ||
    gscMeta['gsc_html_filename'] ||
    gscMeta['gsc_dns_txt_value'] ||
    hasGa4
  )
  results.push(data.jinaFallback
    ? f('gsc-linked', false,
        'Could not scan HTML head — site blocks automated scanning. Verify GSC manually.',
        'Cannot verify — check manually',
        '**Without GSC you have no data on what searches drive traffic** — keyword and ranking data is unavailable.',
        'Go to search.google.com/search-console to confirm your property is verified.')
    : gscVerified
      ? f('gsc-linked', true,
          e.gscVerification
            ? `Google Search Console verification tag found: "${e.gscVerification.slice(0, 40)}…".`
            : 'Google Search Console verification detected.',
          'Google Search Console is verified',
          'Google can report on your search performance and index pages faster.',
          '')
      : f('gsc-linked', false,
          'No Google Search Console verification found in the page HTML.',
          'Search Console not verified',
          '**Without GSC you have no data on what searches drive traffic** — keyword and ranking data is unavailable.',
          'Go to search.google.com/search-console, add your property, and verify using the HTML tag method.')
  )

  // ── posthog-installed ────────────────────────────────────────────────────────
  results.push(data.jinaFallback
    ? f('posthog-installed', false,
        'Could not scan scripts — site blocks automated scanning. Check manually whether PostHog is installed.',
        'Cannot verify — check manually',
        'Without product analytics **you cannot see how users interact with your product** — funnels, drop-off points, and conversion rates are completely invisible.',
        "Go to posthog.com → create a free project → grab your phc_... API key. Then open `md_files/posthog-setup.md` in your project and paste its contents to Claude Code — it will install PostHog and wire up every important event (auth, onboarding, analysis, item checks, exports, AI features, score milestones) in one pass.")
    : e.posthogDetected
      ? f('posthog-installed', true,
          'PostHog analytics detected in the page scripts.',
          'PostHog is installed',
          'User behaviour, funnels, and product analytics are being tracked.',
          '')
      : f('posthog-installed', false,
          'No PostHog analytics detected in the page scripts.',
          'PostHog not installed',
          'Without product analytics **you cannot see how users interact with your product** — funnels, drop-off points, and conversion rates are completely invisible.',
          "Go to posthog.com → create a free project → grab your phc_... API key. Then open `md_files/posthog-setup.md` in your project and paste its contents to Claude Code — it will install PostHog and wire up every important event (auth, onboarding, analysis, item checks, exports, AI features, score milestones) in one pass.")
  )

  // ── gtm-installed ────────────────────────────────────────────────────────────
  results.push(data.jinaFallback
    ? f('gtm-installed', false,
        'Could not scan scripts — site blocks automated scanning. Check manually whether GTM is installed.',
        'Cannot verify — check manually',
        'Without GTM every new tracking tag requires a code deployment — **this slows down marketing execution significantly**.',
        "View your page source and search for 'GTM-' to check if Google Tag Manager is installed.")
    : e.gtmId
      ? f('gtm-installed', true,
          `Google Tag Manager detected (${e.gtmId}).`,
          'Google Tag Manager is installed',
          'All marketing tags can be deployed and updated without touching the codebase.',
          '')
      : f('gtm-installed', false,
          'No Google Tag Manager container found in the page HTML.',
          'GTM not installed',
          'Without GTM every new tracking tag requires a code deployment — **this slows down marketing execution significantly**.',
          'Go to tagmanager.google.com, create a container, and paste the two GTM code snippets into your site\'s <head> and <body>.')
  )

  // ── meta-pixel-installed ─────────────────────────────────────────────────────
  const hasMetaPixel = !!(e.metaPixelId)
  results.push(data.jinaFallback
    ? f('meta-pixel-installed', false,
        'Could not scan scripts — site blocks automated scanning. Check manually whether Meta Pixel is installed.',
        'Cannot verify — check manually',
        '**Without the Meta Pixel, Facebook and Instagram ads cannot track conversions** or optimise delivery — ad spend is wasted.',
        "View your page source and search for 'fbq(' or 'fbevents.js' to check if Meta Pixel is installed.")
    : hasMetaPixel
      ? f('meta-pixel-installed', true,
          e.metaPixelId !== 'detected'
            ? `Meta Pixel detected (ID: ${e.metaPixelId}).`
            : 'Meta Pixel detected (fbevents.js loaded).',
          'Meta Pixel is installed',
          'Facebook and Instagram ad campaigns can track conversions and build retargeting audiences.',
          '')
      : f('meta-pixel-installed', false,
          'No Meta Pixel (fbevents.js or fbq() call) found in the page HTML.',
          'Meta Pixel not installed',
          '**Without the Meta Pixel, Facebook and Instagram ads cannot track conversions** or optimise delivery — ad spend is wasted.',
          'Go to business.facebook.com → Events Manager → create a Pixel → paste the base code snippet into your <head>.')
  )

  // ── tiktok-pixel-installed ───────────────────────────────────────────────────
  // Only relevant if the business is on TikTok — otherwise don't penalise or nag about it
  const tiktokRelevant = e.tiktokPixelDetected || e.hasTiktokLink || !!e.socialLinks['tiktok']
  results.push(!tiktokRelevant
    ? f('tiktok-pixel-installed', true,
        'Not applicable — no TikTok profile is linked from your site, so a TikTok Pixel is not needed.',
        'Not needed — no TikTok presence',
        'The TikTok Pixel only matters if you run TikTok ads. Skip this unless you start advertising on TikTok.',
        '')
    : data.jinaFallback
    ? f('tiktok-pixel-installed', false,
        'Could not scan scripts — site blocks automated scanning. Check manually whether TikTok Pixel is installed.',
        'Cannot verify — check manually',
        'If you plan to run TikTok ads, the Pixel is required to track conversions and optimise delivery.',
        "View your page source and search for 'ttq.load(' or 'analytics.tiktok.com' to check if TikTok Pixel is installed.")
    : e.tiktokPixelDetected
      ? f('tiktok-pixel-installed', true,
          'TikTok Pixel detected (analytics.tiktok.com script or ttq.load() call found).',
          'TikTok Pixel is installed',
          'TikTok ad campaigns can track conversions and build retargeting audiences.',
          '')
      : f('tiktok-pixel-installed', false,
          'Your site links to a TikTok profile, but no TikTok Pixel was detected in the page HTML.',
          'TikTok Pixel not installed',
          'If you plan to run TikTok ads, the Pixel is required to track conversions and optimise delivery.',
          'Go to ads.tiktok.com → Assets → Events → Web Events → create a Pixel → paste the base code or deploy via GTM.')
  )

  // ── privacy-policy ───────────────────────────────────────────────────────────
  const privacyUrl = e.probedPages.privacyUrl
  const hasPrivacy = !!(privacyUrl || e.privacyLinkHref)
  results.push(hasPrivacy
    ? f('privacy-policy', true,
        privacyUrl
          ? `Privacy policy page confirmed at ${privacyUrl}.`
          : `Privacy policy link found on the page (${e.privacyLinkHref}).`,
        'Privacy policy is present',
        'Legal compliance is in place — required for running ads and operating in most jurisdictions.',
        '')
    : f('privacy-policy', false,
        'No privacy policy page or link found.',
        'No privacy policy found',
        '**A privacy policy is legally required** in most countries and required by Google Ads and Meta Ads to run campaigns.',
        'Generate a free privacy policy at termly.io and publish it at /privacy-policy, then link it in your footer.')
  )

  // ── contact-accessible ───────────────────────────────────────────────────────
  const contactUrl = e.probedPages.contactUrl
  const contactInLinks = [...e.allLinks, ...e.navLinks, ...e.footerLinks].some(l =>
    /contact|support|help|reach/i.test(l.text) || /contact|support|help/i.test(l.href)
  )
  const emailInBody = /\S+@\S+\.\S+/.test(e.bodyTextSnippet)
  const hasContact = !!(contactUrl || contactInLinks || emailInBody)
  results.push(hasContact
    ? f('contact-accessible', true,
        contactUrl
          ? `Contact page found at ${contactUrl}.`
          : emailInBody
            ? 'Email address found on the page.'
            : 'Contact link found on the page.',
        'Contact information is accessible',
        'Visitors can reach you — this builds trust and supports sales conversations.',
        '')
    : f('contact-accessible', false,
        'No contact page, link, or email address found.',
        'No contact information found',
        '**Visitors with no way to contact you will leave** — missing contact info reduces trust and kills conversion.',
        'Add a contact email in your footer or create a /contact page linked from your navigation.')
  )

  // ── cta-exists ───────────────────────────────────────────────────────────────
  const ctaPattern = /\b(get started|sign up|start free|try|book|shop|join|contact|subscribe|learn more|get access|free trial|request demo|watch demo|buy now|order now)\b/i
  const hasCtaButton = e.ctaTexts.some(t => ctaPattern.test(t))
  const hasCtaInNav = e.navLinks.some(l => ctaPattern.test(l.text))
  const hasCta = hasCtaButton || hasCtaInNav
  const firstCta = e.ctaTexts.find(t => ctaPattern.test(t)) ?? e.ctaTexts[0]
  results.push(hasCta
    ? f('cta-exists', true,
        `Call-to-action found: "${firstCta}".`,
        'Call-to-action is present',
        'Visitors have a clear next step — this directs traffic toward conversion.',
        '')
    : f('cta-exists', false,
        e.ctaTexts.length > 0
          ? `Buttons found ("${e.ctaTexts.slice(0, 2).join('", "')}") but none use clear action language.`
          : 'No call-to-action buttons or links with action language detected.',
        'No clear call-to-action',
        '**Without a CTA visitors have no direction** — they arrive, scroll, and leave without converting.',
        'Add a prominent button above the fold: "Get started free", "Book a call", or "Try it now".')
  )

  // ── social-presence ──────────────────────────────────────────────────────────
  const socialCount = Object.keys(e.socialLinks).length
  const socialPlatforms = Object.keys(e.socialLinks).join(', ')
  results.push(socialCount >= 2
    ? f('social-presence', true,
        `${socialCount} social media profile${socialCount > 1 ? 's' : ''} linked: ${socialPlatforms}.`,
        `${socialCount} social profiles linked`,
        'Social proof and discoverability are in place across multiple platforms.',
        '')
    : socialCount === 1
      ? f('social-presence', false,
          `Only 1 social profile linked (${socialPlatforms}) — at least 2 are recommended.`,
          'Only 1 social profile linked',
          'A single social link limits discoverability — presence on 2+ platforms is the baseline.',
          'Add your second most relevant social profile link to your site footer.')
      : f('social-presence', false,
          'No social media profile links detected on the site.',
          'No social profiles linked',
          '**No social presence means no discoverability** beyond search — social profiles build trust and expand reach.',
          'Create profiles on 2–3 relevant platforms and add icon links to your website footer.')
  )

  // ── favicon-present ──────────────────────────────────────────────────────────
  results.push(data.jinaFallback
    ? f('favicon-present', true,
        'Could not read HTML head — site blocks automated scanning. Assumed present; verify manually.',
        'Cannot verify — check manually',
        'Open your page source and confirm <link rel="icon"> exists in the <head>.',
        'View source (Ctrl+U) and search for "favicon" to confirm.')
    : e.favicon
      ? f('favicon-present', true,
          `Favicon found: "${e.favicon}".`,
          'Favicon is set',
          'The site has a professional browser tab icon.',
          '')
      : f('favicon-present', false,
          'No favicon tag found — the browser tab shows a blank icon.',
          'No favicon set',
          '**A missing favicon makes the site look unfinished** — small details like this affect first impressions.',
          'Create a favicon at favicon.io and add <link rel="icon" href="/favicon.ico"> to your HTML <head>.')
  )

  // ── business-name-clear ──────────────────────────────────────────────────────
  const titleIsGeneric = !e.title || GENERIC_TITLES.some(g => e.title.toLowerCase().trim() === g)
  const nameInTitle = !titleIsGeneric
  const nameInH1 = !!e.h1 && e.h1.length > 2
  const businessNameClear = nameInTitle || nameInH1
  results.push(businessNameClear
    ? f('business-name-clear', true,
        nameInTitle ? `Business name visible in page title: "${e.title}".` : `Business name visible in H1: "${e.h1}".`,
        'Business name is visible',
        'Visitors and search engines can identify the brand from the page.',
        '')
    : f('business-name-clear', false,
        'Business name could not be identified from the title or H1 heading.',
        'Business name not clearly visible',
        '**If visitors cannot identify your brand in seconds they leave** — brand visibility is the first step in trust.',
        'Set a meaningful title and H1 that includes your business name, e.g. "BrandName – What You Do".')
  )

  // ── page-title-set ───────────────────────────────────────────────────────────
  const titleIsSet = !!e.title && !GENERIC_TITLES.some(g => e.title.toLowerCase().trim() === g)
  results.push(titleIsSet
    ? f('page-title-set', true,
        `Page title is set: "${e.title.slice(0, 70)}${e.title.length > 70 ? '…' : ''}".`,
        'Page title is set',
        'Search engines and browser tabs show a meaningful title for this site.',
        '')
    : f('page-title-set', false,
        e.title
          ? `Page title is a generic default: "${e.title}".`
          : 'No page title tag found.',
        e.title ? 'Page title is a generic default' : 'No page title set',
        '**The page title is the first thing Google and visitors see** in search results — a generic title wastes this.',
        'Set a descriptive title: "Brand Name – Short Value Proposition" (50–60 characters).')
  )

  // These two require AI judgment — returned separately
  const aiSlugs = ['no-placeholder', 'value-prop-exists']

  return { results, aiSlugs }
}
