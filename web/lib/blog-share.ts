import { createHmac, timingSafeEqual } from 'crypto'

// Signed, read-only link to one blog post as markdown, so Claude Code can download it and add it
// to the user's website without the GrowJin MCP connected. The signature is per post, so a link
// only ever exposes that one article (the same text the user is about to publish anyway).

function sig(blogId: string): string {
  return createHmac('sha256', process.env.CRON_SECRET ?? 'dev').update(`blog-md:${blogId}`).digest('hex').slice(0, 24)
}

export function blogMarkdownUrl(appUrl: string, blogId: string): string {
  return `${appUrl.replace(/\/$/, '')}/api/r/blog/${blogId}?s=${sig(blogId)}`
}

export function isValidBlogSig(blogId: string, given: string): boolean {
  const a = Buffer.from(sig(blogId))
  const b = Buffer.from(given)
  return a.length === b.length && timingSafeEqual(a, b)
}
