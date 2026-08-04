import type { ModuleAnalysisResult } from '../types'
import type { EmailMarketingFetchResult } from './fetcher'

function re(
  slug: string,
  verified: boolean,
  detail: string,
  highlight: string,
  narrative: string,
  action: string,
): ModuleAnalysisResult {
  return { slug, verified, detail, highlight, narrative, action }
}

export function runEmailRuleEngine(data: EmailMarketingFetchResult): {
  ruleResults: ModuleAnalysisResult[]
  aiSlugs: string[]
} {
  const ruleResults: ModuleAnalysisResult[] = []

  // ── dv-spf ──────────────────────────────────────────────────────────────────
  ruleResults.push(data.dns.spf.found
    ? re('dv-spf', true,
        `SPF record found: ${data.dns.spf.value?.slice(0, 60) ?? 'v=spf1 ...'}.`,
        'SPF record is configured',
        'Receiving mail servers can verify your domain — **reducing spam classification**.',
        '')
    : re('dv-spf', false,
        'No SPF record found in DNS TXT records.',
        'SPF record is missing',
        '**Without SPF, emails from your domain will land in spam** — it is the baseline auth record.',
        `Add a TXT record at ${data.domain}: "v=spf1 include:_spf.youremailprovider.com ~all"`)
  )

  // ── dv-dkim ─────────────────────────────────────────────────────────────────
  ruleResults.push(data.dns.dkim.found
    ? re('dv-dkim', true,
        `DKIM record found on selector "${data.dns.dkim.selector}".`,
        'DKIM signing is configured',
        'Emails are cryptographically signed — **preventing spoofing and improving deliverability**.',
        '')
    : re('dv-dkim', false,
        'No DKIM record found on common selectors.',
        'DKIM record is missing',
        '**Without DKIM, emails are unsigned** — Gmail and Outlook treat unsigned emails as suspicious.',
        'Enable DKIM in your email platform dashboard and add the provided TXT records to your DNS.')
  )

  // ── dv-dmarc ────────────────────────────────────────────────────────────────
  ruleResults.push(data.dns.dmarc.found
    ? re('dv-dmarc', true,
        `DMARC record found: ${data.dns.dmarc.value?.slice(0, 60) ?? 'v=DMARC1 ...'}.`,
        'DMARC policy is active',
        'Domain is protected from spoofing — **complies with Gmail/Yahoo bulk sender requirements**.',
        '')
    : re('dv-dmarc', false,
        'No DMARC record found in DNS.',
        'DMARC record is missing',
        '**Google and Yahoo now require DMARC** for bulk senders — missing it causes delivery failures.',
        `Add TXT record at _dmarc.${data.domain}: "v=DMARC1; p=none; rua=mailto:dmarc@${data.domain}"`)
  )

  // ── dv-mx ───────────────────────────────────────────────────────────────────
  ruleResults.push(data.dns.mx.found
    ? re('dv-mx', true,
        `${data.dns.mx.records.length} MX record${data.dns.mx.records.length > 1 ? 's' : ''} found: ${data.dns.mx.records.slice(0, 2).join(', ')}.`,
        'MX records are present',
        'Domain is configured to receive email — **signals a legitimate business to ISPs**.',
        '')
    : re('dv-mx', false,
        'No MX records found for this domain.',
        'No MX records configured',
        '**A domain without MX records cannot receive email** — signals an inactive or unverified domain.',
        'Set up MX records via your domain registrar pointing to your email provider\'s mail servers.')
  )

  // ── dv-custom-domain ────────────────────────────────────────────────────────
  ruleResults.push(data.isCustomDomain
    ? re('dv-custom-domain', true,
        `Custom branded domain in use: ${data.domain}.`,
        'Professional domain is used',
        'A branded domain **builds sender reputation and trust** with subscribers and ISPs.',
        '')
    : re('dv-custom-domain', false,
        `Site appears to be on a free hosting domain: ${data.domain}.`,
        'Free hosting domain detected',
        '**Sending email from a free subdomain is a major spam signal** — ISPs and users distrust it.',
        'Register a custom domain (~$12/year) and use it for both your website and email sending.')
  )

  // ── ct-privacy-policy ───────────────────────────────────────────────────────
  const hasPrivacy = !!(data.privacyPolicyUrl || /privacy\s*policy/i.test(data.bodyText))
  ruleResults.push(hasPrivacy
    ? re('ct-privacy-policy', true,
        data.privacyPolicyUrl
          ? `Privacy policy link found: ${data.privacyPolicyUrl}.`
          : 'Privacy policy reference found in page content.',
        'Privacy policy is present',
        'Legal compliance is in place — **required for email collection in GDPR/CAN-SPAM jurisdictions**.',
        '')
    : re('ct-privacy-policy', false,
        'No privacy policy page or link found on the site.',
        'No privacy policy found',
        '**A privacy policy is legally required** for email collection under GDPR and CAN-SPAM.',
        'Generate a free policy at termly.io and link it in your footer and near all opt-in forms.')
  )

  // ── ct-contact-info ─────────────────────────────────────────────────────────
  const hasContact = !!(data.contactPageUrl || data.hasContactEmail)
  ruleResults.push(hasContact
    ? re('ct-contact-info', true,
        data.contactPageUrl
          ? `Contact page link found: ${data.contactPageUrl}.`
          : 'Business email address found on the page.',
        'Contact information is visible',
        'Subscribers can reach the business — **CAN-SPAM requires a contact address in all emails**.',
        '')
    : re('ct-contact-info', false,
        'No contact page link or email address found on the site.',
        'No contact information found',
        '**CAN-SPAM and GDPR require identifiable sender contact info** in all commercial emails.',
        'Add a contact email or link to a contact page in your site footer and email templates.')
  )

  // ── aw-platform-detected ────────────────────────────────────────────────────
  const hasPlatform = data.emailPlatformSignals.length > 0
  ruleResults.push(hasPlatform
    ? re('aw-platform-detected', true,
        `Email platform detected: ${data.emailPlatformSignals.join(', ')}.`,
        `${data.emailPlatformSignals[0]} is in use`,
        'A dedicated platform enables **automation, segmentation, and deliverability management**.',
        '')
    : re('aw-platform-detected', false,
        'No email marketing platform scripts detected in site HTML.',
        'No email platform detected',
        '**Without a dedicated platform, automation and segmentation are impossible** at scale.',
        'Add Mailchimp, Klaviyo, or ConvertKit — all offer free tiers for under 1,000 subscribers.')
  )

  // ── AI handles all remaining items ──────────────────────────────────────────
  const aiSlugs = [
    'lc-form-present', 'lc-above-fold-cta', 'lc-lead-magnet', 'lc-value-proposition',
    'lc-form-minimal', 'lc-multiple-touchpoints',
    'ct-gdpr-signal', 'ct-consent-explicit', 'ct-unsubscribe-mention',
    'ce-email-copy-quality', 'ce-personalization', 'ce-clear-cta-emails',
    'ce-mobile-ready', 'ce-subject-line-strategy', 'ce-content-variety',
    'aw-welcome-series', 'aw-nurture-sequence', 'aw-trigger-emails', 'aw-re-engagement',
    'co-social-proof', 'co-email-cta-landing', 'co-signup-friction-low',
    'co-ab-testing-signals', 'co-post-signup-path',
    'cr-post-purchase', 'cr-review-request', 'cr-loyalty-signals',
  ]

  return { ruleResults, aiSlugs }
}
