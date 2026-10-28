import { getSnapshot, saveSnapshot } from '@/lib/signals'
import type { ScoredLead } from './fit-score'

// The LinkedIn search's last form values and last results, one JSON document per brand in
// signal_snapshots, so opening the page again (or another tab and back) shows them without paying for
// another search or another AI read of the website.

export const LINKEDIN_KEY = 'agent:linkedin'

export interface SavedFilters {
  titles: string
  industries: string
  keywords: string
  technologies: string
  countries: string
  sizes: string[]
  count: number
  why: string
}

export interface SavedLinkedIn {
  filters: SavedFilters | null
  leads: ScoredLead[]
  searchedAt: string | null
  cursor?: { key: string; offset: number } | null   // how far into this search's matches we have read, so searching again brings new people
  hidden?: number                                     // people left out of the last search because they were already contacted
}

export async function readLinkedIn(brandId: string): Promise<SavedLinkedIn | null> {
  const d = await getSnapshot<SavedLinkedIn>(brandId, LINKEDIN_KEY).catch(() => null)
  return d ? { filters: d.filters ?? null, leads: d.leads ?? [], searchedAt: d.searchedAt ?? null, cursor: d.cursor ?? null, hidden: d.hidden ?? 0 } : null
}

/** Merges the change into the saved document (re-read first, so a detection and a search don't undo each other). */
export async function saveLinkedIn(brandId: string, change: Partial<SavedLinkedIn>) {
  const now = (await readLinkedIn(brandId)) ?? { filters: null, leads: [], searchedAt: null }
  await saveSnapshot(brandId, LINKEDIN_KEY, { ...now, ...change })
}
