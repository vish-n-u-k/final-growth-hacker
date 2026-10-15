// What a page looks like in a Google result and as a shared link, read from its HTML (title,
// meta description, Open Graph / X card tags, favicon). Drawn as previews on the title,
// description and social-sharing checks (components/PagePreview.tsx); no extra fetching.

import type * as cheerio from 'cheerio'

export interface PagePreviewData {
  url: string
  title: string
  description: string
  siteName: string
  favicon: string
  og: { title: string; description: string; image: string }
  twitter: { card: string; title: string; description: string; image: string }
}

// Stored on module_items.ai_data for the check; `show` picks the preview.
export interface PagePreview extends PagePreviewData {
  kind: 'preview'
  show: 'google' | 'share'
}

export function isPagePreview(d: unknown): d is PagePreview {
  return !!d && typeof d === 'object' && (d as PagePreview).kind === 'preview'
}

export function readPagePreview($: cheerio.CheerioAPI, pageUrl: string): PagePreviewData {
  const abs = (v: string | undefined) => {
    if (!v) return ''
    try { return new URL(v.trim(), pageUrl).href } catch { return '' }
  }
  const meta = (sel: string) => $(sel).first().attr('content')?.replace(/\s+/g, ' ').trim() ?? ''
  const icon = $('link[rel~="icon"]').first().attr('href') ?? $('link[rel="apple-touch-icon"]').first().attr('href')
  return {
    url: pageUrl,
    title: $('title').first().text().replace(/\s+/g, ' ').trim(),
    description: meta('meta[name="description"]'),
    siteName: meta('meta[property="og:site_name"]'),
    favicon: abs(icon) || abs('/favicon.ico'),
    og: {
      title: meta('meta[property="og:title"]'),
      description: meta('meta[property="og:description"]'),
      image: abs(meta('meta[property="og:image"]') || meta('meta[property="og:image:url"]')),
    },
    twitter: {
      card: meta('meta[name="twitter:card"]'),
      title: meta('meta[name="twitter:title"]'),
      description: meta('meta[name="twitter:description"]'),
      image: abs(meta('meta[name="twitter:image"]') || meta('meta[name="twitter:image:src"]')),
    },
  }
}

// Which checks get which preview.
const GOOGLE = /^(has-title|meta-description|title\.|description\.)/
const SHARE = /^(og-tags|og\.|schema\.twitter-card)/

/** The preview to store on a failing check, or null when that check doesn't get one. */
export function previewFor(slug: string, data: PagePreviewData | undefined): PagePreview | null {
  if (!data) return null
  if (GOOGLE.test(slug)) return { kind: 'preview', show: 'google', ...data }
  if (SHARE.test(slug)) return { kind: 'preview', show: 'share', ...data }
  return null
}
