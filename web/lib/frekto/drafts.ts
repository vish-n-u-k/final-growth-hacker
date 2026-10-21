// ── Preview-before-schedule posts (Social Studio) ────────────────────────────
// Flow: createDraft renders the post WITHOUT scheduling it and stores a 'draft' row →
// the user sees the image (and slides) in Social Studio → approvePost schedules that
// exact render through Frekto's MCP schedule_post. Scheduled posts can be cancelled or
// rescheduled later, which needs Frekto's scheduled_id (not the job_id), so we keep it.

import { db } from '@/lib/db'
import { brandIntegrations, frektoScheduledPosts, socialSuggestions } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { callFrektoMcpTool } from '@/lib/frekto/mcp'
import { zonedToUtc } from '@/lib/frekto/posts'
import { validTimezone } from '@/lib/frekto/time'
import { frektoJobFailed, frektoNetworkError, frektoResponseError } from '@/lib/frekto/errors'

export { validTimezone, utcToZoned } from '@/lib/frekto/time'

const FREKTO_BASE = 'https://api.frekto.ai'

export type PostRow = typeof frektoScheduledPosts.$inferSelect

interface FrektoJob {
  status?: 'queued' | 'rendering' | 'done' | 'failed'
  output_url?: string
  thumbnail_url?: string
  image_urls?: string[]
  scheduled_id?: string | null
  caption?: string | null
  error?: string | null
}

export type When = { postNow: true } | { postNow?: false; date: string; time: string; timezone?: string }

type Result<T = PostRow> = { ok: true; post: T } | { ok: false; error: string; canRegenerate?: boolean; status?: number }

export async function getFrektoForBrand(brandId: string) {
  const [row] = await db.select().from(brandIntegrations)
    .where(and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.provider, 'frekto'), eq(brandIntegrations.status, 'connected')))
    .limit(1)
  if (!row?.apiKey) return null
  const meta = (row.metadata as Record<string, string> | null) ?? {}
  return {
    apiKey: row.apiKey,
    timezone: validTimezone(meta.timezone) ? meta.timezone : 'UTC',
    preferredTime: /^\d{2}:\d{2}$/.test(meta.preferred_time ?? '') ? meta.preferred_time : '10:00',
    meta,
  }
}

export const NOT_CONNECTED = 'Frekto is not connected. Go to Settings → Integrations to add your API key.'


export function formatFor(platform: string, postType: string): { format: string; outputFormat: string } {
  if (postType === 'video') return { format: platform === 'youtube' ? '16:9' : '9:16', outputFormat: 'mp4' }
  return { format: platform === 'instagram' ? '4:5' : '1:1', outputFormat: 'png' }
}

export async function fetchJob(apiKey: string, jobId: string): Promise<FrektoJob | null> {
  try {
    const res = await fetch(`${FREKTO_BASE}/jobs/${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    })
    return res.ok ? ((await res.json()) as FrektoJob) : null
  } catch { return null }
}

// Copy what a finished/failed render gives us onto the row
function jobFields(job: FrektoJob): Partial<typeof frektoScheduledPosts.$inferInsert> {
  if (job.status === 'failed') return { status: 'failed', error: frektoJobFailed(job.error, 'post') }
  if (job.status !== 'done') return {}
  return {
    outputUrl: job.output_url ?? null,
    thumbnailUrl: job.thumbnail_url ?? null,
    slideUrls: job.image_urls && job.image_urls.length > 1 ? job.image_urls : null,
    ...(job.caption ? { caption: job.caption } : {}),
    ...(job.scheduled_id ? { frektoScheduledId: job.scheduled_id } : {}),
  }
}

async function getPost(brandId: string, postId: string): Promise<PostRow | null> {
  const [row] = await db.select().from(frektoScheduledPosts)
    .where(and(eq(frektoScheduledPosts.id, postId), eq(frektoScheduledPosts.brandId, brandId)))
    .limit(1)
  return row ?? null
}

async function update(id: string, set: Partial<typeof frektoScheduledPosts.$inferInsert>): Promise<PostRow> {
  const [row] = await db.update(frektoScheduledPosts).set(set).where(eq(frektoScheduledPosts.id, id)).returning()
  return row
}

// ── Create a draft (render only, nothing is published) ───────────────────────

export async function createDraft(brandId: string, opts: {
  platform: string
  topic: string
  postType: string
  scheduledAt?: Date | null
  source: string
  suggestionId?: string | null
  waitMs?: number
}): Promise<Result> {
  const frekto = await getFrektoForBrand(brandId)
  if (!frekto) return { ok: false, error: NOT_CONNECTED, status: 400 }

  // Claim the suggestion first so two clicks (or two tabs) can't both turn it into a post
  if (opts.suggestionId) {
    const claimed = await db.update(socialSuggestions)
      .set({ status: 'accepted', updatedAt: new Date() })
      .where(and(eq(socialSuggestions.id, opts.suggestionId), eq(socialSuggestions.brandId, brandId), eq(socialSuggestions.status, 'suggested')))
      .returning({ id: socialSuggestions.id })
    if (claimed.length === 0) return { ok: false, error: 'This suggestion was already used or dismissed.', status: 409 }
  }
  const release = async () => {
    if (opts.suggestionId) await db.update(socialSuggestions).set({ status: 'suggested', updatedAt: new Date() }).where(eq(socialSuggestions.id, opts.suggestionId)).catch(() => {})
  }

  const postType = opts.postType === 'video' ? 'video' : 'image'
  const { format, outputFormat } = formatFor(opts.platform, postType)
  let jobId: string
  try {
    const res = await fetch(`${FREKTO_BASE}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${frekto.apiKey}` },
      body: JSON.stringify({ topic: opts.topic.trim().slice(0, 300), format, output_format: outputFormat, schedule: false }),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) { await release(); return { ok: false, error: await frektoResponseError(res, 'create the preview'), status: 502 } }
    const data = (await res.json()) as { job_id?: string }
    if (!data.job_id) { await release(); return { ok: false, error: 'Frekto did not return a job id.', status: 502 } }
    jobId = data.job_id
  } catch (e) {
    await release()
    return { ok: false, error: frektoNetworkError(e, 'create the preview'), status: 502 }
  }

  const [row] = await db.insert(frektoScheduledPosts).values({
    brandId,
    platform: opts.platform,
    topic: opts.topic.trim().slice(0, 500),
    postType,
    scheduledAt: opts.scheduledAt ?? new Date(Date.now() + 864e5),
    frektoJobId: jobId,
    source: opts.source,
    suggestionId: opts.suggestionId ?? null,
    status: 'draft',
  }).returning()

  if (opts.suggestionId) {
    await db.update(socialSuggestions).set({ postId: row.id }).where(eq(socialSuggestions.id, opts.suggestionId)).catch(() => {})
  }

  // Wait for the render if there's time; otherwise the page checks again later
  const deadline = Date.now() + (opts.waitMs ?? 0)
  let post = row
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000))
    const job = await fetchJob(frekto.apiKey, jobId)
    if (job && (job.status === 'done' || job.status === 'failed')) { post = await update(row.id, jobFields(job)); break }
  }
  return { ok: true, post }
}

// ── Check a draft whose render wasn't finished yet ───────────────────────────

export async function refreshPost(brandId: string, post: PostRow, apiKey?: string): Promise<PostRow> {
  if (post.status !== 'draft' || post.outputUrl || !post.frektoJobId) return post
  const key = apiKey ?? (await getFrektoForBrand(brandId))?.apiKey
  if (!key) return post
  const job = await fetchJob(key, post.frektoJobId)
  if (!job || (job.status !== 'done' && job.status !== 'failed')) return post
  return update(post.id, jobFields(job))
}

export async function refreshPostById(brandId: string, postId: string): Promise<Result> {
  const post = await getPost(brandId, postId)
  if (!post) return { ok: false, error: 'Post not found', status: 404 }
  return { ok: true, post: await refreshPost(brandId, post) }
}

// ── Approve: schedule the exact render the user saw ──────────────────────────

function whenArgs(when: When, fallbackTz: string) {
  if (when.postNow) return { args: { post_now: true }, scheduledAt: new Date() }
  const timezone = validTimezone(when.timezone) ? when.timezone : fallbackTz
  return {
    args: { start_date: when.date, time: when.time, timezone },
    scheduledAt: zonedToUtc(when.date, when.time, timezone),
  }
}

function validWhen(when: When): string | null {
  if (when.postNow) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(when.date ?? '')) return 'Pick a date.'
  if (!/^\d{2}:\d{2}$/.test(when.time ?? '')) return 'Pick a time.'
  return null
}

function parseScheduledId(text: string): string | null {
  try {
    const data = JSON.parse(text) as Record<string, unknown>
    const id = data.scheduled_id ?? (data.scheduled as Record<string, unknown> | undefined)?.id ?? data.id
    return typeof id === 'string' ? id : null
  } catch {
    return text.match(/scheduled_id["':\s]+([\w-]+)/)?.[1] ?? null
  }
}

export async function approvePost(brandId: string, postId: string, when: When, opts: { regenerate?: boolean } = {}): Promise<Result> {
  const bad = validWhen(when)
  if (bad) return { ok: false, error: bad, status: 400 }
  const frekto = await getFrektoForBrand(brandId)
  if (!frekto) return { ok: false, error: NOT_CONNECTED, status: 400 }

  let post = await getPost(brandId, postId)
  if (!post) return { ok: false, error: 'Post not found', status: 404 }
  if (post.status !== 'draft') return { ok: false, error: `This post is already ${post.status}.`, status: 409 }
  post = await refreshPost(brandId, post, frekto.apiKey)
  if (!post.outputUrl && !opts.regenerate) return { ok: false, error: 'The preview is still rendering. Try again in a few seconds.', status: 409 }

  // Lock it so a double click can't schedule it twice
  const locked = await db.update(frektoScheduledPosts).set({ status: 'scheduling' })
    .where(and(eq(frektoScheduledPosts.id, post.id), eq(frektoScheduledPosts.status, 'draft')))
    .returning({ id: frektoScheduledPosts.id })
  if (locked.length === 0) return { ok: false, error: 'This post is already being scheduled.', status: 409 }

  const { args, scheduledAt } = whenArgs(when, frekto.timezone)

  if (!opts.regenerate) {
    const mcp = await callFrektoMcpTool(frekto.apiKey, 'schedule_post', { job_id: post.frektoJobId, platform: post.platform, ...args })
    if (!mcp.ok) {
      await update(post.id, { status: 'draft' })
      return { ok: false, error: `Couldn't schedule this preview: ${mcp.error}`, canRegenerate: true, status: 502 }
    }
    const saved = await update(post.id, { status: 'scheduled', scheduledAt, frektoScheduledId: parseScheduledId(mcp.text), error: null })
    return { ok: true, post: saved }
  }

  // Fallback when MCP scheduling isn't available: Frekto's REST API can only schedule at
  // render time, so this makes a NEW render on the same topic (it may look different).
  const { format, outputFormat } = formatFor(post.platform, post.postType)
  try {
    const res = await fetch(`${FREKTO_BASE}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${frekto.apiKey}` },
      body: JSON.stringify({ topic: post.topic.slice(0, 300), format, output_format: outputFormat, schedule: { ...args, platform: post.platform } }),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) {
      await update(post.id, { status: 'draft' })
      return { ok: false, error: await frektoResponseError(res, 'schedule the post'), status: 502 }
    }
    const data = (await res.json()) as { job_id?: string }
    if (!data.job_id) { await update(post.id, { status: 'draft' }); return { ok: false, error: 'Frekto did not return a job id.', status: 502 } }
    const saved = await update(post.id, {
      status: 'scheduled', scheduledAt, frektoJobId: data.job_id, frektoScheduledId: null,
      outputUrl: null, thumbnailUrl: null, slideUrls: null,
      error: 'Scheduled as a new render — the image may differ from the preview.',
    })
    return { ok: true, post: saved }
  } catch (e) {
    await update(post.id, { status: 'draft' })
    return { ok: false, error: frektoNetworkError(e, 'schedule the post'), status: 502 }
  }
}

// ── Cancel / reschedule ──────────────────────────────────────────────────────

// Older rows (and renders scheduled at generate time) may not have scheduled_id yet
async function ensureScheduledId(post: PostRow, apiKey: string): Promise<string | null> {
  if (post.frektoScheduledId) return post.frektoScheduledId
  if (!post.frektoJobId || post.seriesId === post.frektoJobId) return null
  const job = await fetchJob(apiKey, post.frektoJobId)
  if (!job?.scheduled_id) return null
  await update(post.id, { frektoScheduledId: job.scheduled_id })
  return job.scheduled_id
}

export async function cancelPost(brandId: string, postId: string): Promise<Result> {
  const post = await getPost(brandId, postId)
  if (!post) return { ok: false, error: 'Post not found', status: 404 }

  if (post.status === 'draft') {
    // Discarding a preview means the user didn't want that idea
    if (post.suggestionId) {
      await db.update(socialSuggestions).set({ status: 'dismissed', updatedAt: new Date() }).where(eq(socialSuggestions.id, post.suggestionId)).catch(() => {})
    }
    return { ok: true, post: await update(post.id, { status: 'cancelled' }) }
  }
  if (post.status !== 'scheduled') return { ok: false, error: `Can't cancel a post that is ${post.status}.`, status: 409 }
  if (post.scheduledAt.getTime() <= Date.now()) return { ok: false, error: 'This post\'s time has passed — it may already be published.', status: 409 }

  const frekto = await getFrektoForBrand(brandId)
  if (!frekto) return { ok: false, error: NOT_CONNECTED, status: 400 }
  const scheduledId = await ensureScheduledId(post, frekto.apiKey)
  if (!scheduledId) return { ok: false, error: 'GrowJin doesn\'t have Frekto\'s schedule id for this post. Cancel it in your Frekto dashboard.', status: 409 }

  const mcp = await callFrektoMcpTool(frekto.apiKey, 'cancel_scheduled_post', { scheduled_id: scheduledId })
  if (!mcp.ok) return { ok: false, error: `Frekto couldn't cancel it: ${mcp.error}`, status: 502 }
  return { ok: true, post: await update(post.id, { status: 'cancelled' }) }
}

export async function reschedulePost(brandId: string, postId: string, when: When): Promise<Result> {
  const bad = validWhen(when)
  if (bad) return { ok: false, error: bad, status: 400 }
  const post = await getPost(brandId, postId)
  if (!post) return { ok: false, error: 'Post not found', status: 404 }
  if (post.status !== 'scheduled') return { ok: false, error: `Can't reschedule a post that is ${post.status}.`, status: 409 }

  const frekto = await getFrektoForBrand(brandId)
  if (!frekto) return { ok: false, error: NOT_CONNECTED, status: 400 }
  const scheduledId = await ensureScheduledId(post, frekto.apiKey)
  if (!scheduledId) return { ok: false, error: 'GrowJin doesn\'t have Frekto\'s schedule id for this post. Change it in your Frekto dashboard.', status: 409 }

  const { args, scheduledAt } = whenArgs(when, frekto.timezone)
  const mcp = await callFrektoMcpTool(frekto.apiKey, 'reschedule_post', { scheduled_id: scheduledId, ...args })
  if (!mcp.ok) return { ok: false, error: `Frekto couldn't reschedule it: ${mcp.error}`, status: 502 }
  return { ok: true, post: await update(post.id, { scheduledAt }) }
}

// ── Shape sent to the browser ────────────────────────────────────────────────

export function toClientPost(p: PostRow) {
  return {
    id: p.id,
    platform: p.platform,
    topic: p.topic,
    postType: p.postType,
    scheduledAt: p.scheduledAt?.toISOString() ?? null,
    status: p.status,
    outputUrl: p.outputUrl,
    thumbnailUrl: p.thumbnailUrl,
    slideUrls: p.slideUrls ?? null,
    caption: p.caption,
    source: p.source,
    seriesId: p.seriesId,
    error: p.error,
    canManage: p.status === 'draft' || (p.status === 'scheduled' && (!!p.frektoScheduledId || (!!p.frektoJobId && p.seriesId !== p.frektoJobId))),
    createdAt: p.createdAt?.toISOString() ?? null,
  }
}
export type ClientPost = ReturnType<typeof toClientPost>
