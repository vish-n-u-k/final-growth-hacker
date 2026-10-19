import { callAI } from '@/lib/ai/client'
import { COMPETITOR_ANALYSIS_MODULE } from './definition'
import type { DynamicModuleAnalysisResult, DynamicModuleCategoryDefinition } from '../types'
import { hostOf, type CompetitorAnalysisFetchResult, type SiteProfile } from './fetcher'
import { blockedSkipText } from '@/lib/audit/blocked'
import { parseClaudeJsonArray } from '@/lib/modules/parse-utils'
import { COMPETITOR_SUMMARY_SLUG, type ComparisonCell, type ComparisonTable } from './summary'

// Competitor Analysis: the facts are fixed "parity" checks with stable slugs — one fails only when
// a competitor has something you don't — so ticks and the score stay put between runs. Claude only
// writes ideas (standing apart, phrases they lead with, SWOT), which are never scored.

type Result = DynamicModuleAnalysisResult

const r = (category: string, slug: string, weight: 1 | 2 | 3, label: string, verified: boolean, detail: string, highlight: string, narrative: string, action: string): Result =>
  ({ category, slug: `${category}-${slug}`, label, weight, verified, detail, highlight, narrative, action, fixable: false })

/** "Couldn't check": shown as Not checked and left out of the score. */
const skip = (category: string, slug: string, label: string, detail: string): Result =>
  ({ category, slug: `${category}-${slug}`, label, weight: 1, verified: false, detail, narrative: '', action: '', fixable: false })

const names = (list: string[]) => list.length <= 2 ? list.join(' and ') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`
const quote = (s: string, n = 90) => `"${s.length > n ? `${s.slice(0, n - 1)}…` : s}"`
/** Evidence in brackets, as found (it may already quote the page). */
const cite = (s: string, n = 50) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

// ── What each site has ────────────────────────────────────────────────────────

interface Feature {
  category: string
  slug: string
  weight: 1 | 2 | 3
  label: string          // the check
  row: string            // the table row
  short: string          // in titles: "Pricing"
  has: (s: SiteProfile) => boolean
  evidence: (s: SiteProfile) => string
  missing: string        // what your homepage lacks: "shows no pricing…"
  none: string           // what no one does: "show pricing"
  why: string
  action: string
}

const f = (s: SiteProfile) => s.facts!
const FEATURES = (type: string): Feature[] => [
  {
    category: 'offer', slug: 'pricing', short: 'Pricing', weight: type === 'saas' || type === 'ecommerce' ? 3 : 2,
    label: 'Your pricing is as easy to find as theirs', row: 'Pricing shown',
    has: s => !!(f(s).pricing.link || f(s).pricing.pricesOnPage),
    evidence: s => f(s).pricing.link ? 'Pricing page' : 'Prices on homepage',
    missing: 'shows no pricing link or prices', none: 'show pricing', why: '**Visitors comparing options can price them, but not you**, and many won\'t ask.',
    action: 'Add a "Pricing" link to your top menu, or show your starting price near the main button.',
  },
  {
    category: 'offer', slug: 'free-start', short: 'Free start', weight: 2,
    label: 'You offer a risk-free start, as they do', row: 'Free way to start',
    has: s => !!f(s).riskFree, evidence: s => f(s).riskFree ?? '',
    missing: 'offers no free trial, free plan or guarantee', none: 'offer a free way to start', why: '**Buyers try the option that costs nothing to try** before one that asks for money up front.',
    action: 'Offer a free trial or free plan (or a guarantee) and say so next to your main button.',
  },
  {
    category: 'proof', slug: 'customers', short: 'Customer proof', weight: 2,
    label: 'You show customers, as they do', row: 'Customer quotes or logos',
    has: s => !!(f(s).proof.testimonials || f(s).proof.logos), evidence: s => f(s).proof.testimonials ?? f(s).proof.logos ?? '',
    missing: 'shows no customer quotes or logos', none: 'show customer quotes or logos', why: '**Next to competitors with happy customers on show, you look untested.**',
    action: 'Add 2–3 customer quotes with names, or a "Trusted by" row of logos.',
  },
  {
    category: 'proof', slug: 'numbers', short: 'Numbers', weight: 1,
    label: 'You back your claims with numbers, as they do', row: 'Numbers as proof',
    has: s => f(s).proof.numbers.length > 0, evidence: s => f(s).proof.numbers.slice(0, 2).join(', '),
    missing: 'quotes no customer counts or ratings', none: 'quote customer counts or ratings', why: '**Their numbers make their claims easier to believe than yours.**',
    action: 'Add one true number near your proof: customers, posts made, hours saved, or your rating.',
  },
  {
    category: 'proof', slug: 'reviews', short: 'Review links', weight: 1,
    label: 'You link to independent reviews, as they do', row: 'Review sites linked',
    has: s => f(s).proof.reviewSites.length > 0, evidence: s => f(s).proof.reviewSites.map(x => x.name).join(', '),
    missing: 'links to no review sites', none: 'link to review sites', why: '**Buyers trust independent reviews**, and only competitors point them there.',
    action: 'Collect your first reviews on G2, Capterra or Trustpilot and link them from your homepage.',
  },
  {
    category: 'content', slug: 'case-studies', short: 'Case studies', weight: 1,
    label: 'You show a customer\'s results, as they do', row: 'Case studies',
    has: s => !!f(s).proof.caseStudies, evidence: s => f(s).proof.caseStudies ?? '',
    missing: 'links to no case studies', none: 'link to case studies', why: '**Buyers who need convincing read their success stories**, not yours.',
    action: 'Write one short customer story with the result in numbers, and link it from your homepage.',
  },
]

// ── Rule checks ───────────────────────────────────────────────────────────────

export function buildCompetitorRuleResults(data: CompetitorAnalysisFetchResult): Result[] {
  const out: Result[] = []
  const comps = data.competitors
  const features = FEATURES(data.websiteType)
  const youUnreadable = !data.you.loaded
    ? data.you.blocked ? blockedSkipText(data.you.blocked) : 'Couldn\'t check: your homepage couldn\'t be read (it may build its content with JavaScript).'
    : null
  const noComps = comps.length === 0
    ? `Couldn't check: ${data.unreachable.length ? `the competitor sites (${data.unreachable.map(hostOf).join(', ')}) couldn't be read` : 'we have no competitors to compare with'}. Add competitor websites at the top of this page.`
    : null

  for (const ft of features) {
    const reason = youUnreadable ?? noComps
    if (reason) { out.push(skip(ft.category, ft.slug, ft.label, reason)); continue }
    const youHave = ft.has(data.you)
    const theyHave = comps.filter(ft.has)
    const ahead = !youHave ? [] : comps.filter(c => !ft.has(c))
    out.push(youHave
      ? r(ft.category, ft.slug, ft.weight, ft.label, true,
          `You have it (${cite(ft.evidence(data.you))})${theyHave.length ? `, like **${names(theyHave.map(c => c.name))}**` : ''}${ahead.length ? `${theyHave.length ? ';' : ','} **${names(ahead.map(c => c.name))}** ${ahead.length > 1 ? 'don\'t' : 'doesn\'t'}` : ''}.`,
          ahead.length ? `${ft.short}: you're ahead` : `${ft.short}: on par`, 'Buyers comparing you side by side see you hold your own.', '')
      : theyHave.length === 0
        ? r(ft.category, ft.slug, ft.weight, ft.label, true,
            `${comps.length === 1 ? `Neither you nor **${comps[0].name}**` : `None of you, **${comps.map(c => c.name).slice(0, -1).join(', ')}** or **${comps.at(-1)!.name}**`} ${ft.none} on the homepage.`, `${ft.short}: no one has it yet`,
            'No gap to close, and a chance to stand out if you do it first.', '')
        : r(ft.category, ft.slug, ft.weight, ft.label, false,
            `**${names(theyHave.map(c => c.name))}** ${theyHave.length > 1 ? 'do' : 'does'} (${theyHave.slice(0, 2).map(c => cite(ft.evidence(c), 40)).join('; ')}); your homepage ${ft.missing}.`,
            `${ft.short} missing — ${theyHave.length === comps.length && comps.length > 1 ? 'every competitor has it' : `${names(theyHave.map(c => c.name))} ${theyHave.length > 1 ? 'have' : 'has'} it`}`,
            ft.why, ft.action))
  }

  // Articles: fail only when a competitor publishes far more
  const aLabel = 'You publish about as much as they do'
  const reason = noComps
  if (reason) {
    out.push(skip('content', 'articles', aLabel, reason))
  } else {
    const useRecent = data.you.postsLast90Days !== null && comps.every(c => c.postsLast90Days !== null)
    const count = (s: SiteProfile) => (useRecent ? s.postsLast90Days : s.postsFound) ?? 0
    const what = useRecent ? 'articles in the last 90 days' : 'articles'
    const mine = count(data.you)
    const leaders = comps.filter(c => count(c) >= Math.max(3, mine * 2) && count(c) - mine >= 3)
    out.push(leaders.length === 0
      ? r('content', 'articles', 2, aLabel, true, `You have **${mine} ${what}**; ${comps.map(c => `${c.name} ${count(c)}`).join(', ')}.`, 'Keeping up on content', 'You\'re not being out-published for the searches you share.', '')
      : r('content', 'articles', 2, aLabel, false,
          `You have **${mine} ${what}**; ${leaders.map(c => `**${c.name} ${count(c)}**`).join(', ')}.`, 'Out-published by competitors',
          '**Every article they publish is another search they can win and you can\'t.**',
          'Publish one article a week on the questions your buyers ask — see Content Audit\'s topic ideas.'))
  }

  // The side-by-side table rides on the first check
  const first = out.find(x => x.slug === COMPETITOR_SUMMARY_SLUG)
  if (first) first.aiData = { table: buildTable(data, features) }
  return out
}

function buildTable(data: CompetitorAnalysisFetchResult, features: Feature[]): ComparisonTable {
  const sites = [data.you, ...data.competitors]
  const cell = (s: SiteProfile, ft: Feature): ComparisonCell => !s.loaded ? { ok: null, text: 'Couldn\'t read' } : ft.has(s) ? { ok: true, text: ft.evidence(s) } : { ok: false, text: '' }
  const useRecent = sites.every(s => s.postsLast90Days !== null)
  return {
    sites: sites.map(s => ({ name: s.name, url: s.url, you: s.source === 'you', suggested: s.source === 'suggested' })),
    rows: [
      ...features.map(ft => ({ label: ft.row, cells: sites.map(s => cell(s, ft)) })),
      { label: useRecent ? 'Articles, last 90 days' : 'Articles', cells: sites.map(s => ({ ok: null, text: String((useRecent ? s.postsLast90Days : s.postsFound) ?? 0) })) },
      { label: 'Comparison pages', cells: sites.map(s => ({ ok: null, text: String(s.comparisonPages.length) })) },
    ],
    unreachable: data.unreachable,
    competitorUrls: data.competitors.map(c => c.url),
    // (a suggestion whose site no longer loads is dropped)
    achievable: data.achievable.filter(a => !data.unreachable.some(u => hostOf(u) === hostOf(a.url))),
  }
}

// ── Ideas (Claude) ────────────────────────────────────────────────────────────

function siteBlock(s: SiteProfile): string {
  if (!s.facts) return `=== ${s.name} (${s.url}) ===\nCouldn't be read.`
  const x = s.facts
  return `=== ${s.name} (${s.url})${s.source === 'you' ? ' — THIS BRAND' : ''} ===
Title: ${quote(x.title, 120)}
Description: ${quote(x.description, 200)}
Headline: ${quote(x.h1, 150)}
Top of the page: ${quote(x.topText, 400)}
Headings: ${x.headings.slice(0, 12).map(h => quote(h, 70)).join(' | ')}`
}

export async function analyzeCompetitorAnalysis(data: CompetitorAnalysisFetchResult, brainContext?: string): Promise<Result[]> {
  const rules = buildCompetitorRuleResults(data)
  if (data.competitors.length === 0 || !data.you.loaded) return rules

  const ideaCats = (COMPETITOR_ANALYSIS_MODULE.categories as DynamicModuleCategoryDefinition[]).filter(c => c.insight)
  const table = (rules.find(x => x.slug === COMPETITOR_SUMMARY_SLUG)?.aiData as { table?: ComparisonTable } | undefined)?.table
  const tableText = table ? table.rows.map(row => `- ${row.label}: ${row.cells.map((c, i) => `${table.sites[i].name} ${c.ok === null ? c.text : c.ok ? 'yes' : 'no'}`).join(', ')}`).join('\n') : ''

  const prompt = `${brainContext ? `=== About this brand ===\n${brainContext}\n\n` : ''}Brand: ${data.brandName || 'not provided'} (${data.websiteType})
Industry: ${data.industry ?? 'not provided'}
Target audience: ${data.targetAudience ?? 'not provided'}
Main selling point: ${data.usp ?? 'not provided'}
${data.suggested ? 'Note: GrowJin picked these competitors; the brand hasn\'t confirmed them.\n' : ''}
${[data.you, ...data.competitors].map(siteBlock).join('\n\n')}

=== Side by side (from the homepages) ===
${tableText}

=== Write ideas for these sections ===
${ideaCats.map(c => `--- "${c.slug}" (${c.label}) ---\n${c.prompt}`).join('\n\n')}

Return ONLY a JSON array. Each element:
{"category": one of ${ideaCats.map(c => `"${c.slug}"`).join(', ')}, "slug": "{category}-{short-descriptor}", "label": string, "weight": 1|2|3, "detail": one sentence, key point in **double asterisks**, "highlight": 5–8 words, "narrative": one sentence, "action": string}`

  let ideas: Result[] = []
  try {
    const raw = await callAI({ system: COMPETITOR_ANALYSIS_MODULE.systemPrompt, prompt, maxTokens: 3500 })
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
    console.error('[competitor-analysis] ideas failed', err)
  }

  const seen = new Set<string>()
  return [...rules, ...ideas].filter(x => (seen.has(x.slug) ? false : (seen.add(x.slug), true)))
}
