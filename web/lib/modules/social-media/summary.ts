import type { SocialPlatformData, SocialProvider } from './fetcher'

// Shared with the page (client-safe: no server imports).
// One row per platform for the "Your profiles" overview at the top of the module. It rides on the
// first check's aiData (see SOCIAL_SUMMARY_SLUG) so it's stored with the results of each run.
export const SOCIAL_SUMMARY_SLUG = 'website-detection-links'
export interface SocialProfileSummary {
  platform: SocialProvider
  url: string | null
  handle: string | null
  onWebsite: boolean
  link: SocialPlatformData['link']
  followers: number | null
  lastPostDate: string | null
  nextPostDate: string | null
  connected: boolean              // followers, posting and engagement read from a connected account
}
