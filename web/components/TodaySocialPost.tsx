'use client'

// Today → "Create a post": pick an idea, Frekto renders the post, the user checks the preview,
// then posts it now or schedules it. Nothing is published without that last click.
// Server side: /api/social/post (create, status) and /api/social/post/schedule.

import { useEffect, useRef, useState } from 'react'
import SocialIcon from '@/components/SocialIcon'
import { connectUrl } from '@/lib/integrations/connect-url'

export interface PostIdea {
  label: string
  platform: string | null
  hook: string | null
}

// Platforms Frekto can publish to
const PLATFORMS = [
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'pinterest', label: 'Pinterest' },
  { key: 'youtube', label: 'YouTube' },
] as const
const TYPES = [
  { key: 'feed', label: 'Post' },
  { key: 'story', label: 'Story' },
  { key: 'reel', label: 'Reel (video)' },
] as const

interface Preview {
  job_id: string
  status: 'rendering' | 'done' | 'failed'
  preview_url?: string
  slide_urls?: string[]
  is_video?: boolean
  error?: string
}

type Stage = 'compose' | 'making' | 'preview' | 'publishing' | 'published'

const tomorrow = () => {
  const d = new Date(Date.now() + 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const localZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return 'UTC' } }

export default function TodaySocialPost({ connected, ideas, defaultPlatform, onPublished }: {
  connected: boolean
  ideas: PostIdea[]
  defaultPlatform: string | null
  onPublished: () => void
}) {
  const firstIdea = ideas[0]
  const usable = (p: string | null | undefined) => PLATFORMS.some(x => x.key === p) ? p! : null
  const [topic, setTopic] = useState(firstIdea?.label ?? '')
  const [platform, setPlatform] = useState(usable(firstIdea?.platform) ?? usable(defaultPlatform) ?? 'linkedin')
  const [postType, setPostType] = useState<'feed' | 'story' | 'reel'>('feed')
  const [stage, setStage] = useState<Stage>('compose')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [canRegenerate, setCanRegenerate] = useState(false)
  const [when, setWhen] = useState<'now' | 'later'>('now')
  const [date, setDate] = useState(tomorrow)
  const [time, setTime] = useState('09:00')
  const [result, setResult] = useState<string | null>(null)
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (poll.current) clearTimeout(poll.current) }, [])

  const readError = async (res: Response) => {
    const d = await res.json().catch(() => null) as { error?: string; upgrade?: boolean } | null
    if (res.status === 402 || d?.upgrade) return 'Posting from GrowJin is part of GrowJin Pro.'
    return d?.error ?? `Something went wrong (${res.status}). Please try again.`
  }

  // Frekto keeps rendering after our first wait: check back every 5 seconds, for up to 3 minutes
  const watch = (jobId: string, startedAt = Date.now()) => {
    poll.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/social/post?jobId=${encodeURIComponent(jobId)}`)
        const d = await res.json() as Preview & { error?: string }
        if (d.status === 'done') { setPreview(d); setStage('preview'); return }
        if (d.status === 'failed' || (!res.ok && d.error)) { setError(d.error ?? 'Frekto couldn\'t make this post.'); setStage('compose'); return }
      } catch { /* try again below */ }
      if (Date.now() - startedAt > 180_000) { setError('Frekto is taking longer than usual. Try again in a minute.'); setStage('compose'); return }
      watch(jobId, startedAt)
    }, 5000)
  }

  const create = async () => {
    setError(null); setPreview(null); setResult(null); setCanRegenerate(false)
    setStage('making')
    try {
      const res = await fetch('/api/social/post', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: topic.trim(), platform, postType }),
      })
      if (!res.ok) { setError(await readError(res)); setStage('compose'); return }
      const d = await res.json() as Preview
      if (d.status === 'done') { setPreview(d); setStage('preview') }
      else if (d.status === 'failed') { setError(d.error ?? 'Frekto couldn\'t make this post.'); setStage('compose') }
      else watch(d.job_id)
    } catch {
      setError('Couldn\'t reach GrowJin. Check your connection and try again.'); setStage('compose')
    }
  }

  const publish = async (allowRegenerate = false) => {
    if (!preview) return
    setError(null); setStage('publishing')
    try {
      const res = await fetch('/api/social/post/schedule', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: preview.job_id, topic: topic.trim(), platform, postType, allowRegenerate,
          ...(when === 'now' ? { postNow: true } : { startDate: date, time, timezone: localZone() }),
        }),
      })
      const d = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; scheduled_for?: string; regenerated?: boolean; next_step?: string }
      if (!res.ok || !d.ok) {
        setError(res.status === 402 ? 'Posting from GrowJin is part of GrowJin Pro.' : d.error ?? 'Couldn\'t post this. Please try again.')
        setCanRegenerate(!!d.next_step?.includes('allow_regenerate'))
        setStage('preview'); return
      }
      const name = PLATFORMS.find(p => p.key === platform)?.label ?? platform
      setResult(when === 'now'
        ? `Sent to ${name}. Frekto publishes it within about a minute.`
        : `Scheduled for ${name} on ${date} at ${time}.${d.regenerated ? ' (Frekto made a fresh version of the same post, so it may look a little different.)' : ''}`)
      setStage('published')
      onPublished()
    } catch {
      setError('Couldn\'t reach GrowJin. Check your connection and try again.'); setStage('preview')
    }
  }

  if (!connected) {
    return (
      <div className="tsp">
        <p className="tsp-muted">GrowJin makes and publishes posts through Frekto. Connect your Frekto account once and you can post from here.</p>
        <a className="tsp-btn" href={connectUrl('frekto')}>Connect Frekto</a>
      </div>
    )
  }

  if (stage === 'published') {
    return (
      <div className="tsp">
        <div className="tsp-done">
          <span aria-hidden="true">✓</span>
          <div><b>{result}</b><p className="tsp-muted">This task is marked done.</p></div>
        </div>
      </div>
    )
  }

  const busy = stage === 'making' || stage === 'publishing'

  return (
    <div className="tsp">
      {stage !== 'preview' && stage !== 'publishing' && (
        <>
          {ideas.length > 0 && (
            <div className="tsp-field">
              <span className="tsp-label">Ideas from your Social Media audit</span>
              <div className="tsp-chips">
                {ideas.slice(0, 6).map(i => (
                  <button key={i.label} type="button" disabled={busy}
                    className={`tsp-chip${topic === i.label ? ' is-on' : ''}`}
                    onClick={() => { setTopic(i.label); const p = usable(i.platform); if (p) setPlatform(p) }}>
                    {i.platform && <SocialIcon platform={i.platform} size={12} />}{i.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <label className="tsp-field">
            <span className="tsp-label">What the post is about</span>
            <textarea className="tsp-input" rows={2} maxLength={300} disabled={busy} value={topic}
              placeholder="e.g. 3 signs your invoices are costing you clients. Leave empty and Frekto picks a topic for your brand."
              onChange={e => setTopic(e.target.value)} />
          </label>

          <div className="tsp-row">
            <div className="tsp-field">
              <span className="tsp-label">Where</span>
              <div className="tsp-chips">
                {PLATFORMS.map(p => (
                  <button key={p.key} type="button" disabled={busy} className={`tsp-chip${platform === p.key ? ' is-on' : ''}`} onClick={() => setPlatform(p.key)}>
                    <SocialIcon platform={p.key} size={13} />{p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="tsp-field">
              <span className="tsp-label">Type</span>
              <div className="tsp-chips">
                {TYPES.map(t => (
                  <button key={t.key} type="button" disabled={busy} className={`tsp-chip${postType === t.key ? ' is-on' : ''}`} onClick={() => setPostType(t.key)}>{t.label}</button>
                ))}
              </div>
            </div>
          </div>

          {error && <p className="tsp-error" role="alert">{error}</p>}

          <button type="button" className="tsp-btn" disabled={busy} onClick={create}>
            {stage === 'making' ? <><span className="tsp-spin" aria-hidden="true" />Frekto is making your post… (about a minute)</> : 'Make the post'}
          </button>
          <p className="tsp-muted">You&apos;ll see it before anything is published.</p>
        </>
      )}

      {(stage === 'preview' || stage === 'publishing') && preview && (
        <>
          <div className="tsp-preview">
            {preview.is_video
              ? <video src={preview.preview_url} controls />
              : (preview.slide_urls?.length ?? 0) > 1
                ? <div className="tsp-slides">{preview.slide_urls!.map((u, i) => <img key={u} src={u} alt={`Slide ${i + 1}`} />)}</div>
                : <img src={preview.preview_url} alt="Your post" />}
          </div>
          <p className="tsp-muted">Frekto adds the caption and hashtags when it publishes.</p>

          <div className="tsp-field">
            <span className="tsp-label">When</span>
            <div className="tsp-chips">
              <button type="button" disabled={busy} className={`tsp-chip${when === 'now' ? ' is-on' : ''}`} onClick={() => setWhen('now')}>Post now</button>
              <button type="button" disabled={busy} className={`tsp-chip${when === 'later' ? ' is-on' : ''}`} onClick={() => setWhen('later')}>Schedule</button>
              {when === 'later' && (
                <>
                  <input type="date" className="tsp-input tsp-input--small" value={date} min={tomorrow()} disabled={busy} onChange={e => setDate(e.target.value)} />
                  <input type="time" className="tsp-input tsp-input--small" value={time} disabled={busy} onChange={e => setTime(e.target.value)} />
                </>
              )}
            </div>
          </div>

          {error && <p className="tsp-error" role="alert">{error}</p>}

          <div className="tsp-actions">
            <button type="button" className="tsp-btn" disabled={busy} onClick={() => publish(false)}>
              {stage === 'publishing' ? <><span className="tsp-spin" aria-hidden="true" />Sending to Frekto…</>
                : when === 'now' ? `Post to ${PLATFORMS.find(p => p.key === platform)?.label}` : 'Schedule it'}
            </button>
            {canRegenerate && (
              <button type="button" className="tsp-ghost" disabled={busy} onClick={() => publish(true)}>Schedule a fresh version instead</button>
            )}
            <button type="button" className="tsp-ghost" disabled={busy} onClick={() => { setStage('compose'); setPreview(null); setError(null) }}>Make a different one</button>
          </div>
        </>
      )}
    </div>
  )
}
