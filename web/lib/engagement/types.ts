// Engagement Leads: accounts and threads a brand should follow, comment on and reply to, found from
// what its buyers do on Reddit and Instagram. One JSON document per brand in signal_snapshots.

export type EngagementPlatform = 'reddit' | 'instagram'
export type EngagementType = 'asking_for_help' | 'buyer' | 'hub' | 'competitor_follower'
export type EngagementStatus = 'to_do' | 'followed' | 'commented' | 'replied' | 'skip'

/** What the search looks for, written from the brand and editable by the user. */
export interface EngagementProfile {
  buyer: string              // who the brand sells to, in plain words
  problem: string            // what those people struggle with
  phrases: string[]          // how buyers describe the problem in their own words (Reddit)
  subreddits: string[]       // names without r/
  hashtags: string[]         // tags the buyers use, without #
  competitors: string[]      // Instagram handles of competitors, without @
  exclude: string[]          // kinds of accounts to leave out (agencies, resellers, ...)
  by: 'ai' | 'user'
  at: string
}

export interface EngagementLead {
  id: string
  platform: EngagementPlatform
  type: EngagementType
  handle: string             // @account, or the thread title for Reddit
  title: string | null       // thread title (Reddit) or first words of the post
  url: string                // the post or thread
  profileUrl: string | null
  niche: string              // one short phrase
  action: 'follow + comment' | 'reply in thread' | 'comment regularly'
  why: string                // one short line
  excerpt: string | null     // what they wrote, cut short
  engagement: number | null  // comments or likes
  postedAt: string | null
  status: EngagementStatus
  foundAt: string
  doneAt?: string
}

export interface EngagementRun {
  at: string
  found: number              // new leads added
  checked: number            // candidates read
  cost: number               // estimated Apify dollars
  notes: string[]            // short, plain: what did not work
}

export interface EngagementData {
  profile: EngagementProfile | null
  leads: EngagementLead[]
  lastRun: EngagementRun | null
}

export const EMPTY_ENGAGEMENT: EngagementData = { profile: null, leads: [], lastRun: null }

export const STATUS_LABEL: Record<EngagementStatus, string> = {
  to_do: 'To do', followed: 'Followed', commented: 'Commented', replied: 'Replied', skip: 'Skipped',
}

/** The statuses a lead can move to, by platform (Reddit has no follow step). */
export const STATUS_CHOICES: Record<EngagementPlatform, EngagementStatus[]> = {
  instagram: ['followed', 'commented'],
  reddit: ['commented', 'replied'],
}
