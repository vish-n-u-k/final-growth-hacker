import { getSnapshot, saveSnapshot } from '@/lib/signals'
import { EMPTY_ENGAGEMENT, type EngagementData } from './types'

export const ENGAGEMENT_KEY = 'agent:engagement'

export async function readEngagement(brandId: string): Promise<EngagementData> {
  const d = await getSnapshot<EngagementData>(brandId, ENGAGEMENT_KEY).catch(() => null)
  return d ? { ...EMPTY_ENGAGEMENT, ...d, leads: d.leads ?? [] } : { ...EMPTY_ENGAGEMENT, leads: [] }
}

/** Re-reads the latest document and applies the change to it, so a search finishing while the user marks a lead done keeps both. */
export async function updateEngagement(brandId: string, change: (d: EngagementData) => EngagementData | void): Promise<EngagementData> {
  const d = await readEngagement(brandId)
  const next = change(d) ?? d
  await saveSnapshot(brandId, ENGAGEMENT_KEY, next)
  return next
}
