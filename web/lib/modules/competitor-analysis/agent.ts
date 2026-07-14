import { callAI } from '@/lib/ai/client'
import { COMPETITOR_ANALYSIS_MODULE } from './definition'
import type { DynamicModuleAnalysisResult, DynamicModuleCategoryDefinition } from '../types'
import type { CompetitorAnalysisFetchResult, PsiScore } from './fetcher'
import { parseClaudeJsonArray } from '@/lib/modules/parse-utils'

// ── Helper: truncate body text to keyword context ──────────────────────────────

function truncateToKeywordContext(bodyText: string, seedKeyword: string): string {
  if (!bodyText || !seedKeyword) return bodyText.slice(0, 300)

  const keywordLower = seedKeyword.toLowerCase()
  const bodyLower = bodyText.toLowerCase()
  const keywordIndex = bodyLower.indexOf(keywordLower)

  if (keywordIndex === -1) return bodyText.slice(0, 300)

  // Split by sentence markers
  const sentences = bodyText.split(/(?<=[.!?])\s+/)

  // Find which sentence contains the keyword
  let currentPos = 0
  let targetSentenceIdx = 0
  for (let i = 0; i < sentences.length; i++) {
    if (currentPos + sentences[i].length > keywordIndex) {
      targetSentenceIdx = i
      break
    }
    currentPos += sentences[i].length + 1
  }

  // Extract 3 sentences before and after (inclusive of target)
  const startIdx = Math.max(0, targetSentenceIdx - 3)
  const endIdx = Math.min(sentences.length - 1, targetSentenceIdx + 3)

  return sentences.slice(startIdx, endIdx + 1).join(' ').trim()
}

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
        detail: `Your site has no ${info.label} link. **${first}** links to ${info.label} from their homepage.`,
        highlight: `missing ${info.label} — competitors already active`,
        narrative: `Absence signals lower community presence to visitors who look for social proof before buying.`,
        action: `Create a **${info.label} business account** this week, add the link to your footer, and post once to establish the profile.`,
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
        highlight: `${info.label} advantage — no competitors active`,
        narrative: `An active ${info.label} presence gives you a discovery and trust channel your competitors are not using.`,
        action: `Mention your **${info.label}** above the fold on your homepage to make it a visible trust signal.`,
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
      highlight: 'social parity — check posting frequency',
      narrative: 'No material social media gaps detected from homepage link analysis — but parity in presence does not mean equal performance.',
      action: 'Check competitor profiles directly to compare posting frequency and engagement levels.',
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
        detail: `**${first}** has ${info.label} installed — they are ${info.verb}. Your site has no ${info.label} script.`,
        highlight: `no ${info.label} — competitors retargeting your visitors`,
        narrative: `Without ${info.label}, you cannot retarget visitors or measure ad ROI while competitors follow your potential customers across the web.`,
        action: `Install **${info.label}** — search "[your platform] + ${info.label} installation guide" and complete setup this week.`,
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
      highlight: 'ad tracking parity — verify events firing',
      narrative: 'Your ad tracking setup is comparable to competitors based on homepage script analysis.',
      action: 'Verify your pixels are firing correctly using **Google Tag Assistant** or **Meta Pixel Helper** — check for events beyond pageview.',
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
${data.userUrlProfile}`
}

function formatCompetitorSection(c: CompetitorAnalysisFetchResult['competitors'][number], index: number): string {
  if (c.fetchFailed) {
    return `=== Competitor ${index + 1}: ${c.url} ===
FETCH FAILED — could not access this site. Include in competitor discovery as "could not be verified". Skip all data-dependent checks for this competitor.
${c.urlProfile}`
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
${c.urlProfile}`
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
Analyse all the data above. Return findings for EXACTLY these 7 categories: competitor-discovery, feature-comparison, keyword-gap, content-gap, seo-gap, positioning, swot.
Do NOT return any findings with category "social-gap" or "ad-gap".

${categoryInstructions}

Return ONLY a valid JSON array. No markdown fences, no text outside the array. Each element:
{
  "category": string — must be one of: "competitor-discovery", "feature-comparison", "keyword-gap", "content-gap", "seo-gap", "positioning", "swot",
  "slug": string — kebab-case, pattern: {category-slug}-{short-descriptor},
  "label": string — plain English, no jargon; short description of what was found or what is missing; cite competitor names where relevant,
  "weight": 1 | 2 | 3,
  "detail": string — one plain English sentence explaining the finding; wrap the single most important data point (competitor name, number, or keyword) in **double asterisks**,
  "highlight": string — 5–8 plain English words capturing the key point; no jargon, no period, no full sentence,
  "narrative": string — exactly 1 plain English sentence explaining why this matters for the business; wrap the key impact in **double asterisks**,
  "action": string — exactly 1 sentence starting with a verb; technical specifics and jargon allowed here; wrap the specific tool, page name, or term to act on in **double asterisks**,
  "verified": boolean — true if user is at parity or ahead; false if a gap exists,
  "fixable": false
}`

  const raw = await callAI({
    system: COMPETITOR_ANALYSIS_MODULE.systemPrompt,
    prompt,
    maxTokens: 5000,
    model: 'claude-haiku-4-5-20251001',
  })

  let results: DynamicModuleAnalysisResult[]
  try {
    results = parseClaudeJsonArray(raw) as DynamicModuleAnalysisResult[]
  } catch (err) {
    throw new Error(`Competitor analysis agent returned invalid JSON: ${err instanceof Error ? err.message : raw.slice(0, 300)}`)
  }

  const allowed = new Set(['competitor-discovery', 'feature-comparison', 'keyword-gap', 'content-gap', 'seo-gap', 'positioning', 'swot'])

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
