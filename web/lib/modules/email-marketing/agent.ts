import { callAI } from '@/lib/ai/client'
import { EMAIL_MARKETING_MODULE } from './definition'
import { getAllItems, type ModuleAnalysisResult } from '../types'
import { parseClaudeJsonArray } from '@/lib/modules/parse-utils'
import { runEmailRuleEngine } from './rule-engine'
import type { EmailMarketingFetchResult } from './fetcher'

export async function analyzeEmailMarketing(
  data: EmailMarketingFetchResult,
  brainContext?: string,
): Promise<ModuleAnalysisResult[]> {
  const allItems = getAllItems(EMAIL_MARKETING_MODULE)
  const { ruleResults, aiSlugs } = runEmailRuleEngine(data)
  const ruleResultMap = new Map(ruleResults.map(r => [r.slug, r]))

  const aiItems = allItems.filter(item => aiSlugs.includes(item.slug))

  const itemList = aiItems
    .map((item, idx) => `${idx + 1}. [${item.slug}] ${item.label}\nInstructions: ${item.prompt}`)
    .join('\n\n')

  const contextLines = [
    `Website: ${data.url}`,
    data.requirements['email_platform'] ? `Email platform (user-provided): ${data.requirements['email_platform']}` : '',
    data.requirements['business_type'] ? `Business type: ${data.requirements['business_type']}` : '',
    brainContext ? `\nBrand context:\n${brainContext}` : '',
    '',
    '── Forms detected ──',
    data.forms.length > 0
      ? data.forms.map(f => `Form (${f.fieldCount} visible fields): ${f.visibleText.slice(0, 120)}`).join('\n')
      : 'No forms with email inputs detected',
    '',
    '── Subscribe/CTA button texts ──',
    data.ctaTexts.length > 0 ? data.ctaTexts.slice(0, 8).join(' | ') : 'None detected',
    '',
    '── Social proof elements ──',
    data.socialProofElements.length > 0
      ? data.socialProofElements.slice(0, 5).join(' | ')
      : 'None detected',
    '',
    '── Email platform signals ──',
    data.emailPlatformSignals.length > 0 ? data.emailPlatformSignals.join(', ') : 'None detected',
    '',
    '── Pre-computed structural findings ──',
    `Privacy policy: ${data.privacyPolicyUrl ? `found at ${data.privacyPolicyUrl}` : 'not found'}`,
    `Contact info: ${data.contactPageUrl ? `contact page at ${data.contactPageUrl}` : data.hasContactEmail ? 'email address found' : 'not found'}`,
    `Consent checkboxes: ${data.consentCheckboxes.length > 0 ? data.consentCheckboxes.map(c => `"${c.label.slice(0, 80)}" (pre-checked: ${c.defaultChecked})`).join(', ') : 'none detected'}`,
    `DNS SPF: ${data.dns.spf.found ? `found — ${data.dns.spf.value?.slice(0, 50)}` : 'not found'}`,
    `DNS DKIM: ${data.dns.dkim.found ? `found on selector "${data.dns.dkim.selector}"` : 'not found'}`,
    `DNS DMARC: ${data.dns.dmarc.found ? `found — ${data.dns.dmarc.value?.slice(0, 50)}` : 'not found'}`,
    `Custom domain: ${data.isCustomDomain ? `yes (${data.domain})` : `no (${data.domain})`}`,
    '',
    '── Page body excerpt ──',
    data.bodyText.slice(0, 1800),
  ].filter(s => s !== null && s !== undefined).join('\n')

  const raw = await callAI({
    system: EMAIL_MARKETING_MODULE.systemPrompt,
    prompt: `${contextLines}

── Checks to evaluate ──
You MUST return exactly one JSON entry for EVERY slug listed below. If data is insufficient, use your best judgment and set verified: false. Never skip or omit a slug.

Return ONLY a JSON array — no markdown, no text outside the array:
[{"slug": "...", "d": "one-sentence finding under 15 words", "h": "5-8 word key phrase", "n": "why it matters — **bold** one key risk/benefit — under 20 words", "a": "concrete next step, verb-first, under 25 words", "verified": true or false}]

${itemList}`,
    maxTokens: Math.min(aiItems.length * 250, 4000),
    model: 'claude-haiku-4-5-20251001',
  })

  let aiRows: unknown[]
  try {
    aiRows = parseClaudeJsonArray(raw)
  } catch {
    aiRows = []
  }

  const aiResultMap = new Map(
    (aiRows as Record<string, unknown>[])
      .map(r => ({
        slug: r['slug'] as string,
        detail: (r['d'] ?? r['detail'] ?? '') as string,
        highlight: (r['h'] ?? r['highlight'] ?? '') as string,
        narrative: (r['n'] ?? r['narrative'] ?? '') as string,
        action: (r['a'] ?? r['action'] ?? '') as string,
        verified: typeof r['verified'] === 'boolean' ? r['verified'] : false,
      }))
      .filter(r => typeof r.slug === 'string' && r.detail)
      .map(r => [r.slug, r as ModuleAnalysisResult]),
  )

  // Merge: rule engine results first, AI results for remaining items, preserving definition order
  return allItems.map(item => {
    if (!aiSlugs.includes(item.slug)) {
      return ruleResultMap.get(item.slug) ?? {
        slug: item.slug,
        verified: false,
        detail: 'Could not be checked automatically.',
        highlight: 'Manual check needed',
        narrative: '',
        action: '',
      }
    }
    return aiResultMap.get(item.slug) ?? {
      slug: item.slug,
      verified: false,
      detail: 'Could not evaluate — please review manually.',
      highlight: 'Manual check needed',
      narrative: 'Review this item manually to confirm it is in place.',
      action: '',
    }
  })
}
