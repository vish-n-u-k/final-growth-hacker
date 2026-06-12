import Anthropic from '@anthropic-ai/sdk'
import { FOUNDATION_MODULE } from './definition'
import { getAllItems, type ModuleAnalysisResult } from '../types'
import type { FoundationFetchResult } from './fetcher'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function analyzeFoundation(data: FoundationFetchResult): Promise<ModuleAnalysisResult[]> {
  const items = getAllItems(FOUNDATION_MODULE).map((item) => ({
    slug: item.slug,
    prompt: item.prompt,
  }))

  const userPrompt = `Audit this website's foundational infrastructure.

URL: ${data.url}

=== HTML (full head preserved + truncated body) ===
${data.html || 'Unable to fetch — flag all checks as needing manual review'}

=== Checks to run ===
${JSON.stringify(items, null, 2)}

For each check return exactly:
- "slug": string — exactly as given
- "detail": string — one sentence: state what was found (with actual values) if it passes; state the specific problem if it fails
- "narrative": string — 2–3 sentences explaining WHY this matters for this business's ability to grow. Be specific to the check.
- "action": string — one concrete, immediately actionable instruction starting with a verb. Include exact steps, tag names, or tool names where relevant.
- "verified": boolean — true if clearly passes, false if fails or cannot be confirmed

Return ONLY a valid JSON array. No markdown, no text outside the JSON.`

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 6000,
    system: FOUNDATION_MODULE.systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const raw = message.content[0].type === 'text' ? message.content[0].text : '[]'
  const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()

  let results: ModuleAnalysisResult[]
  try {
    results = JSON.parse(clean)
  } catch {
    throw new Error(`Foundation agent returned invalid JSON: ${clean.slice(0, 200)}`)
  }

  return results.filter(
    (r) =>
      typeof r.slug === 'string' &&
      typeof r.detail === 'string' &&
      typeof r.narrative === 'string' &&
      typeof r.action === 'string' &&
      typeof r.verified === 'boolean',
  )
}
