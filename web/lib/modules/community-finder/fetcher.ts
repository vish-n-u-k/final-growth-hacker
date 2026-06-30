import type { CommunityFinderFetchResult, Community } from './types'

// Mock community data for initial launch
// TODO: Replace with real Facebook/LinkedIn API calls in production
const MOCK_FACEBOOK_COMMUNITIES: Community[] = [
  {
    id: 'fb-1',
    platform: 'facebook',
    platformId: '158816184076410',
    name: 'Digital Marketing Tips',
    description: 'Community for digital marketers and content creators sharing strategies and insights',
    link: 'https://www.facebook.com/groups/digitalmarketingtips/',
    memberCount: 152340,
    activityScore: 85,
    relevanceScore: 92,
    competitorPresence: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'fb-2',
    platform: 'facebook',
    platformId: '2156484841090',
    name: 'Entrepreneurs & Business Owners',
    description: 'Supporting entrepreneurs with business growth strategies and networking',
    link: 'https://www.facebook.com/groups/entrepreneursbusinessowners/',
    memberCount: 84520,
    activityScore: 78,
    relevanceScore: 88,
    competitorPresence: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'fb-3',
    platform: 'facebook',
    platformId: '2156437857654',
    name: 'Social Media Marketing Strategies',
    description: 'Discussion and tips for social media marketing best practices',
    link: 'https://www.facebook.com/groups/socialmediamarketingstrategies/',
    memberCount: 121000,
    activityScore: 72,
    relevanceScore: 82,
    competitorPresence: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]

const MOCK_LINKEDIN_COMMUNITIES: Community[] = [
  {
    id: 'li-1',
    platform: 'linkedin',
    platformId: 'search-marketing',
    name: 'Marketing & Business Growth',
    description: 'Network of marketing leaders and professionals sharing strategies',
    link: 'https://www.linkedin.com/search/results/groups/?keywords=marketing%20professionals',
    memberCount: 512000,
    activityScore: 75,
    relevanceScore: 85,
    competitorPresence: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'li-2',
    platform: 'linkedin',
    platformId: 'search-entrepreneurs',
    name: 'Entrepreneurs & Startup Communities',
    description: 'Community for entrepreneurs, startup founders, and business builders',
    link: 'https://www.linkedin.com/search/results/groups/?keywords=entrepreneurs%20startups',
    memberCount: 89000,
    activityScore: 68,
    relevanceScore: 80,
    competitorPresence: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]

export async function fetchCommunityDiscovery(
  requirements: Record<string, string>,
): Promise<CommunityFinderFetchResult> {
  const brandId = requirements['brand_id'] ?? ''
  const brandName = requirements['brand_name'] ?? ''
  const websiteUrl = requirements['website_url'] ?? ''
  const keywords = (requirements['brand_keywords'] ?? '').split(',').map((k) => k.trim())
  const targetPlatforms = (requirements['target_platforms'] ?? 'facebook,linkedin')
    .split(',')
    .map((p) => p.trim().toLowerCase())

  const base: CommunityFinderFetchResult = {
    connected: true,
    brandId,
    brandName,
    websiteUrl,
    keywords,
    fetchErrors: [],
  }

  if (!brandId || keywords.length === 0) {
    base.fetchErrors.push('Brand ID and keywords are required')
    base.connected = false
    return base
  }

  const facebookGroups: Community[] = targetPlatforms.includes('facebook')
    ? MOCK_FACEBOOK_COMMUNITIES
    : []

  const linkedinGroups: Community[] = targetPlatforms.includes('linkedin')
    ? MOCK_LINKEDIN_COMMUNITIES
    : []

  base.discovery = {
    facebookGroups,
    linkedinGroups,
    totalFound: facebookGroups.length + linkedinGroups.length,
    completedAt: new Date().toISOString(),
  }

  return base
}
