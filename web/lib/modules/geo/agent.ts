import * as cheerio from 'cheerio'
import { callAI } from '@/lib/ai/client'
import { GEO_MODULE } from './definition'
import { getAllItems, type ModuleAnalysisResult } from '../types'
import { parseClaudeJsonArray } from '@/lib/modules/parse-utils'
import { isJsShell } from '@/lib/audit/js-shell'
import { blockedSkipText } from '@/lib/audit/blocked'
import { domainWord, type GeoFetchData, type PageFetch } from './fetcher'

// ── Robots.txt parser ─────────────────────────────────────────────────────────
// Follows the robots.txt standard (RFC 9309): consecutive User-agent lines share one group,
// a User-agent line after rules starts a new group, blank lines and # comments don't matter.

type BotStatus = 'allowed' | 'blocked' | 'not-mentioned'
interface RobotsGroup { agents: string[]; rules: { allow: boolean; path: string }[] }

function parseRobots(robotsTxt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = []
  let current: RobotsGroup | null = null
  let lastWasAgent = false
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    const i = line.indexOf(':')
    if (i < 0) continue
    const key = line.slice(0, i).trim().toLowerCase()
    const value = line.slice(i + 1).trim()
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [] }; groups.push(current) }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
    } else {
      if ((key === 'allow' || key === 'disallow') && current) current.rules.push({ allow: key === 'allow', path: value })
      lastWasAgent = false
    }
  }
  return groups
}

/** Whether these rules keep a bot off the homepage (longest matching rule wins; a tie goes to Allow). */
function blocksRoot(rules: RobotsGroup['rules']): boolean {
  const matching = rules.filter(r => r.path === '/' || r.path === '/*' || r.path === '*' || r.path === '/$')
  if (matching.length === 0) return false
  const longest = Math.max(...matching.map(r => r.path.length))
  return !matching.filter(r => r.path.length === longest).some(r => r.allow)
}

function checkBotInRobots(groups: RobotsGroup[], botName: string): BotStatus {
  const bot = botName.toLowerCase()
  const own = groups.filter(g => g.agents.includes(bot))
  if (own.length) return blocksRoot(own.flatMap(g => g.rules)) ? 'blocked' : 'allowed'
  const wildcard = groups.filter(g => g.agents.includes('*'))
  return blocksRoot(wildcard.flatMap(g => g.rules)) ? 'blocked' : 'not-mentioned'
}

function checkTierBots(groups: RobotsGroup[], bots: string[]): { blocked: string[]; allowed: string[]; notMentioned: string[] } {
  const blocked: string[] = []
  const allowed: string[] = []
  const notMentioned: string[] = []
  for (const bot of bots) {
    const status = checkBotInRobots(groups, bot)
    if (status === 'blocked') blocked.push(bot)
    else if (status === 'allowed') allowed.push(bot)
    else notMentioned.push(bot)
  }
  return { blocked, allowed, notMentioned }
}

// ── JSON-LD schema extractor ──────────────────────────────────────────────────

type Node = Record<string, unknown>

function extractSchemas(html: string): Node[] {
  const $ = cheerio.load(html)
  const schemas: Node[] = []
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).html() ?? '')
      // Items can be a list, or bundled in an "@graph" (Yoast, Rank Math, many Next.js sites)
      const add = (o: unknown) => {
        if (Array.isArray(o)) return o.forEach(add)
        if (!o || typeof o !== 'object') return
        schemas.push(o as Node)
        const graph = (o as Node)['@graph']
        if (Array.isArray(graph)) graph.forEach(add)
      }
      add(parsed)
    } catch { /* ignore malformed */ }
  })
  return schemas
}

/** Every typed object in the markup, including nested ones (e.g. WebSite → publisher → Organization). */
function allNodes(schemas: Node[]): Node[] {
  const out: Node[] = []
  const seen = new Set<unknown>()
  const walk = (o: unknown) => {
    if (!o || typeof o !== 'object' || seen.has(o)) return
    seen.add(o)
    if (Array.isArray(o)) return o.forEach(walk)
    if ((o as Node)['@type']) out.push(o as Node)
    Object.values(o as Node).forEach(walk)
  }
  schemas.forEach(walk)
  return out
}

const typesOf = (s: Node) => { const t = s['@type']; return typeof t === 'string' ? [t] : Array.isArray(t) ? t.map(String) : [] }
const findType = (list: Node[], types: string[]) => list.find(s => typesOf(s).some(t => types.includes(t))) ?? null

// Organization and its common sub-types
const ORG_TYPES = ['Organization', 'Corporation', 'OnlineBusiness', 'OnlineStore', 'LocalBusiness', 'ProfessionalService', 'Store',
  'NGO', 'NewsMediaOrganization', 'EducationalOrganization', 'MedicalOrganization', 'GovernmentOrganization', 'SportsOrganization',
  'Airline', 'Consortium', 'FundingScheme', 'LibrarySystem', 'PerformingGroup', 'ResearchOrganization', 'WorkersUnion']
const ARTICLE_TYPES = ['Article', 'BlogPosting', 'NewsArticle', 'TechArticle', 'Report', 'ScholarlyArticle']

const strings = (v: unknown): string[] => (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === 'string')

// ── Page reader ───────────────────────────────────────────────────────────────

const bareHost = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase() } catch { return '' } }
const sameSite = (a: string, b: string) => !!a && !!b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`))
const SOCIAL = /(^|\.)(twitter\.com|x\.com|facebook\.com|linkedin\.com|instagram\.com|pinterest\.com|reddit\.com|tiktok\.com|threads\.net|t\.me|wa\.me|whatsapp\.com|youtube\.com|youtu\.be)$/i

// Concrete facts AI answers like to quote: 40%, 3x, 10,000 teams, $49, 5 hours, 2 million users…
const STAT = /[$€£₹]\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|bn|million|billion)\b)?|\b\d{1,3}(?:,\d{3})+\+?|\b\d+(?:\.\d+)?(?:\s?%|x\b|k\+?(?![\w])|\+|\s?(?:million|billion|thousand)\b|\s(?:hours?|hrs?|minutes?|mins?|seconds?|days?|weeks?|months?|years?|customers?|clients?|users?|teams?|companies|businesses|brands|countries|people|members|downloads|installs|reviews|ratings?|stars?|times)\b)|\b(?:increased?|decreased?|reduced?|improved?|grew|boosted|cut|saved?)\s+(?:\w+\s+){0,2}by\s+\d+/gi

function readPage(html: string, pageUrl: string) {
  const $ = cheerio.load(html)
  const own = bareHost(pageUrl)
  const shell = isJsShell($)
  const clean = (t: string) => t.replace(/\s+/g, ' ').trim()
  const meta = (sel: string) => $(sel).attr('content')?.trim() ?? ''

  const lang = $('html').attr('lang')?.trim() ?? ''
  const title = clean($('title').first().text())
  const h1 = clean($('h1').first().text())
  const headings = $('h2, h3').map((_, el) => clean($(el).text())).get().filter(Boolean)
  const ogSiteName = meta('meta[property="og:site_name"]')
  const modified = meta('meta[property="article:modified_time"]') || meta('meta[property="og:updated_time"]')
  const published = meta('meta[property="article:published_time"]')

  // Every link (menus and footer included), for About / comparison pages
  const links = $('a[href]').map((_, el) => {
    try { return { url: new URL($(el).attr('href') ?? '', pageUrl).href, text: clean($(el).text()) } } catch { return null }
  }).get().filter((l): l is { url: string; text: string } => !!l)

  // The page's own content, without menus, header and footer
  const $c = cheerio.load(html)
  $c('script, style, noscript, template, svg, nav, header, footer').remove()
  const root = $c('main').length ? $c('main').first() : $c('article').length ? $c('article').first() : $c('body')
  root.find('*').append(' ') // keep words in separate elements apart ("Fast", "Simple" → "Fast Simple")
  const text = clean(root.text())
  const stats = [...new Set((text.match(STAT) ?? []).map(m => m.toLowerCase().replace(/\s+/g, ' ').trim()))]
  const listItems = root.find('li').length
  const tableCount = root.find('table').length
  const outsideSites = [...new Set(root.find('a[href]').map((_, el) => {
    try { return bareHost(new URL($c(el).attr('href') ?? '', pageUrl).href) } catch { return '' }
  }).get().filter(h => h && !sameSite(h, own) && !SOCIAL.test(h)))]

  // FAQ-style content: question headings / accordion items, or an FAQ section heading
  const questions = new Set($c('h2, h3, h4, h5, h6, summary, dt, button, [itemprop="name"]').map((_, el) => clean($c(el).text())).get()
    .filter(t => t.length >= 8 && t.length <= 200 && t.endsWith('?')))
  const faqHeading = $c('h1, h2, h3, h4').toArray().some(el => /^(faqs?\b|frequently asked|common questions|questions & answers|q\s?&\s?a\b)/i.test(clean($c(el).text())))

  return {
    shell, textLength: text.length, lang, title, h1, headings, ogSiteName, modified, published, links,
    text, stats, statsCount: stats.length, listItems, tableCount, outsideSites,
    questionCount: questions.size, hasFaqContent: questions.size >= 2 || faqHeading,
  }
}

type Page = ReturnType<typeof readPage>

const pathOf = (u: string) => { try { return new URL(u).pathname || '/' } catch { return u } }

// ── Pre-compute rule findings ─────────────────────────────────────────────────

const ABOUT_PATH = /\/(about|about-us|about_us|company|who-we-are|our-story|team)(\/|$|\.html?)/i
const ABOUT_TEXT = /^(about( us)?|company|our story|who we are|our team|team)$/i
const COMPARE_PATH = /(^|[/\-_])(vs|versus|alternatives?|compare|comparisons?|competitors?)([/\-_.]|$)/i
const COMPARE_TEXT = /\bvs\.?\s|\bversus\b|\balternatives?\s+(to|for)\b|\bcompar(e|ison)\b/i

/** A sub-page (blog post, FAQ page): loaded or not, and what's on it. */
function readSubPage(p: PageFetch | null) {
  if (!p) return null
  return { url: p.url, path: pathOf(p.url), page: p.html ? readPage(p.html, p.url) : null, schemas: p.html ? extractSchemas(p.html) : [] }
}

export function buildRuleFindings(data: GeoFetchData) {
  const groups = parseRobots(data.robotsTxt)
  const tier1 = checkTierBots(groups, ['GPTBot', 'ClaudeBot', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Meta-ExternalAgent', 'Amazonbot'])
  const tier2 = checkTierBots(groups, ['OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot', 'YouBot'])
  const tier3 = checkTierBots(groups, ['ChatGPT-User', 'Claude-User', 'Perplexity-User'])

  const schemas = extractSchemas(data.html)
  const nodes = allNodes(schemas)
  const page = readPage(data.html, data.url)
  const post = readSubPage(data.articlePage)
  const faqPage = readSubPage(data.faqPage)
  const blogIndex = readSubPage(data.blogIndex ?? null)
  const ownHost = bareHost(data.url)

  // FAQ markup: homepage or the FAQ page
  const faqSchemaOn = findType(nodes, ['FAQPage']) ? 'home' : faqPage && findType(allNodes(faqPage.schemas), ['FAQPage']) ? 'faq-page' : null
  const hasFaq = !!faqSchemaOn
  const website = findType(nodes, ['WebSite'])
  const org = findType(nodes, ORG_TYPES)
  const sameAs = org ? strings(org['sameAs']) : []

  // Article markup belongs on blog posts, so check a real post, not the homepage
  const isArticle = (list: Node[]) => !!findType(allNodes(list), ARTICLE_TYPES)
  const articleCheck: { status: 'yes' | 'no' | 'unreachable' | 'no-blog'; url: string } = !post
    ? { status: isArticle(schemas) ? 'yes' : 'no-blog', url: data.url }
    : { status: !post.page ? 'unreachable' : isArticle(post.schemas) ? 'yes' : 'no', url: post.url }

  // llms.txt structure (relative links count too)
  const llms = data.llmsTxt ?? ''
  const llmsPresent = data.llmsTxt !== null && llms.trim().length > 0
  const llmsLinkCount = (llms.match(/\[[^\]]+\]\((?:https?:\/\/|\/)[^)\s]+\)/g) ?? []).length
  const llmsSectionCount = (llms.match(/^##\s/gm) ?? []).length

  // Freshness: a date on the blog post, the homepage, or the sitemap
  const ldDate = (list: Node[], key: string) => allNodes(list).map(n => n[key]).find((v): v is string => typeof v === 'string' && !!v) ?? ''
  const freshness = [
    post?.page?.modified && { where: `blog post (${post.path})`, what: 'last-updated date', value: post.page.modified },
    post && ldDate(post.schemas, 'dateModified') && { where: `blog post (${post.path})`, what: 'last-updated date in its markup', value: ldDate(post.schemas, 'dateModified') },
    post?.page?.published && { where: `blog post (${post.path})`, what: 'published date', value: post.page.published },
    post && ldDate(post.schemas, 'datePublished') && { where: `blog post (${post.path})`, what: 'published date in its markup', value: ldDate(post.schemas, 'datePublished') },
    page.modified && { where: 'homepage', what: 'last-updated date', value: page.modified },
    ldDate(schemas, 'dateModified') && { where: 'homepage', what: 'last-updated date in its markup', value: ldDate(schemas, 'dateModified') },
    data.sitemapLastmod && { where: 'sitemap', what: 'last-modified dates', value: data.sitemapLastmod },
  ].filter((x): x is { where: string; what: string; value: string } => !!x)

  // About page: any link on the homepage (menus and footer included), else the sitemap
  const aboutLink = page.links.find(l => sameSite(bareHost(l.url), ownHost) && (ABOUT_PATH.test(pathOf(l.url)) || ABOUT_TEXT.test(l.text)))
  const aboutUrl = aboutLink?.url ?? data.sitemapUrls.find(u => ABOUT_PATH.test(pathOf(u))) ?? null

  // Comparison pages: sitemap, homepage links and headings, and the blog index's post links and titles
  const compareLinks = (links: typeof page.links) =>
    links.filter(l => sameSite(bareHost(l.url), ownHost) && (COMPARE_PATH.test(pathOf(l.url)) || COMPARE_TEXT.test(l.text))).map(l => pathOf(l.url))
  const blogPage = blogIndex?.page ?? null
  // Post links first; a post title without a link (or a linked card) is only listed when no link matched
  const blogLinks = blogPage ? compareLinks(blogPage.links) : []
  const blogCompares = blogLinks.length ? blogLinks
    : (blogPage?.headings ?? []).filter(h => COMPARE_TEXT.test(h)).map(h => `"${h}" (${blogIndex!.path})`)
  const compares = [...new Set([
    ...data.sitemapUrls.filter(u => COMPARE_PATH.test(pathOf(u))).map(pathOf),
    ...compareLinks(page.links),
    ...page.headings.filter(h => COMPARE_TEXT.test(h)).map(h => `"${h}"`),
    ...blogCompares,
  ])]
  // What the comparison check looked at, for the "not found" text: the blog only counts when we could read it
  const compareBlog = blogIndex ? { path: blogIndex.path, read: !!blogPage && !blogPage.shell, why: !blogPage ? 'couldn\'t be loaded' : 'is built by JavaScript' } : null

  // FAQ-style content: homepage or the FAQ page
  const faqContentOn = page.hasFaqContent ? 'home' : faqPage?.page?.hasFaqContent ? 'faq-page' : null

  return {
    tier1, tier2, tier3,
    hasFaq, faqSchemaOn, faqPage, hasWebSite: !!website, hasOrg: !!org, hasSameAs: sameAs.length > 0, sameAs,
    orgName: typeof org?.['name'] === 'string' ? org['name'] as string : '',
    websiteName: typeof website?.['name'] === 'string' ? website['name'] as string : '',
    articleCheck, post,
    llmsPresent, llmsH1: /^#\s/m.test(llms), llmsBlockquote: /^>\s/m.test(llms),
    llmsLinkCount, llmsSectionCount, llmsDepth: llmsLinkCount >= 5 && llmsSectionCount >= 2,
    page, freshness, aboutUrl, compares, compareBlog, faqContentOn,
    feedUrl: data.feedUrl, botProbes: data.botProbes, wiki: data.wiki,
    sitemapCount: data.sitemapUrls.length,
  }
}

type Findings = ReturnType<typeof buildRuleFindings>

// ── Results helpers ──────────────────────────────────────────────────────────

function re(
  slug: string, verified: boolean,
  detail: string, highlight: string, narrative: string, action: string,
): ModuleAnalysisResult {
  return { slug, verified, detail, highlight, narrative, action }
}

/** Not checked: shown as "Not checked" and left out of the score (detail starts with "Couldn't check"). */
const skip = (slug: string, detail: string): ModuleAnalysisResult => ({ slug, verified: false, detail, narrative: '', action: '' })

const SHELL_SKIP = 'Couldn\'t check: your homepage builds its content with JavaScript, which AI bots don\'t run, so they see an almost empty page (see "AI bots can read your page without JavaScript").'
const NO_BLOG = 'Couldn\'t check: we found no blog posts on the site (looked in the sitemap and homepage links), so there\'s nothing to check yet.'
const NO_LLMS = 'Couldn\'t check: there\'s no AI guidance file yet (see "AI guidance file (llms.txt) exists at the domain root").'
const postSkip = (f: Findings): string | null =>
  !f.post ? NO_BLOG
    : !f.post.page ? `Couldn't check: your blog post (${f.post.path}) didn't load for our checker this time. Re-analyse to try again.`
      : f.post.page.shell ? `Couldn't check: your blog post (${f.post.path}) builds its content with JavaScript, so AI bots (and we) see an almost empty page.`
        : null

// ── Side by side with competitors (geo-gap-*) ───────────────────────────────
// Deterministic: compares the brand's AI-visibility signals with up to 3 competitor sites.
// Only returned when at least one competitor loaded; otherwise these checks stay unrun
// (and don't count toward the score).

const host = (u: string) => { try { return new URL(u.startsWith('http') ? u : `https://${u}`).hostname.replace(/^www\./, '') } catch { return u } }
const verb = (list: unknown[], one: string, many: string) => (list.length === 1 ? one : many)
const names = (list: string[]) => list.length <= 2 ? list.join(' and ') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`

export function buildCompetitorGapResults(you: Findings, comps: { url: string; f: Findings }[]): ModuleAnalysisResult[] {
  const vs = names(comps.map(c => host(c.url)))
  const out: ModuleAnalysisResult[] = []

  // 1. llms.txt
  const llmsAhead = comps.filter(c => c.f.llmsPresent && (!you.llmsPresent || c.f.llmsLinkCount >= you.llmsLinkCount + 5))
  out.push(llmsAhead.length === 0
    ? re('geo-gap-llms', true, `Compared with ${vs}: your AI guidance file is as good or better.`, 'On par with competitors', 'Competitors have no head start in telling AI engines what their site is about.', '')
    : you.llmsPresent
      ? re('geo-gap-llms', false,
          `**${names(llmsAhead.map(c => host(c.url)))}** ${verb(llmsAhead, 'lists', 'list')} far more pages for AI engines (${llmsAhead.map(c => c.f.llmsLinkCount).join(', ')} links vs your ${you.llmsLinkCount}).`,
          'Competitors guide AI better', 'AI engines get a fuller map of their site than of yours, so they find more to cite.',
          'Add your key pages (pricing, features, use cases, comparisons, docs) as links in /llms.txt under ## sections.')
      : re('geo-gap-llms', false,
          `**${names(llmsAhead.map(c => host(c.url)))}** ${verb(llmsAhead, 'has', 'have')} an AI guidance file (llms.txt); you don't.`,
          'Competitors have llms.txt, you don\'t', 'AI engines get a clear summary of their site and have to guess about yours.',
          'Create /llms.txt with a # site name, a > one-line summary and ## sections linking your key pages.'))

  // 2. Structured data (Article only counts when you have blog posts without it)
  const types: { label: string; youLack: boolean; has: (f: Findings) => boolean }[] = [
    { label: 'FAQ', youLack: !you.hasFaq, has: f => f.hasFaq },
    { label: 'Organization', youLack: !you.hasOrg, has: f => f.hasOrg },
    { label: 'WebSite', youLack: !you.hasWebSite, has: f => f.hasWebSite },
    { label: 'Article', youLack: you.articleCheck.status === 'no', has: f => f.articleCheck.status === 'yes' },
  ]
  const schemaGaps = types
    .filter(t => t.youLack)
    .map(t => ({ label: t.label, who: comps.filter(c => t.has(c.f)).map(c => host(c.url)) }))
    .filter(g => g.who.length > 0)
  out.push(schemaGaps.length === 0
    ? re('geo-gap-schema', true, `Compared with ${vs}: you have every type of structured data they use.`, 'Structured data on par', 'AI engines can read your facts as easily as your competitors\'.', '')
    : re('geo-gap-schema', false,
        schemaGaps.map(g => `**${g.label}** (${names(g.who)})`).join('; ') + ' — competitors have these, you don\'t.',
        'Competitors have structured data you lack', 'Structured data gives AI engines ready-made facts and answers to quote; competitors hand them over and you don\'t.',
        `Add JSON-LD for: ${schemaGaps.map(g => g.label === 'FAQ' ? 'FAQPage' : g.label).join(', ')}.`))

  // 3. AI search bots: blocked for you, readable for a competitor
  const yourBlocked = [...you.tier2.blocked, ...you.tier3.blocked]
  const botGaps = yourBlocked.filter(bot => comps.some(c => ![...c.f.tier2.blocked, ...c.f.tier3.blocked].includes(bot)))
  out.push(botGaps.length === 0
    ? re('geo-gap-bots', true, `Compared with ${vs}: AI search bots can read your site just as freely.`, 'AI search access on par', 'You are not shutting out AI search engines that your competitors let in.', '')
    : re('geo-gap-bots', false,
        `Your robots.txt blocks **${names(botGaps)}**, which competitors let in.`,
        'You block AI bots competitors allow', 'Those AI search engines can read and cite competitors but not you.',
        `In robots.txt, remove the Disallow rules for ${botGaps.join(', ')} (or add "Allow: /" for them).`))

  // 4. Quotable content on the homepage
  if (you.page.shell) {
    out.push(skip('geo-gap-content', SHELL_SKIP))
  } else {
    const statLead = comps.filter(c => c.f.page.statsCount >= Math.max(3, you.page.statsCount * 2))
    const faqLead = comps.filter(c => c.f.page.hasFaqContent && !you.page.hasFaqContent)
    const contentGap = statLead.length > 0 || faqLead.length > 0
    out.push(!contentGap
      ? re('geo-gap-content', true, `Compared with ${vs}: your homepage is just as quotable (${you.page.statsCount} concrete numbers${you.page.hasFaqContent ? ', FAQ-style answers' : ''}).`, 'As quotable as competitors', 'AI engines find as many concrete facts to quote on your page as on theirs.', '')
      : re('geo-gap-content', false,
          [statLead.length ? `**${names(statLead.map(c => host(c.url)))}** ${verb(statLead, 'shows', 'show')} ${statLead.map(c => c.f.page.statsCount).join('/')} concrete numbers vs your ${you.page.statsCount}` : '',
           faqLead.length ? `**${names(faqLead.map(c => host(c.url)))}** ${verb(faqLead, 'answers', 'answer')} questions in FAQ style; you don't` : ''].filter(Boolean).join('; ') + '.',
          'Competitors are easier to quote', 'AI answers quote specific numbers and direct answers; competitors give them more of both.',
          [statLead.length ? 'Add 3–5 specific numbers (customers, results, time saved, prices)' : '', faqLead.length ? 'add a short FAQ with question headings' : ''].filter(Boolean).join(' and ') + ' on your homepage.'))
  }

  return out
}

// ── Brand name spelling ───────────────────────────────────────────────────────

/** The different ways the brand name is written across the title, H1 and markup. */
function brandSpellings(ref: string, sources: [string, string][]): Map<string, string[]> {
  const letters = [...ref.replace(/[^\p{L}\p{N}]/gu, '')]
  const forms = new Map<string, string[]>()
  if (letters.length < 2) return forms
  const esc = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${letters.map(esc).join('[\\s-]?')}(?![\\p{L}\\p{N}])`, 'giu')
  for (const [where, text] of sources) {
    for (const m of text.matchAll(pattern)) {
      const list = forms.get(m[0]) ?? []
      if (!list.includes(where)) list.push(where)
      forms.set(m[0], list)
    }
  }
  // ALL-CAPS styling (e.g. a shouty H1) isn't a different spelling when a normal form exists
  const normal = [...forms.keys()].filter(f => f !== f.toUpperCase())
  if (normal.length) for (const f of [...forms.keys()]) if (f === f.toUpperCase()) forms.delete(f)
  return forms
}

// ── Rule-engine results (deterministic items — no Claude needed) ──────────────

// Judged by Claude: two reads of the homepage copy, and the ideas from its training knowledge
const GEO_AI_SLUGS = new Set([
  'geo-structure-h1',
  'geo-competitor-diff',
  'geo-competitor-share',
  'geo-sentiment-known',
  'geo-sentiment-framing',
  'geo-sentiment-use-cases',
])
const SHELL_AI_SLUGS = new Set(['geo-structure-h1', 'geo-competitor-diff'])

function buildGeoRuleResults(f: Findings, siteUrl: string, brandName: string): ModuleAnalysisResult[] {
  const results: ModuleAnalysisResult[] = []
  const site = host(siteUrl)

  // ── What AI bots actually see ──
  results.push(f.page.shell
    ? re('geo-content-no-js', false,
        `**Your homepage HTML is almost empty** (${f.page.textLength} characters of text) — the content is built by JavaScript in the browser. AI crawlers like GPTBot and ClaudeBot don't run JavaScript, so they see a blank page.`,
        'AI bots see an empty page',
        '**AI engines can\'t quote or recommend what they can\'t read** — this blocks almost every other GEO improvement.',
        'Render your pages on the server (server-side rendering or static generation, e.g. Next.js, Astro, Nuxt) or add a prerendering service, so the text is in the HTML.')
    : re('geo-content-no-js', true,
        `**Your homepage text is in the HTML** (${f.page.textLength} characters), so AI crawlers can read it without running JavaScript.`,
        'Readable without JavaScript',
        'AI crawlers read the raw HTML; your content is there for them.',
        ''))

  const probes = f.botProbes
  const BLOCK_STATUS = new Set([401, 403, 406, 451])
  const fwBlocked = probes.filter(p => p.challenged || (p.status !== null && BLOCK_STATUS.has(p.status)))
  const answered = probes.filter(p => p.status !== null && p.status < 500 && p.status !== 429)
  results.push(
    probes.length === 0 ? skip('geo-bots-firewall', 'Couldn\'t check: the AI-bot test visits didn\'t run this time. Re-analyse to try again.')
    : fwBlocked.length > 0
      ? re('geo-bots-firewall', false,
          `**Your server turns away ${names(fwBlocked.map(p => p.bot))}** — our visit as ${verb(fwBlocked, 'that bot', 'those bots')} got ${fwBlocked.map(p => p.challenged ? 'a bot challenge' : `error ${p.status}`).join(', ')} instead of your page, even though a normal visit works.`,
          `${fwBlocked.length} AI bot${fwBlocked.length > 1 ? 's' : ''} blocked by your server`,
          '**Blocked AI crawlers can\'t read or cite your site**, whatever robots.txt says. This is often a CDN or firewall setting (e.g. Cloudflare\'s "Block AI bots").',
          `In your CDN / firewall settings (e.g. Cloudflare → Security → Bots, or AI Crawl Control), allow ${fwBlocked.map(p => p.bot).join(', ')}.`)
    : answered.length === 0 ? skip('geo-bots-firewall', 'Couldn\'t check: your server didn\'t answer our AI-bot test visits this time. Re-analyse to try again.')
      : re('geo-bots-firewall', true,
          `**Your server lets AI bots in** — our visits as ${names(answered.map(p => p.bot))} got your page normally.`,
          'AI bots reach your page',
          'No firewall or CDN rule is turning AI crawlers away. (Some firewalls also check the crawler\'s network address, which an outside test can\'t imitate.)',
          ''))

  // ── llms.txt ──
  results.push(f.llmsPresent
    ? re('geo-llms-present', true,
        '**AI guidance file** found at /llms.txt.',
        'AI guidance file exists',
        'AI engines have a dedicated file to read the site summary and structure.',
        '')
    : re('geo-llms-present', false,
        '**No AI guidance file** found at /llms.txt.',
        'AI guidance file is missing',
        '**Without this file AI engines have no curated summary** to cite — they must guess from raw page content.',
        'Create /llms.txt at your domain root. Start with: # BrandName\\n> One-line description\\n## Key Pages\\n- [Home](https://yourdomain.com)')
  )

  if (!f.llmsPresent) {
    for (const slug of ['geo-llms-h1', 'geo-llms-blockquote', 'geo-llms-sections', 'geo-llms-links', 'geo-llms-depth']) results.push(skip(slug, NO_LLMS))
  } else {
    results.push(f.llmsH1
      ? re('geo-llms-h1', true, '**Description heading** (# line) found in llms.txt.', 'Site description heading present', 'AI engines can identify what the site is about from the first line.', '')
      : re('geo-llms-h1', false, '**llms.txt has no description heading** (# line).', 'AI guidance file missing heading',
          '**Without a heading AI cannot tell what the site is about** from the guidance file.', 'Add a heading as the first line of llms.txt: # BrandName — short tagline'))

    results.push(f.llmsBlockquote
      ? re('geo-llms-blockquote', true, '**One-line product summary** (blockquote) found in llms.txt.', 'Product summary in AI file', 'AI engines can give a brief, accurate description of the product.', '')
      : re('geo-llms-blockquote', false, '**llms.txt has no one-line product summary** (> blockquote line).', 'No product summary in AI file',
          '**Without a one-liner AI engines cannot give brief accurate mentions** of the product.', 'Add a blockquote summary: > BrandName helps [audience] do [outcome] without [pain].'))

    results.push(f.llmsSectionCount > 0
      ? re('geo-llms-sections', true, `**${f.llmsSectionCount} named section${f.llmsSectionCount > 1 ? 's' : ''}** (## headings) found in llms.txt.`, `${f.llmsSectionCount} content sections present`, 'AI can match specific sections of the site to specific user queries.', '')
      : re('geo-llms-sections', false, '**llms.txt has no named sections** — no ## headings found.', 'No content sections in AI file',
          '**Without sections AI cannot match content to specific queries** — everything looks like one undifferentiated block.', 'Add at least 2 sections with ## headings, e.g. ## Features, ## Use Cases, ## Pricing'))

    results.push(f.llmsLinkCount > 0
      ? re('geo-llms-links', true, `**${f.llmsLinkCount} link${f.llmsLinkCount > 1 ? 's' : ''}** to key pages found in llms.txt.`, `${f.llmsLinkCount} page links in AI file`, 'AI can navigate directly to specific content pages from the guidance file.', '')
      : re('geo-llms-links', false, '**llms.txt contains no page links** in [name](url) form.', 'No page links in AI file',
          '**Without links AI cannot navigate to specific content** even if it knows the guidance file exists.', 'Add links: - [Features](https://yourdomain.com/features)\\n- [Pricing](https://yourdomain.com/pricing)'))

    results.push(f.llmsDepth
      ? re('geo-llms-depth', true, `**Good depth** — llms.txt has ${f.llmsLinkCount} links across ${f.llmsSectionCount} sections.`, 'AI guidance file has good depth', 'The file gives AI engines enough structure to navigate and cite specific content.', '')
      : re('geo-llms-depth', false,
          `**llms.txt is thin** — ${f.llmsLinkCount} link${f.llmsLinkCount !== 1 ? 's' : ''} and ${f.llmsSectionCount} section${f.llmsSectionCount !== 1 ? 's' : ''} (target: 5+ links, 2+ sections).`,
          'AI guidance file needs more content',
          '**A near-empty guidance file gives AI engines almost nothing to navigate** — citation chances drop significantly.',
          'Expand llms.txt to at least 5 links across 2+ sections covering your core pages.'))
  }

  // ── robots.txt AI bots ──
  const tierResult = (slug: string, tier: Findings['tier1'], kind: string, okNarrative: string, badNarrative: string) => {
    const n = tier.blocked.length
    results.push(n === 0
      ? re(slug, true,
          `**No AI ${kind} bots blocked** in robots.txt — ${tier.allowed.length > 0 ? `${tier.allowed.join(', ')} explicitly allowed` : 'all allowed by default'}.`,
          `AI ${kind} bots have access`, okNarrative, '')
      : re(slug, false,
          `**${n} AI ${kind} bot${n > 1 ? 's' : ''} blocked** in robots.txt: ${tier.blocked.join(', ')}.`,
          `${n} ${kind} bot${n > 1 ? 's' : ''} blocked`, badNarrative,
          `Remove the "Disallow: /" rules for ${tier.blocked.join(', ')} in robots.txt (or the "User-agent: *" block that covers them), or add "Allow: /" for each.`))
  }
  tierResult('geo-robots-tier1', f.tier1, 'training',
    'AI engines can learn from this content and may mention it in future answers.',
    '**Blocked training bots cannot learn from this content** — it will be left out of AI knowledge.')
  tierResult('geo-robots-tier2', f.tier2, 'search',
    'This site can appear in AI-powered search results like Perplexity and ChatGPT search.',
    '**Blocked search bots cannot surface this site** in AI-powered search results.')
  tierResult('geo-robots-tier3', f.tier3, 'assistant',
    'AI assistants can fetch this site in real time when answering user questions.',
    '**Blocked assistant bots cannot fetch this site** when answering live user questions.')

  // ── schema ──
  results.push(f.hasFaq
    ? re('geo-schema-faq', true,
        `**FAQ structured data** (FAQPage) found on your ${f.faqSchemaOn === 'home' ? 'homepage' : `FAQ page (${f.faqPage?.path})`}.`,
        'FAQ schema markup present',
        'AI engines can directly extract Q&A pairs to cite in answers.',
        '')
    : re('geo-schema-faq', false,
        f.faqPage?.page
          ? `**No FAQ structured data** on your homepage or your FAQ page (${f.faqPage.path}).`
          : '**No FAQ structured data** on your homepage, and no FAQ page found.',
        'No FAQ schema markup',
        '**FAQ markup hands AI engines ready-made questions and answers** — without it they have to dig them out of the page.',
        `Add a FAQPage JSON-LD block (<script type="application/ld+json">) with your top questions and answers to ${f.faqPage?.page ? `your FAQ page (${f.faqPage.path})` : 'the page that answers common questions'}.`)
  )

  results.push(
    f.hasOrg && f.hasSameAs
      ? re('geo-schema-org', true,
          `**Company structured data with ${f.sameAs.length} profile link${f.sameAs.length > 1 ? 's' : ''}** (sameAs) found.`,
          'Company schema with profile links',
          'AI engines can confirm this is a real entity and link it to known profiles.',
          '')
      : f.hasOrg
        ? re('geo-schema-org', false,
            '**Company structured data found, but no profile links** (sameAs) are declared.',
            'Company schema missing profile links',
            '**Without profile links AI may confuse this brand** with similarly named companies.',
            'Add a sameAs array to your Organization schema linking to your LinkedIn, Crunchbase, Wikipedia and social profiles.')
        : re('geo-schema-org', false,
            '**No company structured data** (Organization) found on the homepage.',
            'No company schema markup',
            '**Without company markup AI has no authoritative source** to build an entity profile from.',
            'Add an Organization JSON-LD block with name, url, logo, and sameAs fields.')
  )

  results.push(f.hasWebSite
    ? re('geo-schema-website', true, '**WebSite structured data** found on the homepage.', 'Website schema is present', 'AI engines know the official site name and URL for this brand.', '')
    : re('geo-schema-website', false, '**No WebSite structured data** found on the homepage.', 'No website schema markup',
        '**Without website markup AI has no authoritative name and URL** for this brand.', 'Add a WebSite JSON-LD block with name and url fields to your homepage.'))

  const postPath = pathOf(f.articleCheck.url)
  results.push(
    f.articleCheck.status === 'yes'
      ? re('geo-schema-article', true,
          `**Article or BlogPosting schema** found on your blog post (${postPath}).`,
          'Article schema is present',
          'Blog posts are marked as citable sources for AI engines.',
          '')
    : f.articleCheck.status === 'no-blog' ? skip('geo-schema-article', NO_BLOG)
    : f.articleCheck.status === 'unreachable' ? skip('geo-schema-article', postSkip(f) ?? NO_BLOG)
      : re('geo-schema-article', false,
          `**No Article or BlogPosting schema** on your blog post (${postPath}).`,
          'No article schema on blog posts',
          '**Without article markup blog posts are treated as generic pages** — not as citable sources.',
          'Add an Article JSON-LD block to your blog post template with headline, datePublished, dateModified, and author.')
  )

  // ── Entity clarity ──
  const sameAsHosts = f.sameAs.map(bareHost)
  const wikiLinked = f.sameAs.find(u => /(^|\.)(wikipedia\.org|wikidata\.org)$/i.test(bareHost(u)))
  results.push(
    wikiLinked
      ? re('geo-entity-wikipedia', true, `**Your company markup links to your ${/wikidata/i.test(wikiLinked) ? 'Wikidata' : 'Wikipedia'} entry.**`, 'Public knowledge entry linked',
          'AI engines can tie your site to a known, verified entity.', '')
    : f.wiki.status === 'found'
      ? re('geo-entity-wikipedia', true,
          `**Wikidata entry "${f.wiki.label}" (${f.wiki.id}) lists ${site} as its website**${f.wiki.wikipedia ? ', and it has an English Wikipedia article' : '; no English Wikipedia article yet'}.`,
          'Brand has a public knowledge entry',
          'AI engines treat brands in public knowledge bases as real, known entities.',
          `Add https://www.wikidata.org/wiki/${f.wiki.id} to the sameAs list in your company markup so AI can connect the two.`)
    : f.wiki.status === 'none'
      ? re('geo-entity-wikipedia', false,
          `**No Wikidata entry lists ${site} as its official website**, and your company markup links to none.`,
          'No public knowledge entry',
          '**Brands missing from public knowledge bases are treated as unknown** by AI engines.',
          `If one exists, add "official website: ${site}" to it. If not and you're notable (press, funding, customers), create a Wikidata item with that property, then link it in your company markup's sameAs.`)
      : skip('geo-entity-wikipedia', 'Couldn\'t check: Wikidata didn\'t answer this time. Re-analyse to try again.')
  )

  const AUTHORITATIVE = /(^|\.)(wikipedia\.org|wikidata\.org|crunchbase\.com)$/i
  const strong = sameAsHosts.filter(h => AUTHORITATIVE.test(h))
  results.push(
    !f.hasOrg || !f.hasSameAs
      ? skip('geo-entity-sameas-depth', 'Couldn\'t check: needs company markup with profile links first (see "External profile links in company structured data").')
    : strong.length > 0
      ? re('geo-entity-sameas-depth', true, `**Company markup links to ${names([...new Set(strong)])}.**`, 'Linked to authoritative directories',
          'AI engines use these directories to confirm the brand is an established entity.', '')
      : re('geo-entity-sameas-depth', false,
          `**Company markup only links to ${names([...new Set(sameAsHosts)].slice(0, 5))}** — no Wikipedia, Wikidata or Crunchbase.`,
          'Only social profile links',
          '**Social profiles alone are weak signals** — AI uses authoritative directories to confirm a brand is real and established.',
          'Create a Crunchbase profile (and Wikidata/Wikipedia entry if you qualify) and add their URLs to sameAs in your Organization markup.')
  )

  // Brand name spelling: the saved name, else the name in the markup, else the domain word
  const ref = brandName.trim() || f.orgName || f.page.ogSiteName || f.websiteName
  const refName = ref || domainWord(siteUrl)
  const forms = brandSpellings(refName, [
    ['page title', f.page.title], ['main heading', f.page.h1], ['share name (og:site_name)', f.page.ogSiteName],
    ['company markup', f.orgName], ['website markup', f.websiteName],
  ])
  results.push(
    forms.size > 1
      ? re('geo-entity-nap', false,
          `**Your brand name is written ${forms.size} ways:** ${[...forms].map(([form, where]) => `"${form}" (${where.join(', ')})`).join('; ')}.`,
          'Brand name spelled inconsistently',
          '**Different spellings can make AI treat them as different brands**, splitting what it knows about you.',
          `Use one spelling everywhere — your page title, headings, og:site_name and the name in your Organization and WebSite markup.`)
    : forms.size === 1
      ? re('geo-entity-nap', true,
          `**"${[...forms.keys()][0]}" is spelled the same everywhere** it appears (${[...forms.values()][0].join(', ')}).`,
          'Brand name consistent',
          'AI engines see one clear brand name.', '')
    : ref
      ? re('geo-entity-nap', false,
          `**Your brand name "${refName}" doesn't appear** in your page title, main heading or markup.`,
          'Brand name missing from key places',
          '**AI engines learn your name from these places** — if it\'s missing they may not connect the site to your brand.',
          `Add "${refName}" to your page title, og:site_name and the name field of your Organization markup.`)
      : skip('geo-entity-nap', 'Couldn\'t check: we couldn\'t tell your brand name. Add it in Settings.')
  )

  results.push(
    f.aboutUrl
      ? re('geo-entity-about', true, `**About page found** (${pathOf(f.aboutUrl)}).`, 'About page found',
          'AI engines use the About page to build an accurate brand profile and verify the entity.', '')
    : f.page.shell && f.sitemapCount === 0 ? skip('geo-entity-about', SHELL_SKIP)
      : re('geo-entity-about', false,
          '**No About page found** in your homepage links (menus and footer) or sitemap.',
          'No About page found',
          '**Without an About page AI has no source** to build an accurate brand profile — it may confuse the brand or leave it out of answers.',
          'Create an /about page with your brand story, founding team, and mission. Link it from the menu or footer.')
  )

  // ── Freshness & language ──
  results.push(f.page.lang
    ? re('geo-signals-lang', true, `**Page language declared**: lang="${f.page.lang}".`, 'Page language is declared',
        'AI engines use this to match the page to language-specific queries.', '')
    : re('geo-signals-lang', false, '**No lang attribute** on the <html> element.', 'Page language not declared',
        '**Without a language declaration AI may misjudge** which language queries the page answers.',
        'Add lang="en" (or your language code) to the opening <html> tag.'))

  const fresh = f.freshness[0]
  results.push(fresh
    ? re('geo-signals-modified', true,
        `**Content dates declared** — ${fresh.what} on your ${fresh.where} (${fresh.value.slice(0, 10)}).`,
        'Content freshness date set',
        'AI engines can tell your content is current.', '')
    : re('geo-signals-modified', false,
        `**No content dates found** — ${f.post ? `your blog post (${f.post.path}), ` : ''}homepage and sitemap don't declare when content was published or updated.`,
        'No content freshness date',
        '**Undated content looks stale to AI engines**, which prefer recent sources.',
        f.post
          ? 'Add dateModified and datePublished to the Article markup on your blog posts, and <lastmod> dates to your sitemap.'
          : 'Add <lastmod> dates to your sitemap.xml so AI crawlers know when pages changed.')
  )

  results.push(
    f.feedUrl
      ? re('geo-signals-rss', true, `**RSS/Atom feed** found: ${f.feedUrl}.`, 'RSS feed is present', 'AI crawlers can automatically discover new content as it is published.', '')
    : !f.post ? skip('geo-signals-rss', NO_BLOG)
      : re('geo-signals-rss', false,
          '**No RSS or Atom feed** found — none linked from your homepage or blog post, and none at the usual addresses (/feed, /rss.xml…).',
          'No RSS feed present',
          '**Without a feed new posts take longer to be discovered** and cited.',
          'Publish a feed for your blog (most blog tools have one built in) and link it in <head>: <link rel="alternate" type="application/rss+xml" href="/rss.xml">.')
  )

  // ── Content signals ──
  if (f.page.shell) {
    for (const slug of ['geo-content-stats', 'geo-content-lists']) results.push(skip(slug, SHELL_SKIP))
  } else {
    const ex = f.page.stats.slice(0, 4).map(s => `"${s}"`).join(', ')
    results.push(f.page.statsCount >= 2
      ? re('geo-content-stats', true,
          `**${f.page.statsCount} concrete numbers** on your homepage (e.g. ${ex}).`,
          `${f.page.statsCount} data points in content`,
          'Specific numbers give AI engines facts worth quoting.',
          '')
      : re('geo-content-stats', false,
          f.page.statsCount === 1 ? `**Only 1 concrete number** on your homepage (${ex}).` : '**No concrete numbers** (customers, results, prices, time saved) on your homepage.',
          'Content lacks specific data',
          '**Pages without numbers give AI little to quote** — it prefers specific, checkable facts.',
          'Add 3–5 specific data points: customer counts, results, time saved, or prices.'))

    results.push(f.page.listItems >= 3 || f.page.tableCount >= 1
      ? re('geo-content-lists', true,
          `**Structured content present** — ${f.page.listItems} list item${f.page.listItems !== 1 ? 's' : ''}${f.page.tableCount > 0 ? `, ${f.page.tableCount} table${f.page.tableCount > 1 ? 's' : ''}` : ''}.`,
          'Lists and tables present',
          'AI engines extract structured content far more readily than dense paragraphs.',
          '')
      : re('geo-content-lists', false,
          `**Minimal structured content** — ${f.page.listItems} list items, ${f.page.tableCount} tables (menus and footer not counted).`,
          'No lists or tables in content',
          '**AI skips dense paragraphs** and prefers extracting bullet points and tables.',
          'Break key information into bullet lists or comparison tables — features, benefits, and use cases.'))
  }

  results.push(
    f.faqContentOn
      ? re('geo-structure-faq-content', true,
          f.faqContentOn === 'home' ? '**FAQ-style questions and answers** on your homepage.' : `**FAQ-style questions and answers** on your FAQ page (${f.faqPage?.path}).`,
          'FAQ content present',
          'AI engines can cite this page when answering the specific questions covered.',
          '')
    : f.page.shell ? skip('geo-structure-faq-content', SHELL_SKIP)
      : re('geo-structure-faq-content', false,
          `**No FAQ-style questions and answers** on your homepage${f.faqPage ? ` or FAQ page (${f.faqPage.path})` : ', and no FAQ page found'}.`,
          'No FAQ content on page',
          '**Pages without Q&A miss the most common AI citation trigger** — direct question matching.',
          'Add a FAQ section with 5–8 real customer questions as headings (ending in "?"), each followed by a clear 2–3 sentence answer.')
  )

  const whyNoPost = postSkip(f)
  const cited = f.post?.page?.outsideSites ?? []
  results.push(
    whyNoPost ? skip('geo-content-citations', whyNoPost)
    : cited.length >= 2
      ? re('geo-content-citations', true, `**Your blog post (${f.post!.path}) links to ${cited.length} outside sources** (e.g. ${cited.slice(0, 3).join(', ')}).`,
          'Blog cites outside sources', 'Citing credible sources signals factual grounding, which AI engines favour.', '')
      : re('geo-content-citations', false,
          `**Your blog post (${f.post!.path}) links to ${cited.length === 0 ? 'no' : 'only 1'} outside source${cited.length === 1 ? ` (${cited[0]})` : 's'}.**`,
          'Blog posts don\'t cite sources',
          '**AI engines trust content that backs up its claims** with credible sources.',
          'Back key claims in your posts with links to studies, reports, official docs or well-known publications.')
  )

  results.push(
    f.compares.length > 0
      ? re('geo-competitor-compare', true, `**Comparison content found:** ${f.compares.slice(0, 3).join(', ')}.`, 'Comparison pages present',
          'AI engines cite comparison pages when users ask "X vs Y" or "alternatives to X".', '')
    : f.page.shell && f.sitemapCount === 0 && !f.compareBlog?.read ? skip('geo-competitor-compare', SHELL_SKIP)
      : re('geo-competitor-compare', false,
          `**No comparison pages found** in your sitemap${f.compareBlog?.read ? `, homepage links or blog (${f.compareBlog.path})` : ' or homepage links'} (like /vs/competitor, /alternatives or a "X vs Y" post).`
            + (f.compareBlog && !f.compareBlog.read ? ` Your blog (${f.compareBlog.path}) ${f.compareBlog.why}, so its posts weren't checked.` : ''),
          'No comparison content',
          '**"X vs Y" and "alternatives to X" are common AI questions** — without these pages, competitors\' answers get quoted instead.',
          'Create honest comparison pages for your top 2–3 competitors (e.g. /vs/competitor) and an "alternatives" page, and link them from the footer.')
  )

  return results
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function analyzeGeo(
  data: GeoFetchData,
  brainContext?: string,
  brandName?: string,
  competitors: { url: string; data: GeoFetchData; suggested?: boolean }[] = [],
): Promise<ModuleAnalysisResult[]> {
  const findings = buildRuleFindings(data)
  const allItems = getAllItems(GEO_MODULE)

  // Rule engine handles the deterministic items, plus the side-by-side checks when competitors loaded
  const gap = competitors.length ? buildCompetitorGapResults(findings, competitors.map(c => ({ url: c.url, f: buildRuleFindings(c.data) }))) : []
  const suggestedNote = competitors.some(c => c.suggested) ? ' _(Compared with competitors GrowJin suggested — check them in GEO setup.)_' : ''
  const ruleResults = [
    ...buildGeoRuleResults(findings, data.url, brandName ?? ''),
    ...gap.map(r => (suggestedNote && !r.detail.startsWith('Couldn\'t check') ? { ...r, detail: r.detail + suggestedNote } : r)),
  ]
  const ruleResultMap = new Map(ruleResults.map(r => [r.slug, r]))

  // A firewall answered instead of the site (e.g. Cloudflare's "Just a moment…"): homepage checks
  // are Not checked. robots.txt, llms.txt and Wikidata are judged when they could be read.
  const block = data.blocked
  const ROBOTS = ['geo-robots-tier1', 'geo-robots-tier2', 'geo-robots-tier3']
  const LLMS = ['geo-llms-present', 'geo-llms-h1', 'geo-llms-blockquote', 'geo-llms-sections', 'geo-llms-links', 'geo-llms-depth']
  const fileBlocked = (slug: string) => (data.robotsBlocked && ROBOTS.includes(slug)) || (data.llmsBlocked && LLMS.includes(slug))
  const readable = new Set(['geo-entity-wikipedia', ...ROBOTS, ...LLMS])
  const blockedResult = (slug: string): ModuleAnalysisResult | null => {
    if (fileBlocked(slug)) return skip(slug, `Couldn't check: the site's firewall blocked GrowJin's checker from reading ${ROBOTS.includes(slug) ? 'robots.txt' : 'llms.txt'}. Allow GrowJin in your firewall, then re-analyse.`)
    if (!block || readable.has(slug)) return null
    if (slug === 'geo-bots-firewall') {
      return skip(slug, `Couldn't check: ${block.by} blocks GrowJin's checker on every visit, so we can't tell whether it lets AI bots in. If bot protection is on (e.g. Cloudflare's Bot Fight Mode), it may block AI crawlers like GPTBot and ClaudeBot too — allow verified bots there.`)
    }
    return skip(slug, blockedSkipText(block))
  }

  // Claude: homepage copy judgements (not on JS-built or blocked pages: there's no copy to read) and the ideas
  const aiItems = allItems.filter(item => GEO_AI_SLUGS.has(item.slug) && !((findings.page.shell || block) && SHELL_AI_SLUGS.has(item.slug)))

  let aiResultMap = new Map<string, ModuleAnalysisResult>()
  if (aiItems.length) {
    const itemList = aiItems
      .map((item, idx) => `${idx + 1}. [${item.slug}] ${item.label}\nInstructions: ${item.prompt}`)
      .join('\n\n')

    const raw = await callAI({
      system: GEO_MODULE.systemPrompt,
      prompt: `Website: ${data.url}${brandName ? `\nBrand name: ${brandName}` : ''}
${brainContext ? `\nBrand context:\n${brainContext}\n` : ''}
── Page content ──
Title: ${findings.page.title || 'none'}
H1: ${findings.page.h1 || 'none'}
Headings: ${findings.page.headings.slice(0, 8).join(' | ') || 'none'}
Body excerpt: ${findings.page.text.slice(0, 1200)}

── Checks to evaluate ──
You MUST return exactly one JSON entry for EVERY slug listed below — no exceptions. Never skip or omit a slug.

Return ONLY a JSON array:
[{"slug": "...", "d": "**key fact** in plain English under 12 words", "h": "5-8 plain words", "n": "why it matters — **key risk** under 20 words", "a": "concrete next step under 25 words", "verified": true or false}]

${itemList}`,
      maxTokens: Math.min(aiItems.length * 220, 2000),
      model: 'claude-haiku-4-5-20251001',
    }).catch(() => '')

    let aiRows: unknown[]
    try {
      aiRows = parseClaudeJsonArray(raw)
    } catch {
      aiRows = []
    }

    aiResultMap = new Map(
      (aiRows as any[])
        .map(r => ({
          slug: r.slug,
          detail: r.d ?? r.detail ?? '',
          highlight: r.h ?? r.highlight ?? '',
          narrative: r.n ?? r.narrative ?? '',
          action: r.a ?? r.action ?? '',
          verified: typeof r.verified === 'boolean' ? r.verified : false,
        }))
        .filter(r => typeof r.slug === 'string' && r.detail && GEO_AI_SLUGS.has(r.slug))
        .map(r => [r.slug, r as ModuleAnalysisResult]),
    )
  }

  // Merge: rule engine results + AI results, preserving definition order. Side-by-side checks
  // without competitors stay unrun.
  return allItems.filter(item => !item.slug.startsWith('geo-gap-') || ruleResultMap.has(item.slug)).map(item => {
    const blockedSkip = blockedResult(item.slug)
    if (blockedSkip && !item.insight) return blockedSkip
    if (GEO_AI_SLUGS.has(item.slug)) {
      if (findings.page.shell && SHELL_AI_SLUGS.has(item.slug)) return skip(item.slug, SHELL_SKIP)
      return aiResultMap.get(item.slug) ?? skip(item.slug, 'Couldn\'t check: the AI review didn\'t return a result this time. Re-analyse to try again.')
    }
    return ruleResultMap.get(item.slug) ?? skip(item.slug, 'Couldn\'t check this time. Re-analyse to try again.')
  })
}
