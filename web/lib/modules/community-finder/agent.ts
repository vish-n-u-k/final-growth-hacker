import type { DynamicModuleAnalysisResult } from '../types'
import type { CommunityFinderFetchResult, Community } from './types'
import { fetchCommunityDiscovery } from './fetcher'

const PLATFORM_LABEL: Record<Community['platform'], string> = {
  reddit: 'Reddit',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
}

const CATEGORY_BY_PLATFORM: Record<Community['platform'], string> = {
  reddit: 'reddit-communities',
  facebook: 'facebook-communities',
  linkedin: 'linkedin-communities',
}

function communityFinding(community: Community, idx: number): DynamicModuleAnalysisResult {
  const platform = PLATFORM_LABEL[community.platform]
  return {
    category: CATEGORY_BY_PLATFORM[community.platform],
    slug: `${community.platform}-${idx}`,
    label: `${community.name} (${community.memberCount.toLocaleString()} members)`,
    weight: community.relevanceScore > 85 ? 3 : community.relevanceScore > 70 ? 2 : 1,
    detail: `Activity: ${community.activityScore}/100 | Relevance: ${community.relevanceScore}/100`,
    narrative: `${community.name} is a ${community.memberCount > 50000 ? 'large' : 'mid-sized'} ${platform} community with ${community.activityScore > 60 ? 'high' : 'moderate'} engagement. A strong fit for your keywords — worth joining and observing before you engage.`,
    action: `1. Visit: ${community.link}\n2. Read the community rules (many ban self-promotion)\n3. Observe top posts and comments\n4. Identify pain points members mention\n5. Contribute for 1-2 weeks before posting anything of your own\n6. Share value-first content (no pitch initially)`,
    verified: false,
    fixable: false,
  }
}

// Emits findings for one Apify-backed platform (Facebook / LinkedIn): a
// connect-Apify prompt when the token isn't set, the discovered groups when it
// is, or an empty-result note.
function apifyPlatformFindings(
  platform: 'facebook' | 'linkedin',
  communities: Community[],
  apifyConnected: boolean,
): DynamicModuleAnalysisResult[] {
  const category = CATEGORY_BY_PLATFORM[platform]
  const label = PLATFORM_LABEL[platform]

  if (!apifyConnected) {
    return [
      {
        category,
        slug: `${platform}-connect-apify`,
        label: `Connect Apify to discover ${label} groups`,
        weight: 2,
        detail: `${label} discovery is not active yet.`,
        narrative: `${label} has no free or official way to search groups by keyword, so it needs a scraping backend. Apify covers it and its free tier ($5/month, no credit card) is enough for this module (~50-100 runs).`,
        action: `1. Go to console.apify.com → sign up free (Google sign-in, no card)\n2. Settings → API & Integrations → copy your API token\n3. In this app: Settings → Integrations → connect Apify\n4. Re-run this module to populate ${label} groups here`,
        verified: false,
        fixable: false,
      },
    ]
  }

  if (communities.length === 0) {
    return [
      {
        category,
        slug: `${platform}-no-results`,
        label: `No ${label} groups found`,
        weight: 1,
        detail: `${label} search returned no groups for these keywords.`,
        narrative: `Apify is connected, but no ${label} groups matched. This can happen with very niche or very broad keywords.`,
        action: 'Try different or more specific brand keywords, then re-run.',
        verified: false,
        fixable: false,
      },
    ]
  }

  return communities.map((c, idx) => communityFinding(c, idx))
}

export async function analyzeCommunitiesFinder(
  data: CommunityFinderFetchResult,
  brainContext?: string,
): Promise<DynamicModuleAnalysisResult[]> {
  const findings: DynamicModuleAnalysisResult[] = []
  const all = data.discovery?.communities ?? []
  const apifyConnected = !!data.apifyConnected

  const reddit = all.filter((c) => c.platform === 'reddit')
  const facebook = all.filter((c) => c.platform === 'facebook')
  const linkedin = all.filter((c) => c.platform === 'linkedin')

  // ── Reddit (free, always attempted) ──
  if (reddit.length > 0) {
    reddit.forEach((c, idx) => findings.push(communityFinding(c, idx)))
  } else {
    findings.push({
      category: 'reddit-communities',
      slug: 'reddit-no-results',
      label: 'No Reddit communities found',
      weight: 1,
      detail: data.fetchErrors[0] ?? 'Reddit search returned no results.',
      narrative: data.fetchErrors[0] ?? 'No subreddits matched these keywords.',
      action: 'Refine your brand keywords and run again. If the search was rate-limited, wait a minute first.',
      verified: false,
      fixable: false,
    })
  }

  // ── Facebook & LinkedIn (need Apify) ──
  findings.push(...apifyPlatformFindings('facebook', facebook, apifyConnected))
  findings.push(...apifyPlatformFindings('linkedin', linkedin, apifyConnected))

  // ── Engagement Roadmap (only meaningful with real communities) ──
  if (all.length > 0) {
    const topCommunities = [...all].sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, 3)
    const roadmapText = topCommunities
      .map(
        (c, idx) =>
          `**${idx + 1}. ${c.name}** (${PLATFORM_LABEL[c.platform]})
Members: ${c.memberCount.toLocaleString()} | Relevance: ${c.relevanceScore}/100
Week 1: Join & observe | Week 2: Comment on 3-5 posts | Week 3: Share original insight`,
      )
      .join('\n\n')

    findings.push({
      category: 'community-priorities',
      slug: 'phase-1-roadmap',
      label: `Prioritized roadmap: Top ${topCommunities.length} communities (30 days)`,
      weight: 3,
      detail: 'Launch engagement starting with highest-relevance communities.',
      narrative: `Start with these communities for maximum impact. Each offers strong member relevance, size, and engagement. Follow the week-by-week timeline to establish credibility and relationships before any promotional messaging.`,
      action: roadmapText,
      verified: false,
      fixable: false,
    })
  }

  return findings
}
