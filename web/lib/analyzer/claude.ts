import Anthropic from '@anthropic-ai/sdk'
import { getAllItems, CHANNEL_SKELETONS } from '@/lib/data/skeleton'

export interface AnalysisResult {
  slug: string
  detail: string
  verified: boolean
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function analyzeWithClaude(
  url: string,
  html: string,
  robotsTxt: string | null,
  sitemapXml: string | null,
  channelType: string,
): Promise<AnalysisResult[]> {
  const skeleton = CHANNEL_SKELETONS[channelType]
  if (!skeleton) throw new Error(`No skeleton found for channel type: ${channelType}`)

  const items = getAllItems(skeleton).map((item) => ({
    slug: item.slug,
    prompt: item.prompt,
  }))

  const systemPrompt = `You are an expert SEO and marketing analyst performing a website audit.
You will be given a website's HTML, robots.txt, and sitemap.xml and a list of checks to run.

For each check:
- If it PASSES: write one short confirmation sentence with the actual value found (e.g. "Title tag present: 'AIFeed – Smart AI News' (28 chars)").
- If it FAILS or is suboptimal: first state the specific problem using the actual values found, then give ONE concrete action starting with an action verb (e.g. "Title tag is 74 chars — trim to under 60 by removing the 'Growth Hacker |' prefix.").

Always reference exact values: character counts, exact text, tag names, counts of missing items. Never give generic advice.
If you cannot determine something from the provided content, flag it as needing manual review and set verified to false.
Return ONLY a valid JSON array. No markdown fences, no explanation outside the JSON.`

  const userPrompt = `Audit this website and run every check in the list.

URL: ${url}

=== HTML (truncated) ===
${html}

=== robots.txt ===
${robotsTxt ?? 'Not found — flag this as missing'}

=== sitemap.xml ===
${sitemapXml ?? 'Not found — flag this as missing'}

=== Checks to run ===
${JSON.stringify(items, null, 2)}

Return a JSON array where each element has:
- "slug": exactly as given (string)
- "detail": specific finding — for passes, one confirmation sentence with real values; for failures, the specific problem + one action to fix it (string)
- "verified": true if fully passes, false if anything needs attention (boolean)`

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const raw = message.content[0].type === 'text' ? message.content[0].text : '[]'

  // Strip markdown fences if present
  const clean = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  let results: AnalysisResult[]
  try {
    results = JSON.parse(clean)
  } catch {
    throw new Error(`Claude returned invalid JSON: ${clean.slice(0, 200)}`)
  }

  // Validate shape — filter out any malformed entries
  return results.filter(
    (r) => typeof r.slug === 'string' && typeof r.detail === 'string' && typeof r.verified === 'boolean',
  )
}
