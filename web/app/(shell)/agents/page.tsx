import { redirect } from 'next/navigation'
import { getSessionUser, getBrandForUser } from '@/lib/server-session'
import { loadBrandContext } from '@/lib/agents/context'
import { leadFallback } from '@/lib/agents/lead-agent'
import { searchFallback } from '@/lib/agents/search-agent'
import { readLeadData, readSearchData, readUsage } from '@/lib/agents/store'
import AgentsOverview, { type AgentSummary, type Approval } from '@/components/agents/AgentsOverview'
import { agentsDemo } from '@/lib/agents/demo'
import { serviceStatus } from '@/lib/agents/services'

export const dynamic = 'force-dynamic'

export default async function AgentsPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const brand = await getBrandForUser(user.id)
  if (!brand) redirect('/onboarding')
  const b = await loadBrandContext(brand.id)
  if (!b) redirect('/onboarding')

  const [leadSaved, searchSaved, usage, services] = await Promise.all([
    readLeadData(brand.id).catch(() => null),
    readSearchData(brand.id).catch(() => null),
    readUsage(brand.id).catch(() => ({ dataforseoUsd: 0, hunterLookups: 0, aiUsd: 0 })),
    serviceStatus(),
  ])
  const ld = leadSaved ?? leadFallback(b)()
  const sd = searchSaved ?? searchFallback(b)()

  const leads = ld.leads
  const sent = leads.filter(l => l.sentAt).length
  const replies = leads.filter(l => l.status === 'replied').length
  const answers = (sd.answers?.items ?? []).filter(a => !a.error)
  const lead: AgentSummary = {
    enabled: ld.settings.enabled, setUp: !!leadSaved, lastRunAt: ld.lastRunAt ?? null,
    stats: [[String(leads.length), 'leads found'], [String(sent), 'emails sent'], [String(replies), 'replies']],
  }
  const search: AgentSummary = {
    enabled: sd.settings.enabled, setUp: !!searchSaved, lastRunAt: sd.lastResearchAt ?? null,
    stats: [
      [String(sd.topics.filter(t => t.status !== 'skipped').length), 'topics picked'],
      [String(sd.topics.filter(t => t.status === 'drafted').length), 'drafts to read'],
      [answers.length ? `${answers.filter(a => a.mentioned).length}/${answers.length}` : '—', 'AI answers name you'],
    ],
  }

  const approvals: Approval[] = []
  for (const t of sd.topics.filter(x => x.status === 'drafted')) {
    approvals.push({ tag: 'Blog draft', tone: '', title: `Draft for “${t.keyword}”`, detail: 'Search Agent · written to beat the current #1 result', href: '/agents/search', cta: 'Read' })
  }
  const emails = leads.filter(l => l.status === 'ready' && l.draft && l.email).length
  if (emails) approvals.push({ tag: 'Emails', tone: 'ag-pill-good', title: `${emails} first email${emails === 1 ? '' : 's'} ready to send`, detail: 'Lead Agent · nothing is sent until you approve', href: '/agents/leads', cta: 'Review' })
  const posts = leads.filter(l => l.status === 'ready' && l.reply).length
  if (posts) approvals.push({ tag: 'Forum replies', tone: 'ag-pill-warn', title: `${posts} Reddit / forum repl${posts === 1 ? 'y' : 'ies'} to post`, detail: 'Lead Agent · you post them yourself', href: '/agents/leads', cta: 'Open' })
  const fresh = leads.filter(l => l.status === 'replied').slice(0, 2)
  for (const l of fresh) approvals.push({ tag: 'Reply', tone: 'ag-pill-crit', title: `${l.name || l.company || l.email} replied`, detail: l.replyNote ? `“${l.replyNote.slice(0, 140)}”` : 'Reply from Gmail', href: '/agents/leads', cta: 'Open' })
  for (const t of sd.tasks.filter(x => x.status === 'open').slice(0, 3)) {
    approvals.push({ tag: 'To do', tone: '', title: t.title, detail: `Search Agent · ${t.detail}`, href: '/agents/search', cta: 'Open' })
  }

  const funnel: [string, number][] = [
    ['Found', leads.length],
    ['Good fit', leads.filter(l => l.score >= 7).length],
    ['Contacted', sent + leads.filter(l => l.status === 'posted').length],
    ['Replied', replies],
  ]

  return <AgentsOverview search={search} lead={lead} approvals={approvals} funnel={funnel} usage={usage} demo={agentsDemo()} services={services} />
}
