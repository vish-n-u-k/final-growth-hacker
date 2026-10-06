// ── Social posts via Frekto (used by the GrowJin MCP tools) ──────────────────
// Flow: create_social_post renders a preview (NOT scheduled) → Claude shows it and
// asks the user → schedule_social_post schedules that exact render, records it in
// frekto_scheduled_posts and closes the "Post on social media" task.

import { db } from '@/lib/db'
import { brandIntegrations, brandSignals, frektoScheduledPosts } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { callFrektoMcpTool } from '@/lib/frekto/mcp'

const FREKTO_BASE = 'https://api.frekto.ai'
const POLL_INTERVAL_MS = 3000
const POLL_BUDGET_MS = 45000 // stay well inside MCP client timeouts; longer renders return 'rendering'
const PREVIEW_MAX_BYTES = 900_000

const PLATFORMS = ['linkedin', 'instagram', 'facebook', 'pinterest', 'youtube'] as const
type PostType = 'feed' | 'story' | 'reel'

interface FrektoJob {
  id?: string
  status?: 'queued' | 'rendering' | 'done' | 'failed'
  output_url?: string
  thumbnail_url?: string
  image_urls?: string[]
  error?: string | null
}

export interface PostPreview {
  job_id: string
  status: 'rendering' | 'done' | 'failed'
  topic?: string
  platform?: string
  post_type?: PostType
  preview_url?: string
  slide_urls?: string[]
  is_video?: boolean
  error?: string
  next_step: string
  _image?: { data: string; mimeType: string } // shown inline by the MCP route, stripped from JSON
}

async function getFrekto(brandId: string) {
  const [row] = await db.select().from(brandIntegrations)
    .where(and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.provider, 'frekto'), eq(brandIntegrations.status, 'connected')))
    .limit(1)
  if (!row?.apiKey) return null
  const meta = (row.metadata as Record<string, string> | null) ?? {}
  return {
    apiKey: row.apiKey,
    timezone: meta.timezone || 'UTC',
    defaultPlatform: (meta.auto_post_platforms ?? '').split(',').map((p) => p.trim().toLowerCase()).find((p) => (PLATFORMS as readonly string[]).includes(p)) ?? 'linkedin',
  }
}

const NOT_CONNECTED = { error: 'Frekto is not connected to GrowJin. Go to GrowJin Settings → Integrations → Frekto and add your API key.' }

function formatFor(platform: string, postType: PostType): string {
  if (postType === 'story' || postType === 'reel') return '9:16'
  return platform === 'instagram' || platform === 'facebook' ? '4:5' : '1:1'
}

async function fetchJob(apiKey: string, jobId: string): Promise<FrektoJob | null> {
  try {
    const res = await fetch(`${FREKTO_BASE}/jobs/${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    })
    return res.ok ? ((await res.json()) as FrektoJob) : null
  } catch { return null }
}

// Small JPEG/PNG thumbnail so Claude can show the post inline
async function inlineImage(url: string | undefined): Promise<PostPreview['_image']> {
  if (!url) return undefined
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    const type = res.headers.get('content-type') ?? ''
    if (!res.ok || !type.startsWith('image/')) return undefined
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length <= PREVIEW_MAX_BYTES ? { data: buf.toString('base64'), mimeType: type.split(';')[0] } : undefined
  } catch { return undefined }
}

async function toPreview(job: FrektoJob, jobId: string, extra: Partial<PostPreview> = {}): Promise<PostPreview> {
  if (job.status === 'failed') {
    return { job_id: jobId, status: 'failed', error: job.error ?? 'Frekto could not render this post', next_step: 'Tell the user it failed and offer to try again with create_social_post.', ...extra }
  }
  if (job.status !== 'done') {
    return { job_id: jobId, status: 'rendering', next_step: 'Still rendering. Wait ~20 seconds, then call get_social_post_status with this job_id.', ...extra }
  }
  const isVideo = /\.(mp4|mov|webm)(\?|$)/i.test(job.output_url ?? '')
  return {
    job_id: jobId,
    status: 'done',
    preview_url: job.output_url,
    slide_urls: job.image_urls && job.image_urls.length > 1 ? job.image_urls : undefined,
    is_video: isVideo,
    next_step: 'Show the user the preview (share preview_url, and every slide_url for carousels). Frekto writes the caption and hashtags when it publishes. Ask: post now, schedule for a date/time, or make a different one? Only after the user confirms, call schedule_social_post with this job_id. Do not schedule without explicit approval.',
    _image: await inlineImage(job.thumbnail_url ?? (isVideo ? undefined : job.output_url)),
    ...extra,
  }
}

async function pollUntilDone(apiKey: string, jobId: string): Promise<FrektoJob> {
  const started = Date.now()
  let job: FrektoJob = { status: 'queued' }
  while (Date.now() - started < POLL_BUDGET_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    job = (await fetchJob(apiKey, jobId)) ?? job
    if (job.status === 'done' || job.status === 'failed') break
  }
  return job
}

// ── create_social_post ───────────────────────────────────────────────────────

export async function createSocialPost(
  brandId: string,
  opts: { topic?: string; platform?: string; postType?: string },
): Promise<PostPreview | { error: string }> {
  const frekto = await getFrekto(brandId)
  if (!frekto) return NOT_CONNECTED

  const platform = (PLATFORMS as readonly string[]).includes(opts.platform ?? '') ? opts.platform! : frekto.defaultPlatform
  const postType: PostType = opts.postType === 'story' || opts.postType === 'reel' ? opts.postType : 'feed'
  // Frekto already knows the brand; a generic topic lets it pick something fitting
  const topic = (opts.topic?.trim() || 'covering a relevant brand topic').slice(0, 300)

  let jobId: string
  try {
    const res = await fetch(`${FREKTO_BASE}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${frekto.apiKey}` },
      body: JSON.stringify({
        topic,
        format: formatFor(platform, postType),
        post_type: postType,
        ...(postType === 'reel' ? { output_format: 'mp4' } : {}),
        schedule: false, // preview only — nothing is posted until the user approves
      }),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) return { error: `Frekto rejected the request (${res.status}): ${(await res.text()).slice(0, 300)}` }
    const data = (await res.json()) as { job_id?: string }
    if (!data.job_id) return { error: 'Frekto did not return a job id.' }
    jobId = data.job_id
  } catch (e) {
    return { error: `Could not reach Frekto: ${e instanceof Error ? e.message : String(e)}` }
  }

  const job = await pollUntilDone(frekto.apiKey, jobId)
  return toPreview(job, jobId, { topic, platform, post_type: postType })
}

// ── get_social_post_status ───────────────────────────────────────────────────

export async function getSocialPostStatus(brandId: string, jobId: string): Promise<PostPreview | { error: string }> {
  const frekto = await getFrekto(brandId)
  if (!frekto) return NOT_CONNECTED
  if (!jobId) return { error: 'job_id is required.' }
  const job = await fetchJob(frekto.apiKey, jobId)
  if (!job) return { error: 'Could not find that job in Frekto.' }
  return toPreview(job, jobId)
}

// ── schedule_social_post ─────────────────────────────────────────────────────

// "2026-10-08" + "09:00" in Asia/Kolkata → UTC Date (for our own record)
function zonedToUtc(date: string, time: string, tz: string): Date {
  const guess = new Date(`${date}T${time}:00Z`)
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        .formatToParts(guess).map((p) => [p.type, p.value]),
    )
    const asZoned = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute)
    return new Date(guess.getTime() - (asZoned - guess.getTime()))
  } catch { return guess }
}

export async function scheduleSocialPost(
  brandId: string,
  opts: {
    jobId: string
    topic?: string
    platform?: string
    postType?: string
    postNow?: boolean
    startDate?: string
    time?: string
    timezone?: string
    allowRegenerate?: boolean
  },
): Promise<Record<string, unknown>> {
  const frekto = await getFrekto(brandId)
  if (!frekto) return NOT_CONNECTED
  if (!opts.jobId) return { error: 'job_id is required (from create_social_post).' }
  if (!opts.postNow && !/^\d{4}-\d{2}-\d{2}$/.test(opts.startDate ?? '')) {
    return { error: 'Set post_now=true, or give start_date as YYYY-MM-DD.' }
  }

  const job = await fetchJob(frekto.apiKey, opts.jobId)
  if (!job) return { error: 'Could not find that job in Frekto.' }
  if (job.status !== 'done') return { error: `The post isn't ready yet (status: ${job.status}). Call get_social_post_status first.` }

  const platform = (PLATFORMS as readonly string[]).includes(opts.platform ?? '') ? opts.platform! : frekto.defaultPlatform
  const postType: PostType = opts.postType === 'story' || opts.postType === 'reel' ? opts.postType : 'feed'
  const time = /^\d{2}:\d{2}$/.test(opts.time ?? '') ? opts.time! : '09:00'
  const timezone = opts.timezone || frekto.timezone
  const scheduledAt = opts.postNow ? new Date() : zonedToUtc(opts.startDate!, time, timezone)
  const when = opts.postNow ? { post_now: true } : { start_date: opts.startDate, time, timezone }

  // 1. Schedule the exact render the user approved (Frekto MCP)
  const mcp = await callFrektoMcpTool(frekto.apiKey, 'schedule_post', {
    job_id: opts.jobId, platform, ...(postType !== 'feed' ? { post_type: postType } : {}), ...when,
  })

  let finalJobId = opts.jobId
  let regenerated = false
  let frektoResponse: unknown = null

  if (mcp.ok) {
    try { frektoResponse = JSON.parse(mcp.text) } catch { frektoResponse = mcp.text }
  } else if (opts.allowRegenerate) {
    // 2. Fallback: REST can only schedule at generation time, so render a fresh post with a schedule
    try {
      const res = await fetch(`${FREKTO_BASE}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${frekto.apiKey}` },
        body: JSON.stringify({
          topic: (opts.topic?.trim() || 'covering a relevant brand topic').slice(0, 300),
          format: formatFor(platform, postType),
          post_type: postType,
          schedule: { ...when, platform },
        }),
        signal: AbortSignal.timeout(20000),
      })
      if (!res.ok) return { error: `Frekto rejected the request (${res.status}): ${(await res.text()).slice(0, 300)}` }
      const data = (await res.json()) as { job_id?: string }
      if (!data.job_id) return { error: 'Frekto did not return a job id.' }
      finalJobId = data.job_id
      regenerated = true
    } catch (e) {
      return { error: `Could not reach Frekto: ${e instanceof Error ? e.message : String(e)}` }
    }
  } else {
    return {
      error: `Couldn't schedule the approved post: ${mcp.error}`,
      next_step: 'Tell the user. Offer to retry with allow_regenerate=true, which schedules a NEW render on the same topic (the image may differ from the preview). Only do that if the user agrees.',
    }
  }

  // Record it so GrowJin knows a post went out
  await db.insert(frektoScheduledPosts).values({
    brandId,
    platform,
    topic: (opts.topic?.trim() || 'Post created from Claude').slice(0, 300),
    postType: /\.(mp4|mov|webm)(\?|$)/i.test(job.output_url ?? '') ? 'video' : 'image',
    scheduledAt,
    frektoJobId: finalJobId,
    outputUrl: regenerated ? null : (job.output_url ?? null),
    status: 'scheduled',
  })

  // Close today's "Post on social media" suggestion
  await db.update(brandSignals)
    .set({ status: 'done', resolvedAt: new Date() })
    .where(and(eq(brandSignals.brandId, brandId), eq(brandSignals.source, 'diagnosis'), eq(brandSignals.signalKey, 'social-post'), eq(brandSignals.status, 'open')))
    .catch(() => {})

  return {
    ok: true,
    job_id: finalJobId,
    platform,
    scheduled_for: opts.postNow ? 'now (Frekto publishes within about a minute)' : `${opts.startDate} ${time} ${timezone}`,
    regenerated,
    ...(regenerated ? { note: 'A new render was scheduled because the approved one could not be scheduled directly. It may look different from the preview.' } : {}),
    frekto_response: frektoResponse,
  }
}
