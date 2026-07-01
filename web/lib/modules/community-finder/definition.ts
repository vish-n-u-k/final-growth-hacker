import type { ModuleDefinition } from '../types'

export const COMMUNITY_FINDER_MODULE: ModuleDefinition = {
  type: 'community-finder',
  name: 'Social Media Community Finder',
  description: 'Discover real, active communities where your audience hangs out — Reddit free, plus Facebook & LinkedIn when Apify is connected.',
  order: 13,
  unlockThreshold: 80,
  dynamic: true,
  comingSoon: true,
  comingSoonNote: 'Community discovery requires Facebook Groups API access (currently in restricted review) and Reddit community search. We are building this with real data sources — live community recommendations are coming soon.',
  requirements: [
    {
      key: 'brand_keywords',
      label: 'Brand Keywords',
      type: 'text',
      placeholder: 'e.g. AI, content creation, marketing',
      required: true,
    },
  ],
  systemPrompt: 'Analyze communities and generate findings.',
  categories: [
    {
      slug: 'reddit-communities',
      label: 'Reddit Communities',
      order: 1,
      prompt: 'Analyze Reddit communities.',
    },
    {
      slug: 'facebook-communities',
      label: 'Facebook Communities',
      order: 2,
      prompt: 'Analyze Facebook communities.',
    },
    {
      slug: 'linkedin-communities',
      label: 'LinkedIn Communities',
      order: 3,
      prompt: 'Analyze LinkedIn communities.',
    },
    {
      slug: 'community-priorities',
      label: 'Engagement Roadmap',
      order: 4,
      prompt: 'Create engagement roadmap.',
    },
  ],
}
