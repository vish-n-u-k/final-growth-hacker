'use client'

// Today → "Create a post", shown inside the card as three steps:
//   1. What to post about (ready ideas, or write your own)
//   2. Where (platform and format)
//   3. Check the preview, then post now or schedule
// Nothing is published without that last click.
// Server side: /api/social/post (create, status), /api/social/post/schedule, /api/social/post/ideas.

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
const FORMATS = [
  { key: 'feed', label: 'Image post' },
  { key: 'story', label: 'Story' },
  { key: 'reel', label: 'Short video' },
] as const

interface Preview {
  job_id: string
  status: 'rendering' | 'done' | 'failed'
  preview_url?: string
  slide_urls?: string[]
  is_video?: boolean
  error?: string
}

type Stage = 'choose' | 'making' | 'preview' | 'publishing' | 'published'

const OWN = '__own__'
const tomorrow = () => {
  const d = new Date(Date.now() + 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const localZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return 'UTC' } }
const nameOf = (p: string) => PLATFORMS.find(x => x.key === p)?.label ?? p
const usable = (p: string | null | undefined) => PLATFORMS.some(x => x.key === p) ? p! : null

export default function TodaySocialPost({ connected, ideas: auditIdeas, defaultPlatform, onPublished, onCancel }: {
  connected: boolean
  ideas: PostIdea[]
  defaultPlatform: string | null
  onPublished: () => void
  onCancel: () => void
}) {
  const [ideas, setIdeas] = useState<PostIdea[]>(auditIdeas)
  const [ideasLoading, setIdeasLoading] = useState(connected && auditIdeas.length === 0)
  const [picked, setPicked] = useState<string>(auditIdeas[0]?.label ?? OWN)
  const [ownTopic, setOwnTopic] = useState('')
  const [platform, setPlatform] = useState(usable(auditIdeas[0]?.platform) ?? usable(defaultPlatform) ?? 'linkedin')
  const [format, setFormat] = useState<'feed' | 'story' | 'reel'>('feed')
  const [stage, setStage] = useState<Stage>('choose')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [canRegenerate, setCanRegenerate] = useState(false)
  const [when, setWhen] = useState<'now' | 'later'>('now')
  const [date, setDate] = useState(tomorrow)
  const [time, setTime] = useState('09:00')
  const [result, setResult] = useState<string | null>(null)
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (poll.current) clearTimeout(poll.current) }, [])

  // No ideas from the Social Media audit yet: ask for three quick ones
  useEffect(() => {
    if (!connected || auditIdeas.length > 0) return
    let alive = true
    fetch('/api/social/post/ideas').then(r => r.ok ? r.json() : null).then((d: { ideas?: PostIdea[] } | null) => {
      if (!alive) return
      const list = d?.ideas ?? []
      setIdeas(list)
      if (list[0]) { setPicked(list[0].label); setPlatform(p => usable(list[0].platform) ?? p) }
    }).catch(() => {}).finally(() => { if (alive) setIdeasLoading(false) })
    return () => { alive = false }
  }, [connected, auditIdeas.length])

  const topic = picked === OWN ? ownTopic.trim() : picked

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
        if (d.status === 'failed' || (!res.ok && d.error)) { setError(d.error ?? 'Frekto couldn\'t create this post. Try another idea.'); setStage('choose'); return }
      } catch { /* try again below */ }
      if (Date.now() - startedAt > 180_000) { setError('Frekto is taking longer than usual. Please try again in a minute.'); setStage('choose'); return }
      watch(jobId, startedAt)
    }, 5000)
  }

  const create = async () => {
    setError(null); setPreview(null); setResult(null); setCanRegenerate(false)
    setStage('making')
    try {
      const res = await fetch('/api/social/post', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, platform, postType: format }),
      })
      if (!res.ok) { setError(await readError(res)); setStage('choose'); return }
      const d = await res.json() as Preview
      if (d.status === 'done') { setPreview(d); setStage('preview') }
      else if (d.status === 'failed') { setError(d.error ?? 'Frekto couldn\'t create this post. Try another idea.'); setStage('choose') }
      else watch(d.job_id)
    } catch {
      setError('Couldn\'t reach GrowJin. Check your connection and try again.'); setStage('choose')
    }
  }

  const publish = async (allowRegenerate = false) => {
    if (!preview) return
    setError(null); setStage('publishing')
    try {
      const res = await fetch('/api/social/post/schedule', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: preview.job_id, topic, platform, postType: format, allowRegenerate,
          ...(when === 'now' ? { postNow: true } : { startDate: date, time, timezone: localZone() }),
        }),
      })
      const d = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; regenerated?: boolean; next_step?: string }
      if (!res.ok || !d.ok) {
        setError(res.status === 402 ? 'Posting from GrowJin is part of GrowJin Pro.' : d.error ?? 'Couldn\'t publish this. Please try again.')
        setCanRegenerate(!!d.next_step?.includes('allow_regenerate'))
        setStage('preview'); return
      }
      setResult(when === 'now'
        ? `Posted to ${nameOf(platform)}. It goes live within about a minute.`
        : `Scheduled for ${nameOf(platform)} on ${new Date(`${date}T${time}`).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.${d.regenerated ? ' (Frekto made a fresh version of the same post, so it may look a little different.)' : ''}`)
      setStage('published')
      onPublished()
    } catch {
      setError('Couldn\'t reach GrowJin. Check your connection and try again.'); setStage('preview')
    }
  }

  // ── Not connected ──
  if (!connected) {
    return (
      <div className="tsp">
        <div className="tsp-note">
          <b>Connect Frekto to post from here</b>
          <p>GrowJin creates and publishes posts through your Frekto account. Connect it once, then come back to this card.</p>
        </div>
        <div className="tsp-foot">
          <a className="tsp-btn" href={connectUrl('frekto')}>Connect Frekto</a>
          <button type="button" className="tsp-link" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    )
  }

  // ── Done ──
  if (stage === 'published') {
    return (
      <div className="tsp">
        <div className="tsp-done">
          <span aria-hidden="true">✓</span>
          <div><b>{result}</b><p>Nice. Today&apos;s post is done.</p></div>
        </div>
        <div className="tsp-foot"><button type="button" className="tsp-btn" onClick={onCancel}>Close</button></div>
      </div>
    )
  }

  const step = stage === 'preview' || stage === 'publishing' ? 3 : 1
  const busy = stage === 'making' || stage === 'publishing'

  return (
    <div className="tsp">
      <ol className="tsp-steps" aria-label="Steps">
        <li className={step === 1 ? 'is-on' : 'is-done'}>Pick an idea</li>
        <li className={step === 1 ? 'is-on' : 'is-done'}>Choose where</li>
        <li className={step === 3 ? 'is-on' : ''}>Check and post</li>
      </ol>

      {(stage === 'choose' || stage === 'making') && (
        <>
          {/* 1. What to post about */}
          <fieldset className="tsp-q" disabled={busy}>
            <legend>What should the post be about?</legend>
            {ideasLoading && <div className="tsp-skel" aria-label="Loading ideas"><i /><i /><i /></div>}
            {ideas.map(i => (
              <label key={i.label} className={`tsp-opt${picked === i.label ? ' is-on' : ''}`}>
                <input type="radio" name="tsp-idea" checked={picked === i.label}
                  onChange={() => { setPicked(i.label); const p = usable(i.platform); if (p) setPlatform(p) }} />
                <span>{i.label}</span>
                {usable(i.platform) && <em><SocialIcon platform={i.platform!} size={12} />{nameOf(i.platform!)}</em>}
              </label>
            ))}
            <label className={`tsp-opt${picked === OWN ? ' is-on' : ''}`}>
              <input type="radio" name="tsp-idea" checked={picked === OWN} onChange={() => setPicked(OWN)} />
              <span>{ideas.length || ideasLoading ? 'Write my own' : 'Write what the post is about'}</span>
            </label>
            {picked === OWN && (
              <textarea className="tsp-input" rows={2} maxLength={300} value={ownTopic} autoFocus={ideas.length > 0}
                placeholder="e.g. How we helped a customer save 5 hours a week. Leave empty and Frekto picks a topic for your brand."
                onChange={e => setOwnTopic(e.target.value)} />
            )}
          </fieldset>

          {/* 2. Where */}
          <fieldset className="tsp-q" disabled={busy}>
            <legend>Where should it go?</legend>
            <div className="tsp-chips">
              {PLATFORMS.map(p => (
                <button key={p.key} type="button" className={`tsp-chip${platform === p.key ? ' is-on' : ''}`} aria-pressed={platform === p.key} onClick={() => setPlatform(p.key)}>
                  <SocialIcon platform={p.key} size={13} />{p.label}
                </button>
              ))}
            </div>
            <div className="tsp-chips tsp-chips--small">
              {FORMATS.map(f => (
                <button key={f.key} type="button" className={`tsp-chip${format === f.key ? ' is-on' : ''}`} aria-pressed={format === f.key} onClick={() => setFormat(f.key)}>{f.label}</button>
              ))}
            </div>
          </fieldset>

          {error && <p className="tsp-error" role="alert">{error}</p>}

          <div className="tsp-foot">
            {stage === 'making' ? (
              <div className="tsp-progress" role="status">
                <span className="tsp-spin" aria-hidden="true" />
                <div><b>Creating your {nameOf(platform)} post…</b><p>This usually takes under a minute. Nothing is published yet.</p></div>
              </div>
            ) : (
              <>
                <button type="button" className="tsp-btn" disabled={picked === OWN && ideasLoading} onClick={create}>Create preview</button>
                <button type="button" className="tsp-link" onClick={onCancel}>Cancel</button>
                <span className="tsp-hint">You&apos;ll see the post before anything is published.</span>
              </>
            )}
          </div>
        </>
      )}

      {(stage === 'preview' || stage === 'publishing') && preview && (
        <div className="tsp-review">
          <div className="tsp-preview">
            {preview.is_video
              ? <video src={preview.preview_url} controls />
              : (preview.slide_urls?.length ?? 0) > 1
                ? <div className="tsp-slides">{preview.slide_urls!.map((u, i) => <img key={u} src={u} alt={`Slide ${i + 1}`} />)}</div>
                : <img src={preview.preview_url} alt="Your post" />}
          </div>
          <div className="tsp-review-side">
            <p className="tsp-meta"><SocialIcon platform={platform} size={14} />{nameOf(platform)} · {FORMATS.find(f => f.key === format)?.label}</p>
            {topic && <p className="tsp-topic">“{topic}”</p>}
            <p className="tsp-hint">Frekto writes the caption and hashtags when it publishes.</p>

            <fieldset className="tsp-q" disabled={busy}>
              <legend>When?</legend>
              <label className={`tsp-opt${when === 'now' ? ' is-on' : ''}`}>
                <input type="radio" name="tsp-when" checked={when === 'now'} onChange={() => setWhen('now')} /><span>Now</span>
              </label>
              <label className={`tsp-opt${when === 'later' ? ' is-on' : ''}`}>
                <input type="radio" name="tsp-when" checked={when === 'later'} onChange={() => setWhen('later')} /><span>Later</span>
              </label>
              {when === 'later' && (
                <div className="tsp-when">
                  <input type="date" className="tsp-input" value={date} min={tomorrow()} onChange={e => setDate(e.target.value)} aria-label="Date" />
                  <input type="time" className="tsp-input" value={time} onChange={e => setTime(e.target.value)} aria-label="Time" />
                </div>
              )}
            </fieldset>

            {error && <p className="tsp-error" role="alert">{error}</p>}

            <div className="tsp-foot">
              <button type="button" className="tsp-btn" disabled={busy} onClick={() => publish(false)}>
                {stage === 'publishing' ? <><span className="tsp-spin" aria-hidden="true" />Sending…</> : when === 'now' ? `Post to ${nameOf(platform)}` : 'Schedule post'}
              </button>
              {canRegenerate && <button type="button" className="tsp-ghost" disabled={busy} onClick={() => publish(true)}>Schedule a fresh version</button>}
              <button type="button" className="tsp-link" disabled={busy} onClick={() => { setStage('choose'); setPreview(null); setError(null) }}>Back</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
