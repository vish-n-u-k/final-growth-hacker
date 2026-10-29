// The work tools, grouped by the job they do. The sidebar and the Tools page both read this list,
// so a tool has one name and one description everywhere. Growth Path and Today aren't in it:
// the sidebar pins them above the groups.

export interface ToolItem {
  href: string
  label: string
  desc: string // one line for the Tools page
  icon: string // components/ToolIcon
  pro?: boolean // needs GrowJin Pro when billing is on
  lockedType?: 'gmail-outreach' | 'meta-ads' // locked until the Growth Path module before it is further along
  gmail?: boolean // sends from the user's Gmail, so the Tools page shows whether Gmail is connected
}

export interface ToolGroup {
  label: string
  items: ToolItem[]
}

export const TOOL_GROUPS: ToolGroup[] = [
  // Find people, then contact them: the two lead sources feed the same Gmail outreach
  { label: 'Get customers', items: [
    // Lead Finder holds what the Lead Agent (/agents/leads) and Competitor Leads (/lead-finder) did;
    // both old addresses open it
    { href: '/leads', label: 'Lead Finder', icon: 'people', pro: true, gmail: true,
      desc: 'Finds shops, Etsy and Instagram sellers, Reddit posts and your competitors\' unhappy customers every morning, writes to them and follows up.' },
    { href: '/gmail-hub', label: 'Email Outreach', icon: 'mail', lockedType: 'gmail-outreach', pro: true, gmail: true,
      desc: 'Spot leads in your Gmail, send campaigns and follow up.' },
  ]},
  { label: 'Get seen', items: [
    { href: '/agents/search', label: 'Search Agent', icon: 'search', pro: true,
      desc: 'Picks keywords you can win, writes posts, finds sites to get links from and tracks your Google and AI rank.' },
    { href: '/social', label: 'Social Studio', icon: 'image', pro: true,
      desc: 'Plan, preview and schedule social posts with Frekto.' },
    { href: '/dashboard/meta-ads/blueprint', label: 'Meta Ads', icon: 'megaphone', pro: true, // live for everyone (no Growth Path progress lock)
      desc: 'Check your Meta setup and get a ready-to-launch campaign.' },
  ]},
  { label: 'Keep track', items: [
    { href: '/reminders', label: 'Reminders', icon: 'bell', pro: true,
      desc: 'Recurring checks, email follow-ups and alerts when something drops.' },
    { href: '/analytics', label: 'Analytics', icon: 'chart', pro: true,
      desc: 'Visitors, sign-ups and where they came from.' },
  ]},
]
