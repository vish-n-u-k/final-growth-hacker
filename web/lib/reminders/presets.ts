export type ReminderCategory = 'marketplace' | 'app-store' | 'directory' | 'profile' | 'custom'

export interface ReminderPreset {
  title: string
  category: ReminderCategory
  intervalDays: number
}

const PRESETS_BY_TYPE: Record<string, ReminderPreset[]> = {
  ecommerce: [
    { title: 'Refresh product photos', category: 'marketplace', intervalDays: 60 },
    { title: 'Update product descriptions', category: 'marketplace', intervalDays: 90 },
    { title: 'Review and update pricing', category: 'marketplace', intervalDays: 30 },
    { title: 'Update shipping & return policy', category: 'marketplace', intervalDays: 90 },
  ],
  saas: [
    { title: 'Refresh G2 / Capterra profile', category: 'directory', intervalDays: 60 },
    { title: 'Update ProductHunt listing', category: 'profile', intervalDays: 90 },
    { title: 'Refresh AppSumo listing', category: 'marketplace', intervalDays: 60 },
    { title: 'Update App Store / Play Store listing', category: 'app-store', intervalDays: 60 },
    { title: 'Refresh pricing page', category: 'profile', intervalDays: 30 },
  ],
  local: [
    { title: 'Update Google Business Profile', category: 'directory', intervalDays: 30 },
    { title: 'Refresh Yelp listing', category: 'directory', intervalDays: 60 },
    { title: 'Update business hours on all directories', category: 'directory', intervalDays: 90 },
  ],
  agency: [
    { title: 'Refresh Clutch / UpWork profile', category: 'directory', intervalDays: 60 },
    { title: 'Update Crunchbase listing', category: 'profile', intervalDays: 90 },
    { title: 'Refresh portfolio on all directories', category: 'profile', intervalDays: 60 },
  ],
  blog: [
    { title: 'Update author bio on all platforms', category: 'profile', intervalDays: 90 },
    { title: 'Refresh Medium / Substack profile', category: 'profile', intervalDays: 60 },
  ],
  nonprofit: [
    { title: 'Update GuideStar / Charity Navigator profile', category: 'directory', intervalDays: 90 },
    { title: 'Refresh Facebook / GiveLively fundraiser page', category: 'marketplace', intervalDays: 60 },
  ],
  event: [
    { title: 'Update Eventbrite listing', category: 'marketplace', intervalDays: 14 },
    { title: 'Refresh Meetup group description', category: 'directory', intervalDays: 30 },
  ],
  portfolio: [
    { title: 'Add new project to Behance / Dribbble', category: 'profile', intervalDays: 60 },
    { title: 'Update LinkedIn featured work', category: 'profile', intervalDays: 90 },
  ],
}

const UNIVERSAL_PRESETS: ReminderPreset[] = [
  { title: 'Update LinkedIn company page', category: 'profile', intervalDays: 60 },
]

export function getPresetsForWebsiteType(websiteType: string | null): ReminderPreset[] {
  const typePresets = websiteType ? (PRESETS_BY_TYPE[websiteType] ?? []) : []
  return [...typePresets, ...UNIVERSAL_PRESETS]
}
