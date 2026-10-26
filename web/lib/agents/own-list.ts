// "Add your own emails" in the Lead Agent's Email tab: the user pastes or uploads people they
// already know, GrowJin writes one email for all of them (first name and company filled in for
// each), the user approves the whole list at once, and the agent sends it within the daily limit,
// with the same follow-ups as the leads it finds. Only emails are given, so nothing is looked up.

import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { emailSuppressions, outreachEmails } from '@/lib/db/schema'
import { callAI, withAIContext } from '@/lib/ai/client'
import { stripEmDashes } from '@/lib/email/clean'
import { agentsDemo } from './demo'
import { brandBlock, idOf, loadBrandContext, parseJsonLoose, type BrandContext } from './context'
import { leadFallback, sendFirstEmail, sentToday } from './lead-agent'
import { readLeadData, updateLeadData, type Lead, type LeadAgentData } from './store'
import { EMAIL, MAX_LIST, fillFor, personFrom, type Person, type Skipped } from './own-list-text'

/** Who on the list can be emailed: drops repeats, people already in the Lead Agent, already emailed, or opted out. */
export async function checkPeople(brandId: string, d: LeadAgentData, raw: { email: string; name?: string }[]): Promise<{ people: Person[]; skipped: Skipped[] }> {
  const people: Person[] = [], skipped: Skipped[] = []
  const seen = new Set<string>()
  const inAgent = new Set(d.leads.map(l => l.email?.toLowerCase()).filter(Boolean) as string[])
  const emails = [...new Set(raw.map(r => String(r.email ?? '').trim().toLowerCase()).filter(e => EMAIL.test(e)))]
  let emailed = new Set<string>(), optedOut = new Set<string>()
  if (emails.length && !agentsDemo()) {
    const [sent, supp] = await Promise.all([
      db.select({ e: outreachEmails.toEmail }).from(outreachEmails)
        .where(and(eq(outreachEmails.brandId, brandId), inArray(outreachEmails.toEmail, emails), inArray(outreachEmails.status, ['sent', 'scheduled', 'sending']))).catch(() => []),
      db.select({ e: emailSuppressions.email }).from(emailSuppressions)
        .where(and(eq(emailSuppressions.brandId, brandId), inArray(emailSuppressions.email, emails))).catch(() => []),
    ])
    emailed = new Set(sent.map(x => x.e.toLowerCase()))
    optedOut = new Set(supp.map(x => x.e.toLowerCase()))
  }
  for (const r of raw) {
    const email = String(r.email ?? '').trim().toLowerCase()
    if (!EMAIL.test(email)) continue
    if (seen.has(email)) { skipped.push({ email, why: 'listed twice' }); continue }
    seen.add(email)
    if (optedOut.has(email)) skipped.push({ email, why: 'asked not to be emailed' })
    else if (inAgent.has(email)) skipped.push({ email, why: 'already in the Lead Agent' })
    else if (emailed.has(email)) skipped.push({ email, why: 'already emailed' })
    else if (people.length >= MAX_LIST) skipped.push({ email, why: `over ${MAX_LIST} people` })
    else people.push(personFrom(email, typeof r.name === 'string' ? r.name.slice(0, 80) : undefined))
  }
  return { people, skipped }
}

function templateFor(b: BrandContext, about: string) {
  return {
    subject: 'Quick idea for {company}',
    body: `Hi {first name},\n\n${about.replace(/\.$/, '')}.\n\nI think it could help {company}. Want me to send a few free examples made for you?\n\n${b.name}`,
  }
}

/** One email for the whole list, written from one line, with {first name} and {company} in it. */
export async function draftListEmail(brandId: string, about: string): Promise<{ subject: string; body: string } | null> {
  const b = await loadBrandContext(brandId)
  if (!b) return null
  const line = about.trim().slice(0, 300) || `${b.name} could help them`
  try {
    const raw = await withAIContext({ brandId, moduleType: 'lead-agent', websiteUrl: b.websiteUrl }, () => callAI({
      feature: 'lead-agent',
      maxTokens: 800,
      system: 'You write short, personal outreach that gets replies. Plain words, no hype, no buzzwords, no emojis. Return only a raw JSON object.',
      prompt: `${brandBlock(b)}

The user is emailing people they already know or chose themselves. All we have for each person is their email address, so write ONE email that works for everyone on the list.
What the email is about, in the user's words: "${line}"

Write "subject" (3-6 words, lower-key, never clickbait) and "body" (under 90 words).
- Start with exactly "Hi {first name}," and use {company} once where the company name fits. Write those placeholders exactly like that; they are filled in for each person.
- Then the point, in one or two short sentences. Then ONE small ask. Sign off with "${b.name}".
- No em dashes. No links, no opt-out line (added automatically).

Return {"subject":"...","body":"..."}`,
    }))
    const x = parseJsonLoose<{ subject?: string; body?: string }>(raw, 'object')
    if (x?.subject && x.body) return { subject: stripEmDashes(x.subject).slice(0, 200), body: stripEmDashes(x.body).slice(0, 4000) }
  } catch { /* fall back to the plain template below */ }
  return templateFor(b, line)
}

/**
 * The user approved the whole list: every person becomes a lead with their own copy of the email,
 * queued; as many as today's limit allows go out now, the rest with the daily run.
 */
export async function addOwnList(brandId: string, input: {
  name: string; about?: string; subject: string; body: string
  people: { email: string; name?: string; text?: string }[]
}): Promise<{ ok: boolean; message: string }> {
  const b = await loadBrandContext(brandId)
  if (!b) return { ok: false, message: 'Brand not found.' }
  const fallback = leadFallback(b)
  const d = (await readLeadData(brandId)) ?? fallback()
  const subject = input.subject.trim().slice(0, 200), body = input.body.trim().slice(0, 4000)
  if (!subject || !body) return { ok: false, message: 'Write the email first.' }
  const { people } = await checkPeople(brandId, d, input.people)
  if (!people.length) return { ok: false, message: 'Nobody on the list can be emailed.' }
  // A person's own edited copy, if the user changed it on the review step
  const own = new Map(input.people.filter(p => typeof p.text === 'string' && p.text.trim()).map(p => [p.email.trim().toLowerCase(), p.text!.trim().slice(0, 4000)]))

  const now = new Date().toISOString()
  const listId = idOf(`list:${now}:${input.name}`)
  const name = input.name.trim().slice(0, 80) || 'Your list'
  const leads: Lead[] = people.map(p => ({
    id: idOf(`own:${p.email}`), source: 'own', listId, foundAt: now,
    title: p.first ? `${p.first}${p.company ? ` · ${p.company}` : ''}` : p.company || p.email,
    url: '', snippet: '', name: p.first || undefined, company: p.company || undefined,
    website: p.company ? p.email.split('@')[1] : undefined,
    score: 0, why: `From your list “${name}”.`, email: p.email, emailVerified: false,
    draft: { subject: fillFor(subject, p), body: own.get(p.email) ?? fillFor(body, p) },
    status: 'queued', approvedBy: 'user', followupsSent: 0,
  }))
  await updateLeadData(brandId, fallback, x => {
    const have = new Set(x.leads.map(l => l.id))
    x.leads = [...leads.filter(l => !have.has(l.id)), ...x.leads]
    x.lists = [{ id: listId, name, createdAt: now, size: leads.length, about: input.about?.slice(0, 300) }, ...(x.lists ?? [])].slice(0, 50)
  })

  // Today's share goes out now
  const fresh = (await readLeadData(brandId)) ?? fallback()
  let room = Math.max(0, fresh.settings.dailyLimit - sentToday(fresh))
  const patches = new Map<string, Partial<Lead>>()
  const sentAt: string[] = []
  let firstError = ''
  for (const l of fresh.leads.filter(x => x.listId === listId && x.status === 'queued')) {
    if (room <= 0) break
    const p = await sendFirstEmail(brandId, l, fresh.settings.followUpDays)
    patches.set(l.id, p)
    if (p.status === 'sent') { room -= 1; sentAt.push(p.sentAt!) }
    else if (p.error && !firstError) { firstError = p.error; if (p.status !== 'opted_out') break }
  }
  if (patches.size) {
    await updateLeadData(brandId, fallback, x => {
      for (const [id, p] of patches) {
        const l = x.leads.find(y => y.id === id)
        if (l && l.status === 'queued') Object.assign(l, p)
      }
      x.sentLog = [...x.sentLog, ...sentAt].sort()
    })
  }
  const sent = sentAt.length, later = leads.length - sent
  const message = firstError && !sent
    ? `List saved, but sending failed: ${firstError}`
    : [`Approved ${leads.length}.`, sent ? `${sent} sent now.` : null, later ? `${later} go out with the daily limit${sent ? '' : ', starting tomorrow'}.` : null].filter(Boolean).join(' ')
  return { ok: !firstError || sent > 0, message }
}
