// Shared with the page (client-safe: no server imports).
// The side-by-side table at the top of Competitor Analysis. It rides on the first check's aiData
// (see COMPETITOR_SUMMARY_SLUG) so it's stored with the results of each run.
export const COMPETITOR_SUMMARY_SLUG = 'offer-pricing'

export interface ComparisonSite {
  name: string
  url: string
  you: boolean
  suggested: boolean           // GrowJin suggested this competitor; the user hasn't confirmed it
}
export interface ComparisonCell { ok: boolean | null; text: string }   // ok null = couldn't tell
export interface ComparisonTable {
  sites: ComparisonSite[]
  rows: { label: string; cells: ComparisonCell[] }[]
  unreachable: string[]        // listed but couldn't be read
  competitorUrls: string[]     // the list the next run will use (for the editor)
  achievable?: { name: string; url: string; why: string }[]   // similar-size competitors you can realistically catch
}
