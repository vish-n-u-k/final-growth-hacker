export type ReminderCategory = 'marketplace' | 'content' | 'social' | 'seo' | 'outreach' | 'ads' | 'custom'

export interface ReminderPreset {
  title: string
  description?: string
  category: ReminderCategory
  intervalDays: number
}

const PRESETS_BY_TYPE: Record<string, ReminderPreset[]> = {
  ecommerce: [
    { title: 'Update Shopify/Etsy listings', category: 'marketplace', intervalDays: 30 },
    { title: 'Refresh product photos', category: 'marketplace', intervalDays: 60 },
    { title: 'Review and update pricing', category: 'marketplace', intervalDays: 30 },
    { title: 'Run a promotion/sale', category: 'content', intervalDays: 30 },
  ],
  saas: [
    { title: 'Update ProductHunt / AppSumo listing', category: 'marketplace', intervalDays: 60 },
    { title: 'Publish changelog post', category: 'content', intervalDays: 14 },
    { title: 'Reach out to churned users', category: 'outreach', intervalDays: 30 },
  ],
  local: [
    { title: 'Update Google Business Profile', category: 'seo', intervalDays: 30 },
    { title: 'Respond to new reviews', category: 'seo', intervalDays: 7 },
    { title: 'Post local event or offer', category: 'social', intervalDays: 14 },
  ],
  agency: [
    { title: 'Add new case study', category: 'content', intervalDays: 60 },
    { title: 'Update portfolio page', category: 'content', intervalDays: 60 },
    { title: 'Client check-in email', category: 'outreach', intervalDays: 30 },
  ],
  blog: [
    { title: 'Publish new article', category: 'content', intervalDays: 14 },
    { title: 'Refresh top 5 old posts', category: 'seo', intervalDays: 30 },
    { title: 'Build 5 new backlinks', category: 'seo', intervalDays: 30 },
  ],
  nonprofit: [
    { title: 'Update donation page / impact stats', category: 'content', intervalDays: 30 },
    { title: 'Newsletter to donors', category: 'outreach', intervalDays: 30 },
  ],
  event: [
    { title: 'Update event listing on Eventbrite/Meetup', category: 'marketplace', intervalDays: 14 },
    { title: 'Post event promo content', category: 'social', intervalDays: 7 },
  ],
  portfolio: [
    { title: 'Add new project', category: 'content', intervalDays: 60 },
    { title: 'Update skills/tools list', category: 'content', intervalDays: 90 },
  ],
}

const UNIVERSAL_PRESETS: ReminderPreset[] = [
  { title: 'Post on LinkedIn', category: 'social', intervalDays: 7 },
  { title: 'Reply to unanswered comments/DMs', category: 'social', intervalDays: 7 },
]

export function getPresetsForWebsiteType(websiteType: string | null): ReminderPreset[] {
  const typePresets = websiteType ? (PRESETS_BY_TYPE[websiteType] ?? []) : []
  return [...typePresets, ...UNIVERSAL_PRESETS]
}
