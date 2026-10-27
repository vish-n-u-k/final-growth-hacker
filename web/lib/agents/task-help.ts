// Turns the Search Agent's "other things to do" into something to act on:
//   fix:description → new wording for the site, written for the brand, to paste in a few places
//   listing on a directory (G2, Capterra…) → where to add the product, then a review request
//   listing on an article site (zapier.com…) → a pitch to the site, in Sites to pitch
//   listing on Reddit → open the threads (answered from the Lead Agent's Community tab)

import { callAI, withAIContext } from '@/lib/ai/client'
import { findEmail, hunterConfigured } from './hunter'
import { brandBlock, idOf, loadBrandContext, parseJsonLoose } from './context'
import { addUsage, newMeter, readSearchData, updateSearchData, type LinkOpportunity } from './store'
import { searchFallback } from './search-agent'
import { listingDomain } from './task-kinds'

/** Writes the brand's description three ways (headline, search description, About paragraph). */
export async function writeDescription(brandId: string): Promise<{ ok: boolean; message?: string }> {
  const b = await loadBrandContext(brandId)
  if (!b) return { ok: false, message: 'Brand not found.' }
  const d = await readSearchData(brandId)
  const issue = d?.description?.issue ?? ''
  const said = d?.description?.text ?? ''
  const copy = await withAIContext({ brandId, moduleType: 'search-agent', websiteUrl: b.websiteUrl }, async () => {
    const raw = await callAI({
      feature: 'search-agent',
      model: 'claude-sonnet-4-6',
      maxTokens: 900,
      system: 'You write clear, plain website copy that tells people (and AI assistants) exactly what a product is. No hype, no buzzwords. Return only a raw JSON object.',
      prompt: `${brandBlock(b)}

ChatGPT currently describes ${b.name} as: "${said || 'unknown'}"
The problem: ${issue || 'the description is wrong or vague'}

Write how ${b.name} should describe itself on its own site, so AI assistants describe it correctly:
- "headline": the homepage headline, under 12 words, says what it is and who it's for
- "meta": the homepage search description, 140-155 characters
- "about": one paragraph for the About page, 2-3 sentences, starting "${b.name} is"

Return {"headline":"...","meta":"...","about":"..."}`,
    })
    const x = parseJsonLoose<{ headline?: string; meta?: string; about?: string }>(raw, 'object')
    return x?.headline && x.meta && x.about ? { headline: x.headline.trim(), meta: x.meta.trim(), about: x.about.trim() } : null
  })
  if (!copy) return { ok: false, message: 'Couldn’t write it. Try again.' }
  await updateSearchData(brandId, searchFallback(b), x => {
    const t = x.tasks.find(y => y.key === 'fix:description')
    if (t) t.copy = copy
  })
  return { ok: true }
}

/** An article site AI keeps citing: becomes a site to pitch (with a drafted pitch), and the to-do closes. */
export async function taskToPitch(brandId: string, key: string): Promise<{ ok: boolean; message?: string; linkId?: string }> {
  const b = await loadBrandContext(brandId)
  if (!b) return { ok: false, message: 'Brand not found.' }
  const d = await readSearchData(brandId)
  const t = d?.tasks.find(x => x.key === key)
  if (!t) return { ok: false, message: 'That to-do is gone. Refresh the page.' }
  const dom = listingDomain(t)
  const id = idOf(dom)
  const have = d?.links?.find(l => l.id === id)
  if (have) {
    await updateSearchData(brandId, searchFallback(b), x => { const y = x.tasks.find(z => z.key === key); if (y) y.status = 'done' })
    return { ok: true, linkId: id }
  }
  const example = t.detail.match(/Example: "([^"]+)"/)?.[1] ?? ''
  const pitch = await withAIContext({ brandId, moduleType: 'search-agent', websiteUrl: b.websiteUrl }, async () => {
    const raw = await callAI({
      feature: 'search-agent',
      model: 'claude-sonnet-4-6',
      maxTokens: 700,
      system: 'You write short, honest, specific outreach emails to website editors. Return only a raw JSON object.',
      prompt: `${brandBlock(b)}

AI assistants keep citing ${dom}${example ? ` (for example the page "${example}")` : ''} when people ask about tools like ${b.name}, but the page doesn't mention ${b.name}.
Write a pitch to the editor asking them to consider adding ${b.name}: "subject" (3-7 words) and "body" (50-90 words, no greeting line, plain words). In this order: their page; the gap (it leaves ${b.name} out); what you offer to make adding it easy (a free account to try it, and a ready-to-paste two-line description of ${b.name} written into the email); ONE short question to end. Mention a price or affiliate programme only if the brand info gives one. Sign off with "${b.name}".
Return {"subject":"...","body":"..."}`,
    })
    const x = parseJsonLoose<{ subject?: string; body?: string }>(raw, 'object')
    return x?.subject && x.body ? { subject: x.subject.trim(), body: x.body.trim() } : undefined
  })
  const meter = newMeter()
  const found = hunterConfigured() ? await findEmail(dom, undefined, meter).catch(() => null) : null
  await addUsage(brandId, meter, 'Search Agent').catch(() => {})
  const link: LinkOpportunity = {
    id, domain: dom, source: 'list', url: t.url || `https://${dom}`, title: example || dom,
    authority: null, names: [], why: `AI answers keep citing ${dom}, in answers that don't mention ${b.name}.`,
    pitch, email: found?.email, emailVerified: found?.verified, contactName: found?.name,
    status: found?.email && pitch ? 'ready' : 'new', foundAt: new Date().toISOString(),
  }
  await updateSearchData(brandId, searchFallback(b), x => {
    x.links = [link, ...(x.links ?? []).filter(l => l.id !== id)]
    const y = x.tasks.find(z => z.key === key)
    if (y) y.status = 'done'
  })
  return { ok: true, linkId: id }
}

