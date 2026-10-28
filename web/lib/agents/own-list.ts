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
export async function checkPeople(brandId: string, d: LeadAgentData, raw: { email: string; name?: string; company?: string }[]): Promise<{ people: Person[]; skipped: Skipped[] }> {
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
    else people.push(personFrom(email, typeof r.name === 'string' ? r.name.slice(0, 80) : undefined, typeof r.company === 'string' ? r.company : undefined))
  }
  return { people, skipped }
}

function templateFor(b: BrandContext, about: string) {
  const point = about.replace(/\.$/, '').trim()
  return {
    subject: 'A quick idea for {company}',
    body: `Hi {first name},\n\nI am writing to {company} because ${point.charAt(0).toLowerCase()}${point.slice(1)}.\n\nThat is what ${b.name} does, and I think it could save {company} real time.\n\nWould it be useful if I sent a few free examples made for {company}?\n\nBest,\n${b.name}`,
  }
}

// Models sometimes return the email as one block. Put the greeting, the points and the sign-off on their own lines.
export function structured(body: string, brand: string): string {
  let t = body.replace(/\r/g, '').trim()
  if (/\n\s*\n/.test(t)) return t.replace(/\n{3,}/g, '\n\n')
  t = t.replace(/^((?:Hi|Hello|Hey|Dear)\s*\{first name\},?)\s*/i, '$1\n\n')
  const tail = t.match(new RegExp(`\\s*(?:(?:Best|Thanks|Regards|Cheers|Kind regards|Warmly),?\\s*)?${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'))
  let sign = ''
  if (tail) { t = t.slice(0, tail.index).trim(); sign = `\n\nBest,\n${brand}` }
  const [greet, ...rest] = t.split('\n\n')
  const sentences = (rest.join(' ').match(/[^.!?]+[.!?]+(?:\s|$)/g) ?? [rest.join(' ')]).map(x => x.trim()).filter(Boolean)
  const paras: string[] = []
  for (let i = 0; i < sentences.length; i += 2) paras.push(sentences.slice(i, i + 2).join(' '))
  return [greet, ...paras].join('\n\n') + sign
}

/** One email for the whole list, written from one line, with {first name} and {company} in it. */
export async function draftListEmail(brandId: string, about: string): Promise<{ subject: string; body: string } | null> {
  const b = await loadBrandContext(brandId)
  if (!b) return null
  const line = about.trim().slice(0, 300) || `${b.name} could help them`
  try {
    const raw = await withAIContext({ brandId, moduleType: 'lead-agent', websiteUrl: b.websiteUrl }, () => callAI({
      feature: 'lead-agent',
      maxTokens: 900,
      system: 'You write short, well-structured outreach emails that get replies: a clear opening, one concrete offer, one easy ask. Plain words, no hype, no buzzwords, no emojis. Return only a raw JSON object.',
      prompt: `${brandBlock(b)}

The user is emailing people they already know or chose themselves. All we have for each person is their email address, so write ONE email that works for everyone on the list.
What the email is about, in the user's words: "${line}"

Write "subject" and "body", laid out like a well-made short business email, in these parts, each separated by a blank line (write the line breaks as \\n\\n in the JSON):
1. "Hi {first name}," on its own line.
2. Opening, 1-2 sentences: why you are writing to a business like {company}, naming a real problem its kind of business has that this brand solves. Never a compliment about their company, you know nothing about it except the name.
3. The offer, 1-2 sentences: what ${b.name} does for them, with one concrete capability or result taken from the brand notes above. No vague claims.
4. One small, easy ask as a question (for example "Would it be useful if I sent two examples made for {company}?").
5. "Best," on one line, then "${b.name}" on the next line.
Rules:
- Use {company} two or three times in total (opening, ask, and the subject if it reads naturally). Write {first name} and {company} exactly like that, with the braces; they are filled in for each person.
- "subject": 3-6 words, plain, lower-key, never clickbait, e.g. "Social posts for {company}".
- Under 110 words in the body. Plain words, no buzzwords, no exclamation marks, no emojis, no em dashes. No links and no opt-out line (added automatically).
- Fix the spelling of what the user typed; use their idea, not their wording.

Return {"subject":"...","body":"..."}`,
    }))
    const x = parseJsonLoose<{ subject?: string; body?: string }>(raw, 'object')
    if (x?.subject && x.body) return { subject: stripEmDashes(x.subject).slice(0, 200), body: structured(stripEmDashes(x.body), b.name).slice(0, 4000) }
  } catch { /* fall back to the plain template below */ }
  return templateFor(b, line)
}

/**
 * The user approved the whole list: every person becomes a lead with their own copy of the email,
 * queued; as many as today's limit allows go out now, the rest with the daily run.
 */
export async function addOwnList(brandId: string, input: {
  name: string; about?: string; subject: string; body: string
  people: { email: string; name?: string; company?: string; text?: string }[]
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
