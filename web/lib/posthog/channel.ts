// Where a visit came from, worked out from the first pageview's referrer and UTM tags.
// PostHog only computes $channel_type for sessions, not as an event property, so queries that
// read properties.$channel_type always got nothing ("Unknown"). This classifier needs only
// fields every posthog-js pageview carries.

const SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|baidu|yandex|ecosia|brave|search\.)/
const SOCIAL = /(^|\.)(facebook|fb|instagram|linkedin|lnkd|t\.co|twitter|x\.com|reddit|youtube|youtu\.be|tiktok|pinterest|threads|quora|medium|producthunt|news\.ycombinator)/
const AI = /(^|\.)(chatgpt|openai|perplexity|claude|gemini|copilot|you\.com|phind)/

/** example.co / app.example.co → example.co (last two labels; good enough for this purpose). */
export function rootDomain(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '')
  return h.split('.').slice(-2).join('.')
}

export function hostOfUrl(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, '') } catch { return '' }
}

export function classifyChannel(v: { referringDomain: string; utmSource: string; utmMedium: string; paidClick: boolean }, ownRoot: string, ownHost = ''): string {
  const ref = v.referringDomain.toLowerCase().replace(/^www\./, '')
  const medium = v.utmMedium.toLowerCase()
  const source = v.utmSource.toLowerCase()
  const paid = v.paidClick || /cpc|ppc|paid|ads?$|display|retarget/.test(medium)
  if (paid) return SOCIAL.test(source) || SOCIAL.test(ref) ? 'Paid social' : 'Paid search'
  if (medium === 'email' || /newsletter|mailchimp|substack/.test(source)) return 'Email'
  if (source) {
    if (SEARCH.test(source)) return 'Organic search'
    if (SOCIAL.test(source)) return 'Organic social'
    if (AI.test(source)) return 'AI assistants'
  }
  if (!ref || ref === '$direct') return 'Direct'
  // The brand's own domain: from the website (frekto.ai → app) counts as 'Your website'; another
  // subdomain (moving around inside app.frekto.ai) means they were already in the app: 'Direct'.
  if (ownRoot && rootDomain(ref) === ownRoot) return !ownHost || ref === ownHost.replace(/^www\./, '') ? 'Your website' : 'Direct'
  if (AI.test(ref)) return 'AI assistants'
  if (SEARCH.test(ref)) return 'Organic search'
  if (SOCIAL.test(ref)) return 'Organic social'
  return 'Referral'
}
