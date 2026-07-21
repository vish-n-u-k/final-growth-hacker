import type { ModuleDefinition } from '../types'

export const BACKLINKS_MODULE: ModuleDefinition = {
  type: 'backlinks',
  name: 'Backlinks & Link Building',
  tagline: 'build authority through quality backlinks',
  description: 'Raises authority for more organic traffic.',
  order: 6,
  unlockThreshold: 80,
  dynamic: true,
  comingSoon: true,
  comingSoonNote: 'Full link profile auditing — toxic link detection, competitor backlink gap analysis, anchor text distribution, and domain authority scoring — requires DataForSEO API integration. This module is in active development.',
  requirements: [],
  systemPrompt: '',
  categories: [
    { slug: 'link-profile', label: 'Link Profile Audit', order: 1, prompt: '' },
    { slug: 'competitor-link-gap', label: 'Competitor Link Gap', order: 2, prompt: '' },
    { slug: 'toxic-links', label: 'Toxic Link Detection', order: 3, prompt: '' },
    { slug: 'lost-links', label: 'Lost Link Reclamation', order: 4, prompt: '' },
    { slug: 'anchor-text', label: 'Anchor Text Analysis', order: 5, prompt: '' },
    { slug: 'outreach-targets', label: 'Link Building Opportunities', order: 6, prompt: '' },
  ],
}
