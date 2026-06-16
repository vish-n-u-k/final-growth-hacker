import { callAI } from '@/lib/ai/client'
import { COMPETITOR_ANALYSIS_MODULE } from './definition'
import type { DynamicModuleAnalysisResult, DynamicModuleCategoryDefinition } from '../types'
import type { CompetitorAnalysisFetchResult, PsiScore } from './fetcher'

// ── Deterministic constants ───────────────────────────────────────────────────

const PLATFORMS: Record<string, { label: string; weight: 1 | 2 | 3 }> = {
  instagram:  { label: 'Instagram',  weight: 2 },
  facebook:   { label: 'Facebook',   weight: 1 },
  linkedin:   { label: 'LinkedIn',   weight: 2 },
  twitter:    { label: 'Twitter/X',  weight: 1 },
  tiktok:     { label: 'TikTok',     weight: 2 },
  youtube:    { label: 'YouTube',    weight: 2 },
}

const PIXELS: Record<string, { label: string; weight: 1 | 2 | 3; verb: string }> = {
  google_ads:       { label: 'Google Ads',             weight: 3, verb: 'running paid search campaigns' },
  facebook_pixel:   { label: 'Facebook/Meta Pixel',    weight: 2, verb: 'running Meta retargeting ads' },
  gtm:              { label: 'Google Tag Manager',     weight: 2, verb: 'using structured tag and analytics management' },
  linkedin_insight: { label: 'LinkedIn Insight Tag',   weight: 1, verb: 'tracking B2B visitors or running LinkedIn ads' },
  tiktok_pixel:     { label: 'TikTok Pixel',           weight: 1, verb: 'running TikTok ad campaigns' },
}

// ── Deterministic: social-gap ─────────────────────────────────────────────────

function buildSocialFindings(data: CompetitorAnalysisFetchResult): DynamicModuleAnalysisResult[] {
  const findings: DynamicModuleAnalysisResult[] = []

  for (const [platform, info] of Object.entries(PLATFORMS)) {
    const userHas = !!data.userParsed.social[platform]
    const competitorsWithIt = data.competitors.filter(c => !c.fetchFailed && !!c.parsed.social[platform])

    if (!userHas && competitorsWithIt.length > 0) {
      const first = competitorsWithIt[0].url
      findings.push({
        category: 'social-gap',
        slug: `social-gap-no-${platform}`,
        label: `No ${info.label} presence — ${competitorsWithIt.length} competitor${competitorsWithIt.length > 1 ? 's have' : ' has'} it`,
        weight: info.weight,
        detail: `Your site has no ${info.label} link. ${first} links to ${info.label} from their homepage.`,
        narrative: `${info.label} is an active discovery channel for your competitors. Absence signals lower community presence to visitors who look for social proof before buying. Even a low-frequency account builds brand awareness and trust.`,
        action: `Create a ${info.label} business account this week and add the link to your website footer. Post once to establish the profile, then commit to a consistent cadence.`,
        verified: false,
        fixable: false,
      })
    } else if (userHas && competitorsWithIt.length === 0) {
      findings.push({
        category: 'social-gap',
        slug: `social-gap-ahead-${platform}`,
        label: `You have ${info.label} — none of the analysed competitors do`,
        weight: 1,
        detail: `Your site links to ${info.label}. None of the analysed competitors have a visible ${info.label} link.`,
        narrative: `This is a differentiator. An active ${info.label} presence gives you a discovery and trust channel your competitors are not using.`,
        action: `Keep your ${info.label} profile active and on-brand. Consider mentioning it above the fold on your homepage to make it a visible trust signal.`,
        verified: true,
        fixable: false,
      })
    }
  }

  if (findings.length === 0) {
    findings.push({
      category: 'social-gap',
      slug: 'social-gap-on-par',
      label: 'Social media presence matches competitors',
      weight: 1,
      detail: 'Your site and the analysed competitors have similar social platform coverage on their homepages.',
      narrative: 'No material social media gaps detected from homepage link analysis. Parity does not mean equal performance — competitors with the same platforms may post more frequently.',
      action: 'Review posting frequency and engagement on each platform. Check competitor profiles directly to compare activity levels.',
      verified: true,
      fixable: false,
    })
  }

  return findings
}

// ── Deterministic: ad-gap ─────────────────────────────────────────────────────

function buildAdFindings(data: CompetitorAnalysisFetchResult): DynamicModuleAnalysisResult[] {
  const findings: DynamicModuleAnalysisResult[] = []

  for (const [pixel, info] of Object.entries(PIXELS)) {
    const userHas = !!data.userPixels[pixel]
    const competitorsWithIt = data.competitors.filter(c => !c.fetchFailed && !!c.pixels[pixel])

    if (!userHas && competitorsWithIt.length > 0) {
      const first = competitorsWithIt[0].url
      findings.push({
        category: 'ad-gap',
        slug: `ad-gap-no-${pixel.replace(/_/g, '-')}`,
        label: `${info.label} not installed — detected on ${competitorsWithIt.length} competitor${competitorsWithIt.length > 1 ? 's' : ''}`,
        weight: info.weight,
        detail: `${first} has ${info.label} installed — they are ${info.verb}. Your site has no ${info.label} script.`,
        narrative: `Without ${info.label}, you cannot retarget visitors or accurately measure ad ROI. Competitors with this infrastructure can follow your potential customers across the web after they leave without converting.`,
        action: `Install ${info.label} on your website. Search "[your CMS or website platform] + ${info.label} installation guide" for step-by-step instructions.`,
        verified: false,
        fixable: false,
      })
    }
  }

  if (findings.length === 0) {
    findings.push({
      category: 'ad-gap',
      slug: 'ad-gap-on-par',
      label: 'Ad tracking infrastructure matches competitors',
      weight: 1,
      detail: 'No significant gaps in ad network pixels detected between your site and the analysed competitors.',
      narrative: 'Your ad tracking setup is comparable to your competitors based on homepage script analysis.',
      action: 'Verify your pixels are firing correctly using Google Tag Assistant or Meta Pixel Helper browser extensions. Check for events beyond pageview (e.g. form submit, purchase).',
      verified: true,
      fixable: false,
    })
  }

  return findings
}

// ── Claude analysis ───────────────────────────────────────────────────────────

function formatPsi(psi: PsiScore | null): string {
  if (!psi) return 'not available'
  return `${psi.performance}/100 (LCP: ${psi.lcp}ms, CLS: ${psi.cls.toFixed(2)}, TBT: ${psi.tbt}ms)`
}

function formatUserSection(data: CompetitorAnalysisFetchResult): string {
  const u = data.userParsed
  return `=== Your website: ${data.userUrl} ===
Title: "${u.title}"
Meta description: "${u.description}"
H1: "${u.h1}" (total H1 count: ${u.h1Count})
H2 headings: ${u.h2s.length > 0 ? u.h2s.map(h => `"${h}"`).join(', ') : 'none found'}
First paragraph: "${u.firstParagraph}"
Schema markup: ${u.hasSchema ? 'Yes' : 'No'}
Images: ${u.imgCount} total, ${u.imgWithAlt} with alt text
Internal links: ~${u.internalLinks}
Distinctive TF-IDF terms: ${data.userTopTerms.join(', ')}
PageSpeed (mobile): ${formatPsi(data.userPsi)}
Body content sample:
${u.bodyText.slice(0, 2500)}`
}

function formatCompetitorSection(c: CompetitorAnalysisFetchResult['competitors'][number], index: number): string {
  if (c.fetchFailed) {
    return `=== Competitor ${index + 1}: ${c.url} ===
FETCH FAILED — could not access this site. Include in competitor discovery as "could not be verified". Skip all data-dependent checks for this competitor.`
  }
  const p = c.parsed
  return `=== Competitor ${index + 1}: ${c.url} ===
Title: "${p.title}"
Meta description: "${p.description}"
H1: "${p.h1}" (total H1 count: ${p.h1Count})
H2 headings: ${p.h2s.length > 0 ? p.h2s.map(h => `"${h}"`).join(', ') : 'none found'}
First paragraph: "${p.firstParagraph}"
Schema markup: ${p.hasSchema ? 'Yes' : 'No'}
Images: ${p.imgCount} total, ${p.imgWithAlt} with alt text
Internal links: ~${p.internalLinks}
Distinctive TF-IDF terms: ${c.topTerms.join(', ')}
PageSpeed (mobile): ${formatPsi(c.psi)}
Body content sample:
${p.bodyText.slice(0, 2000)}`
}

async function runClaudeAnalysis(
  data: CompetitorAnalysisFetchResult,
  socialFindings: DynamicModuleAnalysisResult[],
  adFindings: DynamicModuleAnalysisResult[],
  brainContext?: string,
): Promise<DynamicModuleAnalysisResult[]> {
  const categories = COMPETITOR_ANALYSIS_MODULE.categories as DynamicModuleCategoryDefinition[]

  const socialSummary = socialFindings.map(f => `• ${f.label} [${f.verified ? 'PASS' : 'GAP'}]`).join('\n')
  const adSummary = adFindings.map(f => `• ${f.label} [${f.verified ? 'PASS' : 'GAP'}]`).join('\n')

  // Category instructions — exclude social-gap and ad-gap (pre-computed)
  const categoryInstructions = categories
    .filter(c => c.slug !== 'social-gap' && c.slug !== 'ad-gap')
    .map(c => `--- Category: "${c.slug}" (label: "${c.label}") ---\n${c.prompt}`)
    .join('\n\n')

  const prompt = `${brainContext ? `=== What we already know about this brand ===\n${brainContext}\n\n` : ''}${formatUserSection(data)}

${data.competitors.map((c, i) => formatCompetitorSection(c, i)).join('\n\n')}

=== Industry keyword ===
${data.industry || 'Not provided — infer from homepage content and competitor data'}

=== Competitors source ===
${data.competitorsProvided
  ? 'User provided these URLs. Verify each is a real competitor based on content.'
  : 'No competitor URLs were provided. Infer 3–5 likely competitors from the user homepage and industry keyword. Flag each as "inferred — not confirmed".'}

=== Pre-computed findings (for SWOT context — do NOT generate separate social-gap or ad-gap findings) ===
Social media gaps:
${socialSummary}

Ad strategy gaps:
${adSummary}

=== Your task ===
Analyse all the data above. Return findings for EXACTLY these 6 categories: competitor-discovery, keyword-gap, content-gap, seo-gap, positioning, swot.
Do NOT return any findings with category "social-gap" or "ad-gap".

${categoryInstructions}

Return ONLY a valid JSON array. No markdown fences, no text outside the array. Each element:
{
  "category": string — must be one of: "competitor-discovery", "keyword-gap", "content-gap", "seo-gap", "positioning", "swot",
  "slug": string — kebab-case, pattern: {category-slug}-{short-descriptor},
  "label": string — short and specific; cite competitor URLs where relevant,
  "weight": 1 | 2 | 3,
  "detail": string — one sentence citing specific data points,
  "narrative": string — 2–3 sentences explaining why this matters for growth or revenue,
  "action": string — specific step starting with a verb; something a non-technical person can complete within a week,
  "verified": boolean — true if user is at parity or ahead; false if a gap exists,
  "fixable": false
}`

  const raw = await callAI({
    system: COMPETITOR_ANALYSIS_MODULE.systemPrompt,
    prompt,
    maxTokens: 16000,
  })

  const clean = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  let results: DynamicModuleAnalysisResult[]
  try {
    results = JSON.parse(clean)
  } catch {
    throw new Error(`Competitor analysis agent returned invalid JSON: ${clean.slice(0, 300)}`)
  }

  const allowed = new Set(['competitor-discovery', 'keyword-gap', 'content-gap', 'seo-gap', 'positioning', 'swot'])

  return results
    .filter(r =>
      typeof r.category === 'string' &&
      allowed.has(r.category) &&
      typeof r.slug === 'string' &&
      typeof r.label === 'string' &&
      (r.weight === 1 || r.weight === 2 || r.weight === 3) &&
      typeof r.detail === 'string' &&
      typeof r.narrative === 'string' &&
      typeof r.action === 'string' &&
      typeof r.verified === 'boolean',
    )
    .map(r => ({ ...r, fixable: typeof r.fixable === 'boolean' ? r.fixable : false }))
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function analyzeCompetitorAnalysis(
  data: CompetitorAnalysisFetchResult,
  brainContext?: string,
): Promise<DynamicModuleAnalysisResult[]> {
  const socialFindings = buildSocialFindings(data)
  const adFindings = buildAdFindings(data)
  const claudeFindings = await runClaudeAnalysis(data, socialFindings, adFindings, brainContext)

  return [...claudeFindings, ...socialFindings, ...adFindings]
}
