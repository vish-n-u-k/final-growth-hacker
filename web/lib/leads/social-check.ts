import * as cheerio from 'cheerio'
import { INACTIVE_DAYS, type SocialAccount, type SocialCheck, type SocialGroup, type SocialPlatform } from './social-types'

// Looks at a lead's company before the user writes to them: which social accounts their own website
// links to (free: one page read), and for Instagram and Facebook when they last posted (Apify's
// official scrapers, a few cents per account). Never throws: a site or account that cannot be read
// comes back as "down" or "activity not checked", not as an error.

const UA = 'Mozilla/5.0 (compatible; GrowJinBot/1.0; +https://growjin.com)'
const SITE_TIMEOUT = 9000
export const ACTOR_IG = 'apify~instagram-profile-scraper'
export const ACTOR_FB = 'apify~facebook-posts-scraper'

// ── 1. The website ───────────────────────────────────────────────────────────

const validHost = (d: string) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(d) && !/^(localhost|.*\.local|.*\.internal)$/i.test(d) && !/^\d+(\.\d+){3}$/.test(d)

const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu'])
function rootOf(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, '').split('.')
  if (parts.length >= 3 && SECOND_LEVEL.has(parts[parts.length - 2]) && parts[parts.length - 1].length === 2) return parts.slice(-3).join('.')
  return parts.slice(-2).join('.')
}

// One social link, cleaned: null for share buttons, the site's own root link, and other non-profile pages
export function profileOf(raw: string): SocialAccount | null {
  let u: URL
  try { u = new URL(raw.trim().replace(/^\/\//, 'https://')) } catch { return null }
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, '')
  const seg = u.pathname.split('/').filter(Boolean)
  if (!seg.length) return null   // a bare facebook.com or instagram.com icon, not an account
  const first = seg[0].toLowerCase()
  if (host === 'instagram.com') return ['p', 'reel', 'reels', 'explore', 'accounts', 'share', 'stories', 'tv'].includes(first) ? null : { platform: 'instagram', url: `https://www.instagram.com/${seg[0]}` }
  if (host === 'facebook.com' || host === 'fb.com') {
    if (['sharer', 'sharer.php', 'share.php', 'share', 'plugins', 'dialog', 'tr', 'login', 'policies', 'help', 'about', 'privacy', 'watch', 'events', 'hashtag', 'l.php'].includes(first)) return null
    const path = first === 'pages' || first === 'people' ? seg.slice(0, 3).join('/') : seg[0]
    return { platform: 'facebook', url: `https://www.facebook.com/${path}` }
  }
  if (host === 'twitter.com' || host === 'x.com') return ['intent', 'share', 'home', 'i', 'search', 'hashtag', 'widgets.js'].includes(first) ? null : { platform: 'x', url: `https://x.com/${seg[0].replace(/^@/, '')}` }
  if (host === 'linkedin.com') return ['company', 'in', 'school'].includes(first) && seg[1] ? { platform: 'linkedin', url: `https://www.linkedin.com/${seg[0]}/${seg[1]}` } : null
  if (host === 'youtube.com') return first === 'channel' || first === 'c' || first === 'user' ? (seg[1] ? { platform: 'youtube', url: `https://www.youtube.com/${seg[0]}/${seg[1]}` } : null) : first.startsWith('@') ? { platform: 'youtube', url: `https://www.youtube.com/${seg[0]}` } : null
  if (host === 'tiktok.com') return first.startsWith('@') ? { platform: 'tiktok', url: `https://www.tiktok.com/${seg[0]}` } : null
  if (host === 'pinterest.com') return ['pin', 'pin-builder', 'ideas', 'search'].includes(first) ? null : { platform: 'pinterest', url: `https://www.pinterest.com/${seg[0]}` }
  return null
}

interface SiteScan { site: 'ok' | 'moved' | 'down'; movedTo: string | null; accounts: SocialAccount[] }

async function scanSite(domain: string): Promise<SiteScan> {
  if (!validHost(domain)) return { site: 'down', movedTo: null, accounts: [] }
  try {
    const res = await fetch(`https://${domain}`, { redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(SITE_TIMEOUT) })
    if (!res.ok) return { site: 'down', movedTo: null, accounts: [] }
    const final = new URL(res.url)
    const moved = rootOf(final.hostname) !== rootOf(domain)
    const html = (await res.text()).slice(0, 1_500_000)
    const $ = cheerio.load(html)
    const found = new Map<string, SocialAccount>()
    const add = (raw: string | undefined) => {
      if (!raw) return
      const a = profileOf(raw)
      if (a && !found.has(a.platform)) found.set(a.platform, a)   // the first link of each network wins
    }
    $('a[href], link[rel="me"]').each((_, el) => add($(el).attr('href')))
    add($('meta[property="article:publisher"]').attr('content'))
    const tw = $('meta[name="twitter:site"], meta[name="twitter:creator"]').attr('content')
    if (tw && /^@\w+$/.test(tw.trim()) && !found.has('x')) found.set('x', { platform: 'x', url: `https://x.com/${tw.trim().slice(1)}` })
    return { site: moved ? 'moved' : 'ok', movedTo: moved ? final.hostname.replace(/^www\./, '') : null, accounts: [...found.values()] }
  } catch {
    return { site: 'down', movedTo: null, accounts: [] }
  }
}

// ── 2. When they last posted (Instagram, Facebook) ───────────────────────────

async function runActor(actor: string, body: Record<string, unknown>, capUsd: number): Promise<Record<string, unknown>[] | null> {
  const token = process.env.APIFY_API_TOKEN?.trim()
  if (!token) return null
  try {
    const res = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?maxTotalChargeUsd=${capUsd.toFixed(3)}&timeout=110`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(130000),
    })
    if (!res.ok) { console.error('[social-check] Apify', actor, 'returned', res.status, (await res.text().catch(() => '')).slice(0, 200)); return null }
    const items = await res.json()
    return Array.isArray(items) ? items.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : null
  } catch (e) {
    console.error('[social-check] Apify', actor, 'failed:', e)
    return null
  }
}

const handleOf = (url: string) => url.split('/').filter(Boolean).slice(2).join('/').toLowerCase()
const newest = (dates: (string | null)[]) => dates.filter((d): d is string => !!d && !Number.isNaN(Date.parse(d))).sort().pop() ?? null

/** handle → ISO date of the newest post, for the Instagram accounts given. Missing = could not read. */
async function instagramLastPosts(urls: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  const names = [...new Set(urls.map(handleOf).filter(Boolean))].slice(0, 40)
  if (!names.length) return out
  const items = await runActor(ACTOR_IG, { usernames: names }, names.length * 0.012 + 0.02)
  for (const it of items ?? []) {
    const name = String(it.username ?? '').toLowerCase()
    if (!name) continue
    const posts = Array.isArray(it.latestPosts) ? (it.latestPosts as Record<string, unknown>[]) : []
    // Pinned posts can be years old, so the newest of all of them counts
    out.set(name, newest(posts.map(p => (typeof p.timestamp === 'string' ? p.timestamp : null))))
  }
  return out
}

/** page path → ISO date of the newest post, for the Facebook pages given. */
async function facebookLastPosts(urls: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  const pages = [...new Set(urls)].slice(0, 40)
  if (!pages.length) return out
  const items = await runActor(ACTOR_FB, { startUrls: pages.map(url => ({ url })), resultsLimit: 1 }, pages.length * 0.02 + 0.02)
  for (const it of items ?? []) {
    const key = handleOf(String(it.inputUrl ?? it.facebookUrl ?? ''))
    const when = typeof it.time === 'string' ? it.time : typeof it.timestamp === 'number' ? new Date(it.timestamp * 1000).toISOString() : null
    if (key) out.set(key, when)
  }
  return out
}

// ── 3. Put together ──────────────────────────────────────────────────────────

export function classify(scan: SiteScan, lastPostAt: string | null, readable: boolean, now = Date.now()): SocialGroup {
  if (scan.site !== 'ok') return 'site'
  if (!scan.accounts.length) return 'none'
  if (lastPostAt) return now - Date.parse(lastPostAt) <= INACTIVE_DAYS * 86_400_000 ? 'active' : 'inactive'
  // An Instagram or Facebook account that was read but has no posts at all counts as not active
  return readable ? 'inactive' : 'unknown'
}

/** domain → what we found. Sites are read first; the social scrapers then run once for all domains together. */
export async function checkDomains(domains: string[]): Promise<Map<string, SocialCheck>> {
  const unique = [...new Set(domains.map(d => d.toLowerCase().trim()).filter(Boolean))]
  const scans = new Map<string, SiteScan>()
  for (let i = 0; i < unique.length; i += 6) {
    await Promise.all(unique.slice(i, i + 6).map(async d => { scans.set(d, await scanSite(d)) }))
  }

  const live = unique.filter(d => scans.get(d)!.site === 'ok')
  const igUrls = live.flatMap(d => scans.get(d)!.accounts.filter(a => a.platform === 'instagram').map(a => a.url))
  const fbUrls = live.flatMap(d => scans.get(d)!.accounts.filter(a => a.platform === 'facebook').map(a => a.url))
  const [ig, fb] = await Promise.all([instagramLastPosts(igUrls), facebookLastPosts(fbUrls)])

  const result = new Map<string, SocialCheck>()
  for (const d of unique) {
    const scan = scans.get(d)!
    const dated: { at: string | null; on: SocialPlatform }[] = []
    let readable = false
    for (const a of scan.accounts) {
      if (a.platform === 'instagram' && ig.has(handleOf(a.url))) { readable = true; dated.push({ at: ig.get(handleOf(a.url)) ?? null, on: 'instagram' }) }
      if (a.platform === 'facebook' && fb.has(handleOf(a.url))) { readable = true; dated.push({ at: fb.get(handleOf(a.url)) ?? null, on: 'facebook' }) }
    }
    const lastPostAt = newest(dated.map(x => x.at))
    result.set(d, {
      checkedAt: new Date().toISOString(),
      group: classify(scan, lastPostAt, readable),
      site: scan.site,
      movedTo: scan.movedTo,
      accounts: scan.accounts,
      lastPostAt,
      lastPostOn: lastPostAt ? dated.find(x => x.at === lastPostAt)?.on ?? null : null,
    })
  }
  return result
}
