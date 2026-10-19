// Shared with the page (client-safe: no server imports).
// What Content Audit read, shown at the top of the module. It rides on the first check's aiData
// (see CONTENT_SUMMARY_SLUG) so it's stored with the results of each run.
export const CONTENT_SUMMARY_SLUG = 'content-library-blog'
export interface ContentOverview {
  pagesRead: number
  pagesFound: number
  postsFound: number
  newestPostDate: string | null
  typicalPostWords: number | null   // median words per article read
  unreadable: boolean               // blocked or built with JavaScript: page text couldn't be read
  searchClicks?: number | null      // clicks from Google in the last 90 days (Search Console); null/absent = not connected
}
