// Ask's admin switch (getAskMode in lib/modules/analysis-mode.ts, separate from module runs). On 'queue', Ask's Claude work
// for anyone but an admin waits for the team instead of running: typed questions (and the lead
// searches or emails they lead to), Lead Finder's "Find new leads" and "Look again now" in memory.
// Writing emails and replies always runs straight away. Background work that uses Claude (patterns
// noticed, pinned answers refreshed) pauses.
//
// Jobs live per brand in signal_snapshots 'ask:queue'. One pending row in the admin queue
// (analysis_requests, ASK_REQUEST_NAME, module_id = brand id) stands for all of a brand's waiting jobs;
// the admin's Run runs them (runQueued), and the answers show on Ask's home under "From the team".

import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { analysisRequests } from '@/lib/db/schema'
import { isAdminEmail } from '@/lib/admin'
import { getSnapshot, saveSnapshot } from '@/lib/signals'
import { getAskMode, type AnalysisMode } from '@/lib/modules/analysis-mode'
import { queueAnalysisRequest } from '@/lib/modules/analysis-queue'
import { withAIContext } from '@/lib/ai/client'
import { withDemo } from '@/lib/agents/demo'
import { readDemoSwitch } from '@/lib/agents/store'
import { advanceEngine, readJob, startEngine } from '@/lib/leads/engine'
import { askQuestion, questionsLeft } from './engine'
import { refreshNoticed } from './memory'
import { ASK_REQUEST_NAME, type AskEvent, type QueuedJob } from './types'

const KEY = 'ask:queue'
const KEEP = 30
const KEEP_DAYS = 30

/** How this person's Ask work runs: admins always straight away; everyone else follows the switch. */
export async function modeFor(email: string | null | undefined): Promise<AnalysisMode> {
  return isAdminEmail(email) ? 'direct' : getAskMode()
}

export async function readQueue(brandId: string): Promise<QueuedJob[]> {
  const jobs = (await getSnapshot<{ jobs: QueuedJob[] }>(brandId, KEY))?.jobs ?? []
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000
  return jobs.filter(j => j.status === 'waiting' || Date.parse(j.doneAt ?? j.at) > cutoff)
}
const save = (brandId: string, jobs: QueuedJob[]) => saveSnapshot(brandId, KEY, { jobs: jobs.slice(0, KEEP) })

async function update(brandId: string, id: string, f: (j: QueuedJob) => QueuedJob) {
  const jobs = await readQueue(brandId)
  await save(brandId, jobs.map(j => (j.id === id ? f(j) : j)))
}

/** Adds a job and makes sure the admin queue has a pending row for this brand. */
export async function enqueue(brandId: string, user: { id: string; email: string }, job: Pick<QueuedJob, 'kind' | 'question' | 'threadId' | 'clarify'>): Promise<{ job?: QueuedJob; error?: string }> {
  const jobs = await readQueue(brandId)
  if (job.kind !== 'question' && jobs.some(j => j.kind === job.kind && j.status === 'waiting')) return { job: jobs.find(j => j.kind === job.kind && j.status === 'waiting') }
  if (job.kind === 'question' && (await questionsLeft(brandId)) - jobs.filter(j => j.kind === 'question' && j.status === 'waiting').length <= 0) {
    return { error: 'That’s all your questions for today. Ready answers still work, and you can ask again tomorrow.' }
  }
  const j: QueuedJob = { ...job, id: crypto.randomUUID(), at: new Date().toISOString(), status: 'waiting' }
  await save(brandId, [j, ...jobs])
  const [pending] = await db.select({ id: analysisRequests.id }).from(analysisRequests)
    .where(and(eq(analysisRequests.moduleId, brandId), eq(analysisRequests.moduleName, ASK_REQUEST_NAME), eq(analysisRequests.status, 'pending'))).limit(1)
  if (!pending) await queueAnalysisRequest({ userId: user.id, userEmail: user.email, moduleId: brandId, moduleName: ASK_REQUEST_NAME })
  return { job: j }
}

/** The person opened a finished job: it no longer shows as new. */
export async function markSeen(brandId: string, id: string) {
  await update(brandId, id, j => ({ ...j, seen: true }))
}

// Progress lines aren't kept: the answer is what they come back for
const KEEP_EVENT = new Set<AskEvent['t']>(['understand', 'look', 'check', 'answer', 'card', 'ask_back', 'memory', 'remembered', 'task', 'proposal', 'error'])

/**
 * Moves the brand's lead search on until it's finished or the time is up (inside the admin's Run, so
 * it runs where the Run runs: Claude Code on the owner's computer, or the API on the live site).
 * True when it's finished.
 */
async function finishSearch(brandId: string, deadline: number): Promise<boolean> {
  for (;;) {
    const job = await readJob(brandId)
    if (!job || job.status !== 'running') return true
    const left = deadline - Date.now()
    if (left < 30_000) return false
    // Someone else holds it for a moment (an earlier stretch still saving): wait and look again
    if (job.lockUntil && job.lockUntil > Date.now()) { await new Promise(r => setTimeout(r, 5_000)); continue }
    await withDemo(false, () => advanceEngine(brandId, Math.min(230_000, left - 20_000)))
  }
}

/**
 * Runs a brand's waiting jobs, oldest first, until `budgetMs` is nearly used (the admin's Run). A job
 * that starts a lead search is only done once the search is: the user never sees it half way. If time
 * runs out it stays waiting (searching), and the next Run carries the search on.
 */
export async function runQueued(brandId: string, budgetMs: number): Promise<{ ran: number; remaining: number }> {
  const started = Date.now()
  const deadline = started + budgetMs
  let ran = 0
  for (;;) {
    const next = (await readQueue(brandId)).filter(j => j.status === 'waiting').sort((a, b) => a.at.localeCompare(b.at))[0]
    if (!next) break
    let out: Partial<QueuedJob>
    try {
      if (next.searching) {
        // A search an earlier Run started: carry it on
        out = (await finishSearch(brandId, deadline)) ? { status: 'done', searching: false } : { searching: true }
      } else {
        // A question can take a minute or two; don't start one that won't finish
        if (ran > 0 && deadline - Date.now() < 130_000) break
        if (next.kind === 'question') {
          const events: AskEvent[] = []
          let threadId = next.threadId
          await askQuestion(brandId, { question: next.question, clarify: next.clarify, threadId: next.threadId }, e => {
            if (e.t === 'thread') threadId = e.id
            else if (KEEP_EVENT.has(e.t)) events.push(e)
          })
          const search = events.some(e => e.t === 'task' && !e.error)
          const failed = events.some(e => e.t === 'error')
          out = { events, threadId, ...(failed ? { status: 'failed' as const } : search ? {} : { status: 'done' as const }) }
          if (search) {
            await update(brandId, next.id, j => ({ ...j, ...out, searching: true }))
            out = (await finishSearch(brandId, deadline)) ? { ...out, status: 'done', searching: false } : { ...out, searching: true }
          }
        } else if (next.kind === 'leads') {
          const r = await withDemo(false, () => startEngine(brandId))
          if (!r.job) out = { status: 'failed', note: r.error ?? 'The search didn’t start.' }
          else {
            await update(brandId, next.id, j => ({ ...j, searching: true }))
            out = (await finishSearch(brandId, deadline))
              ? { status: 'done', searching: false, note: 'Your new leads are in. Open Leads to see them.' }
              : { searching: true }
          }
        } else {
          const demo = await readDemoSwitch(brandId)
          const m = await withDemo(demo, () => withAIContext({ brandId, moduleType: 'ask-memory' }, () => refreshNoticed(brandId, true)))
          out = { status: 'done', note: `Looked again at what you’ve done: ${m.noticed.length} pattern${m.noticed.length === 1 ? '' : 's'} noticed. See What Ask remembers.` }
        }
      }
    } catch (e) {
      console.error('[ask] queued job failed', e)
      out = { status: 'failed', note: 'This didn’t finish. Ask again.' }
    }
    const finished = out.status === 'done' || out.status === 'failed'
    await update(brandId, next.id, j => ({ ...j, ...out, ...(finished ? { doneAt: new Date().toISOString(), seen: false } : {}) }))
    if (!finished) break   // the search needs another Run
    ran += 1
  }
  const remaining = (await readQueue(brandId)).filter(j => j.status === 'waiting').length
  return { ran, remaining }
}
