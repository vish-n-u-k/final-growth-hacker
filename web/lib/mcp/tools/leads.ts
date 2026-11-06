import { and, eq, gte, ilike, inArray, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { emailSuppressions, outreachEmails } from '@/lib/db/schema'
import { withDemo } from '@/lib/agents/demo'
import { readDemoSwitch, readLeadData, type Lead } from '@/lib/agents/store'
import { domainOf, loadBrandContext } from '@/lib/agents/context'
import { addEngineLeads, type EngineLead } from '@/lib/leads/engine'
import { ENGINE_PROMPT } from '@/lib/leads/engine-prompt'

// MCP tools for finding leads in a Claude conversation with the dataforseo / hunter / apify tools and
// putting them on Lead Finder's board: get_lead_settings (what to look for), check_contacts (who not
// to contact again) and save_leads (the board). Same data as the Lead Agent / Lead Finder pages,
// including the brand's demo-mode switch (demo leads are kept apart from real ones).

const MAX_CHECK = 200
const MAX_SAVE = 50

const inDemo = async <T>(brandId: string, fn: () => Promise<T>) => withDemo(await readDemoSwitch(brandId), fn)

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v))
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
const list = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\s,;]+/) : []).map(str).filter(Boolean)

// ── get_lead_settings ─────────────────────────────────────────────────────────

export async function getLeadSettings(brandId: string, args: Record<string, unknown>) {
  return inDemo(brandId, async () => {
    const b = await loadBrandContext(brandId)
    if (!b) return { error: 'Brand not found.' }
    const data = await readLeadData(brandId)
    const s = data?.settings
    const leads = data?.leads ?? []
    const byStatus: Record<string, number> = {}
    for (const l of leads) byStatus[l.status] = (byStatus[l.status] ?? 0) + 1
    const engine = s?.engine
    return {
      demo_mode: data?.demo === true || (await readDemoSwitch(brandId)),
      brand: {
        name: b.name, website: b.websiteUrl, description: b.summary ?? b.usp ?? '', offer: b.usp ?? '',
        competitors: b.competitors.map(c => (c.domain ? `${c.name} (${c.domain})` : c.name)),
      },
      lead_finder: engine
        ? { brief: engine.brief, industry: engine.industry, location: engine.location, company_size: engine.companySize, contact_role: engine.contactRole, leads_per_search: engine.leadCount }
        : null,
      ideal_customer: s?.icp
        ? { kind: s.icp.kind, who: s.icp.who, marketing: s.icp.marketing, kinds_of_business: s.icp.trades ?? [], good_fit: s.icp.fit, not_a_fit: s.icp.notFit, example_customers: s.icp.examples, quiet_social_counts_in_favour: s.icp.quietSocial ?? null }
        : null,
      customer: s?.customer ?? '',
      looking_for: s?.companyQuery ?? '',
      country: s?.country ?? '',
      use_brand_profile: s?.useBrand !== false,
      skip_eu: s?.skipEU ?? false,
      sending: { daily_limit: s?.dailyLimit ?? 15, follow_up_days: s?.followUpDays ?? [], mode: s?.mode ?? 'approve' },
      leads: { total: leads.length, by_status: byStatus },
      // Domains already on the board, so a search doesn't spend on them again (check_contacts for emails)
      already_known: [...new Set(leads.map(l => (l.website ? domainOf(l.website) : '')).filter(Boolean))].slice(0, 300),
      last_search: data?.engineRun ? { at: data.engineRun.at, status: data.engineRun.status, added: data.engineRun.added, summary: data.engineRun.summary } : null,
      ...(args.include_playbook === true ? { playbook: ENGINE_PROMPT } : {}),
      note: engine || s?.icp ? undefined : 'No Lead Finder brief or ideal-customer card saved yet. Ask the user who they want to reach, or fill it in from get_brand_info.',
    }
  })
}

// ── check_contacts ────────────────────────────────────────────────────────────

type Verdict = 'new' | 'already_a_lead' | 'emailed' | 'scheduled' | 'opted_out' | 'bounced'

export async function checkContacts(brandId: string, args: Record<string, unknown>) {
  const emails = [...new Set(list(args.emails).map(e => e.toLowerCase()).filter(validEmail))].slice(0, MAX_CHECK)
  const domains = [...new Set(list(args.domains).map(d => domainOf(d.includes('://') ? d : `https://${d}`)).filter(Boolean))].slice(0, MAX_CHECK)
  if (!emails.length && !domains.length) return { error: 'Give emails and/or domains to check.' }

  return inDemo(brandId, async () => {
    const lead = await readLeadData(brandId).catch(() => null)
    const leads = lead?.leads ?? []
    const byEmail = new Map<string, Lead>()
    const byDomain = new Map<string, Lead>()
    for (const l of leads) {
      if (l.email) byEmail.set(l.email.toLowerCase(), l)
      if (l.website) byDomain.set(domainOf(l.website), l)
    }

    // Emails GrowJin sent (or will send) to these addresses or anyone at these domains, last 2 years
    const since = new Date(Date.now() - 730 * 86_400_000)
    const allDomains = domains.slice(0, 100)
    const [sent, suppressed] = await Promise.all([
      db.select({ e: outreachEmails.toEmail, status: outreachEmails.status, at: outreachEmails.sentAt, created: outreachEmails.createdAt, subject: outreachEmails.subject })
        .from(outreachEmails)
        .where(and(
          eq(outreachEmails.brandId, brandId),
          inArray(outreachEmails.status, ['sent', 'scheduled', 'sending']),
          gte(outreachEmails.createdAt, since),
          or(
            ...(emails.length ? [inArray(outreachEmails.toEmail, emails)] : []),
            ...allDomains.map(d => ilike(outreachEmails.toEmail, `%@${d}`)),
          ),
        )).catch(() => []),
      db.select({ e: emailSuppressions.email, reason: emailSuppressions.reason })
        .from(emailSuppressions)
        .where(and(eq(emailSuppressions.brandId, brandId), or(
          ...(emails.length ? [inArray(emailSuppressions.email, emails)] : []),
          ...allDomains.map(d => ilike(emailSuppressions.email, `%@${d}`)),
        ))).catch(() => []),
    ])

    const leadInfo = (l: Lead) => ({ lead: { company: l.company ?? l.title, status: l.status, email: l.email ?? null } })
    const sentInfo = (r: (typeof sent)[number]) => ({ last_email: { to: r.e, subject: r.subject, at: (r.at ?? r.created)?.toISOString() ?? null } })

    const verdictOf = (match: (addr: string) => boolean, l: Lead | undefined) => {
      const sup = suppressed.find(x => match(x.e.toLowerCase()))
      if (sup) return { status: (sup.reason === 'bounced' ? 'bounced' : 'opted_out') as Verdict, email: sup.e }
      const s = sent.filter(x => match(x.e.toLowerCase())).sort((a, b) => +(b.at ?? b.created ?? 0) - +(a.at ?? a.created ?? 0))[0]
      if (s) return { status: (s.status === 'scheduled' ? 'scheduled' : 'emailed') as Verdict, ...sentInfo(s), ...(l ? leadInfo(l) : {}) }
      if (l) return { status: 'already_a_lead' as Verdict, ...leadInfo(l) }
      return { status: 'new' as Verdict }
    }

    const results = [
      ...emails.map(email => ({ email, ...verdictOf(a => a === email, byEmail.get(email)) })),
      ...domains.map(domain => ({ domain, ...verdictOf(a => a.endsWith(`@${domain}`), byDomain.get(domain)) })),
    ]
    const counts: Record<string, number> = {}
    for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1
    return {
      counts,
      results,
      note: 'Only contact "new" ones. "already_a_lead" is on the Lead Finder board already (any status, including skipped). Domain checks match any address at that domain.',
    }
  })
}

// ── save_leads ────────────────────────────────────────────────────────────────

export async function saveLeads(brandId: string, args: Record<string, unknown>) {
  const raw = Array.isArray(args.leads) ? args.leads : []
  if (!raw.length) return { error: 'Give leads: an array of objects with at least company or website.' }
  if (raw.length > MAX_SAVE) return { error: `At most ${MAX_SAVE} leads per call. Split them up.` }
  const leads = raw.filter((l): l is EngineLead => !!l && typeof l === 'object')
  const dropped = (Array.isArray(args.dropped) ? args.dropped : []).filter((d): d is { company?: string; reason?: string } => !!d && typeof d === 'object').slice(0, 50)

  return inDemo(brandId, async () => {
    const r = await addEngineLeads(brandId, leads, dropped, { foundVia: 'Found with Claude' })
    if (!r) return { error: 'Brand not found.' }
    const demo = await readDemoSwitch(brandId)
    return {
      added: r.added.length,
      leads: r.added.map(l => ({ company: l.company, status: l.status === 'ready' ? 'ready (email or message to write and approve)' : 'needs an email' })),
      kept_aside: r.keptAside,
      skipped: r.skipped,
      ...(demo ? { demo_mode: true } : {}),
      next: r.added.length
        ? `${demo ? 'Saved to the DEMO list (demo mode is on for this brand). ' : ''}They're on Lead Finder (/leads) under Contact directly. The user opens each one, GrowJin writes the email, and once they approve it GrowJin sends it from their Gmail within the daily limit, with follow-ups that stop when they reply.`
        : 'Nothing new was added.',
    }
  })
}
