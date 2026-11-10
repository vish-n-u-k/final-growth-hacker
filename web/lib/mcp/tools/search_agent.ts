import { withDemo } from '@/lib/agents/demo'
import { readDemoSwitch, readSearchData, type AiAnswer } from '@/lib/agents/store'
import { tidySearchFor } from '@/lib/agents/search-agent'
import { ENGINE_LABEL } from '@/lib/agents/dataforseo'

// Read-only view of the Search Agent's saved data (signal_snapshots agent:search): AI answers and
// the sites they cite, keyword ideas and rankings, posts to write, to-dos and sites to pitch.
// Nothing is run or spent here; the data is from the agent's last weekly research.

export type SearchSection = 'overview' | 'ai_answers' | 'keywords' | 'topics' | 'tasks' | 'links'
export const SEARCH_SECTIONS: SearchSection[] = ['overview', 'ai_answers', 'keywords', 'topics', 'tasks', 'links']

const engineName = (e: string) => (ENGINE_LABEL as Record<string, string>)[e] ?? (e === 'google_ai' ? 'Google AI Overview' : e)

/** Sites AI answers cite, most cited first, with how often the brand was left out of those answers. */
function citedSites(items: AiAnswer[], limit: number) {
  const map = new Map<string, { domain: string; cited: number; withoutYou: number; example: string }>()
  for (const a of items) {
    for (const c of a.citations ?? []) {
      const row = map.get(c.domain) ?? { domain: c.domain, cited: 0, withoutYou: 0, example: c.url }
      row.cited++
      if (!a.mentioned) row.withoutYou++
      map.set(c.domain, row)
    }
  }
  return [...map.values()].sort((a, b) => b.cited - a.cited).slice(0, limit)
}

function aiSummary(items: AiAnswer[]) {
  const ok = items.filter(a => !a.error)
  const byEngine: Record<string, { asked: number; named: number }> = {}
  const rivals = new Map<string, number>()
  for (const a of ok) {
    const e = (byEngine[engineName(a.engine)] ??= { asked: 0, named: 0 })
    e.asked++
    if (a.mentioned) e.named++
    for (const n of [...a.brands, ...(a.others ?? [])]) rivals.set(n, (rivals.get(n) ?? 0) + 1)
  }
  return {
    answers: ok.length,
    failed: items.length - ok.length,
    named_in: ok.filter(a => a.mentioned).length,
    by_engine: byEngine,
    most_named: [...rivals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, answers]) => ({ name, answers })),
  }
}

export async function getSearchAgent(brandId: string, section: SearchSection = 'overview', limit = 20) {
  const n = Math.max(1, Math.min(100, limit || 20))
  return withDemo(await readDemoSwitch(brandId), async () => {
    // Drops suggestions saved before the platform / rival checks existed (as the page does)
    await tidySearchFor(brandId).catch(() => {})
    const d = await readSearchData(brandId)
    if (!d) {
      return { set_up: false, message: 'The Search Agent has not run for this brand yet. Open Tools → Search Agent in GrowJin to start its first research.' }
    }

    const answers = d.answers?.items ?? []
    const head = {
      set_up: true,
      demo: !!d.demo,
      daily_run_on: d.settings.enabled,
      country: d.settings.country,
      starting_keywords: d.settings.seeds,
      ai_questions: d.settings.questions,
      last_research_at: d.lastResearchAt ?? null,
      last_write_at: d.lastWriteAt ?? null,
      last_links_at: d.lastLinksAt ?? null,
      ...(d.lastError ? { last_error: d.lastError } : {}),
      ...(d.linksError ? { links_error: d.linksError } : {}),
    }

    if (section === 'ai_answers') {
      return {
        ...head,
        asked_at: d.answers?.at ?? null,
        summary: aiSummary(answers),
        mention_history: d.mentionHistory.slice(-12),
        cited_sites: citedSites(answers.filter(a => !a.error), n),
        answers: answers.slice(0, n * 3).map(a => ({
          question: a.question,
          engine: engineName(a.engine),
          named: a.mentioned,
          position: a.position,
          brands_named: a.brands,
          other_products: a.others ?? [],
          ...(a.samples ? { asked_times: a.samples, named_times: a.hits ?? 0 } : {}),
          citations: (a.citations ?? []).slice(0, 8).map(c => ({ domain: c.domain, url: c.url, title: c.title })),
          ...(a.error ? { error: a.error } : {}),
        })),
        how_ai_describes_you: d.description,
      }
    }

    if (section === 'keywords') {
      return {
        ...head,
        rankings_at: d.ranks?.at ?? null,
        rankings: (d.ranks?.rows ?? []).slice(0, n),
        rank_changes: d.rankChanges.slice(0, n),
        ideas_at: d.ideas?.at ?? null,
        ideas: (d.ideas?.rows ?? []).slice(0, n),
        verdicts: 'picked = in the to-do · fit = good fit waiting for room · broad = too broad · hard = hard to win · off = not your buyers · unknown = difficulty unknown · small = too few searches · branded = your brand name · unchecked = not checked for fit',
      }
    }

    if (section === 'topics') {
      return {
        ...head,
        topics: d.topics.slice(0, n).map(t => ({
          keyword: t.keyword,
          kind: t.kind ?? 'new',
          ...(t.pageUrl ? { page_to_rewrite: t.pageUrl } : {}),
          status: t.status,
          volume: t.volume,
          difficulty: t.difficulty || null,
          why: t.why,
          picked_at: t.pickedAt,
          ...(t.blogId ? { blog_id: t.blogId } : {}),
        })),
        note: 'Drafted posts can be read with get_blog_post (blog_id).',
      }
    }

    if (section === 'tasks') {
      return {
        ...head,
        tasks: d.tasks.filter(t => t.status === 'open').slice(0, n).map(t => ({ key: t.key, kind: t.kind, title: t.title, detail: t.detail, ...(t.url ? { url: t.url } : {}) })),
        done_or_dismissed: d.tasks.filter(t => t.status !== 'open').length,
        ads_tips: d.adsTips,
      }
    }

    if (section === 'links') {
      const links = d.links ?? []
      const count: Record<string, number> = {}
      for (const l of links) count[l.status] = (count[l.status] ?? 0) + 1
      return {
        ...head,
        counts: count,
        links: links.filter(l => l.status !== 'skipped').slice(0, n).map(l => ({
          domain: l.domain,
          kind: l.source === 'gap' ? 'links to competitors' : l.source === 'list' ? 'list article' : 'cited by AI',
          page: l.url,
          title: l.title,
          authority: l.authority,
          competitors_named: l.names,
          why: l.why,
          status: l.status,
          ...(l.contactName ? { contact: l.contactName } : {}),
          has_email: !!l.email,
          ...(l.pitch ? { pitch: l.pitch } : {}),
          ...(l.replyNote ? { reply: l.replyNote } : {}),
        })),
      }
    }

    // overview
    const ok = answers.filter(a => !a.error)
    return {
      ...head,
      ai_answers: d.answers ? { asked_at: d.answers.at, ...aiSummary(answers), top_cited_sites: citedSites(ok, 5) } : null,
      how_ai_describes_you: d.description,
      rankings: d.ranks ? { at: d.ranks.at, keywords_ranked: d.ranks.rows.length, top: d.ranks.rows.slice(0, 5) } : null,
      rank_changes: d.rankChanges.slice(0, 5),
      topics: d.topics.filter(t => t.status !== 'skipped' && t.status !== 'published').slice(0, 5).map(t => ({ keyword: t.keyword, status: t.status, kind: t.kind ?? 'new' })),
      open_tasks: d.tasks.filter(t => t.status === 'open').slice(0, 5).map(t => ({ kind: t.kind, title: t.title })),
      links: { total: (d.links ?? []).length, ready_to_send: (d.links ?? []).filter(l => l.status === 'ready').length },
      more: 'Call again with section = ai_answers, keywords, topics, tasks or links for the full lists.',
    }
  })
}
