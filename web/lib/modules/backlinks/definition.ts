import type { ModuleDefinition } from '../types'

export const BACKLINKS_MODULE: ModuleDefinition = {
  relevantFor: ['saas', 'ecommerce', 'agency', 'blog', 'local'],
  type: 'backlinks',
  name: 'Backlinks & Link Building',
  tagline: 'build authority through quality backlinks',
  description: 'Raises authority for more organic traffic.',
  order: 96,
  placement: 'hidden',
  unlockThreshold: 80,
  dynamic: true,
  comingSoon: true,
  // Link building lives in the Search Agent (lib/agents/link-opportunities.ts): sites that link to or list
  // competitors but not the brand, each with a contact and a pitch. This module stays hidden.
  comingSoonNote: 'Link building is part of the Search Agent: every week it finds sites that link to your competitors or list them in "best of" articles but leave you out, and drafts a pitch for each. Open AI Agents → Search Agent → Link opportunities.',
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
