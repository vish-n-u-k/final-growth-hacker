// Last pass on every email before it goes out through Gmail: no em dashes, and UTM tags on links
// so a click from an email shows up as email traffic in analytics (PostHog / GA read utm_*).

const EM_DASH = /\s*(?:—|&mdash;|&#8212;|&#x2014;)\s*/gi

/** "Quick note — we help" -> "Quick note, we help". Runs on plain text or HTML. */
export function stripEmDashes(s: string): string {
  // A dash right before punctuation (or a tag/line end) just goes; otherwise it becomes a comma
  return s.replace(EM_DASH, (m, offset: number, all: string) => {
    const next = all[offset + m.length]
    return next === undefined || /[,.!?:;<]/.test(next) ? '' : ', '
  })
}

/** Adds utm_source / utm_medium / utm_campaign to an http(s) URL, keeping any utm_* it already has. */
export function withUtm(url: string, campaign: string): string {
  let u: URL
  try { u = new URL(url) } catch { return url }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return url
  const set = (k: string, v: string) => { if (!u.searchParams.has(k)) u.searchParams.set(k, v) }
  set('utm_source', 'growjin')
  set('utm_medium', 'email')
  set('utm_campaign', campaign)
  return u.toString()
}

/**
 * Tags every http(s) href in an HTML email with UTM params. `skip` leaves some links alone
 * (e.g. our own API endpoints like "Mark done", which aren't pages anyone lands on).
 */
export function utmLinks(html: string, campaign: string, skip?: (url: string) => boolean): string {
  return html.replace(/href=(["'])(https?:\/\/[^"']+)\1/gi, (m, q: string, raw: string) => {
    const url = raw.replace(/&amp;/g, '&')
    if (skip?.(url)) return m
    return `href=${q}${withUtm(url, campaign).replace(/&/g, '&amp;')}${q}`
  })
}

/** Our API routes (one-click actions, redirects) aren't landing pages, so they stay untagged. */
export const isApiLink = (url: string) => {
  try { return new URL(url).pathname.startsWith('/api/') } catch { return false }
}

/** Both passes, for an outgoing HTML email body. */
export function cleanEmailHtml(html: string, campaign: string): string {
  return utmLinks(stripEmDashes(html), campaign, isApiLink)
}
