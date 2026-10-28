// What the social check finds for one lead's company (lib/leads/social-check.ts). Kept free of server
// code so the Lead Finder panel can import it.

export type SocialPlatform = 'instagram' | 'facebook' | 'x' | 'linkedin' | 'youtube' | 'tiktok' | 'pinterest'

// none      no social accounts linked from their website
// inactive  accounts, but the newest post we could read is more than INACTIVE_DAYS old
// active    accounts, and a post within INACTIVE_DAYS
// unknown   accounts, but we could not read when they last posted (only LinkedIn, X or YouTube, or the read failed)
// site      their website now points somewhere else, or does not load
export type SocialGroup = 'none' | 'inactive' | 'active' | 'unknown' | 'site'

export interface SocialAccount { platform: SocialPlatform; url: string }

export interface SocialCheck {
  checkedAt: string
  group: SocialGroup
  site: 'ok' | 'moved' | 'down'
  movedTo: string | null          // the website it now points to, when moved
  accounts: SocialAccount[]
  lastPostAt: string | null       // newest post found on Instagram or Facebook
  lastPostOn: SocialPlatform | null
}

export const INACTIVE_DAYS = 90

export const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  instagram: 'Instagram', facebook: 'Facebook', x: 'X', linkedin: 'LinkedIn', youtube: 'YouTube', tiktok: 'TikTok', pinterest: 'Pinterest',
}

export const GROUP_LABEL: Record<SocialGroup, string> = {
  inactive: 'Not active on social media',
  none: 'No social media found',
  active: 'Active on social media',
  unknown: 'Has accounts, activity not checked',
  site: 'Website changed or not working',
}

export const GROUP_ORDER: SocialGroup[] = ['inactive', 'none', 'active', 'unknown', 'site']

// One line under each group's name, so the groups explain themselves
export const GROUP_HINT: Record<SocialGroup, string> = {
  inactive: `They have accounts but have not posted in the last ${INACTIVE_DAYS} days.`,
  none: 'Their website does not link to any social accounts.',
  active: `They posted in the last ${INACTIVE_DAYS} days.`,
  unknown: 'They have accounts, but we can only read post dates on Instagram and Facebook.',
  site: 'Their website now points to another company or did not load. Unticked for you.',
}
