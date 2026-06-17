import { callAI } from '@/lib/ai/client'
import { SOCIAL_MEDIA_MODULE } from './definition'
import type { DynamicModuleAnalysisResult, DynamicModuleCategoryDefinition } from '../types'
import type { SocialMediaFetchResult, SocialPlatformData } from './fetcher'

// ── Format helpers ─────────────────────────────────────────────────────────────

function formatPlatform(p: SocialPlatformData): string {
  const lines: string[] = []

  if (!p.connected && !p.detectedOnWebsite) {
    return `${p.platform.toUpperCase()}: Not connected, not detected on website`
  }

  if (!p.connected && p.detectedOnWebsite) {
    return `${p.platform.toUpperCase()}: Detected on website (social link found) but NOT connected — no API metrics available`
  }

  // Connected
  const status = p.fetchError
    ? `Connected but API fetch failed: ${p.fetchError}`
    : 'Connected'

  lines.push(`${p.platform.toUpperCase()}: ${status}`)

  if (!p.fetchError) {
    if (p.handle)         lines.push(`  Handle: ${p.handle}`)
    if (p.profileUrl)     lines.push(`  Profile: ${p.profileUrl}`)
    if (p.followerCount !== null) lines.push(`  Followers: ${p.followerCount.toLocaleString()}`)
    if (p.followingCount !== null) lines.push(`  Following: ${p.followingCount.toLocaleString()}`)
    if (p.postCount !== null)     lines.push(`  Total posts/videos: ${p.postCount.toLocaleString()}`)
    if (p.bio)            lines.push(`  Bio: "${p.bio.slice(0, 300)}"`)
    lines.push(`  Website in bio: ${p.websiteInBio ? 'Yes' : 'No'}`)
    lines.push(`  Profile image set: ${p.profileImageSet ? 'Yes' : 'Unknown'}`)
    if (p.lastPostDate)   lines.push(`  Last post: ${new Date(p.lastPostDate).toDateString()} (${daysSince(p.lastPostDate)} days ago)`)
    else                  lines.push(`  Last post: Unknown`)
    if (p.postsPerWeek !== null) lines.push(`  Posting rate: ~${p.postsPerWeek} posts/week`)
    else                  lines.push(`  Posting rate: Unknown`)
    if (p.engagementRate !== null) lines.push(`  Engagement rate: ${p.engagementRate}%`)
    else                  lines.push(`  Engagement rate: Not available`)
  }

  return lines.join('\n')
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

function buildPrompt(data: SocialMediaFetchResult, brainContext?: string): string {
  const categories = SOCIAL_MEDIA_MODULE.categories as DynamicModuleCategoryDefinition[]

  const platformsSection = data.platforms.map(formatPlatform).join('\n\n')

  const websiteLinksSection = data.socialLinksOnWebsite.length > 0
    ? data.socialLinksOnWebsite.map((l) => `  - ${l.platform}: ${l.url}`).join('\n')
    : '  None detected'

  const categoryInstructions = categories
    .map((c) => `--- Category: "${c.slug}" (label: "${c.label}") ---\n${c.prompt}`)
    .join('\n\n')

  return `${brainContext ? `=== Prior context about this brand ===\n${brainContext}\n\n` : ''}=== Brand Context ===
Brand: ${data.brandName || 'not provided'}
Website: ${data.websiteUrl}
Industry: ${data.industry ?? 'not provided — infer from website context'}
Target audience: ${data.targetAudience ?? 'not provided — infer from content'}

=== Social Platform Data ===

${platformsSection}

=== Social Links Found on Website Homepage ===
${websiteLinksSection}

=== Category Instructions ===
${categoryInstructions}

=== Output requirements ===
Analyse all platform data above. Generate findings for ALL 5 categories listed.

Return ONLY a valid JSON array. No markdown fences, no text outside the array. Each element:
{
  "category": string — exactly one of: "platform-presence", "profile-quality", "content-posting", "engagement-audience", "social-score",
  "slug": string — kebab-case, pattern: {category-slug}-{short-descriptor},
  "label": string — specific, cite actual platform names, metrics, or copy,
  "weight": 1 | 2 | 3,
  "detail": string — one sentence citing exact data (exact counts, exact dates, exact copy phrases),
  "narrative": string — 2–3 sentences explaining business impact,
  "action": string — specific step starting with a verb, completable within one week by a non-technical person,
  "verified": boolean — true if this check passes | false if gap exists,
  "fixable": boolean — true ONLY for website code changes (add social meta tags, add social links to footer/header). false for everything else
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
    maxTokens: 12000,
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
    throw new Error(`Social media agent returned invalid JSON: ${clean.slice(0, 300)}`)
  }

  const allowed = new Set([
    'platform-presence',
    'profile-quality',
    'content-posting',
    'engagement-audience',
    'social-score',
  ])

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
