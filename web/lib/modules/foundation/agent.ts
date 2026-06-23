import { callAI } from '@/lib/ai/client'
import { FOUNDATION_MODULE } from './definition'
import { getAllItems, type ModuleAnalysisResult } from '../types'
import type { FoundationFetchResult } from './fetcher'

export async function analyzeFoundation(data: FoundationFetchResult): Promise<ModuleAnalysisResult[]> {
  const items = getAllItems(FOUNDATION_MODULE).map((item) => ({
    slug: item.slug,
    prompt: item.prompt,
  }))

  const userPrompt = `Audit this website's foundational infrastructure.

URL: ${data.url}
Custom domain: ${data.customDomain ? 'Yes' : `No — hosted on ${data.hostingPlatform ?? 'a free hosting platform'}`}

=== Extracted site data ===
${data.extracted ? JSON.stringify(data.extracted, null, 2) : 'Unable to fetch — flag all checks as needing manual review'}

=== Checks to run ===
${JSON.stringify(items, null, 2)}

For each check return exactly:
- "slug": string — exactly as given
- "detail": string — ONE sentence, max 120 chars: what was found (with actual values) if passes; exact problem if fails
- "narrative": string — ONE sentence, max 150 chars: why this matters for growth or trust
- "action": string — ONE sentence, max 120 chars: single concrete next step starting with a verb
- "verified": boolean — true if clearly passes, false if fails or cannot be confirmed

Be extremely concise. No filler. Return ONLY a valid JSON array. No markdown, no text outside the JSON.`

  const raw = await callAI({
    system: FOUNDATION_MODULE.systemPrompt,
    prompt: userPrompt,
    maxTokens: 8192,
    model: 'claude-haiku-4-5-20251001',
  })
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  const clean = start !== -1 && end !== -1 ? raw.slice(start, end + 1) : raw.trim()

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
