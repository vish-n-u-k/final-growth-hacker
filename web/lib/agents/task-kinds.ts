// What kind of help a Search Agent to-do needs (shared by the page and lib/agents/task-help.ts).

import type { AgentTask } from './store'

// Review and software directories: listing the product there is free. `add` is where vendors
// start; when unknown it's the site itself (look for "list your product" / "for vendors").
export const DIRECTORIES: Record<string, { name: string; add?: string }> = {
  'g2.com': { name: 'G2', add: 'https://sell.g2.com/' },
  'capterra.com': { name: 'Capterra', add: 'https://www.capterra.com/vendors/sign-up' },
  'getapp.com': { name: 'GetApp', add: 'https://www.capterra.com/vendors/sign-up' },
  'softwareadvice.com': { name: 'Software Advice', add: 'https://www.capterra.com/vendors/sign-up' },
  'producthunt.com': { name: 'Product Hunt', add: 'https://www.producthunt.com/posts/new' },
  'trustpilot.com': { name: 'Trustpilot', add: 'https://business.trustpilot.com/' },
  'trustradius.com': { name: 'TrustRadius' },
  'alternativeto.net': { name: 'AlternativeTo' },
  'saasworthy.com': { name: 'SaaSworthy' },
  'sourceforge.net': { name: 'SourceForge' },
  'crozdesk.com': { name: 'Crozdesk' },
  'saashub.com': { name: 'SaaSHub' },
}

export type TaskHelp = 'describe' | 'directory' | 'article' | 'reddit' | 'other'

export const listingDomain = (t: AgentTask) => t.key.startsWith('listing:') ? t.key.slice('listing:'.length) : ''

export function helpOf(t: AgentTask): TaskHelp {
  if (t.key === 'fix:description') return 'describe'
  if (t.kind !== 'listing') return 'other'
  const dom = listingDomain(t)
  if (dom.includes('reddit.com')) return 'reddit'
  return DIRECTORIES[dom.replace(/^www\./, '')] ? 'directory' : 'article'
}
