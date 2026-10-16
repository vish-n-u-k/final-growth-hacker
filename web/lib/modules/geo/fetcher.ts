import { detectBlock, type BlockInfo } from '@/lib/audit/blocked'

export interface PageFetch {
  url: string
  html: string | null // null = found but couldn't be loaded
}

// The homepage loaded with an AI crawler's user agent, to catch firewalls / CDNs (e.g. Cloudflare's
// "Block AI bots") that turn AI crawlers away even when robots.txt lets them in.
export interface BotProbe {
  bot: string
  status: number | null // null = no answer (timeout / network error)
  challenged: boolean   // served a bot challenge page instead of the site
}

// Wikidata entry whose official website is this domain
export interface WikiLookup {
  status: 'found' | 'none' | 'error' | 'skipped'
  id?: string
  label?: string
  wikipedia?: string | null
}

export interface GeoFetchData {
  url: string
  html: string
  robotsTxt: string             // '' = no robots.txt
  llmsTxt: string | null        // null = missing (404, or an HTML page served at that address)
  sitemapUrls: string[]         // <loc> URLs from /sitemap.xml (following a sitemap index)
  sitemapLastmod: string | null // most recent <lastmod> date in the sitemap
  // One real blog post / article page (from the sitemap or homepage links); null when the site has none
  articlePage: PageFetch | null
  // An FAQ page (/faq…), for FAQ markup that lives off the homepage; null when there is none
  faqPage: PageFetch | null
  // The blog's index page (/blog/…), for comparison posts the sitemap doesn't list; null when there is none
  blogIndex: PageFetch | null
  feedUrl: string | null        // RSS / Atom feed, from <link> tags or common feed addresses
  botProbes: BotProbe[]         // [] for light (competitor) loads
  wiki: WikiLookup
  // A firewall (e.g. Cloudflare's "Just a moment…") answered instead of the site: the homepage
  // checks can't be judged. robots.txt / llms.txt can be blocked separately.
  blocked: BlockInfo | null
  robotsBlocked: boolean
  llmsBlocked: boolean
}

const UA = 'Mozilla/5.0 (compatible; GrowJinBot/1.0)'

type Kind = 'html' | 'text' | 'xml'

/**
 * GET a URL and return its body, or null. Many sites answer every address with their normal
 * page (status 200), so text and XML files are only accepted when they really are text / XML.
 */
async function fetchText(url: string, timeoutMs = 8000, kind: Kind = 'html', onBlock?: (b: BlockInfo) => void): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(timeoutMs),
    })
    const body = await res.text()
    const block = detectBlock(res.status, res.headers, body)
    if (block) { onBlock?.(block); return null }
    if (!res.ok) return null
    if (kind === 'text') {
      const type = res.headers.get('content-type') ?? ''
      if (/html/i.test(type) || /^\s*</.test(body)) return null
    }
    if (kind === 'xml' && !/<(urlset|sitemapindex|rss|feed)\b/i.test(body)) return null
    return body
  } catch {
    return null
  }
}

// Blog posts / articles: a content section followed by a post slug (not listings, tags or pages 2+)
const POST_PATH = /\/(blog|blogs|posts?|articles?|news|insights|guides?|resources|learn|journal|stories|updates)\/(?!(tag|tags|category|categories|author|authors|page|feed)\b)[^/?#]+/i
const FAQ_PATH = /\/(faqs?|frequently-asked-questions)(\/|$|\.html?)/i
// The blog's own listing page: just the section, e.g. /blog or /resources/
const BLOG_INDEX_PATH = /^\/(blog|blogs|posts?|articles?|news|insights|guides?|resources|learn|journal|stories)\/?$/i

/** The blog index: the section the found post lives in (/blog/post → /blog/), else a homepage or sitemap link to one. */
function findBlogIndexUrl(postUrl: string | null, sitemapUrls: string[], html: string, origin: string): string | null {
  if (postUrl) {
    try {
      const section = new URL(postUrl).pathname.split('/')[1]
      if (section && BLOG_INDEX_PATH.test(`/${section}`)) return `${origin}/${section}/`
    } catch { /* fall through */ }
  }
  return findPageUrl(BLOG_INDEX_PATH, sitemapUrls, html, origin)
}

/** The first sitemap URL (else homepage link) on this site whose path matches. */
function findPageUrl(pattern: RegExp, sitemapUrls: string[], html: string, origin: string): string | null {
  const matches = (u: string) => { try { const x = new URL(u, origin); return x.origin === origin && pattern.test(x.pathname) } catch { return false } }
  const fromSitemap = sitemapUrls.find(matches)
  if (fromSitemap) return fromSitemap
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["']/gi)) {
    if (matches(m[1])) return new URL(m[1], origin).href
  }
  return null
}

const locs = (xml: string) => [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([^<\]]+)/gi)].map(m => m[1].trim())
const lastmods = (xml: string) => [...xml.matchAll(/<lastmod>\s*([^<]+)/gi)].map(m => m[1].trim())

/** Page URLs and the latest <lastmod> from /sitemap.xml, following a sitemap index into up to 4 child sitemaps (posts first). */
async function readSitemap(sitemapXml: string | null): Promise<{ urls: string[]; lastmod: string | null }> {
  if (!sitemapXml) return { urls: [], lastmod: null }
  let xmls = [sitemapXml]
  if (/<sitemapindex/i.test(sitemapXml)) {
    const children = [...locs(sitemapXml)].sort((a, b) => Number(/post|blog|article/i.test(b)) - Number(/post|blog|article/i.test(a))).slice(0, 4)
    xmls = (await Promise.all(children.map(u => fetchText(u, 6000, 'xml')))).filter((x): x is string => !!x)
  }
  const dates = [...lastmods(sitemapXml), ...xmls.flatMap(lastmods)].filter(d => !Number.isNaN(Date.parse(d))).sort()
  return { urls: xmls.flatMap(locs).slice(0, 200), lastmod: dates.at(-1) ?? null }
}

/** RSS / Atom feed: a <link> tag on the homepage or blog post, else a common feed address. */
async function findFeed(pages: (string | null)[], origin: string, postUrl: string | null): Promise<string | null> {
  for (const html of pages) {
    if (!html) continue
    const tag = /<link\s[^>]*type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i.exec(html)?.[0]
    const href = tag && /href=["']([^"']+)["']/i.exec(tag)?.[1]
    if (href) { try { return new URL(href, origin).href } catch { /* ignore */ } }
  }
  if (!postUrl) return null // no blog, nothing to feed
  const section = (() => { try { return new URL(postUrl).pathname.split('/')[1] } catch { return '' } })()
  const candidates = [...new Set(['/feed', '/rss.xml', '/feed.xml', '/atom.xml', '/index.xml', `/${section}/rss.xml`, `/${section}/feed`, `/${section}/feed.xml`])]
  const found = await Promise.all(candidates.map(p => fetchText(`${origin}${p}`, 5000, 'xml')))
  const i = found.findIndex(x => x && /<(rss|feed)\b/i.test(x))
  return i >= 0 ? `${origin}${candidates[i]}` : null
}

const AI_BOT_AGENTS: [string, string][] = [
  ['GPTBot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot'],
  ['OAI-SearchBot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot'],
  ['ChatGPT-User', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot'],
  ['ClaudeBot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)'],
  ['PerplexityBot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)'],
]

async function probeBots(url: string): Promise<BotProbe[]> {
  return Promise.all(AI_BOT_AGENTS.map(async ([bot, agent]) => {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': agent }, signal: AbortSignal.timeout(8000) })
      await res.body?.cancel().catch(() => {})
      return { bot, status: res.status, challenged: res.headers.get('cf-mitigated') === 'challenge' }
    } catch {
      return { bot, status: null, challenged: false }
    }
  }))
}

const bareHost = (u: string) => { try { return new URL(u.startsWith('http') ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase() } catch { return '' } }

/** The word a domain is named after: "frekto" for app.frekto.ai. */
export function domainWord(url: string): string {
  const labels = bareHost(url).split('.')
  const generic = new Set(['app', 'my', 'get', 'try', 'use', 'go', 'join', 'hello'])
  return (labels.length > 2 && generic.has(labels[0]) ? labels[1] : labels[0]) ?? ''
}

/** A Wikidata item whose "official website" is this domain (found by searching the brand name). */
async function lookupWikidata(brandName: string, siteUrl: string): Promise<WikiLookup> {
  const site = bareHost(siteUrl)
  const terms = [...new Set([brandName.trim(), domainWord(siteUrl)].filter(t => t.length > 1))]
  if (!site || terms.length === 0) return { status: 'skipped' }
  const api = 'https://www.wikidata.org/w/api.php?format=json&origin=*'
  const get = async (q: string) => {
    const res = await fetch(`${api}&${q}`, { headers: { 'User-Agent': 'GrowJinBot/1.0 (GEO audit)' }, signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`wikidata ${res.status}`)
    return res.json() as Promise<Record<string, any>>
  }
  try {
    const searches = await Promise.all(terms.map(t => get(`action=wbsearchentities&language=en&limit=7&search=${encodeURIComponent(t)}`)))
    const ids = [...new Set(searches.flatMap(s => (s.search ?? []).map((e: { id: string }) => e.id)))].slice(0, 30)
    if (ids.length === 0) return { status: 'none' }
    const { entities = {} } = await get(`action=wbgetentities&props=claims|sitelinks|labels&languages=en&ids=${ids.join('|')}`)
    for (const id of ids) {
      const e = entities[id]
      const sites: string[] = (e?.claims?.P856 ?? []).map((c: any) => c?.mainsnak?.datavalue?.value).filter((v: unknown) => typeof v === 'string')
      const match = sites.some(s => { const h = bareHost(s); return h === site || site.endsWith(`.${h}`) || h.endsWith(`.${site}`) })
      if (!match) continue
      const enwiki = e?.sitelinks?.enwiki?.title as string | undefined
      return {
        status: 'found', id, label: e?.labels?.en?.value ?? id,
        wikipedia: enwiki ? `https://en.wikipedia.org/wiki/${encodeURIComponent(enwiki.replace(/ /g, '_'))}` : null,
      }
    }
    return { status: 'none' }
  } catch {
    return { status: 'error' }
  }
}

export async function fetchGeoData(
  requirements: Record<string, string>,
  // light: competitor loads skip the bot probes, Wikidata lookup and feed search
  opts: { light?: boolean } = {},
): Promise<GeoFetchData | { error: string }> {
  const rawUrl = requirements['website_url']
  if (!rawUrl) return { error: 'Website URL is required.' }

  const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`
  let origin: string
  try {
    origin = new URL(url).origin
  } catch {
    return { error: `Invalid URL: ${rawUrl}` }
  }

  let blocked: BlockInfo | null = null
  let robotsBlocked = false
  let llmsBlocked = false
  const [html, robotsTxt, llmsTxt, sitemapXml, botProbes, wiki] = await Promise.all([
    fetchText(url, 12000, 'html', b => { blocked = b }),
    fetchText(`${origin}/robots.txt`, 8000, 'text', () => { robotsBlocked = true }),
    fetchText(`${origin}/llms.txt`, 8000, 'text', () => { llmsBlocked = true }),
    fetchText(`${origin}/sitemap.xml`, 8000, 'xml'),
    opts.light ? Promise.resolve([]) : probeBots(url),
    opts.light ? Promise.resolve<WikiLookup>({ status: 'skipped' }) : lookupWikidata(requirements['brand_name'] ?? '', url),
  ])

  // Blocked by a firewall: carry on with what we could read (robots.txt, llms.txt, Wikidata);
  // the homepage checks become Not checked
  const block = blocked as BlockInfo | null // set inside the fetch callback
  if (block) {
    return {
      url, html: '', robotsTxt: robotsTxt ?? '', llmsTxt, sitemapUrls: [], sitemapLastmod: null,
      articlePage: null, faqPage: null, blogIndex: null, feedUrl: null, botProbes: [], wiki, blocked: block, robotsBlocked, llmsBlocked,
    }
  }
  if (!html) return { error: `Could not fetch ${url}` }

  const sitemap = await readSitemap(sitemapXml ?? null)

  // A real blog post (for article markup, citations and dates) and an FAQ page (for FAQ markup)
  const postUrl = findPageUrl(POST_PATH, sitemap.urls, html, origin)
  const faqUrl = findPageUrl(FAQ_PATH, sitemap.urls, html, origin)
  // The blog index lists posts (e.g. "Frekto vs Buffer") the sitemap may leave out; not needed for competitors
  const blogUrl = opts.light ? null : findBlogIndexUrl(postUrl, sitemap.urls, html, origin)
  const [postHtml, faqHtml, blogHtml] = await Promise.all([
    postUrl ? fetchText(postUrl, 8000) : null,
    faqUrl ? fetchText(faqUrl, 8000) : null,
    blogUrl ? fetchText(blogUrl, 8000) : null,
  ])
  const feedUrl = opts.light ? null : await findFeed([html, postHtml], origin, postUrl)

  return {
    url,
    html,
    robotsTxt: robotsTxt ?? '',
    llmsTxt,
    sitemapUrls: sitemap.urls,
    sitemapLastmod: sitemap.lastmod,
    articlePage: postUrl ? { url: postUrl, html: postHtml } : null,
    faqPage: faqUrl ? { url: faqUrl, html: faqHtml } : null,
    blogIndex: blogUrl ? { url: blogUrl, html: blogHtml } : null,
    feedUrl,
    botProbes,
    wiki,
    blocked: null,
    robotsBlocked,
    llmsBlocked,
  }
}
