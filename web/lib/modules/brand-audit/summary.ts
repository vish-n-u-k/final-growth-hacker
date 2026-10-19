// Shared with the page (client-safe: no server imports).
// What Brand Audit compared the homepage against, shown at the top of the module. It rides on the
// first check's aiData (see BRAND_SUMMARY_SLUG) so it's stored with the results of each run.
export const BRAND_SUMMARY_SLUG = 'positioning-audience'
export interface BrandBasis {
  headline: string | null       // the homepage's main headline as we read it
  pageRead: boolean             // false: blocked or built with JavaScript, so nothing was read
  audience: string | null       // from the brand profile (Settings → Brand)
  usp: string | null
  voice: string | null
}
