import { callAI } from '@/lib/ai/client'
import { SOCIAL_MEDIA_MODULE } from './definition'
import type { DynamicModuleAnalysisResult, DynamicModuleCategoryDefinition } from '../types'
import type { SocialMediaFetchResult, SocialPlatformData } from './fetcher'
import { parseClaudeJsonArray } from '@/lib/modules/parse-utils'

// ── Format helpers ─────────────────────────────────────────────────────────────

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

function formatApiPlatform(p: SocialPlatformData): string {
  const lines: string[] = []
  lines.push(`${p.platform.toUpperCase()} [API connected${p.fetchError ? ` — fetch failed: ${p.fetchError}` : ''}]`)
  if (!p.fetchError) {
    if (p.handle)              lines.push(`  Handle: ${p.handle}`)
    if (p.profileUrl)          lines.push(`  Profile URL: ${p.profileUrl}`)
    if (p.followerCount !== null) lines.push(`  Followers: ${p.followerCount.toLocaleString()}`)
    if (p.followingCount !== null) lines.push(`  Following: ${p.followingCount.toLocaleString()}`)
    if (p.postCount !== null)  lines.push(`  Total posts/videos: ${p.postCount.toLocaleString()}`)
    if (p.bio)                 lines.push(`  Bio: "${p.bio.slice(0, 300)}"`)
    lines.push(`  Website in bio: ${p.websiteInBio ? 'Yes' : 'No'}`)
    lines.push(`  Profile image set: ${p.profileImageSet ? 'Yes' : 'Unknown'}`)
    if (p.lastPostDate)        lines.push(`  Last post: ${new Date(p.lastPostDate).toDateString()} (${daysSince(p.lastPostDate)} days ago)`)
    else                       lines.push(`  Last post: Unknown`)
    if (p.postsPerWeek !== null) lines.push(`  Posting rate: ~${p.postsPerWeek} posts/week`)
    else                       lines.push(`  Posting rate: Unknown`)
    if (p.engagementRate !== null) lines.push(`  Engagement rate: ${p.engagementRate}%`)
    else                       lines.push(`  Engagement rate: Not available`)
  }
  return lines.join('\n')
}

function formatUrlPlatform(p: SocialPlatformData): string {
  const lines: string[] = [`${p.platform.toUpperCase()} [Profile URL provided — no API]`]
  lines.push(`  Profile URL: ${p.profileUrl}`)

  // HTTP status
  if (p.httpStatus !== null) {
    const note = p.httpStatus === 200 ? 'account confirmed active'
      : p.httpStatus === 404 ? 'account not found — may be deleted or URL wrong'
      : `HTTP ${p.httpStatus}`
    lines.push(`  HTTP status: ${p.httpStatus} (${note})`)
  } else {
    lines.push(`  HTTP status: Could not reach URL (timeout or DNS failure)`)
  }

  // Handle
  if (p.handle) lines.push(`  Handle (extracted from URL): ${p.handle}`)
  else          lines.push(`  Handle: Could not extract from URL`)

  // Scraped meta
  if (p.publicPageTitle) lines.push(`  Page title (scraped): "${p.publicPageTitle}"`)
  else                   lines.push(`  Page title: Not available (JS-rendered or blocked)`)

  if (p.bioFromHtml) lines.push(`  Bio (scraped): "${p.bioFromHtml}"`)
  else               lines.push(`  Bio: Not available from public HTML`)

  if (p.profileImageUrl) lines.push(`  Profile image: Set (og:image present)`)
  else                   lines.push(`  Profile image: Not detected in page HTML`)

  // Handle quality
  if (p.handleQuality) {
    const q = p.handleQuality
    lines.push(`  Handle quality:`)
    lines.push(`    Contains numbers: ${q.hasNumbers ? 'Yes (red flag)' : 'No'}`)
    lines.push(`    Contains underscores: ${q.hasUnderscores ? 'Yes' : 'No'}`)
    lines.push(`    Brand name match: ${q.matchesBrandName} (score ${q.matchScore}/100)`)
    lines.push(`    Handle length: ${q.length} characters`)
    lines.push(`    Professional: ${q.isProfessional ? 'Yes' : 'No'}`)
  }

  lines.push(`  Metrics: None — API token not connected`)
  return lines.join('\n')
}

function buildPrompt(data: SocialMediaFetchResult, brainContext?: string): string {
  const categories = SOCIAL_MEDIA_MODULE.categories as DynamicModuleCategoryDefinition[]

  // Split platforms by tier
  const apiPlatforms    = data.platforms.filter(p => p.tier === 'api_connected')
  const urlPlatforms    = data.platforms.filter(p => p.tier === 'url_provided')
  const homepageOnly    = data.platforms.filter(p => p.tier === 'homepage')
  const notFound        = data.platforms.filter(p => p.tier === 'none')

  const websiteLinksSection = data.socialLinksOnWebsite.length > 0
    ? data.socialLinksOnWebsite.map((l) => `  - ${l.platform}: ${l.url}`).join('\n')
    : '  None detected'

  const apiSection = apiPlatforms.length > 0
    ? apiPlatforms.map(formatApiPlatform).join('\n\n')
    : '  None'

  const urlSection = urlPlatforms.length > 0
    ? urlPlatforms.map(formatUrlPlatform).join('\n\n')
    : '  None — user has not added profile URLs in module setup'

  const homepageOnlySection = homepageOnly.length > 0
    ? homepageOnly.map(p => `  - ${p.platform.toUpperCase()}: Link found on website, no URL provided by user`).join('\n')
    : '  None'

  const notFoundSection = notFound.length > 0
    ? notFound.map(p => `  - ${p.platform.toUpperCase()}: Not detected anywhere`).join('\n')
    : '  All platforms accounted for'

  const categoryInstructions = categories
    .filter((c) => !c.comingSoon)
    .map((c) => `--- Category: "${c.slug}" (label: "${c.label}") ---\n${c.prompt}`)
    .join('\n\n')

  const consistency = data.handleConsistency
  const consistencySection = consistency.handles.length > 0
    ? [
        `Handles compared: ${consistency.handles.map(h => `${h.platform}=${h.handle}`).join(', ')}`,
        `Majority handle: ${consistency.majorityHandle ?? 'N/A'}`,
        `Consistent across platforms: ${consistency.isConsistent ? 'Yes' : 'No'} (score: ${consistency.consistencyScore}%)`,
        consistency.inconsistentPlatforms.length > 0
          ? `Inconsistent platforms: ${consistency.inconsistentPlatforms.join(', ')}`
          : '',
      ].filter(Boolean).join('\n')
    : 'No handles available for comparison (no profile URLs provided)'

  return `${brainContext ? `=== Prior context about this brand ===\n${brainContext}\n\n` : ''}=== Brand Context ===
Brand: ${data.brandName || 'not provided'}
Website: ${data.websiteUrl}
Industry: ${data.industry ?? 'not provided — infer from website context'}
Target audience: ${data.targetAudience ?? 'not provided — infer from content'}

=== TIER 1: Homepage Social Links Detected ===
${websiteLinksSection}

Platforms found on homepage only (link detected, no URL provided by user):
${homepageOnlySection}

=== TIER 2: User-Provided Profile URLs ===
${urlSection}

=== Cross-Platform Handle Consistency ===
${consistencySection}

=== TIER 3: API-Connected Platforms ===
${apiSection}

=== Platforms Not Found Anywhere ===
${notFoundSection}

=== Category Instructions ===
${categoryInstructions}

=== Output requirements ===
Generate findings for ALL 5 categories. Return ONLY a valid JSON array — no markdown fences, no text outside the array.

Each element:
{
  "category": string — exactly one of: "website-detection", "profile-analysis", "metrics-analysis", "content-strategy", "growth-playbook",
  "slug": string — kebab-case, pattern: {category-slug}-{short-descriptor},
  "label": string — plain English, no jargon; cite actual platform names or handles,
  "weight": 1 | 2 | 3,
  "detail": string — one plain English sentence explaining the finding; wrap the single most important data point in **double asterisks**,
  "highlight": string — 5–8 plain English words capturing the key point; no jargon, no period,
  "narrative": string — exactly 1 plain English sentence explaining why this matters for the business; wrap the key impact in **double asterisks**,
  "action": string — specific step starting with a verb, completable within one week; technical specifics allowed here; wrap the specific thing to do in **double asterisks**,
  "verified": boolean — true if check passes | false if gap exists,
  "fixable": boolean — true ONLY for website code changes (add social meta tags, add social links to header/footer). false for everything else
}`
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function analyzeSocialMedia(
  data: SocialMediaFetchResult,
  brainContext?: string,
): Promise<DynamicModuleAnalysisResult[]> {
  const prompt = buildPrompt(data, brainContext)

  const raw = await callAI({
    system: SOCIAL_MEDIA_MODULE.systemPrompt,
    prompt,
    maxTokens: 8000,
    model: 'claude-haiku-4-5-20251001',
  })

  let results: DynamicModuleAnalysisResult[]
  try {
    results = parseClaudeJsonArray(raw) as DynamicModuleAnalysisResult[]
  } catch (err) {
    throw new Error(`Social media agent returned invalid JSON: ${err instanceof Error ? err.message : raw.slice(0, 300)}`)
  }

  const allowed = new Set(['website-detection', 'profile-analysis', 'metrics-analysis', 'content-strategy', 'growth-playbook'])

  return results
    .filter(
      (r) =>
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
    .map((r) => ({ ...r, fixable: typeof r.fixable === 'boolean' ? r.fixable : false }))
}
