import { callAI } from '@/lib/ai/client'
import { GMAIL_OUTREACH_MODULE } from './definition'
import type { DynamicModuleAnalysisResult } from '../types'
import type { GmailOutreachFetchResult } from './fetcher'
import { parseClaudeJsonArray } from '@/lib/modules/parse-utils'

export async function analyzeGmailOutreach(
  data: GmailOutreachFetchResult,
  brainContext?: string,
): Promise<DynamicModuleAnalysisResult[]> {
  const catDef = GMAIL_OUTREACH_MODULE.categories[0] as { prompt: string }

  const websiteContext = [
    data.title           ? `Title: ${data.title}` : null,
    data.metaDescription ? `Meta description: ${data.metaDescription}` : null,
    data.h1              ? `H1: ${data.h1}` : null,
    data.h2s.length > 0  ? `Headings: ${data.h2s.join(' | ')}` : null,
    data.ctaTexts.length > 0 ? `CTAs: ${data.ctaTexts.join(' | ')}` : null,
    data.bodyText        ? `Body (excerpt): ${data.bodyText.slice(0, 2000)}` : null,
  ].filter(Boolean).join('\n')

  const prompt = `Brand: ${data.brandName}
Website: ${data.url}

Website content:
${websiteContext}

${brainContext ? `Sales playbook & brand context:\n${brainContext}\n\n` : ''}${catDef.prompt}

Return a JSON array of exactly 6 objects. Each object must have:
{
  "slug": "prospect-0",
  "label": "Name · Company",
  "detail": "{\"name\":\"...\",\"company\":\"...\",\"title\":\"...\",\"suggestedEmail\":\"...\"}",
  "narrative": "...",
  "action": "...",
  "weight": 2,
  "verified": false,
  "fixable": false
}

Return ONLY the JSON array, nothing else.`

  const raw = await callAI({
    system: GMAIL_OUTREACH_MODULE.systemPrompt,
    prompt,
    maxTokens: 2000,
    model: 'claude-haiku-4-5-20251001',
  })

  const parsed = parseClaudeJsonArray(raw)
  if (!parsed) return fallbackProspects()

  return (parsed as Record<string, unknown>[]).map((item, i) => ({
    category: 'prospects',
    slug:      (item.slug as string)      ?? `prospect-${i}`,
    label:     (item.label as string)     ?? `Prospect ${i + 1}`,
    weight:    ([1, 2, 3].includes(item.weight as number) ? item.weight : 2) as 1 | 2 | 3,
    detail:    (item.detail as string)    ?? '{}',
    narrative: (item.narrative as string) ?? '',
    action:    (item.action as string)    ?? '',
    verified:  false,
    fixable:   false,
  }))
}

function fallbackProspects(): DynamicModuleAnalysisResult[] {
  return [{
    category: 'prospects',
    slug: 'prospect-error',
    label: 'Analysis returned no results',
    weight: 1,
    detail: '{}',
    narrative: 'The analysis did not return valid prospect data. Try re-running.',
    action: 'Click Re-analyse to try again.',
    verified: false,
    fixable: false,
  }]
}
