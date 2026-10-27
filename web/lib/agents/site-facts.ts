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

export interface MarketingFacts {
  hiring: string[]            // marketing or content roles on their careers / jobs page
  team: string[]              // marketing roles named on their team / about page
  creators: boolean           // they work with influencers or creators (an ambassador / creator programme)
  founderSocial: string[]     // a person's own X or LinkedIn linked from the home page (founder-led posting)
  blogDays: number | null     // days since the newest dated blog post, when one could be read
  read: string[]              // which pages were read, for the AI ("careers, team")
}

// Roles that mean someone else already does their marketing
const MARKETING_ROLE = /\b(head of marketing|vp,? marketing|marketing (director|manager|lead|coordinator|specialist|associate)|cmo|chief marketing officer|growth (marketer|lead|manager)|content (marketer|writer|creator|manager|strategist|lead)|social media (manager|coordinator|specialist|lead)|community manager|brand manager|copywriter|seo (manager|specialist)|performance marketer|demand gen\w*)\b/gi
const CREATORS = /\b(influencer|ugc creator|creator program|brand ambassador|ambassador program|affiliate program|partner with creators)\b/i

/**
 * Who does a business's marketing, from free pages: marketing roles on its careers or team page,
 * a creator or ambassador programme, a person's own X / LinkedIn on the home page, and how fresh
 * its blog is. Founders who post themselves are the buyers for a do-it-yourself tool; a company
 * with a marketing team or creators isn't.
 */
export async function marketingFacts(domain: string, homeHtml = ''): Promise<MarketingFacts> {
  const page = async (paths: string[]) => {
    for (const p of paths) {
      const html = await (await get(`https://${domain}${p}`, 'text/html', 4000))?.text().catch(() => null)
      if (html && html.length > 500) return { path: p, text: html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') }
    }
    return null
  }
  const [jobs, team, blog] = await Promise.all([
    page(['/careers', '/jobs']),
    page(['/about', '/team']),
    get(`https://${domain}/blog`, 'text/html', 4000).then(r => r?.text().catch(() => null) ?? null),
  ])
  const roles = (t?: string) => [...new Set([...(t ?? '').matchAll(MARKETING_ROLE)].map(m => m[0].toLowerCase()))].slice(0, 4)
  // A person's own profile, not the company's: x.com/name or linkedin.com/in/name
  const founderSocial = [
    /(twitter|x)\.com\/(?!intent|share|home|search|i\/)[A-Za-z0-9_]{2,15}["'/?]/i.test(homeHtml) ? 'X' : null,
    /linkedin\.com\/in\/[\w-]+/i.test(homeHtml) ? 'LinkedIn (a person)' : null,
  ].filter((x): x is string => !!x)
  const dates = [...(blog ?? '').matchAll(/(?:datetime=["']|"datePublished"\s*:\s*")(\d{4}-\d{2}-\d{2})/g)].map(m => Date.parse(m[1])).filter(t => !Number.isNaN(t) && t < Date.now() + DAY)
  const newest = dates.length ? Math.max(...dates) : null
  return {
    hiring: roles(jobs?.text),
    team: roles(team?.text),
    creators: CREATORS.test(`${homeHtml} ${team?.text ?? ''} ${jobs?.text ?? ''}`),
    founderSocial,
    blogDays: newest ? Math.round((Date.now() - newest) / DAY) : null,
    read: [jobs && 'careers', team && 'team / about', blog && 'blog'].filter((x): x is string => !!x),
  }
}

/** One line for the AI, e.g. "Hiring: content writer · No marketing roles on the team page · Founder links X". */
export function marketingLine(m: MarketingFacts): string {
  return [
    m.hiring.length ? `Hiring for marketing: ${m.hiring.join(', ')}` : m.read.includes('careers') ? 'Careers page has no marketing roles' : null,
    m.team.length ? `Team / about page names marketing roles: ${m.team.join(', ')}` : m.read.includes('team / about') ? 'Team / about page names no marketing roles' : null,
    m.creators ? 'Works with influencers, creators or ambassadors' : null,
    m.founderSocial.length ? `Home page links a person’s own ${m.founderSocial.join(' and ')}` : null,
    m.blogDays !== null ? `Newest blog post ${m.blogDays} days ago` : m.read.includes('blog') ? 'Has a blog (no dates read)' : null,
  ].filter(Boolean).join(' · ') || 'No careers, team or blog page found'
}
