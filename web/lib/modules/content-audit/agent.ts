import { callAI } from '@/lib/ai/client'
import { CONTENT_AUDIT_MODULE } from './definition'
import type { DynamicModuleAnalysisResult, DynamicModuleCategoryDefinition } from '../types'
import type { ContentAuditFetchResult, PageSummary } from './fetcher'
import { blockedSkipText } from '@/lib/audit/blocked'
import { parseClaudeJsonArray } from '@/lib/modules/parse-utils'
import { CONTENT_SUMMARY_SLUG, type ContentOverview } from './summary'

// Content Audit: the facts (how much content, how fresh, how substantial, whether posts lead to the
// product) are fixed rule checks with stable slugs, so ticks and the score stay put between runs.
// Each content page gets a verdict from fixed rules too. Claude only writes ideas (gaps, blog
// topics), and the 30-day plan is built from those topics. Ideas are never scored.

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PageVerdict {
  url: string
  title: string | null
  wordCount: number
  verdict: 'Keep' | 'Refresh' | 'Consolidate' | 'Repurpose' | 'Remove'
  urgency: 'High' | 'Medium' | 'Low'
  reason: string
  action: string
}

export interface CalendarEntry {
  date: string
  topic: string
  category: string
  format: string
  priority: 'High' | 'Medium' | 'Low'
  stage: 'Awareness' | 'Consideration' | 'Decision'
}

export interface ContentAuditAnalysisOutput {
  findings: DynamicModuleAnalysisResult[]
  pageVerdicts: PageVerdict[]
  calendarData: CalendarEntry[] | null
}

type Result = DynamicModuleAnalysisResult

const r = (category: string, slug: string, weight: 1 | 2 | 3, label: string, verified: boolean, detail: string, highlight: string, narrative: string, action: string): Result =>
  ({ category, slug: `${category}-${slug}`, label, weight, verified, detail, highlight, narrative, action, fixable: false })

/** "Couldn't check": shown as Not checked and left out of the score. */
const skip = (category: string, slug: string, label: string, detail: string): Result =>
  ({ category, slug: `${category}-${slug}`, label, weight: 1, verified: false, detail, narrative: '', action: '', fixable: false })

const DAY = 86_400_000
const daysSince = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / DAY)
const pathOf = (url: string) => { try { return new URL(url).pathname } catch { return url } }
const nameOf = (p: PageSummary, tpl: Template) => p.title ? `"${cleanTitle(p.title, tpl).slice(0, 60)}"` : pathOf(p.url)
const list = (pages: PageSummary[], tpl: Template, n = 4) => `${pages.slice(0, n).map(p => nameOf(p, tpl)).join(', ')}${pages.length > n ? ` and ${pages.length - n} more` : ''}`
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0 }

const SHELL_SKIP = 'Couldn\'t check: your site builds its pages with JavaScript, so their text isn\'t in the HTML we (and search engines) read.'

// ── Titles ────────────────────────────────────────────────────────────────────

// Most sites add the same ending to every title ("… | Frekto – AI Social Media Posts"). It's removed
// before comparing or showing titles, so pages aren't called duplicates for sharing it.
type Template = Set<string>
const SEP = /\s+[|–—:·-]\s+/
function templateOf(pages: PageSummary[]): Template {
  const titles = pages.map(p => p.title).filter((t): t is string => !!t)
  const counts = new Map<string, number>()
  for (const t of titles) for (const part of new Set(t.split(SEP).map(s => s.trim().toLowerCase()))) counts.set(part, (counts.get(part) ?? 0) + 1)
  return new Set([...counts].filter(([, n]) => titles.length >= 3 && n >= Math.max(2, titles.length * 0.4)).map(([s]) => s))
}
function cleanTitle(t: string, tpl: Template): string {
  const parts = t.split(SEP).filter(s => !tpl.has(s.trim().toLowerCase()))
  return (parts.join(' – ') || t).trim()
}
const STOP = new Set(['the', 'and', 'for', 'with', 'your', 'you', 'our', 'how', 'what', 'why', 'when', 'who', 'are', 'from', 'into', 'this', 'that', 'best', 'guide', 'tips', 'ways'])
const titleWords = (t: string, tpl: Template) => new Set((cleanTitle(t, tpl).toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(w => w.length > 2 && !STOP.has(w)).map(w => w.replace(/s$/, '')))

/** Pairs of content pages whose titles are about the same thing (shorter page first). */
function duplicatePairs(pages: PageSummary[], tpl: Template): [PageSummary, PageSummary][] {
  const out: [PageSummary, PageSummary][] = []
  const used = new Set<string>()
  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      const a = pages[i], b = pages[j]
      if (!a.title || !b.title || used.has(a.url) || used.has(b.url)) continue
      const wa = titleWords(a.title, tpl), wb = titleWords(b.title, tpl)
      if (wa.size < 3 || wb.size < 3) continue
      const shared = [...wa].filter(w => wb.has(w)).length
      if (shared / new Set([...wa, ...wb]).size >= 0.6) {
        out.push(a.wordCount <= b.wordCount ? [a, b] : [b, a])
        used.add(a.url); used.add(b.url)
      }
    }
  }
  return out
}

// ── Rule checks ───────────────────────────────────────────────────────────────

export function buildContentRuleResults(data: ContentAuditFetchResult): Result[] {
  const out: Result[] = []
  const ok = data.pages.filter(p => !p.fetchError)
  const tpl = templateOf(ok)
  const posts = ok.filter(p => p.kind === 'post')
  const content = ok.filter(p => p.kind === 'post' || p.kind === 'page')
  const unreadable = data.homepageBlocked ? blockedSkipText(data.homepageBlocked) : data.homepageIsJsShell ? SHELL_SKIP : null

  // ── Your content ──
  const L = 'content-library'
  const found = Math.max(data.postsFound, posts.length)
  const blogLabel = 'You publish articles on your site'
  // Nothing read and no sitemap to fall back on: we can't say there's no blog
  if (found === 0 && unreadable && data.totalPagesFound <= 1) {
    out.push(skip(L, 'blog', blogLabel, unreadable))
  } else out.push(found >= 3
    ? r(L, 'blog', 3, blogLabel, true, `We found **${found} articles** on your site.`, `${found} articles published`,
        'Articles bring in people searching for answers, long after you publish them.', '')
    : r(L, 'blog', 3, blogLabel, false,
        found === 0 ? 'We found **no blog or articles** on your site.' : `We found **only ${found} article${found > 1 ? 's' : ''}** on your site.`,
        found === 0 ? 'No blog yet' : 'Very few articles',
        '**Without articles, the only way people find you is by already knowing your name.**',
        'Start a blog at /blog and publish one useful article a week for your audience. See the topic ideas below.'))

  // Freshness and pace, from the posts' own dates or the sitemap's
  const dates = [data.newestPostDate, ...posts.map(p => p.published)].filter((d): d is string => !!d)
  const newest = dates.sort().at(-1) ?? null
  const recent = data.postsLast90Days ?? (posts.some(p => p.published) ? posts.filter(p => p.published && daysSince(p.published) <= 90).length : null)
  if (found > 0) {
    const fLabel = 'You\'ve published something recently'
    if (!newest) {
      out.push(skip(L, 'fresh', fLabel, 'Couldn\'t check: your articles don\'t show a date, and your sitemap doesn\'t list when pages changed. Add a publish date to each article.'))
    } else {
      const d = daysSince(newest)
      out.push(d <= 30
        ? r(L, 'fresh', 2, fLabel, true, `Your newest article went up **${d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`}**.`, 'Published in the last month', 'A blog that\'s kept up looks alive to visitors and search engines.', '')
        : r(L, 'fresh', 2, fLabel, false, `Your newest article is **${d} days old**.`, d > 90 ? 'Blog has gone quiet' : 'Nothing new this month',
            '**A blog that stopped looks abandoned**, and search engines visit it less often.',
            'Publish one new article this week, then keep to a steady pace, even one a fortnight.'))
    }
    const cLabel = 'You publish at a steady pace'
    out.push(recent === null
      ? skip(L, 'cadence', cLabel, 'Couldn\'t check: we couldn\'t tell when your articles were published.')
      : recent >= 3
        ? r(L, 'cadence', 2, cLabel, true, `**${recent} articles** in the last 90 days.`, 'About one a month or more', 'A steady pace builds an audience and search traffic over time.', '')
        : r(L, 'cadence', 2, cLabel, false, `**${recent === 0 ? 'No' : `Only ${recent}`} article${recent === 1 ? '' : 's'}** in the last 90 days.`, 'Publishing has slowed',
            '**Content builds traffic by adding up**: a few posts a year rarely move it.',
            'Plan the next 6 posts now (see the publishing plan below) and publish one every week or two.'))
  }

  // ── Page quality ──
  const Q = 'content-quality'
  const qualityChecks: [string, string][] = [
    ['thin', 'Your content pages are substantial'], ['depth', 'Your articles go into depth'], ['duplicates', 'No two pages cover the same topic'],
    ['cta', 'Your articles lead readers to your product'], ['links', 'Your articles link to your other pages'],
  ]
  if (unreadable) {
    for (const [slug, label] of qualityChecks) out.push(skip(Q, slug, label, unreadable))
    return out
  }

  const [tL, dL, uL, cL, kL] = qualityChecks.map(c => c[1])
  if (content.length === 0) {
    out.push(skip(Q, 'thin', tL, 'Couldn\'t check: we found no articles or content pages to read (only your homepage, legal and utility pages).'))
  } else {
    const thin = content.filter(p => p.wordCount < 300)
    out.push(thin.length === 0
      ? r(Q, 'thin', 3, tL, true, `All **${content.length} content pages** we read have 300+ words.`, 'No thin pages', 'Pages with substance can answer what people search for.', '')
      : r(Q, 'thin', 3, tL, false, `**${thin.length} of ${content.length} content pages** ${thin.length === 1 ? 'has' : 'have'} under 300 words: ${list(thin, tpl)}.`, `${thin.length} thin page${thin.length > 1 ? 's' : ''}`,
          '**Thin pages rarely rank**, and visitors leave them without learning much.',
          'Expand each to 600+ words that answer the reader\'s question, or merge it into a fuller page. The page table below lists them.'))
  }

  if (posts.length >= 2) {
    const m = median(posts.map(p => p.wordCount))
    out.push(m >= 700
      ? r(Q, 'depth', 2, dL, true, `Your typical article is **${m.toLocaleString()} words**.`, 'Articles go into depth', 'In-depth articles are the ones that rank and get shared.', '')
      : r(Q, 'depth', 2, dL, false, `Your typical article is **${m.toLocaleString()} words** — short for a topic to rank.`, 'Articles are short',
          '**Short articles lose to fuller ones** on the same topic in search.',
          'Make your next articles 800–1,500 words, with headings, examples and steps.'))
  } else {
    out.push(skip(Q, 'depth', dL, `Couldn't check: we read ${posts.length === 1 ? 'only one article' : 'no articles'}, so there's nothing to compare.`))
  }

  if (content.length >= 3) {
    const pairs = duplicatePairs(content, tpl)
    out.push(pairs.length === 0
      ? r(Q, 'duplicates', 2, uL, true, `None of the **${content.length} content pages** we read share a topic.`, 'Each page has its own topic', 'Search engines know which page to show for each search.', '')
      : r(Q, 'duplicates', 2, uL, false,
          `**${pairs.length} pair${pairs.length > 1 ? 's' : ''} of pages** cover the same topic: ${pairs.slice(0, 3).map(([a, b]) => `${nameOf(a, tpl)} and ${nameOf(b, tpl)}`).join('; ')}.`,
          'Pages compete with each other',
          '**Two pages on one topic split the attention** search engines would give a single strong page.',
          'Merge each pair into the fuller page and redirect the other one to it. The page table below marks them "Consolidate".'))
  } else {
    out.push(skip(Q, 'duplicates', uL, 'Couldn\'t check: fewer than 3 content pages to compare.'))
  }

  if (posts.length > 0) {
    const withCta = posts.filter(p => p.hasCta)
    out.push(withCta.length >= posts.length / 2
      ? r(Q, 'cta', 2, cL, true, `**${withCta.length} of ${posts.length} articles** invite readers to try, sign up or see pricing.`, 'Articles lead to your product', 'Readers who like an article have a next step.', '')
      : r(Q, 'cta', 2, cL, false, `**Only ${withCta.length} of ${posts.length} articles** invite readers to try, sign up or see pricing.`, 'Articles don\'t lead anywhere',
          '**Readers finish the article and leave** — the traffic never turns into customers.',
          'End every article with one line and a button, e.g. "Want this done for you? Start your free trial."'))

    const weak = posts.filter(p => p.bodyLinks < 2)
    out.push(weak.length <= posts.length / 3
      ? r(Q, 'links', 1, kL, true, `**${posts.length - weak.length} of ${posts.length} articles** link to 2+ of your other pages.`, 'Articles link to each other', 'Readers keep going, and search engines find all your pages.', '')
      : r(Q, 'links', 1, kL, false, `**${weak.length} of ${posts.length} articles** link to fewer than 2 of your other pages: ${list(weak, tpl, 3)}.`, 'Articles are dead ends',
          '**Readers have nowhere to go next**, and newer pages are harder for search engines to find.',
          'Add 2–3 links in each article to related articles or your product pages.'))
  } else {
    out.push(skip(Q, 'cta', cL, 'Couldn\'t check: we read no articles.'), skip(Q, 'links', kL, 'Couldn\'t check: we read no articles.'))
  }

  return out
}

// ── Page verdicts (fixed rules) ───────────────────────────────────────────────

export function computeVerdicts(data: ContentAuditFetchResult): PageVerdict[] {
  // Nothing meaningful to say when the pages couldn't be read
  if (data.homepageBlocked || data.homepageIsJsShell) return []
  const tpl = templateOf(data.pages.filter(p => !p.fetchError))
  const content = data.pages.filter(p => !p.fetchError && (p.kind === 'post' || p.kind === 'page'))
  const merge = new Map(duplicatePairs(content, tpl).map(([short, full]) => [short.url, full]))
  const v = (p: PageSummary, verdict: PageVerdict['verdict'], urgency: PageVerdict['urgency'], reason: string, action: string): PageVerdict =>
    ({ url: p.url, title: p.title ? cleanTitle(p.title, tpl) : null, wordCount: p.wordCount, verdict, urgency, reason, action })

  return content.map(p => {
    const into = merge.get(p.url)
    if (into) return v(p, 'Consolidate', 'High', `Covers the same topic as ${nameOf(into, tpl)}, which is fuller.`, `Move anything unique into ${pathOf(into.url)}, then redirect this page there.`)
    if (p.kind === 'post' && p.wordCount < 100) return v(p, 'Remove', 'Medium', `Almost empty: ${p.wordCount} words.`, 'Write it properly, or delete it and redirect to a related article.')
    if (p.wordCount < 300) return v(p, 'Refresh', 'High', `Thin: ${p.wordCount} words.`, 'Expand to 600+ words that fully answer the reader\'s question.')
    if (p.kind === 'post' && p.published && daysSince(p.published) > 540) {
      return v(p, 'Refresh', 'Medium', `Last updated ${Math.round(daysSince(p.published) / 30)} months ago.`, `Bring it up to date for ${new Date().getFullYear()} and change the date.`)
    }
    if (p.kind === 'post' && (!p.hasCta || p.bodyLinks < 2)) {
      const fixes = [!p.hasCta && 'add a call to try or sign up', p.bodyLinks < 2 && 'link to 2–3 related pages'].filter(Boolean)
      return v(p, 'Refresh', 'Low', `${p.wordCount.toLocaleString()} words, but ${!p.hasCta ? 'no next step for readers' : 'few links to your other pages'}.`, `${fixes.join(' and ').replace(/^./, c => c.toUpperCase())}.`)
    }
    return v(p, 'Keep', 'Low', `${p.wordCount.toLocaleString()} words${p.kind === 'post' ? ', links onward and leads to your product' : ''}.`, 'Nothing to do now.')
  }).sort((a, b) => ORDER[a.verdict] - ORDER[b.verdict] || URGENCY[a.urgency] - URGENCY[b.urgency])
}
const ORDER: Record<PageVerdict['verdict'], number> = { Consolidate: 0, Remove: 1, Refresh: 2, Repurpose: 3, Keep: 4 }
const URGENCY: Record<PageVerdict['urgency'], number> = { High: 0, Medium: 1, Low: 2 }

// ── Ideas (Claude) and the publishing plan ────────────────────────────────────

const STAGES = ['Awareness', 'Consideration', 'Decision'] as const

/** One post every 5 days from tomorrow, Decision posts first. */
function buildCalendar(topics: Result[]): CalendarEntry[] {
  const stageOf = (x: Result): CalendarEntry['stage'] => (STAGES as readonly string[]).includes(x.highlight ?? '') ? x.highlight as CalendarEntry['stage'] : x.weight === 3 ? 'Decision' : x.weight === 2 ? 'Consideration' : 'Awareness'
  const sorted = [...topics].sort((a, b) => b.weight - a.weight)
  return sorted.map((t, i) => ({
    date: new Date(Date.now() + (1 + i * 5) * DAY).toISOString().slice(0, 10),
    topic: t.label,
    category: 'Blog',
    format: 'Blog post',
    priority: t.weight === 3 ? 'High' : t.weight === 2 ? 'Medium' : 'Low',
    stage: stageOf(t),
  }))
}

export async function analyzeContentAudit(data: ContentAuditFetchResult, brainContext?: string): Promise<ContentAuditAnalysisOutput> {
  if (data.pages.every(p => p.fetchError) && data.postsFound === 0 && !data.homepageBlocked) {
    throw new Error('No pages could be read for the content audit. Check that the website URL is correct and public.')
  }
  const rules = buildContentRuleResults(data)
  const pageVerdicts = computeVerdicts(data)

  // The overview at the top of the module rides on the first check
  const ok = data.pages.filter(p => !p.fetchError)
  const postsRead = ok.filter(p => p.kind === 'post')
  const overview: ContentOverview = {
    pagesRead: ok.length,
    pagesFound: data.totalPagesFound,
    postsFound: Math.max(data.postsFound, postsRead.length),
    newestPostDate: [data.newestPostDate, ...postsRead.map(p => p.published)].filter((d): d is string => !!d).sort().at(-1) ?? null,
    typicalPostWords: postsRead.length ? median(postsRead.map(p => p.wordCount)) : null,
    unreadable: !!(data.homepageBlocked || data.homepageIsJsShell),
  }
  const first = rules.find(x => x.slug === CONTENT_SUMMARY_SLUG)
  if (first) first.aiData = { overview }

  // Ideas: one call, with room for them all
  const ideaCats = (CONTENT_AUDIT_MODULE.categories as DynamicModuleCategoryDefinition[]).filter(c => c.insight && c.prompt)
  const failed = rules.filter(x => !x.verified && !x.detail.startsWith('Couldn\'t check'))
  const tpl = templateOf(ok)
  const titles = ok.filter(p => p.title).map(p => `- [${p.kind}] ${cleanTitle(p.title!, tpl)} (${p.wordCount} words)`).slice(0, 40)
  const prompt = `${brainContext ? `=== About this brand ===\n${brainContext}\n\n` : ''}Brand: ${data.brandName || 'not provided'}
Website: ${data.websiteUrl}
Industry: ${data.industry ?? 'not provided'}
Target audience: ${data.targetAudience ?? 'not provided'}
Main selling point: ${data.usp ?? 'not provided'}

=== Pages on the site (facts) ===
${overview.postsFound} articles found in total; ${ok.length} pages read:
${titles.join('\n') || '(none could be read)'}

=== Checks that failed ===
${failed.length ? failed.map(f => `- ${f.label}: ${f.detail.replace(/\*\*/g, '')}`).join('\n') : 'none'}

=== Write ideas for these sections ===
${ideaCats.map(c => `--- "${c.slug}" (${c.label}) ---\n${c.prompt}`).join('\n\n')}

Return ONLY a JSON array. Each element:
{"category": one of ${ideaCats.map(c => `"${c.slug}"`).join(', ')}, "slug": "{category}-{short-descriptor}", "label": string, "weight": 1|2|3, "detail": string, "highlight": string, "narrative": string, "action": string}`

  let ideas: Result[] = []
  try {
    const raw = await callAI({ system: CONTENT_AUDIT_MODULE.systemPrompt, prompt, maxTokens: 4000 })
    const allowed = new Set(ideaCats.map(c => c.slug))
    ideas = (parseClaudeJsonArray(raw) as Result[])
      .filter(x => typeof x?.category === 'string' && allowed.has(x.category) && typeof x.label === 'string' && typeof x.detail === 'string')
      .map(x => ({
        category: x.category,
        // Ideas are recognised by their slug prefix (see isDynamicIdea), so make sure it's there
        slug: String(x.slug ?? x.label).startsWith(`${x.category}-`) ? String(x.slug) : `${x.category}-${String(x.slug ?? x.label).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`,
        label: x.label,
        weight: x.weight === 3 || x.weight === 1 ? x.weight : 2,
        detail: x.detail,
        highlight: x.highlight,
        narrative: x.narrative ?? '',
        action: x.action ?? '',
        verified: false,
        fixable: false,
      }))
  } catch (err) {
    console.error('[content-audit] ideas failed', err)
  }

  // The 30-day plan, built from the blog topic ideas
  const topics = ideas.filter(x => x.category === 'blog-topics')
  const calendarData = topics.length ? buildCalendar(topics) : null
  if (calendarData) {
    ideas.push({
      category: 'content-calendar', slug: 'content-calendar-30-day', label: '30-day publishing plan', weight: 2,
      detail: `**${calendarData.length} articles**, one every 5 days from ${calendarData[0].date}, the ones closest to a purchase first.`,
      highlight: 'A plan for the next 30 days',
      narrative: 'Publishing on a schedule is what turns ideas into traffic.',
      action: 'Download the plan and put the dates in your calendar.',
      verified: false, fixable: false, aiData: calendarData as unknown as Record<string, unknown>,
    })
  }

  // Unique slugs (two items with the same slug would overwrite each other)
  const seen = new Set<string>()
  const findings = [...rules, ...ideas].filter(x => (seen.has(x.slug) ? false : (seen.add(x.slug), true)))
  return { findings, pageVerdicts, calendarData }
}
