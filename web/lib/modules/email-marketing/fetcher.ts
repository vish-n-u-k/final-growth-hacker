import * as cheerio from 'cheerio'
import { promises as dnsPromises } from 'dns'

export interface EmailMarketingFetchResult {
  url: string
  domain: string
  isCustomDomain: boolean
  html: string
  bodyText: string
  forms: { action: string; inputs: string[]; visibleText: string; fieldCount: number }[]
  ctaTexts: string[]
  socialProofElements: string[]
  privacyPolicyUrl: string | null
  contactPageUrl: string | null
  hasContactEmail: boolean
  consentCheckboxes: { defaultChecked: boolean; label: string }[]
  emailPlatformSignals: string[]
  dns: {
    spf: { found: boolean; value: string | null }
    dkim: { found: boolean; selector: string | null }
    dmarc: { found: boolean; value: string | null }
    mx: { found: boolean; records: string[] }
  }
  requirements: Record<string, string>
}

const EMAIL_PLATFORMS: [RegExp, string][] = [
  [/mailchimp\.com|mc\.us|list-manage\.com|campaign-archive\.com/i, 'Mailchimp'],
  [/klaviyo\.com/i, 'Klaviyo'],
  [/hs-scripts\.com|hubspot\.com/i, 'HubSpot'],
  [/convertkit\.com/i, 'ConvertKit'],
  [/activecampaign\.com/i, 'ActiveCampaign'],
  [/sendinblue\.com|brevo\.com/i, 'Brevo'],
  [/drip\.com/i, 'Drip'],
  [/omnisend\.com/i, 'Omnisend'],
  [/aweber\.com/i, 'AWeber'],
  [/constantcontact\.com/i, 'Constant Contact'],
  [/moosend\.com/i, 'Moosend'],
  [/mailerlite\.com/i, 'MailerLite'],
  [/sendgrid\.com/i, 'SendGrid'],
  [/emailoctopus\.com/i, 'EmailOctopus'],
  [/getresponse\.com/i, 'GetResponse'],
]

const FREE_HOSTING_DOMAINS = [
  'wordpress.com', 'wix.com', 'weebly.com', 'squarespace.com',
  'webflow.io', 'netlify.app', 'vercel.app', 'github.io',
  'typeform.com', 'webnode.com', 'site123.com', 'godaddysites.com',
]

async function checkSpf(domain: string): Promise<{ found: boolean; value: string | null }> {
  try {
    const records = await dnsPromises.resolveTxt(domain)
    for (const record of records) {
      const joined = record.join('')
      if (joined.toLowerCase().startsWith('v=spf1')) {
        return { found: true, value: joined }
      }
    }
    return { found: false, value: null }
  } catch {
    return { found: false, value: null }
  }
}

async function checkDkim(domain: string): Promise<{ found: boolean; selector: string | null }> {
  const selectors = [
    'google', 'mailchimp', 'default', 'k1', 'k2',
    'selector1', 'selector2', 's1', 's2',
    'mail', 'email', 'dkim', 'key1', 'smtp', 'mandrill',
  ]
  for (const selector of selectors) {
    try {
      const records = await dnsPromises.resolveTxt(`${selector}._domainkey.${domain}`)
      const allText = records.flat().join('').toLowerCase()
      if (allText.includes('v=dkim1') || allText.includes('k=rsa') || allText.includes('p=')) {
        return { found: true, selector }
      }
    } catch {
      // selector not found — try next
    }
  }
  return { found: false, selector: null }
}

async function checkDmarc(domain: string): Promise<{ found: boolean; value: string | null }> {
  try {
    const records = await dnsPromises.resolveTxt(`_dmarc.${domain}`)
    for (const record of records) {
      const joined = record.join('')
      if (joined.toLowerCase().startsWith('v=dmarc1')) {
        return { found: true, value: joined }
      }
    }
    return { found: false, value: null }
  } catch {
    return { found: false, value: null }
  }
}

async function checkMx(domain: string): Promise<{ found: boolean; records: string[] }> {
  try {
    const records = await dnsPromises.resolveMx(domain)
    if (records.length > 0) {
      return { found: true, records: records.map(r => r.exchange) }
    }
    return { found: false, records: [] }
  } catch {
    return { found: false, records: [] }
  }
}

export async function fetchEmailMarketingData(
  requirements: Record<string, string>,
): Promise<EmailMarketingFetchResult> {
  const rawUrl = requirements['website_url'] ?? ''
  const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`

  let domain = ''
  let isCustomDomain = true
  try {
    domain = new URL(url).hostname.replace(/^www\./, '')
    isCustomDomain = !FREE_HOSTING_DOMAINS.some(h => domain.endsWith(h))
  } catch {
    domain = rawUrl.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0] ?? ''
  }

  // Fetch homepage HTML
  let html = ''
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrowJinBot/1.0)' },
      signal: AbortSignal.timeout(15000),
    })
    if (res.ok) html = await res.text()
  } catch {
    html = ''
  }

  const $ = cheerio.load(html)

  // Parse forms with email inputs
  const forms: EmailMarketingFetchResult['forms'] = []
  $('form').each((_, el) => {
    const inputs: string[] = []
    $(el).find('input').each((_, inp) => {
      const type = $(inp).attr('type') ?? 'text'
      const name = $(inp).attr('name') ?? ''
      const placeholder = $(inp).attr('placeholder') ?? ''
      inputs.push(`${type}:${name || placeholder}`)
    })
    const hasEmail = inputs.some(i => /email/i.test(i))
    if (hasEmail || inputs.length > 0) {
      forms.push({
        action: $(el).attr('action') ?? '',
        inputs,
        visibleText: $(el).text().replace(/\s+/g, ' ').trim().slice(0, 200),
        fieldCount: inputs.filter(i => !i.startsWith('hidden') && !i.startsWith('submit')).length,
      })
    }
  })

  // Extract CTA texts related to email/subscribe
  const ctaTexts: string[] = []
  const ctaPattern = /\b(subscribe|sign.?up|join|get started|download|get free|free trial|get access|notify me|opt.?in|register|newsletter|email list|stay updated|get updates|book|enroll|stay in touch|get the guide|free guide)\b/i
  $('button, a, [role="button"], input[type="submit"], input[type="button"]').each((_, el) => {
    const text = ($(el).text().trim() || $(el).attr('value') || '').trim()
    if (text && ctaPattern.test(text)) {
      ctaTexts.push(text.slice(0, 100))
    }
  })

  // Detect social proof elements
  const socialProofElements: string[] = []
  $('[class*="testimonial"], [class*="review"], [class*="trust"], [class*="social-proof"], [class*="logo-"]').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim().slice(0, 100)
    if (text) socialProofElements.push(text)
  })
  const subscriberMatches = html.match(/(\d[\d,.]+\+?\s*(?:subscribers?|readers?|customers?|members?|users?|people))/gi) ?? []
  socialProofElements.push(...subscriberMatches.slice(0, 3))

  // Detect privacy policy link
  let privacyPolicyUrl: string | null = null
  $('a').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    const text = $(el).text().trim()
    if (/privacy/i.test(text) || /privacy/i.test(href)) {
      privacyPolicyUrl = href || null
    }
  })

  // Detect contact page / email address
  let contactPageUrl: string | null = null
  const hasContactEmail = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/.test(html.slice(0, 50000))
  $('a').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    const text = $(el).text().trim()
    if (/contact|support|help/i.test(text) || /\/contact|\/support/i.test(href)) {
      contactPageUrl = href || null
    }
  })

  // Detect consent checkboxes near email inputs
  const consentCheckboxes: { defaultChecked: boolean; label: string }[] = []
  $('input[type="checkbox"]').each((_, el) => {
    const id = $(el).attr('id') ?? ''
    const labelText = id
      ? $(`label[for="${id}"]`).text().trim()
      : $(el).closest('label').text().trim()
    if (/email|subscribe|newsletter|marketing|consent|agree|opt.?in/i.test(labelText)) {
      consentCheckboxes.push({
        defaultChecked: $(el).attr('checked') !== undefined,
        label: labelText.slice(0, 200),
      })
    }
  })

  // Detect email platform scripts
  const emailPlatformSignals: string[] = []
  const detected = new Set<string>()
  for (const [pattern, name] of EMAIL_PLATFORMS) {
    if (pattern.test(html) && !detected.has(name)) {
      detected.add(name)
      emailPlatformSignals.push(name)
    }
  }
  // Also surface user-supplied platform if not already detected
  const userPlatform = requirements['email_platform']
  if (userPlatform && !detected.has(userPlatform)) {
    emailPlatformSignals.push(userPlatform)
  }

  // Extract body text (strip nav/scripts/styles first)
  $('script, style, nav, header').remove()
  const bodyText = ($('main, article, [role="main"], body').first().text() ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 3000)

  // Run DNS checks in parallel
  const [spf, dkim, dmarc, mx] = await Promise.all([
    checkSpf(domain),
    checkDkim(domain),
    checkDmarc(domain),
    checkMx(domain),
  ])

  return {
    url,
    domain,
    isCustomDomain,
    html: html.slice(0, 30000),
    bodyText,
    forms,
    ctaTexts,
    socialProofElements,
    privacyPolicyUrl,
    contactPageUrl,
    hasContactEmail,
    consentCheckboxes,
    emailPlatformSignals,
    dns: { spf, dkim, dmarc, mx },
    requirements,
  }
}
