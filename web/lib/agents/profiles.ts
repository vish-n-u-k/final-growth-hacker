// Seller pages on a marketplace or social network: an Etsy shop, an Instagram account, a Facebook
// page, a TikTok, an eBay or Amazon store, a YouTube channel, a Substack, a Medium or Pinterest page.
// Many small sellers have no website of their own, only one of these, and no public email, so the
// Lead Agent keeps them as "seller page" leads with a short message the user sends there by hand.
// Pure functions, so the pages can use them too.

export interface Profile {
  platform: string   // "Etsy", "Instagram"…
  handle: string     // the shop or account name, as in the link
  key: string        // host + path, no protocol: the lead's id and link ("etsy.com/shop/candleco")
}

// Paths on these sites that are never one seller's page
const NOT_A_HANDLE = /^(p|reel|reels|explore|accounts|stories|tv|direct|about|legal|help|privacy|terms|login|signup|share|sharer|sharer\.php|groups|events|watch|marketplace|hashtag|search|pages|people|photo|photos|video|videos|tag|discover|music|live|trending|feed|results|playlist|shorts|pin|ideas|today|business|settings|home|i|intent|messages)$/i

// Each rule finds the page's own path in a link ("/shop/CandleCo" in ".../uk/shop/CandleCo?ref=x"); the
// handle is the last part of it
const RULES: { platform: string; host: RegExp; path: (path: string, host: string) => string | null }[] = [
  { platform: 'Etsy', host: /(^|\.)etsy\.com$/, path: p => p.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(shop\/[A-Za-z0-9_-]+)/)?.[1] ?? null },
  { platform: 'Instagram', host: /(^|\.)instagram\.com$/, path: p => p.match(/^\/([A-Za-z0-9_.]+)\/?$/)?.[1] ?? null },
  { platform: 'Facebook', host: /(^|\.)facebook\.com$/, path: p => p.match(/^\/([A-Za-z0-9.-]{3,})\/?$/)?.[1] ?? null },
  { platform: 'TikTok', host: /(^|\.)tiktok\.com$/, path: p => p.match(/^\/(@[A-Za-z0-9_.]+)/)?.[1] ?? null },
  { platform: 'eBay', host: /(^|\.)ebay\.[a-z.]+$/, path: p => p.match(/^\/((?:str|usr)\/[A-Za-z0-9_.-]+)/)?.[1] ?? null },
  { platform: 'Amazon', host: /(^|\.)amazon\.[a-z.]+$/, path: p => p.match(/^\/(stores\/[A-Za-z0-9_-]+)/)?.[1] ?? null },
  { platform: 'YouTube', host: /(^|\.)youtube\.com$/, path: p => p.match(/^\/(@[A-Za-z0-9_.-]+|c\/[A-Za-z0-9_.-]+)\/?$/)?.[1] ?? null },
  { platform: 'Substack', host: /^[a-z0-9-]+\.substack\.com$/, path: () => '' },
  { platform: 'Medium', host: /(^|\.)medium\.com$/, path: p => p.match(/^\/(@[A-Za-z0-9_.-]+)\/?$/)?.[1] ?? null },
  { platform: 'Pinterest', host: /(^|\.)pinterest\.[a-z.]+$/, path: p => p.match(/^\/([A-Za-z0-9_]{3,})\/?$/)?.[1] ?? null },
]

/** The seller page a link points to, or null when it's a post, a listing or not one of these sites. */
export function profileOf(url: string): Profile | null {
  let u: URL
  try { u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`) } catch { return null }
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '')
  for (const r of RULES) {
    if (!r.host.test(host)) continue
    const path = r.path(u.pathname, host)
    if (path === null) return null
    const handle = r.platform === 'Substack' ? host.split('.')[0] : path.split('/').pop()!.replace(/^@/, '')
    if (!handle || NOT_A_HANDLE.test(handle)) return null
    return { platform: r.platform, handle, key: path ? `${host}/${path}` : host }
  }
  return null
}

/** Which platform a seller-page lead is on, from its link ("Etsy"), or "their page". */
export const platformOf = (url: string) => profileOf(url)?.platform ?? 'their page'

/** Short glyph for a seller page's avatar. */
export const PLATFORM_GLYPH: Record<string, string> = { Etsy: 'Et', Instagram: 'IG', Facebook: 'f', TikTok: 'Tk', eBay: 'eB', Amazon: 'a', YouTube: 'YT', Substack: 'S', Medium: 'M', Pinterest: 'P' }
