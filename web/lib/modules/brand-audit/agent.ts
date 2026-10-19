import { callAI } from '@/lib/ai/client'
import { BRAND_AUDIT_MODULE } from './definition'
import type { DynamicModuleAnalysisResult, DynamicModuleCategoryDefinition } from '../types'
import type { BrandAuditFetchResult } from './fetcher'
import { blockedSkipText } from '@/lib/audit/blocked'
import { parseClaudeJsonArray } from '@/lib/modules/parse-utils'

// Brand Audit: the facts (what the top of the homepage says, proof, pricing, a risk-free start,
// why-us) are fixed rule checks with stable slugs, so ticks and the score stay put between runs.
// Claude only writes the ideas (positioning, voice, standing out), which are shown as ideas and
// never scored.

type Result = DynamicModuleAnalysisResult

const r = (category: string, slug: string, weight: 1 | 2 | 3, label: string, verified: boolean, detail: string, highlight: string, narrative: string, action: string): Result =>
  ({ category, slug: `${category}-${slug}`, label, weight, verified, detail, highlight, narrative, action, fixable: false })

/** "Couldn't check": shown as Not checked and left out of the score. */
const skip = (category: string, slug: string, label: string, detail: string): Result =>
  ({ category, slug: `${category}-${slug}`, label, weight: 1, verified: false, detail, narrative: '', action: '', fixable: false })

const names = (list: string[]) => list.length <= 2 ? list.join(' and ') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`
const quote = (s: string, n = 90) => `"${s.length > n ? `${s.slice(0, n - 1)}…` : s}"`

const SHELL_SKIP = 'Couldn\'t check: your homepage builds its content with JavaScript, so its copy isn\'t in the HTML we (and search engines) read.'
const SETTINGS = 'Settings → Brand'

// Which checks fit which kind of website
const COMMERCIAL = new Set(['saas', 'ecommerce', 'agency', 'local'])
const SELLS_ONLINE = new Set(['saas', 'ecommerce'])
const CASE_STUDY_TYPES = new Set(['saas', 'agency', 'portfolio'])

// ── Words ─────────────────────────────────────────────────────────────────────

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'your', 'you', 'our', 'their', 'them', 'they', 'who', 'what', 'from', 'into', 'than', 'then', 'need', 'needed', 'needs', 'want', 'wants', 'under', 'over', 'more', 'most', 'less', 'all', 'one', 'any', 'every', 'just', 'like', 'make', 'makes', 'help', 'helps', 'get', 'gets', 'can', 'will', 'are', 'was', 'has', 'have', 'not', 'without', 'via', 'using', 'use', 'uses', 'other', 'others', 'also', 'its', 'it\'s', 'very', 'really', 'only', 'skills', 'skill'])

const stem = (w: string) => {
  w = w.toLowerCase()
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3)
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}
const words = (s: string) => (s.toLowerCase().match(/[a-z][a-z0-9'-]*/g) ?? []).flatMap(w => w.split('-')).filter(w => w.length >= 3 && !STOP.has(w))
const stems = (s: string) => new Set(words(s).map(stem))

/** "Small business owners, solo founders, and agencies who want to…" → the groups named before "who". */
function audienceGroups(audience: string): string[] {
  const head = audience.split(/\b(who|that|which|looking|wanting|trying)\b|[.(:—–]/i)[0]
  return head.split(/,|;|&|\/|\band\b|\bor\b/i).map(s => s.trim()).filter(s => words(s).length > 0).slice(0, 6)
    // lower-case the first letter unless it's an acronym (SaaS, B2B)
    .map(s => /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)
}

// ── Rule checks ───────────────────────────────────────────────────────────────

export function buildBrandRuleResults(data: BrandAuditFetchResult): Result[] {
  const out: Result[] = []
  const type = data.websiteType
  const pageSkip = data.homepageBlocked ? blockedSkipText(data.homepageBlocked) : data.homepageIsJsShell ? SHELL_SKIP : null
  const check = (category: string, slug: string, label: string, run: () => Result) =>
    out.push(pageSkip ? skip(category, slug, label, pageSkip) : run())

  // ── Clear positioning ──
  const P = 'positioning'
  const top = stems(data.topText)
  const topWhere = data.h1 ? `your headline (${quote(data.h1, 70)}) and the copy under it` : 'the top of your homepage'

  // Who it's for
  const aLabel = 'Who it\'s for is clear at the top of your homepage'
  if (!data.targetAudience) {
    out.push(skip(P, 'audience', aLabel, `Couldn't check: add your target audience in ${SETTINGS} so we know who to look for.`))
  } else {
    const groups = audienceGroups(data.targetAudience)
    const named = groups.filter(g => { const w = [...stems(g)]; return w.filter(x => top.has(x)).length >= Math.min(2, w.length) })
    check(P, 'audience', aLabel, () => named.length > 0
      ? r(P, 'audience', 3, aLabel, true,
          `${topWhere[0].toUpperCase()}${topWhere.slice(1)} speak${data.h1 ? '' : 's'} to **${names(named)}**.`, `Speaks to ${names(named).slice(0, 40)}`,
          'Visitors who fit can tell in seconds that this is for them.', '')
      : r(P, 'audience', 3, aLabel, false,
          `${topWhere[0].toUpperCase()}${topWhere.slice(1)} ${data.h1 ? 'don\'t' : 'doesn\'t'} name who it's for. Your audience: **${names(groups.length ? groups : [data.targetAudience!.slice(0, 80)])}**.`,
          'Audience not named at the top',
          '**Visitors have to guess whether it\'s for them**, and many leave before they find out.',
          `Name them in the headline or the line right under it, e.g. "… for ${(groups[0] ?? 'your audience').toLowerCase()}".`))
  }

  // The main selling point
  const uLabel = 'Your main selling point is at the top of your homepage'
  if (!data.usp) {
    out.push(skip(P, 'usp', uLabel, `Couldn't check: add your main selling point in ${SETTINGS} so we can look for it.`))
  } else {
    const key = [...stems(data.usp)]
    const hit = key.filter(w => top.has(w))
    const share = key.length ? hit.length / key.length : 0
    const missing = key.filter(w => !top.has(w))
    check(P, 'usp', uLabel, () => key.length >= 2 && hit.length >= 2 && share >= 0.4
      ? r(P, 'usp', 3, uLabel, true,
          `The top of your homepage carries your selling point (**${hit.slice(0, 6).join(', ')}**).`, 'Selling point up front',
          'Visitors see your reason to choose you before they scroll.', '')
      : r(P, 'usp', 3, uLabel, false,
          `Your selling point (${quote(data.usp!, 100)}) is **missing from the top of your homepage**${hit.length ? ` — only "${hit.slice(0, 4).join('", "')}" appear` : ''}.`,
          'Selling point not up front',
          '**Your best reason to choose you is hidden** below the fold or not on the page at all.',
          `Put it in the line under your headline${missing.length ? ` — make sure it mentions ${missing.slice(0, 4).map(w => `"${w}"`).join(', ')}` : ''}.`))
  }

  // A concrete promise (a number, a time, an outcome)
  const pLabel = 'The top of your homepage makes a concrete promise'
  check(P, 'promise', pLabel, () => {
    const m = /\b\d[\d,.]*\s*(%|x\b|×|seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|times\b|posts?|leads?|customers?)|\bin (under|less than) (a|an|one|\d+) \w+|\b(save|cut|double|triple|halve)s? (your |up to )?\w+/i.exec(data.topText)
    return m
      ? r(P, 'promise', 1, pLabel, true, `It promises something specific: ${quote(m[0].trim(), 60)}.`, 'Concrete promise up front', 'Specific claims are easier to believe and remember than general ones.', '')
      : r(P, 'promise', 1, pLabel, false, 'The top of your homepage has **no specific number, time or outcome**.', 'No concrete promise',
          '**Vague promises sound like everyone else\'s.** A number or a time makes yours believable.',
          'Add one specific, true claim near the headline, e.g. how long it takes, how much it saves, or how many customers use it.')
  })

  // ── Proof ──
  const R = 'proof'
  const pr = data.proof
  check(R, 'testimonials', 'Customers speak for you on your homepage', () => pr.testimonials
    ? r(R, 'testimonials', 3, 'Customers speak for you on your homepage', true, `Your homepage has ${pr.testimonials}.`, 'Customer quotes on the homepage', 'Words from real customers persuade more than anything you say yourself.', '')
    : r(R, 'testimonials', 3, 'Customers speak for you on your homepage', false, '**No customer quotes** found on your homepage.', 'No customer quotes',
        '**Without other people vouching for you, visitors have only your word.**',
        'Add 2–3 short quotes from real customers, each with a name, role or company, and a photo if you can.'))

  check(R, 'logos', 'You show who already uses you', () => pr.logos
    ? r(R, 'logos', 2, 'You show who already uses you', true, `Your homepage shows ${pr.logos}.`, 'Shows who uses you', 'Familiar names make you look established.', '')
    : r(R, 'logos', 2, 'You show who already uses you', false, '**No "trusted by" line or customer logos** on your homepage.', 'No "trusted by" proof',
        '**Visitors can\'t see that anyone like them already uses you.**',
        'Add a "Trusted by" row with customer logos — or, if you\'re early, a line like "Used by 40+ small businesses" (only if true).'))

  check(R, 'numbers', 'You back your claims with numbers', () => pr.numbers.length > 0
    ? r(R, 'numbers', 2, 'You back your claims with numbers', true, `Your homepage quotes **${pr.numbers.slice(0, 3).join(', ')}**.`, 'Numbers back your claims', 'Real numbers make claims believable.', '')
    : r(R, 'numbers', 2, 'You back your claims with numbers', false, '**No customer counts or ratings** on your homepage (e.g. "2,000+ businesses", "4.8/5").', 'No numbers as proof',
        '**Claims without numbers are easy to doubt.**',
        'Add one true number near your proof: customers, posts made, hours saved, or your average rating.'))

  check(R, 'review-sites', 'You link to reviews on sites people trust', () => pr.reviewSites.length > 0
    ? r(R, 'review-sites', 2, 'You link to reviews on sites people trust', true, `Your homepage links to **${names(pr.reviewSites.map(s => s.name))}**.`, 'Links to independent reviews', 'Reviews on independent sites are trusted more than your own page.', '')
    : r(R, 'review-sites', 2, 'You link to reviews on sites people trust', false,
        `**No links to independent reviews** (${SELLS_ONLINE.has(type) ? 'G2, Capterra, Trustpilot, Product Hunt' : 'Google reviews, Trustpilot, Yelp'}) on your homepage.`, 'No independent reviews linked',
        '**Visitors who want a second opinion have to go looking** — and may not come back.',
        type === 'saas'
          ? 'Get your first reviews on G2 or Product Hunt, then add their badge or a link to your homepage.'
          : 'Ask happy customers for a Google or Trustpilot review, then link to it from your homepage.'))

  if (CASE_STUDY_TYPES.has(type)) {
    check(R, 'case-studies', 'You show a customer\'s results in detail', () => pr.caseStudies
      ? r(R, 'case-studies', 1, 'You show a customer\'s results in detail', true, `Your homepage links to ${pr.caseStudies}.`, 'Case studies linked', 'A detailed story shows exactly what working with you gets.', '')
      : r(R, 'case-studies', 1, 'You show a customer\'s results in detail', false, '**No case studies or customer stories** linked from your homepage.', 'No case studies',
          '**Buyers comparing options want to see results**, not just promises.',
          'Write one short customer story: their problem, what they did with you, and the result in numbers. Link it from your homepage.'))
  }

  // ── Easy to trust ──
  const T = 'trust'
  if (SELLS_ONLINE.has(type)) {
    check(T, 'pricing', 'Pricing is easy to find', () => data.pricing.link || data.pricing.pricesOnPage
      ? r(T, 'pricing', 2, 'Pricing is easy to find', true,
          data.pricing.link ? `Your homepage links to your pricing (**${data.pricing.link}**).` : 'Your homepage shows prices.', 'Pricing one click away',
          'Visitors can check it fits their budget without asking.', '')
      : r(T, 'pricing', 2, 'Pricing is easy to find', false, '**No pricing link or prices** on your homepage.', 'Pricing hard to find',
          '**Hidden pricing makes people assume it\'s expensive**, and many leave instead of asking.',
          'Add a "Pricing" link to your top menu, or show your starting price near the main button.'))
  }
  if (COMMERCIAL.has(type)) {
    const label = 'There\'s a risk-free way to start'
    check(T, 'risk-free', label, () => data.riskFree
      ? r(T, 'risk-free', 2, label, true, `Your homepage offers ${quote(data.riskFree!, 50)}.`, 'Risk-free start offered', 'Lowering the risk makes the first "yes" easy.', '')
      : r(T, 'risk-free', 2, label, false,
          `**No free trial, free plan, guarantee or "no card needed"** on your homepage.`, 'No risk-free start',
          '**Asking for money or commitment up front stops people who are only curious.**',
          type === 'saas' ? 'Offer a free trial or free plan and say "no credit card needed" next to the main button.'
            : type === 'ecommerce' ? 'Show your returns or money-back promise near the "Buy" button.'
            : 'Offer a free first call, quote or consultation and say so next to the main button.'))
  }

  // ── Standing out ──
  const D = 'differentiation'
  if (COMMERCIAL.has(type)) {
    const label = 'Your homepage says why you over the alternatives'
    check(D, 'why-us', label, () => data.whyUs
      ? r(D, 'why-us', 2, label, true, `Your homepage has a section that sets you apart: ${quote(data.whyUs!, 70)}.`, 'Says why you', 'Visitors comparing options get a reason to pick you.', '')
      : r(D, 'why-us', 2, label, false,
          `**No "why us" section** on your homepage${data.competitors.length ? ` (people may be comparing you with ${names(data.competitors.slice(0, 3).map(c => c.name))})` : ''}.`,
          'No reason to pick you over others',
          '**Visitors comparing options can\'t see what makes you different**, so they choose on price or name.',
          'Add a short "Why [your brand]" section under the hero with 3 reasons only you can claim. See the ideas below for wording.'))
  }

  return out
}

// ── Ideas (Claude) ────────────────────────────────────────────────────────────

export async function analyzeBrandAudit(data: BrandAuditFetchResult, brainContext?: string): Promise<DynamicModuleAnalysisResult[]> {
  const rules = buildBrandRuleResults(data)
  const ideaCats = (BRAND_AUDIT_MODULE.categories as DynamicModuleCategoryDefinition[]).filter(c => c.insight)

  // Nothing to base ideas on when the page couldn't be read
  if (!data.homepageLoaded || data.homepageIsJsShell) return rules

  const failed = rules.filter(x => !x.verified && !x.detail.startsWith('Couldn\'t check'))
  const prompt = `${brainContext ? `=== About this brand ===\n${brainContext}\n\n` : ''}Brand: ${data.brandName || 'not provided'}
Website: ${data.websiteUrl} (${data.websiteType})
Industry: ${data.industry ?? 'not provided'}
Target audience: ${data.targetAudience ?? 'not provided'}
Main selling point: ${data.usp ?? 'not provided'}
Desired brand voice: ${data.brandVoice ?? 'not provided'}
Competitors: ${data.competitors.length ? data.competitors.map(c => `${c.name} (${c.url})`).join(', ') : 'none known'}

=== The homepage (facts) ===
Headline: ${data.h1 ? quote(data.h1, 200) : 'none'}
Top of the page: ${quote(data.topText, 700)}
Headings: ${data.headings.slice(0, 15).map(h => quote(h, 80)).join(' | ')}
"Why us" section: ${data.whyUs ? quote(data.whyUs, 80) : 'none'}
Proof found: ${[data.proof.testimonials, data.proof.logos, data.proof.numbers.join(', '), data.proof.reviewSites.map(s => s.name).join(', ')].filter(Boolean).join('; ') || 'none'}
Copy sample: ${quote(data.copySample, 1800)}

=== Checks that failed ===
${failed.length ? failed.map(f => `- ${f.label}: ${f.detail.replace(/\*\*/g, '')}`).join('\n') : 'none'}

=== Write ideas for these sections ===
${ideaCats.map(c => `--- "${c.slug}" (${c.label}) ---\n${c.prompt}`).join('\n\n')}

Return ONLY a JSON array. Each element:
{"category": one of ${ideaCats.map(c => `"${c.slug}"`).join(', ')}, "slug": "{category}-{short-descriptor}", "label": plain English title, "weight": 1|2|3 (priority), "detail": one sentence, the idea, key point in **double asterisks**, "highlight": 5–8 words, "narrative": one sentence on why it helps this brand, "action": the ready-to-use copy or concrete first step}`

  let ideas: Result[] = []
  try {
    const raw = await callAI({ system: BRAND_AUDIT_MODULE.systemPrompt, prompt, maxTokens: 4000 })
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
    console.error('[brand-audit] ideas failed', err)
  }

  // Unique slugs (two ideas with the same slug would overwrite each other)
  const seen = new Set<string>()
  return [...rules, ...ideas].filter(x => (seen.has(x.slug) ? false : (seen.add(x.slug), true)))
}
