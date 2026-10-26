// Free facts about a company's website, read straight from the site (no paid service):
//   - storeFacts: what an online store sells, how many products, and when it last added one, from
//     Shopify's public /products.json or WooCommerce's public Store API
//   - contactEmail: an email the business lists on its own home, contact or about page
// Used by the Lead Agent's "Companies like your customers" before any AI or Hunter cost.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const DAY = 86_400_000

async function get(url: string, accept: string, timeoutMs = 6000): Promise<Response | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' })
    return res.ok ? res : null
  } catch {
    return null
  }
}

export interface StoreFacts {
  platform: 'Shopify' | 'WooCommerce'
  products: number            // how many products were listed
  more: boolean               // the list was cut off, so there are more than `products`
  types: string[]             // what they sell, most common first (product types or categories)
  examples: string[]          // a few product names
  newestDays: number | null   // days since the newest product was added (Shopify only)
}

/** What an online store sells, how big it is and whether it's active, or null when it isn't a store we can read. */
export async function storeFacts(domain: string): Promise<StoreFacts | null> {
  return (await shopify(domain)) ?? (await woo(domain))
}

async function shopify(domain: string): Promise<StoreFacts | null> {
  const res = await get(`https://${domain}/products.json?limit=250`, 'application/json')
  if (!res || !(res.headers.get('content-type') ?? '').includes('json')) return null
  const j = await res.json().catch(() => null) as { products?: { title?: string; product_type?: string; tags?: string[] | string; published_at?: string; created_at?: string }[] } | null
  const list = j?.products
  if (!Array.isArray(list)) return null
  const newest = list.map(p => Date.parse(p.published_at ?? p.created_at ?? '')).filter(t => !Number.isNaN(t)).sort((a, b) => b - a)[0]
  return {
    platform: 'Shopify',
    products: list.length,
    more: list.length >= 250,
    types: mostCommon(list.map(p => p.product_type ?? '')),
    examples: list.slice(0, 5).map(p => (p.title ?? '').trim()).filter(Boolean),
    newestDays: newest ? Math.max(0, Math.round((Date.now() - newest) / DAY)) : null,
  }
}

async function woo(domain: string): Promise<StoreFacts | null> {
  const res = await get(`https://${domain}/wp-json/wc/store/v1/products?per_page=100`, 'application/json')
  if (!res || !(res.headers.get('content-type') ?? '').includes('json')) return null
  const list = await res.json().catch(() => null) as { name?: string; categories?: { name?: string }[] }[] | null
  if (!Array.isArray(list)) return null
  const total = Number(res.headers.get('x-wp-total')) || list.length
  return {
    platform: 'WooCommerce',
    products: total,
    more: false,
    types: mostCommon(list.flatMap(p => (p.categories ?? []).map(c => c.name ?? ''))),
    examples: list.slice(0, 5).map(p => (p.name ?? '').replace(/&#?\w+;/g, ' ').trim()).filter(Boolean),
    newestDays: null,
  }
}

function mostCommon(values: string[]): string[] {
  const count = new Map<string, number>()
  for (const v of values) {
    const k = v.trim()
    if (k && !/^(uncategori[sz]ed|default|all)$/i.test(k)) count.set(k, (count.get(k) ?? 0) + 1)
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => k)
}

/** One line for the lead card and the AI, e.g. "Shopify store · 24 products (Candles, Wax melts) · newest 12 days ago". */
export function storeLine(f: StoreFacts): string {
  const size = `${f.products}${f.more ? '+' : ''} product${f.products === 1 ? '' : 's'}`
  const what = f.types.length ? ` (${f.types.slice(0, 4).join(', ')})` : f.examples.length ? ` (e.g. ${f.examples.slice(0, 3).join(', ')})` : ''
  const fresh = f.newestDays === null ? '' : ` · newest ${f.newestDays === 0 ? 'today' : `${f.newestDays} day${f.newestDays === 1 ? '' : 's'} ago`}`
  return `${f.platform} store · ${size}${what}${fresh}`
}

// Addresses that are never a person at the business
const JUNK_EMAIL = /(example\.|domain\.|email\.com$|yourname|youremail|sentry|wixpress|godaddy|shopify\.com$|squarespace|cloudflare|\.(png|jpe?g|gif|webp|svg)$|^(no-?reply|noreply|donotreply|postmaster|abuse|privacy|legal|webmaster)@)/i

/**
 * An email the business lists itself: mailto links or plain addresses on the home, contact or about
 * page (Shopify's /pages/contact too). Its own domain first. Free, so it's tried before Hunter.
 */
export async function contactEmail(domain: string, homeHtml?: string): Promise<string | null> {
  const pages = ['', '/contact', '/pages/contact', '/contact-us', '/pages/contact-us', '/about']
  for (const path of pages) {
    const html = path === '' && homeHtml !== undefined ? homeHtml : await (await get(`https://${domain}${path}`, 'text/html'))?.text().catch(() => null)
    if (!html) continue
    const found = [
      ...[...html.matchAll(/mailto:([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi)].map(m => m[1]),
      ...[...html.replace(/<[^>]+>/g, ' ').matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)].map(m => m[0]),
    ].map(e => decodeURIComponent(e).toLowerCase()).filter(e => !JUNK_EMAIL.test(e))
    const own = found.find(e => e.endsWith(`@${domain}`) || e.endsWith(`.${domain}`))
    if (own ?? found[0]) return own ?? found[0]
  }
  return null
}

/** Runs `fn` over `items`, at most `limit` at a time (so 30 sites aren't fetched all at once). */
export async function inBatches<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]) }
  }))
  return out
}
