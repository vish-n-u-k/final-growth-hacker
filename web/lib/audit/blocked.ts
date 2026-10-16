// Firewalls and bot protection (Cloudflare, Vercel, Akamai, Sucuri, Imperva…) often answer
// requests from cloud servers, like GrowJin's checker, with a challenge or "access denied" page
// instead of the site. Reading that page as if it were the site gives false results (e.g. "your
// page is empty without JavaScript"), so the audits detect it and mark those checks Not checked.

export interface BlockInfo {
  by: string        // who blocked us: "Cloudflare", "Vercel", or "the site's firewall"
  status: number
  title: string     // the title of the page we got instead, e.g. "Just a moment..."
}

const TITLE_MARKERS: [RegExp, string][] = [
  [/^just a moment/i, 'Cloudflare'],
  [/^attention required/i, 'Cloudflare'],
  [/verifying you are human|checking your browser|please wait while we verify/i, 'the site\'s firewall'],
  [/vercel security checkpoint/i, 'Vercel'],
  [/^access denied$/i, 'the site\'s firewall'],
  [/ddos-guard/i, 'DDoS-Guard'],
  [/sucuri website firewall/i, 'Sucuri'],
  [/^(request rejected|forbidden|403 forbidden|blocked)$/i, 'the site\'s firewall'],
]

const BODY_MARKERS: [RegExp, string][] = [
  [/\/cdn-cgi\/challenge-platform|window\._cf_chl_opt|cf-browser-verification|cf_chl_/i, 'Cloudflare'],
  [/vercel-challenge|_vercel\/security|x-vercel-challenge/i, 'Vercel'],
  [/incapsula incident id|_incapsula_resource/i, 'Imperva'],
  [/access denied[\s\S]{0,200}reference #[0-9a-f.]+/i, 'Akamai'],
  [/sucuri website firewall/i, 'Sucuri'],
]

type HeaderBag = Headers | Record<string, string | undefined>
const header = (h: HeaderBag, name: string) =>
  (typeof (h as Headers).get === 'function' ? (h as Headers).get(name) : (h as Record<string, string | undefined>)[name.toLowerCase()]) ?? ''

/** The firewall that answered instead of the site, or null when we got the site. */
export function detectBlock(status: number, headers: HeaderBag, html: string): BlockInfo | null {
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
  const server = header(headers, 'server').toLowerCase()

  if (/challenge/i.test(header(headers, 'cf-mitigated'))) return { by: 'Cloudflare', status, title }
  if (/challenge|deny/i.test(header(headers, 'x-vercel-mitigated'))) return { by: 'Vercel', status, title }

  const byTitle = TITLE_MARKERS.find(([re]) => re.test(title))
  // Challenge pages are small; a big real page that merely mentions these words isn't one
  const smallish = html.length < 60_000
  const byBody = smallish ? BODY_MARKERS.find(([re]) => re.test(html)) : undefined
  if (byTitle || byBody) {
    const by = byBody?.[1] ?? (byTitle![1] === 'the site\'s firewall' && server.includes('cloudflare') ? 'Cloudflare' : byTitle![1])
    return { by, status, title }
  }

  // An error status with a small page: the server refused us (rate limit, IP block, WAF rule)
  if ([401, 403, 406, 429, 451, 503].includes(status) && html.length < 30_000) {
    return { by: server.includes('cloudflare') ? 'Cloudflare' : server.includes('vercel') ? 'Vercel' : 'the site\'s firewall', status, title }
  }
  return null
}

/** "Couldn't check…" text for a check that needed the page (shown as Not checked, left out of the score). */
export function blockedSkipText(b: BlockInfo): string {
  return `Couldn't check: ${b.by} blocked GrowJin's checker and showed a ${b.title ? `"${b.title}" ` : ''}page (status ${b.status}) instead of your site. `
    + `Allow GrowJin in your firewall (e.g. Cloudflare → Security → Bots / WAF), then re-analyse. Real visitors usually aren't affected, but other bots and AI crawlers may be.`
}

/**
 * For quick status checks where we don't read the page (HEAD requests, page sampling): a firewall
 * turning us away, which says nothing about whether the page itself works.
 */
export function isFirewallRefusal(status: number, headers: HeaderBag): boolean {
  if (/challenge/i.test(header(headers, 'cf-mitigated')) || /challenge|deny/i.test(header(headers, 'x-vercel-mitigated'))) return true
  const server = header(headers, 'server').toLowerCase()
  return [403, 429].includes(status) && /cloudflare|vercel|akamai|sucuri|incapsula|ddos-guard/.test(server)
}
