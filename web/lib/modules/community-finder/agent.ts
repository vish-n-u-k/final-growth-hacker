import type { DynamicModuleAnalysisResult } from '../types'
import type { CommunityFinderFetchResult } from './types'
import { fetchCommunityDiscovery } from './fetcher'

export async function analyzeCommunitiesFinder(
  data: CommunityFinderFetchResult,
  brainContext?: string,
): Promise<DynamicModuleAnalysisResult[]> {
  const findings: DynamicModuleAnalysisResult[] = []

  if (!data.discovery || data.discovery.totalFound === 0) {
    findings.push({
      category: 'facebook-communities',
      slug: 'no-communities',
      label: 'No communities found',
      weight: 2,
      detail: 'Community discovery returned no results.',
      narrative: 'No communities matched your search. Try different keywords.',
      action: 'Refine your brand keywords and run analysis again.',
      verified: false,
      fixable: false,
    })
    return findings
  }

  // ── Facebook Communities ──
  data.discovery.facebookGroups.slice(0, 3).forEach((group, idx) => {
    findings.push({
      category: 'facebook-communities',
      slug: `facebook-${idx}`,
      label: `${group.name} (${group.memberCount.toLocaleString()} members)`,
      weight: group.relevanceScore > 85 ? 3 : group.relevanceScore > 70 ? 2 : 1,
      detail: `Activity: ${group.activityScore}/100 | Relevance: ${group.relevanceScore}/100 | Competitor: ${group.competitorPresence ? 'Yes' : 'No'}`,
      narrative: `${group.name} is a ${group.memberCount > 10000 ? 'large' : 'mid-sized'} community with ${group.activityScore > 75 ? 'high' : 'moderate'} engagement. ${group.competitorPresence ? 'Competitors present - differentiate your approach.' : 'No competitors - early opportunity to establish presence.'}`,
      action: `1. Visit: ${group.link}\n2. Observe top posts and comments\n3. Identify pain points members mention\n4. Join and lurk for 1 week\n5. Post value-first content (no pitch initially)`,
      verified: false,
      fixable: false,
    })
  })

  // ── LinkedIn Communities ──
  data.discovery.linkedinGroups.slice(0, 3).forEach((group, idx) => {
    findings.push({
      category: 'linkedin-communities',
      slug: `linkedin-${idx}`,
      label: `${group.name} (${group.memberCount.toLocaleString()} professionals)`,
      weight: group.relevanceScore > 80 ? 3 : 2,
      detail: `Relevance: ${group.relevanceScore}/100 | Activity: ${group.activityScore}/100 | B2B Opportunity: High`,
      narrative: `${group.name} attracts decision-makers and business professionals. ${group.activityScore > 70 ? 'Strong engagement.' : 'Steady engagement.'} ${group.competitorPresence ? 'Monitor competitor posts and differentiate.' : 'First-mover advantage in this space.'}`,
      action: `1. Review group: ${group.link}\n2. Analyze discussion themes\n3. Note best-performing content types\n4. Join and share thought leadership\n5. Build relationships with 3-5 key influencers`,
      verified: false,
      fixable: false,
    })
  })

  // ── Competitor Analysis ──
  const competitorCount =
    data.discovery.facebookGroups.filter((g) => g.competitorPresence).length +
    data.discovery.linkedinGroups.filter((g) => g.competitorPresence).length
  const untappedCount = data.discovery.totalFound - competitorCount

  findings.push({
    category: 'engagement-gaps',
    slug: 'competitor-gap-analysis',
    label: `${untappedCount} untapped | ${competitorCount} with competitors`,
    weight: untappedCount > 2 ? 3 : 2,
    detail: `Community saturation: ${competitorCount}/${data.discovery.totalFound} (${Math.round((competitorCount / data.discovery.totalFound) * 100)}%)`,
    narrative: `You have significant white space with ${untappedCount} communities where competitors haven't established presence. This is a major first-mover advantage. In shared communities, differentiate by addressing specific pain points competitors overlook.`,
    action: `Priority: Join ${untappedCount} untapped communities first. In competitive communities: study competitors' messaging, identify gaps, and lead with complementary value propositions.`,
    verified: false,
    fixable: false,
  })

  // ── Engagement Roadmap ──
  const topCommunities = [...data.discovery.facebookGroups, ...data.discovery.linkedinGroups]
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 3)

  const roadmapText = topCommunities
    .map(
      (c, idx) =>
        `**${idx + 1}. ${c.name}** (${c.platform === 'facebook' ? '👥 Facebook' : '💼 LinkedIn'})
Members: ${c.memberCount.toLocaleString()} | Relevance: ${c.relevanceScore}/100
${c.competitorPresence ? '⚠️ Competitive' : '✨ Untapped'}
Week 1: Join & observe | Week 2: Comment on 3-5 posts | Week 3: Share original insight`,
    )
    .join('\n\n')

  findings.push({
    category: 'community-priorities',
    slug: 'phase-1-roadmap',
    label: `Prioritized roadmap: Top ${topCommunities.length} communities (30 days)`,
    weight: 3,
    detail: 'Launch engagement starting with highest-relevance communities.',
    narrative: `Start with these communities for maximum impact. Each offers excellent member relevance, size, and engagement. Follow the week-by-week timeline to establish credibility and relationships before any promotional messaging.`,
    action: roadmapText,
    verified: false,
    fixable: false,
  })

  return findings
}
