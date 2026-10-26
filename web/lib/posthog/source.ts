// Turns a person's first UTM source / referring domain into a readable source name.
// Short names (t.co, x.com, fb) must match the whole host or a whole word: a plain substring
// check made chatgpt.com ("chatgp-t.co-m") count as Twitter/X.
export function normalizeSource(utmSource: string, referringDomain: string): string {
  const src = (utmSource || referringDomain || '').toLowerCase().trim().replace(/^www\./, '')
  if (!src || src === '(direct)' || src === 'direct' || src === '$direct') return 'Direct'
  const host = (k: string) => src === k || src.endsWith(`.${k}`)
  const words = src.split(/[^a-z0-9]+/)
  if (src.includes('chatgpt') || host('openai.com')) return 'ChatGPT'
  if (src.includes('perplexity')) return 'Perplexity'
  if (host('claude.ai')) return 'Claude'
  if (host('gemini.google.com')) return 'Gemini'
  if (host('copilot.microsoft.com')) return 'Copilot'
  if (src.includes('instagram')) return 'Instagram'
  if (src.includes('facebook') || words.includes('fb') || host('fb.com') || host('fb.me')) return 'Facebook'
  if (src.includes('google')) return 'Google'
  if (src.includes('linkedin') || host('lnkd.in')) return 'LinkedIn'
  if (src.includes('twitter') || src === 'x' || host('t.co') || host('x.com')) return 'Twitter/X'
  if (src.includes('youtube') || host('youtu.be')) return 'YouTube'
  if (src.includes('tiktok')) return 'TikTok'
  // strip www. and return domain root
  const domain = referringDomain.replace(/^www\./, '').split('/')[0]
  return domain || utmSource || 'Direct'
}
