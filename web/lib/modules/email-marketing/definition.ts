import type { ModuleDefinition } from '../types'

export const EMAIL_MARKETING_MODULE: ModuleDefinition = {
  type: 'email-marketing',
  name: 'Email Marketing',
  tagline: 'build and optimise your email engine',
  description: 'Turns visitors into subscribers and subscribers into customers.',
  order: 15,
  unlockThreshold: 0,
  dynamic: false,
  requirements: [
    {
      key: 'website_url',
      label: 'Your website URL',
      type: 'url',
      placeholder: 'yourdomain.com',
      required: true,
    },
    {
      key: 'email_platform',
      label: 'Email marketing platform (optional)',
      type: 'text',
      placeholder: 'e.g. Mailchimp, Klaviyo, ConvertKit',
      required: false,
    },
    {
      key: 'business_type',
      label: 'Business type (optional)',
      type: 'text',
      placeholder: 'e.g. SaaS, Ecommerce, Agency, Local',
      required: false,
    },
  ],
  systemPrompt: `You are a senior email marketing consultant auditing a business website for email marketing readiness.

Your job is to evaluate whether the website has the signals needed for effective email marketing: lead capture, compliance, content strategy, automation, conversion optimisation, and customer retention.

Rules:
- Evaluate each item based solely on the website data provided — never invent signals not present.
- verified: true = the signal is clearly present and working. verified: false = missing, weak, or unclear.
- d = one-sentence plain-English finding (what you found or did not find). Under 15 words.
- h = 5–8 word key phrase summarising the finding.
- n = why it matters for email marketing success. **Bold** the single biggest risk or benefit. Under 20 words.
- a = concrete next step. Verb-first. Specific to this business. Under 25 words.
- Write for a business owner, not a developer. No jargon without explanation.
- Return ONLY a JSON array — no markdown fences, no text outside the array.`,
  categories: [
    // ── 1. Lead Capture ───────────────────────────────────────────────────────
    {
      slug: 'lead-capture',
      label: 'Lead Capture',
      order: 1,
      subCategories: [
        {
          slug: 'lc-signup-forms',
          label: 'Sign-up Forms & CTAs',
          order: 1,
          description: 'The entry points that turn website visitors into email subscribers — forms, CTAs, lead magnets, and sign-up friction.',
          items: [
            {
              slug: 'lc-form-present',
              label: 'Email opt-in form present',
              prompt: 'Evaluate if an email opt-in form is present on the site. Look for form elements with email input fields, newsletter sections, subscribe widgets. d: state whether found and describe where. n: why capturing emails directly is the foundation of email growth. a: where to add a form if none is found.',
              order: 1,
              weight: 3,
            },
            {
              slug: 'lc-above-fold-cta',
              label: 'CTA visible above the fold',
              prompt: 'Evaluate if a subscribe or sign-up CTA is visible without scrolling (above the fold). Check hero sections, sticky nav CTAs, top banners. d: state whether found and describe it specifically. n: why above-fold CTAs dramatically increase capture rate. a: the exact placement to add one if missing.',
              order: 2,
              weight: 2,
            },
            {
              slug: 'lc-lead-magnet',
              label: 'Lead magnet / incentive offered',
              prompt: 'Evaluate if there is a clear incentive to subscribe: free guide, discount, checklist, free trial, exclusive content, early access, or similar. d: describe the incentive found or note it is absent. n: why a compelling incentive increases opt-in rates 3–5×. a: suggest a specific lead magnet type that fits this business.',
              order: 3,
              weight: 2,
            },
            {
              slug: 'lc-value-proposition',
              label: 'Clear value proposition on sign-up',
              prompt: 'Evaluate if the sign-up form or section clearly communicates WHAT the subscriber gets and WHY it matters. d: quote or describe the value prop found, or note it is vague/missing. n: why a clear value prop is the single biggest driver of form conversions. a: write a stronger value prop based on the site if the current one is weak.',
              order: 4,
              weight: 2,
            },
            {
              slug: 'lc-form-minimal',
              label: 'Form fields minimal (≤3 fields)',
              prompt: 'Evaluate if opt-in forms ask for 3 or fewer visible fields (excluding hidden fields). Fewer fields = higher conversion. d: state how many fields the main form shows. n: why each extra field reduces completions. a: which specific fields to remove if too many are shown.',
              order: 5,
              weight: 1,
            },
            {
              slug: 'lc-multiple-touchpoints',
              label: 'Multiple sign-up entry points',
              prompt: 'Evaluate if there are multiple places to subscribe across the site: header, footer, pop-up, inline blog, dedicated landing page, exit-intent. d: list the touchpoints found. n: why multiple touchpoints capture more subscribers without increasing ad spend. a: the highest-value touchpoint to add next if only one exists.',
              order: 6,
              weight: 1,
            },
          ],
        },
      ],
    },

    // ── 2. Deliverability ─────────────────────────────────────────────────────
    {
      slug: 'deliverability',
      label: 'Deliverability',
      order: 2,
      subCategories: [
        {
          slug: 'dv-dns-auth',
          label: 'DNS Authentication',
          order: 1,
          description: 'Email authentication records prevent your emails from landing in spam. Checked automatically via live DNS lookup.',
          items: [
            {
              slug: 'dv-spf',
              label: 'SPF record configured',
              prompt: 'The pre-computed DNS finding shows whether an SPF record exists for this domain. d: state whether found and quote the key portion of the value. n: **bold** why missing SPF causes emails to land in spam. a: exact DNS TXT record format to add if missing.',
              order: 1,
              weight: 3,
            },
            {
              slug: 'dv-dkim',
              label: 'DKIM record configured',
              prompt: 'The pre-computed DNS finding shows whether a DKIM record was detected on common selectors. d: state whether found and which selector matched. n: **bold** why DKIM signing prevents spoofing and improves inbox placement. a: how to enable DKIM in common email platforms if missing.',
              order: 2,
              weight: 3,
            },
            {
              slug: 'dv-dmarc',
              label: 'DMARC record configured',
              prompt: 'The pre-computed DNS finding shows whether a DMARC record exists. d: state whether found and describe the policy level (none/quarantine/reject). n: **bold** why DMARC is now required by Gmail and Yahoo for bulk senders. a: minimum DMARC TXT record to add as a starting point if missing.',
              order: 3,
              weight: 2,
            },
            {
              slug: 'dv-mx',
              label: 'MX records present',
              prompt: 'The pre-computed DNS finding shows whether MX records exist for this domain. d: state whether found and how many records. n: why valid MX records signal a real, active business domain. a: where to configure MX records if missing.',
              order: 4,
              weight: 2,
            },
            {
              slug: 'dv-custom-domain',
              label: 'Professional/branded domain used',
              prompt: 'The pre-computed finding shows whether the site uses a custom domain vs a free hosting subdomain. d: confirm the domain and whether it is a custom professional domain. n: **bold** why sending from a branded domain dramatically improves deliverability and trust. a: steps to set up a custom domain for email if not using one.',
              order: 5,
              weight: 1,
            },
          ],
        },
      ],
    },

    // ── 3. Compliance & Trust ─────────────────────────────────────────────────
    {
      slug: 'compliance-trust',
      label: 'Compliance & Trust',
      order: 3,
      subCategories: [
        {
          slug: 'ct-legal-signals',
          label: 'Legal Compliance Signals',
          order: 1,
          description: 'Email marketing is regulated by GDPR (Europe), CAN-SPAM (US), and CASL (Canada). These signals confirm the business is operating legally.',
          items: [
            {
              slug: 'ct-privacy-policy',
              label: 'Privacy policy page present',
              prompt: 'The pre-computed finding shows whether a privacy policy link was found. d: state whether found and where it links. n: **bold** why a privacy policy is legally required for email collection in GDPR and CAN-SPAM jurisdictions. a: where to create and link a free privacy policy if missing.',
              order: 1,
              weight: 3,
            },
            {
              slug: 'ct-contact-info',
              label: 'Contact information visible',
              prompt: 'The pre-computed finding shows whether a contact page or email address was found. d: state what was found (email address, contact page, or none). n: why visible contact info is required by CAN-SPAM and builds sender trust with ISPs. a: the easiest way to add visible contact info if missing.',
              order: 2,
              weight: 2,
            },
            {
              slug: 'ct-gdpr-signal',
              label: 'GDPR/CAN-SPAM compliance signals',
              prompt: 'Look for visible GDPR or CAN-SPAM compliance signals: cookie consent banner, privacy preference centre, "we respect your privacy" language near opt-in forms, data handling explanation. d: describe the compliance signals found or note their absence. n: why visible compliance signals reduce unsubscribes and build list quality. a: the most impactful compliance signal to add first.',
              order: 3,
              weight: 2,
            },
            {
              slug: 'ct-consent-explicit',
              label: 'Consent not pre-checked',
              prompt: 'Evaluate if consent is explicitly given (not assumed). Look for unchecked opt-in checkboxes, explicit "I agree to receive emails" language, double opt-in mentions. The pre-computed finding lists any consent checkboxes detected and whether they are pre-checked. d: describe what consent mechanism was found. n: **bold** why pre-checked consent violates GDPR and can make your list legally invalid. a: how to change the form to use explicit opt-in if it is currently ambiguous.',
              order: 4,
              weight: 2,
            },
            {
              slug: 'ct-unsubscribe-mention',
              label: 'Unsubscribe process mentioned',
              prompt: 'Look for any mention of easy unsubscribe, "opt out at any time", "one-click unsubscribe", "no spam", or similar reassurance near opt-in forms or in email programme descriptions. d: state whether found and quote it. n: why prominently mentioning easy unsubscribe paradoxically increases sign-ups by reducing fear. a: add this language near the main opt-in form if absent.',
              order: 5,
              weight: 1,
            },
          ],
        },
      ],
    },

    // ── 4. Content & Engagement ───────────────────────────────────────────────
    {
      slug: 'content-engagement',
      label: 'Content & Engagement',
      order: 4,
      subCategories: [
        {
          slug: 'ce-content-strategy',
          label: 'Content & Copy Strategy',
          order: 1,
          items: [
            {
              slug: 'ce-email-copy-quality',
              label: 'Email copy quality signals on site',
              prompt: 'Evaluate the quality of website copy as a proxy for email copy: is it specific and benefit-focused, or generic and feature-heavy? Look at headlines, sub-headings, and body copy tone. d: describe the copy tone and quality found. n: why sites with strong specific copy consistently produce better-performing emails. a: the single most impactful copy change to make.',
              order: 1,
              weight: 2,
            },
            {
              slug: 'ce-personalization',
              label: 'Personalization / segmentation signals',
              prompt: 'Look for personalisation signals: multiple audience types addressed separately, "for [specific role/goal]" language, different content paths for different customers, segmented opt-in forms. d: describe what personalisation signals exist. n: why segmented emails outperform single-audience broadcasts. a: the most valuable audience segment to target first for this business.',
              order: 2,
              weight: 2,
            },
            {
              slug: 'ce-clear-cta-emails',
              label: 'Clear CTA referenced in email strategy',
              prompt: 'Evaluate the CTA quality across the site as an indicator of email CTA strategy: are CTAs action-specific, benefit-led, and prominent? Or vague ("click here", "learn more") and buried? d: describe the CTA quality observed. n: why emails with a single clear CTA generate significantly higher click-through rates. a: the strongest CTA pattern for this business to apply in emails.',
              order: 3,
              weight: 2,
            },
            {
              slug: 'ce-mobile-ready',
              label: 'Mobile-friendly email design indicated',
              prompt: 'Evaluate if the website is mobile-responsive — this is the strongest proxy for email mobile readiness. Check viewport meta tag presence, readable font sizes, touch-friendly buttons. d: state whether the site appears mobile-optimised. n: why over 60% of emails are opened on mobile — non-responsive design destroys click rates. a: the most important mobile improvement for both site and email templates.',
              order: 4,
              weight: 2,
            },
            {
              slug: 'ce-subject-line-strategy',
              label: 'Subject line / preview text strategy',
              prompt: 'Use the homepage headline quality as a proxy for subject line thinking. Look for: benefit-led headlines, curiosity gaps, personalisation, urgency, specificity. d: describe the headline quality and what it suggests about email subject line capability. n: why subject line quality is the single biggest driver of email open rates. a: write one example subject line for this business based on what you found.',
              order: 5,
              weight: 1,
            },
            {
              slug: 'ce-content-variety',
              label: 'Content variety beyond promotions',
              prompt: 'Look for content beyond product promotions: blog posts, resources, guides, case studies, tutorials, webinars, podcasts — signals that email content would have value beyond offers. d: describe the content types found. n: why a mix of value and promotional emails prevents unsubscribes and builds loyalty. a: the best content type to add to the email mix for this specific business.',
              order: 6,
              weight: 1,
            },
          ],
        },
      ],
    },

    // ── 5. Automation & Workflows ─────────────────────────────────────────────
    {
      slug: 'automation-workflows',
      label: 'Automation & Workflows',
      order: 5,
      subCategories: [
        {
          slug: 'aw-automation-signals',
          label: 'Automation & Platform Signals',
          order: 1,
          description: 'Email automation turns one-time effort into ongoing revenue — welcome sequences, nurture campaigns, and trigger-based emails work 24/7.',
          items: [
            {
              slug: 'aw-welcome-series',
              label: 'Welcome series / onboarding flow',
              prompt: 'Look for signals of a welcome or onboarding sequence: "welcome to the community" language, confirmation page content, "what happens next" copy after sign-up, onboarding flow descriptions. d: describe what was found or note its absence. n: why a welcome series is the highest-ROI automation — new subscribers are most engaged in the first 48 hours. a: the most important first email to send to new subscribers for this business.',
              order: 1,
              weight: 3,
            },
            {
              slug: 'aw-platform-detected',
              label: 'Email marketing platform detected',
              prompt: 'The pre-computed finding shows email platform scripts detected in the site HTML. Also consider the email_platform value if user-provided. d: name the platform detected or note none was found. n: why a dedicated platform versus ad-hoc sending enables automation at scale. a: recommend the best platform for this business type if none was detected.',
              order: 2,
              weight: 2,
            },
            {
              slug: 'aw-nurture-sequence',
              label: 'Nurture / drip sequence signals',
              prompt: 'Look for signals of nurture campaigns: multi-step funnels described, progressive content offers, drip email course mentions, automated follow-up language, "over the next few days" copy. d: describe the nurture signals found. n: why a drip sequence converts cold leads 3× better than a single email. a: the most important nurture sequence to build first for this business.',
              order: 3,
              weight: 2,
            },
            {
              slug: 'aw-trigger-emails',
              label: 'Trigger-based emails (behavior/action)',
              prompt: 'Look for signals of behaviour-triggered emails: cart abandonment recovery, download confirmation follow-up, inactivity reactivation, milestone emails, post-action follow-ups. d: describe any trigger email signals found. n: **bold** why trigger emails convert 5–10× better than broadcast emails. a: the single highest-value trigger email to build first for this business.',
              order: 4,
              weight: 2,
            },
            {
              slug: 'aw-re-engagement',
              label: 'Re-engagement / win-back strategy',
              prompt: 'Look for re-engagement signals: "we miss you" campaign mentions, reactivation offers, subscriber preference centre, list hygiene descriptions, win-back flow. d: describe what was found or note its absence. n: why re-engaging inactive subscribers costs a fraction of acquiring new ones. a: the most effective re-engagement offer for this specific business.',
              order: 5,
              weight: 1,
            },
          ],
        },
      ],
    },

    // ── 6. Conversion Optimization ────────────────────────────────────────────
    {
      slug: 'conversion-optimization',
      label: 'Conversion Optimization',
      order: 6,
      subCategories: [
        {
          slug: 'co-conversion-signals',
          label: 'Conversion & Landing Page Signals',
          order: 1,
          items: [
            {
              slug: 'co-social-proof',
              label: 'Social proof on landing/signup pages',
              prompt: 'Look for social proof near opt-in forms or landing pages: subscriber counts ("Join 5,000+ readers"), testimonials, star ratings, logos, press mentions. d: describe what social proof was found near opt-in elements. n: why social proof near a form can double conversion rates. a: the best social proof to add near the main opt-in for this business.',
              order: 1,
              weight: 2,
            },
            {
              slug: 'co-email-cta-landing',
              label: 'Email CTAs link to dedicated pages',
              prompt: 'Look for signs of dedicated landing pages for email offers: separate pages for lead magnets, opt-in-specific pages distinct from the homepage, "subscribe to access" gated pages. d: describe what dedicated pages were found or note their absence. n: why dedicated landing pages convert 2–3× better than homepage opt-ins. a: the first dedicated landing page to create for this business.',
              order: 2,
              weight: 2,
            },
            {
              slug: 'co-signup-friction-low',
              label: 'Low friction sign-up experience',
              prompt: 'Evaluate how easy it is to subscribe: is the form prominent, simple, and fast to complete? Look for friction signals: excessive fields, CAPTCHA, unclear confirmation, multiple steps before subscribing. d: describe the sign-up experience quality. n: **bold** why every extra step or field reduces completions. a: the single highest-friction point to remove.',
              order: 3,
              weight: 2,
            },
            {
              slug: 'co-ab-testing-signals',
              label: 'A/B testing or optimization signals',
              prompt: 'Look for signals of a testing and optimisation mindset: multiple headline variants visible, "our best-converting" or "highest open rate" language, split test references, analytics tools beyond basic traffic. d: describe what optimisation signals exist. n: why testing subject lines and CTAs compounds growth over time. a: the most impactful A/B test to run first for this business.',
              order: 4,
              weight: 1,
            },
            {
              slug: 'co-post-signup-path',
              label: 'Clear post-signup journey defined',
              prompt: 'Look for what happens after someone subscribes: confirmation page content, "check your inbox" instructions, clear next steps shown, thank-you page with further action. d: describe what the post-signup experience looks like. n: why a clear post-signup path reduces immediate unsubscribes and sets subscriber expectations. a: the most important message to add to the post-signup confirmation.',
              order: 5,
              weight: 1,
            },
          ],
        },
      ],
    },

    // ── 7. Customer Retention ─────────────────────────────────────────────────
    {
      slug: 'customer-retention',
      label: 'Customer Retention',
      order: 7,
      subCategories: [
        {
          slug: 'cr-retention-signals',
          label: 'Retention & Loyalty Signals',
          order: 1,
          items: [
            {
              slug: 'cr-post-purchase',
              label: 'Post-purchase email sequence signals',
              prompt: 'Look for signals of post-purchase email sequences: order confirmation language, shipping update mentions, "how to get the most from" content, product tips post-delivery, satisfaction check-in flows. d: describe what post-purchase email signals were found. n: why post-purchase emails have the highest open rates of any email type. a: the most valuable post-purchase email to create for this business.',
              order: 1,
              weight: 2,
            },
            {
              slug: 'cr-review-request',
              label: 'Review / feedback request flow',
              prompt: 'Look for signals of review or feedback collection: testimonial submission forms, review platform logos (Trustpilot, G2, Capterra), NPS survey mentions, "how are we doing" prompts, feedback links. d: describe what review collection signals exist. n: why automated review request emails generate the highest-ROI social proof. a: the easiest review collection email to set up for this business.',
              order: 2,
              weight: 1,
            },
            {
              slug: 'cr-loyalty-signals',
              label: 'Loyalty / retention program signals',
              prompt: 'Look for loyalty or retention signals: points or rewards program, exclusive member benefits, VIP tiers, subscription or membership language, referral programme, anniversary or milestone emails described. d: describe what loyalty signals were found. n: why retained customers spend 3× more than new ones and are the most valuable email segment. a: the first retention mechanic to add for this specific business.',
              order: 3,
              weight: 1,
            },
          ],
        },
      ],
    },
  ],
}
