// Turns a person's first UTM source / referring domain into a readable source name.
export function normalizeSource(utmSource: string, referringDomain: string): string {
  const src = (utmSource || referringDomain || '').toLowerCase()
  if (!src || src === '(direct)' || src === 'direct' || src === '$direct') return 'Direct'
  if (src.includes('facebook') || src.includes('fb') || src === 'instagram') return src.includes('instagram') ? 'Instagram' : 'Facebook'
  if (src.includes('google')) return 'Google'
  if (src.includes('linkedin')) return 'LinkedIn'
  if (src.includes('twitter') || src.includes('t.co') || src === 'x') return 'Twitter/X'
  if (src.includes('youtube')) return 'YouTube'
  if (src.includes('tiktok')) return 'TikTok'
  // strip www. and return domain root
  const domain = referringDomain.replace(/^www\./, '').split('/')[0]
  return domain || utmSource || 'Direct'
}
