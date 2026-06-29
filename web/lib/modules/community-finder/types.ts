export interface Community {
  id: string
  platform: 'facebook' | 'linkedin'
  platformId: string
  name: string
  description?: string
  link: string
  memberCount: number
  activityScore: number // 0-100
  relevanceScore: number // 0-100
  competitorPresence: boolean
  healthScore?: number // 0-100
  lastAnalyzedAt?: string
  createdAt: string
  updatedAt: string
}

export interface CommunityAnalysisData {
  communityId: string
  sentimentPositive: number // percentage
  sentimentNeutral: number
  sentimentNegative: number
  painPoints: Array<{
    pain: string
    frequency: number
  }>
  cultureSummary: string
  topPosts: Array<{
    title: string
    engagement: number
  }>
  analyzedAt: string
}

export interface EngagementStrategyData {
  communityId: string
  conversationStarters: string[]
  valuePosts: string[]
  softPitches: string[]
  optimalTimes: Array<{
    day: string
    time: string
  }>
  replyStrategy: string
  createdAt: string
  updatedAt: string
}

export interface CommunityPerformanceMetric {
  communityId: string
  date: string // YYYY-MM-DD
  postsShared: number
  commentsReceived: number
  reactionsReceived: number
  sharesReceived: number
  repliesPosted: number
  websiteVisits: number
  trialSignups: number
  sentimentScore: number // 0-100
  engagementRate: number // percentage
  createdAt: string
}

export interface DiscoveryResult {
  facebookGroups: Community[]
  linkedinGroups: Community[]
  totalFound: number
  completedAt: string
}

export interface CommunityFinderFetchResult {
  connected: boolean
  brandId: string
  brandName: string
  websiteUrl: string
  keywords: string[]
  discovery?: DiscoveryResult
  fetchErrors: string[]
}
