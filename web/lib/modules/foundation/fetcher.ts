const FREE_HOSTING_DOMAINS: { pattern: RegExp; platform: string }[] = [
  { pattern: /\.vercel\.app$/i,        platform: 'Vercel' },
  { pattern: /\.netlify\.app$/i,       platform: 'Netlify' },
  { pattern: /\.github\.io$/i,         platform: 'GitHub Pages' },
  { pattern: /\.pages\.dev$/i,         platform: 'Cloudflare Pages' },
  { pattern: /\.web\.app$/i,           platform: 'Firebase Hosting' },
  { pattern: /\.firebaseapp\.com$/i,   platform: 'Firebase Hosting' },
  { pattern: /\.herokuapp\.com$/i,     platform: 'Heroku' },
  { pattern: /\.onrender\.com$/i,      platform: 'Render' },
  { pattern: /\.railway\.app$/i,       platform: 'Railway' },
  { pattern: /\.fly\.dev$/i,           platform: 'Fly.io' },
  { pattern: /\.amplifyapp\.com$/i,    platform: 'AWS Amplify' },
  { pattern: /\.azurewebsites\.net$/i, platform: 'Azure App Service' },
  { pattern: /\.wixsite\.com$/i,       platform: 'Wix' },
  { pattern: /\.webflow\.io$/i,        platform: 'Webflow' },
  { pattern: /\.myshopify\.com$/i,     platform: 'Shopify (dev store)' },
  { pattern: /\.glitch\.me$/i,         platform: 'Glitch' },
  { pattern: /\.replit\.dev$/i,        platform: 'Replit' },
  { pattern: /\.repl\.co$/i,           platform: 'Replit' },
  { pattern: /\.surge\.sh$/i,          platform: 'Surge' },
]

function detectFreeHosting(url: string): { customDomain: boolean; hostingPlatform: string | null } {
  try {
    const hostname = new URL(url).hostname
    for (const { pattern, platform } of FREE_HOSTING_DOMAINS) {
      if (pattern.test(hostname)) return { customDomain: false, hostingPlatform: platform }
    }
    return { customDomain: true, hostingPlatform: null }
  } catch {
    return { customDomain: true, hostingPlatform: null }
  }
}

export interface FoundationFetchResult {
  html: string
  url: string
  customDomain: boolean
  hostingPlatform: string | null
}

async function safeFetch(url: string, timeoutMs = 12000): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'GrowthHackerBot/1.0 (Site Auditor)' },
    })
    clearTimeout(timer)
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

function stripNoise(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function extractContent(html: string, bodyMaxChars = 30000): string {
  const headMatch = html.match(/<head[\s\S]*?<\/head>/i)
  const bodyMatch = html.match(/<body[\s\S]*?<\/body>/i)
  const head = headMatch ? stripNoise(headMatch[0]) : ''
  const body = bodyMatch
    ? stripNoise(bodyMatch[0]).slice(0, bodyMaxChars)
    : stripNoise(html).slice(0, bodyMaxChars)
  return `${head}\n${body}`.trim()
}

export async function fetchFoundationData(requirements: Record<string, string>): Promise<FoundationFetchResult> {
  const rawUrl = requirements['website_url'] ?? ''
  const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`
  const [html, { customDomain, hostingPlatform }] = await Promise.all([
    safeFetch(url),
    Promise.resolve(detectFreeHosting(url)),
  ])
  return {
    html: html ? extractContent(html) : '',
    url,
    customDomain,
    hostingPlatform,
  }
}
