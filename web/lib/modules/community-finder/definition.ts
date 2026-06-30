import type { ModuleDefinition } from '../types'

export const COMMUNITY_FINDER_MODULE: ModuleDefinition = {
  type: 'community-finder',
  name: 'Social Media Community Finder',
  description: 'Discover and analyze Facebook & LinkedIn communities where your audience hangs out.',
  order: 13,
  unlockThreshold: 80,
  dynamic: true,
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
      slug: 'facebook-communities',
      label: 'Facebook Communities',
      order: 1,
      prompt: 'Analyze Facebook communities.',
    },
    {
      slug: 'linkedin-communities',
      label: 'LinkedIn Communities',
      order: 2,
      prompt: 'Analyze LinkedIn communities.',
    },
    {
      slug: 'engagement-gaps',
      label: 'Opportunity Gaps',
      order: 3,
      prompt: 'Analyze competitor presence.',
    },
    {
      slug: 'community-priorities',
      label: 'Engagement Roadmap',
      order: 4,
      prompt: 'Create engagement roadmap.',
    },
  ],
}
