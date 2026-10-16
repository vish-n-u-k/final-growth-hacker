'use client'

import { useEffect, useMemo, useState } from 'react'
import SocialIcon, { socialBrand } from '@/components/SocialIcon'
import type { ClientPost } from '@/lib/frekto/drafts'
import { formatInZone, utcToZoned } from '@/lib/frekto/time'
import { Spinner } from '@/components/ui/spinner'

export type ScheduledPost = ClientPost

interface PostSuggestion {
  id?: string
  platform: string
  shouldPost: boolean
  topic: string
  postType: string
  scheduledAt: string
  reason: string
}

interface SeriesSuggestion {
  id?: string
  platform: string
  shouldPost: boolean
  instruction: string
  count: number
  cadence: string
  format: string
  outputFormat: string
  startDate: string
  reason: string[]
}

type When = { postNow: true } | { date: string; time: string; timezone: string }

const PLATFORM_ICONS: Record<string, string> = {
  instagram: 'IG',
  linkedin: 'LI',
  twitter: 'X',
  facebook: 'FB',
  youtube: 'YT',
  tiktok: 'TK',
}

const PLATFORM_COLORS: Record<string, string> = {
  instagram: '#e1306c',
  linkedin: '#0077b5',
  twitter: '#1da1f2',
  facebook: '#1877f2',
  youtube: '#ff0000',
  tiktok: '#010101',
}

const MANUAL_PLATFORMS = ['linkedin', 'instagram', 'facebook', 'youtube']

function PlatformPill({ platform, size = 'sm' }: { platform: string; size?: 'sm' | 'md' }) {
  const color = PLATFORM_COLORS[platform] ?? 'var(--green)'
  const pad = size === 'md' ? '4px 10px' : '2px 8px'
  const fs = size === 'md' ? '12px' : '10px'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      padding: pad, borderRadius: '99px', fontSize: fs, fontWeight: 700,
      background: `${color}18`, color, border: `1px solid ${color}40`,
      letterSpacing: '0.02em', textTransform: socialBrand(platform) ? 'none' : 'uppercase', gap: 5,
      flexShrink: 0,
    }}>
      {socialBrand(platform)
        ? <><SocialIcon platform={platform} size={size === 'md' ? 13 : 11} />{socialBrand(platform)!.name}</>
        : PLATFORM_ICONS[platform] ?? platform.slice(0, 2).toUpperCase()}
    </span>
  )
}

// A post whose time has passed and was never confirmed is "Sent to Frekto", not "Posted" —
// GrowJin doesn't hear back from Frekto yet, so it can't claim it went out.
function StatusPill({ post, now }: { post: ScheduledPost; now: number }) {
  const due = post.scheduledAt ? new Date(post.scheduledAt).getTime() <= now : false
  const configs: Record<string, { bg: string; color: string; border: string; label: string }> = {
    done: { bg: 'rgba(23,154,80,.10)', color: 'var(--green)', border: 'rgba(23,154,80,.25)', label: 'Posted' },
    scheduled: due
      ? { bg: 'var(--bg-soft)', color: 'var(--text-dim)', border: 'var(--line)', label: 'Sent to Frekto' }
      : { bg: 'rgba(122,90,8,.08)', color: 'var(--gold)', border: 'rgba(122,90,8,.25)', label: 'Scheduled' },
    scheduling: { bg: 'rgba(122,90,8,.08)', color: 'var(--gold)', border: 'rgba(122,90,8,.25)', label: 'Scheduling…' },
    draft: { bg: 'rgba(37,99,235,.08)', color: '#2563eb', border: 'rgba(37,99,235,.25)', label: 'Needs approval' },
    failed: { bg: 'rgba(220,38,38,.08)', color: '#dc2626', border: 'rgba(220,38,38,.25)', label: 'Failed' },
    cancelled: { bg: 'var(--bg-soft)', color: 'var(--text-faint)', border: 'var(--line)', label: 'Cancelled' },
  }
  const cfg = configs[post.status] ?? configs.scheduled
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: '99px', fontSize: '10px', whiteSpace: 'nowrap',
      fontWeight: 600, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
    }}>
      {post.status === 'scheduling' && <Spinner size={8} />}{cfg.label}
    </span>
  )
}

const SOURCE_LABELS: Record<string, string> = {
  suggestion: 'AI suggestion', series: 'Series', auto: 'Auto-post', claude: 'From Claude', manual: 'Manual',
}

const card: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '12px',
  padding: '24px',
  marginBottom: '20px',
}

const sectionTitle: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: 700,
  color: 'var(--text)',
  marginBottom: '4px',
}

const sectionSub: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--text-faint)',
  marginBottom: '16px',
}

const primaryBtn = (disabled = false): React.CSSProperties => ({
  padding: '6px 14px', borderRadius: '7px', fontSize: '12px', fontWeight: 600, border: 'none',
  cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
  background: disabled ? 'var(--bg-soft)' : 'var(--green)', color: disabled ? 'var(--text-dim)' : '#fff',
  fontFamily: 'var(--font-body)',
})

const ghostBtn: React.CSSProperties = {
  padding: '6px 12px', borderRadius: '7px', fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap',
  border: '1px solid var(--line)', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer',
  fontFamily: 'var(--font-body)',
}

const inputStyle: React.CSSProperties = {
  padding: '5px 8px', borderRadius: '7px', border: '1px solid var(--line)', background: 'var(--bg)',
  color: 'var(--text)', fontSize: '12px', fontFamily: 'var(--font-body)',
}

const isVideoUrl = (url: string | null) => !!url && /\.(mp4|mov|webm)(\?|$)/i.test(url)

// ── Preview of the rendered post (image, video or carousel) ──────────────────

function Preview({ post, size, onOpen }: { post: ScheduledPost; size: number; onOpen?: () => void }) {
  const src = post.thumbnailUrl ?? (isVideoUrl(post.outputUrl) ? null : post.outputUrl)
  const box: React.CSSProperties = {
    width: size, height: size, borderRadius: '8px', flexShrink: 0, overflow: 'hidden',
    background: 'var(--bg-soft)', border: '1px solid var(--line)', position: 'relative',
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: onOpen && post.outputUrl ? 'zoom-in' : 'default',
  }
  if (!post.outputUrl && post.status === 'draft') {
    return <div style={box}><span style={{ fontSize: '10px', color: 'var(--text-faint)', textAlign: 'center', padding: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}><Spinner size={14} />Rendering…</span></div>
  }
  if (!post.outputUrl) {
    return <div style={box}><span style={{ fontSize: '10px', color: 'var(--text-faint)', textAlign: 'center', padding: 4 }}>No preview</span></div>
  }
  return (
    <div style={box} onClick={onOpen} role={onOpen ? 'button' : undefined} aria-label={onOpen ? 'Open preview' : undefined}>
      {src
        ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <video src={post.outputUrl} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      {isVideoUrl(post.outputUrl) && <span style={{ position: 'absolute', bottom: 3, right: 3, fontSize: '9px', fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'rgba(0,0,0,.6)', color: '#fff' }}>VIDEO</span>}
      {post.slideUrls && post.slideUrls.length > 1 && <span style={{ position: 'absolute', bottom: 3, right: 3, fontSize: '9px', fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'rgba(0,0,0,.6)', color: '#fff' }}>{post.slideUrls.length} slides</span>}
    </div>
  )
}

function PreviewModal({ post, timezone, onClose }: { post: ScheduledPost; timezone: string; onClose: () => void }) {
  const slides = post.slideUrls && post.slideUrls.length > 1 ? post.slideUrls : null
  const [i, setI] = useState(0)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const url = slides ? slides[i] : post.outputUrl
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', borderRadius: 12, padding: 16, maxWidth: 560, width: '100%', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <PlatformPill platform={post.platform} size="md" />
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{formatInZone(post.scheduledAt, timezone)}</span>
          <button onClick={onClose} style={{ ...ghostBtn, marginLeft: 'auto' }}>Close</button>
        </div>
        {url && (isVideoUrl(url)
          ? <video src={url} controls playsInline style={{ width: '100%', borderRadius: 8, background: '#000' }} />
          : <img src={url} alt={post.topic} style={{ width: '100%', borderRadius: 8, display: 'block' }} />)}
        {slides && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 8 }}>
            <button style={ghostBtn} disabled={i === 0} onClick={() => setI(i - 1)}>‹ Prev</button>
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Slide {i + 1} of {slides.length}</span>
            <button style={ghostBtn} disabled={i === slides.length - 1} onClick={() => setI(i + 1)}>Next ›</button>
          </div>
        )}
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginTop: 12 }}>{post.topic}</div>
        <p style={{ fontSize: 12.5, color: 'var(--text-dim)', margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>
          {post.caption ?? 'Frekto writes the caption and hashtags when it publishes.'}
        </p>
      </div>
    </div>
  )
}

// ── Date/time picker used for approve and reschedule ─────────────────────────

function WhenPicker({ initialIso, timezone, busy, confirmLabel, onConfirm, onPostNow, onCancel }: {
  initialIso: string | null
  timezone: string
  busy: boolean
  confirmLabel: string
  onConfirm: (w: When) => void
  onPostNow?: () => void
  onCancel?: () => void
}) {
  const start = useMemo(() => {
    const base = initialIso && new Date(initialIso).getTime() > Date.now() + 10 * 60_000 ? new Date(initialIso) : new Date(Date.now() + 864e5)
    return utcToZoned(base, timezone)
  }, [initialIso, timezone])
  const [date, setDate] = useState(start.date)
  const [time, setTime] = useState(start.time)
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
      <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} aria-label="Date" />
      <input type="time" value={time} onChange={e => setTime(e.target.value)} style={inputStyle} aria-label="Time" />
      <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{timezone}</span>
      <button style={primaryBtn(busy || !date || !time)} disabled={busy || !date || !time} onClick={() => onConfirm({ date, time, timezone })}>
        {busy ? '…' : confirmLabel}
      </button>
      {onPostNow && <button style={ghostBtn} disabled={busy} onClick={onPostNow}>Post now</button>}
      {onCancel && <button style={ghostBtn} disabled={busy} onClick={onCancel}>Back</button>}
    </div>
  )
}

export default function SocialStudioPage({
  brandId,
  brandName,
  frektoConnected,
  socialModuleId,
  autoPostEnabled: initialAutoPost,
  frektoMeta,
  initialPosts,
  initialSuggestions,
  initialSeriesSuggestions,
  renderedAt,
}: {
  brandId: string
  brandName: string
  frektoConnected: boolean
  socialModuleId: string | null
  autoPostEnabled: boolean
  frektoMeta: { timezone: string; preferred_time: string; auto_post_platforms: string; auto_post_mode: 'approve' | 'auto' }
  initialPosts: ScheduledPost[]
  initialSuggestions: PostSuggestion[]
  initialSeriesSuggestions: SeriesSuggestion[]
  renderedAt: string
}) {
  const tz = frektoMeta.timezone
  // Server render time first so the upcoming/history split matches on hydration
  const [now, setNow] = useState(() => new Date(renderedAt).getTime())
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  const [autoPost, setAutoPost] = useState(initialAutoPost)
  const [autoMode, setAutoMode] = useState(frektoMeta.auto_post_mode)
  const [autoPostLoading, setAutoPostLoading] = useState(false)

  const [posts, setPosts] = useState<ScheduledPost[]>(initialPosts)
  const [busyPost, setBusyPost] = useState<string | null>(null)
  const [postError, setPostError] = useState<{ id: string; message: string; canRegenerate: boolean } | null>(null)
  const [reschedulingId, setReschedulingId] = useState<string | null>(null)
  const [openPost, setOpenPost] = useState<ScheduledPost | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  const [suggestions, setSuggestions] = useState<PostSuggestion[]>(initialSuggestions)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestError, setSuggestError] = useState<string | null>(null)
  const [previewingId, setPreviewingId] = useState<string | null>(null)

  const [seriesSuggestions, setSeriesSuggestions] = useState<SeriesSuggestion[]>(initialSeriesSuggestions)
  const [seriesLoading, setSuggestSeriesLoading] = useState(false)
  const [seriesError, setSeriesError] = useState<string | null>(null)
  const [launchingId, setLaunchingId] = useState<string | null>(null)

  const [manual, setManual] = useState({ platform: 'linkedin', postType: 'image', topic: '' })
  const [manualBusy, setManualBusy] = useState(false)
  const [manualError, setManualError] = useState<string | null>(null)

  const upsertPost = (p: ScheduledPost) => setPosts(list => [p, ...list.filter(x => x.id !== p.id)])

  const drafts = posts.filter(p => p.status === 'draft')
  const upcoming = posts
    .filter(p => (p.status === 'scheduled' || p.status === 'scheduling') && p.scheduledAt && new Date(p.scheduledAt).getTime() > now)
    .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime())
  const history = posts.filter(p => p.status !== 'draft' && !upcoming.includes(p))

  // Previews still rendering: check every 10s (for up to ~5 minutes)
  const rendering = drafts.filter(p => !p.outputUrl).map(p => p.id).join(',')
  useEffect(() => {
    if (!rendering) return
    let tries = 0
    const t = setInterval(async () => {
      if (++tries > 30) { clearInterval(t); return }
      for (const id of rendering.split(',')) {
        try {
          const res = await fetch(`/api/social/posts/${id}`)
          const data = await res.json() as { post?: ScheduledPost }
          if (data.post && (data.post.outputUrl || data.post.status !== 'draft')) setPosts(list => list.map(x => x.id === id ? data.post! : x))
        } catch { /* try again next tick */ }
      }
    }, 10_000)
    return () => clearInterval(t)
  }, [rendering])

  // ── Auto-post ─────────────────────────────────────────────────────────────────
  const saveAutoPost = async (patch: { enabled?: boolean; mode?: 'approve' | 'auto' }) => {
    setAutoPostLoading(true)
    try {
      const res = await fetch('/api/settings/frekto-auto-post', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (res.ok) {
        if (patch.enabled !== undefined) setAutoPost(patch.enabled)
        if (patch.mode) setAutoMode(patch.mode)
      }
    } finally {
      setAutoPostLoading(false)
    }
  }

  // ── Post actions (approve / reschedule / cancel) ─────────────────────────────
  const postAction = async (post: ScheduledPost, body: { action: string; when?: When; regenerate?: boolean }) => {
    setBusyPost(post.id)
    setPostError(null)
    try {
      const res = await fetch(`/api/social/posts/${post.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json() as { post?: ScheduledPost; error?: string; canRegenerate?: boolean }
      if (!res.ok || !data.post) {
        setPostError({ id: post.id, message: data.error ?? 'Something went wrong.', canRegenerate: !!data.canRegenerate })
        return
      }
      setPosts(list => list.map(x => x.id === post.id ? data.post! : x))
      setReschedulingId(null)
    } catch {
      setPostError({ id: post.id, message: 'Network error — please try again.', canRegenerate: false })
    } finally {
      setBusyPost(null)
    }
  }

  const cancelPost = (post: ScheduledPost) => {
    const msg = post.status === 'draft'
      ? 'Discard this preview? The idea won\'t be suggested again.'
      : 'Cancel this post? It will be taken off your Frekto schedule and won\'t be published.'
    if (window.confirm(msg)) postAction(post, { action: 'cancel' })
  }

  // ── AI Suggest ────────────────────────────────────────────────────────────────
  const fetchSuggestions = async () => {
    if (!socialModuleId) return
    setSuggestLoading(true)
    setSuggestError(null)
    try {
      const res = await fetch('/api/frekto/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleId: socialModuleId }),
      })
      const data = await res.json() as { suggestions?: PostSuggestion[]; error?: string }
      if (data.error) { setSuggestError(data.error); return }
      setSuggestions(data.suggestions ?? [])
    } catch {
      setSuggestError('Network error — please try again.')
    } finally {
      setSuggestLoading(false)
    }
  }

  const createPreview = async (s: PostSuggestion) => {
    if (!s.id) return
    setPreviewingId(s.id)
    setSuggestError(null)
    try {
      const res = await fetch('/api/social/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId: s.id }),
      })
      const data = await res.json() as { post?: ScheduledPost; error?: string }
      if (!res.ok || !data.post) { setSuggestError(data.error ?? 'Could not create the preview.'); return }
      upsertPost(data.post)
      setSuggestions(list => list.filter(x => x.id !== s.id))
    } catch {
      setSuggestError('Network error — please try again.')
    } finally {
      setPreviewingId(null)
    }
  }

  const dismissSuggestion = async (id: string | undefined, kind: 'post' | 'series') => {
    if (!id) return
    if (kind === 'post') setSuggestions(list => list.filter(x => x.id !== id))
    else setSeriesSuggestions(list => list.filter(x => x.id !== id))
    await fetch(`/api/social/suggestions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'dismissed' }),
    }).catch(() => {})
  }

  // ── Series ────────────────────────────────────────────────────────────────────
  const fetchSeriesSuggestions = async () => {
    if (!socialModuleId) return
    setSuggestSeriesLoading(true)
    setSeriesError(null)
    try {
      const res = await fetch('/api/frekto/series-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleId: socialModuleId }),
      })
      const data = await res.json() as { suggestions?: SeriesSuggestion[]; error?: string }
      if (data.error) { setSeriesError(data.error); return }
      setSeriesSuggestions((data.suggestions ?? []).filter(s => s.shouldPost))
    } catch {
      setSeriesError('Network error — please try again.')
    } finally {
      setSuggestSeriesLoading(false)
    }
  }

  const launchSeries = async (s: SeriesSuggestion) => {
    const key = s.id ?? s.platform
    setLaunchingId(key)
    setSeriesError(null)
    try {
      const res = await fetch('/api/frekto/series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suggestionId: s.id,
          platform: s.platform,
          instruction: s.instruction,
          count: s.count,
          cadence: s.cadence,
          format: s.format,
          outputFormat: s.outputFormat,
          startDate: s.startDate,
          brandId,
        }),
      })
      const data = await res.json() as { rows?: ScheduledPost[]; error?: string }
      if (!res.ok || data.error) { setSeriesError(data.error ?? 'Could not launch the series.'); return }
      setPosts(list => [...(data.rows ?? []), ...list])
      setSeriesSuggestions(list => list.filter(x => (x.id ?? x.platform) !== key))
    } catch {
      setSeriesError('Network error — please try again.')
    } finally {
      setLaunchingId(null)
    }
  }

  // ── Manual ────────────────────────────────────────────────────────────────────
  const createManual = async () => {
    if (!manual.topic.trim()) return
    setManualBusy(true)
    setManualError(null)
    try {
      const res = await fetch('/api/social/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manual),
      })
      const data = await res.json() as { post?: ScheduledPost; error?: string }
      if (!res.ok || !data.post) { setManualError(data.error ?? 'Could not create the preview.'); return }
      upsertPost(data.post)
      setManual(m => ({ ...m, topic: '' }))
    } catch {
      setManualError('Network error — please try again.')
    } finally {
      setManualBusy(false)
    }
  }

  const header = (
    <div style={{ marginBottom: '28px' }}>
      <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text)', margin: '0 0 4px', fontFamily: 'var(--font-display)' }}>
        Social Studio
      </h1>
      <p style={{ fontSize: '13px', color: 'var(--text-faint)', margin: 0 }}>
        AI-driven post scheduling powered by Frekto — {brandName}
      </p>
    </div>
  )

  // Not connected: one clear card instead of five greyed-out sections each saying "connect Frekto".
  if (!frektoConnected) {
    return (
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '32px 16px' }}>
        {header}
        <div style={{ ...card, padding: '22px' }}>
          <div style={sectionTitle}>Connect Frekto to start posting</div>
          <p style={{ ...sectionSub, marginBottom: '14px' }}>Frekto creates and publishes the posts. Once it&apos;s connected, Social Studio can:</p>
          <ul style={{ margin: '0 0 18px', paddingLeft: '18px', listStyle: 'disc', fontSize: '13.5px', color: 'var(--text-dim)', lineHeight: 1.8 }}>
            <li>Suggest one ready-to-post idea per platform from your audit</li>
            <li>Show you each post before it&apos;s scheduled</li>
            <li>Plan a whole content series</li>
            <li>Keep a queue you can reschedule or cancel</li>
          </ul>
          <a href="/settings?tab=integrations" style={{ display: 'inline-block', padding: '10px 18px', borderRadius: '10px', background: 'var(--green)', color: '#fff', fontSize: '14px', fontWeight: 600, textDecoration: 'none' }}>
            Connect Frekto →
          </a>
        </div>
      </div>
    )
  }

  const errorFor = (id: string) => postError?.id === id ? (
    <div style={{ marginTop: 8, fontSize: 12, color: '#dc2626' }}>
      {postError.message}
      {postError.canRegenerate && (
        <div style={{ marginTop: 6, color: 'var(--text-dim)' }}>
          You can schedule a fresh render of the same topic instead — it may look different from this preview.{' '}
          <button
            style={{ ...ghostBtn, padding: '3px 8px', marginLeft: 4 }}
            onClick={() => {
              const p = posts.find(x => x.id === id)
              const at = p?.scheduledAt && new Date(p.scheduledAt).getTime() > Date.now() ? new Date(p.scheduledAt) : new Date(Date.now() + 864e5)
              if (p) postAction(p, { action: 'approve', regenerate: true, when: { ...utcToZoned(at, tz), timezone: tz } })
            }}
          >
            Schedule a fresh render
          </button>
        </div>
      )}
    </div>
  ) : null

  // Group upcoming posts of the same series under one heading
  const upcomingGroups: { key: string; seriesId: string | null; items: ScheduledPost[] }[] = []
  for (const p of upcoming) {
    const g = p.seriesId ? upcomingGroups.find(x => x.seriesId === p.seriesId) : undefined
    if (g) g.items.push(p)
    else upcomingGroups.push({ key: p.seriesId ?? p.id, seriesId: p.seriesId, items: [p] })
  }

  const postRow = (p: ScheduledPost, compact = false) => (
    <div key={p.id} style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)' }}>
      {/* On a phone the actions wrap under the post instead of squeezing its text */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
        <Preview post={p} size={compact ? 44 : 56} onOpen={p.outputUrl ? () => setOpenPost(p) : undefined} />
        <div style={{ flex: '1 1 120px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 3 }}>
            <PlatformPill platform={p.platform} />
            <StatusPill post={p} now={now} />
            <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>{formatInZone(p.scheduledAt, tz)}</span>
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: compact ? 'nowrap' : 'normal' }}>
            {p.topic}
          </div>
          {!compact && (
            <div style={{ fontSize: '11px', color: 'var(--text-faint)', marginTop: 2 }}>
              {SOURCE_LABELS[p.source] ?? p.source}
              {p.caption ? ` · ${p.caption.slice(0, 90)}${p.caption.length > 90 ? '…' : ''}` : ''}
              {p.error && p.status !== 'failed' ? ` · ${p.error}` : ''}
            </div>
          )}
          {p.status === 'failed' && p.error && <div style={{ fontSize: '11px', color: '#dc2626', marginTop: 2 }}>{p.error}</div>}
        </div>
        {!compact && p.status === 'scheduled' && reschedulingId !== p.id && (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 'auto' }}>
            {p.canManage ? (
              <>
                <button style={ghostBtn} disabled={busyPost === p.id} onClick={() => { setReschedulingId(p.id); setPostError(null) }}>Reschedule</button>
                <button style={ghostBtn} disabled={busyPost === p.id} onClick={() => cancelPost(p)}>{busyPost === p.id ? '…' : 'Cancel'}</button>
              </>
            ) : (
              <a href="https://app.frekto.ai" target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>Manage in Frekto ↗</a>
            )}
          </div>
        )}
      </div>
      {reschedulingId === p.id && (
        <div style={{ marginTop: 10 }}>
          <WhenPicker
            initialIso={p.scheduledAt} timezone={tz} busy={busyPost === p.id} confirmLabel="Move"
            onConfirm={when => postAction(p, { action: 'reschedule', when })}
            onPostNow={() => postAction(p, { action: 'reschedule', when: { postNow: true } })}
            onCancel={() => setReschedulingId(null)}
          />
        </div>
      )}
      {errorFor(p.id)}
    </div>
  )

  const platformsSet = !!frektoMeta.auto_post_platforms.trim()

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '32px 16px' }}>
      {header}

      {/* Section 1 — Auto-Post Control */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
          <div>
            <div style={sectionTitle}>Auto-posting</div>
            <p style={{ ...sectionSub, marginBottom: 0 }}>
              {!autoPost
                ? 'Enable to let GrowJin make a post for you every day via Frekto.'
                : autoMode === 'approve'
                  ? 'Every day GrowJin makes new posts and puts them under "Waiting for your approval". Nothing goes out until you approve it.'
                  : 'Every day GrowJin makes new posts and schedules them straight away, without asking.'}
            </p>
            {autoPost && platformsSet && (
              <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: '6px 0 0' }}>
                Platforms: {frektoMeta.auto_post_platforms} · Time: {frektoMeta.preferred_time} · TZ: {tz}
              </p>
            )}
            {autoPost && !platformsSet && (
              <p style={{ fontSize: '12px', color: '#dc2626', margin: '6px 0 0' }}>
                No platforms chosen, so nothing will be made.{' '}
                <a href="/settings?tab=integrations" style={{ color: 'var(--green)', textDecoration: 'none' }}>Set auto-post platforms in Settings → Integrations → Frekto</a>
              </p>
            )}
          </div>
          <button
            disabled={autoPostLoading}
            onClick={() => saveAutoPost({ enabled: !autoPost })}
            aria-label={autoPost ? 'Turn auto-posting off' : 'Turn auto-posting on'}
            style={{
              flexShrink: 0,
              width: '44px', height: '24px', borderRadius: '12px', border: 'none',
              cursor: autoPostLoading ? 'not-allowed' : 'pointer',
              background: autoPost ? 'var(--green)' : 'var(--line)',
              position: 'relative', transition: 'background .2s',
            }}
          >
            <span style={{
              position: 'absolute', top: '3px', width: '18px', height: '18px', borderRadius: '50%',
              background: '#fff', transition: 'left .2s',
              left: autoPost ? '23px' : '3px',
              boxShadow: '0 1px 3px rgba(0,0,0,.2)',
            }} />
          </button>
        </div>
        {autoPost && (
          <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
            {([['approve', 'Ask me before posting'], ['auto', 'Post automatically']] as const).map(([m, label]) => (
              <button
                key={m}
                disabled={autoPostLoading}
                onClick={() => saveAutoPost({ mode: m })}
                style={{ ...ghostBtn, ...(autoMode === m ? { borderColor: 'var(--green)', color: 'var(--green)', background: 'rgba(23,154,80,.06)' } : {}) }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Section 2 — Drafts waiting for approval */}
      {drafts.length > 0 && (
        <div style={{ ...card, borderColor: 'rgba(37,99,235,.35)' }}>
          <div style={sectionTitle}>Waiting for your approval ({drafts.length})</div>
          <p style={sectionSub}>Check each post, then schedule it, post it now, or discard it. Nothing is published until you approve.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {drafts.map(p => (
              <div key={p.id} style={{ padding: '14px', borderRadius: '10px', border: '1px solid var(--line)', background: 'var(--bg)' }}>
                <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                  <Preview post={p} size={150} onOpen={p.outputUrl ? () => setOpenPost(p) : undefined} />
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                      <PlatformPill platform={p.platform} size="md" />
                      <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{SOURCE_LABELS[p.source] ?? p.source} · {p.postType}</span>
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{p.topic}</div>
                    <p style={{ fontSize: '12px', color: 'var(--text-dim)', margin: '0 0 10px' }}>
                      {p.caption ?? 'Frekto writes the caption and hashtags when it publishes.'}
                    </p>
                    {p.outputUrl ? (
                      <>
                        <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 6 }}>When should it go out?</div>
                        <WhenPicker
                          initialIso={p.scheduledAt} timezone={tz} busy={busyPost === p.id} confirmLabel="Schedule"
                          onConfirm={when => postAction(p, { action: 'approve', when })}
                          onPostNow={() => postAction(p, { action: 'approve', when: { postNow: true } })}
                        />
                      </>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>Frekto is still rendering this preview. It will appear here automatically.</div>
                    )}
                    <button style={{ ...ghostBtn, marginTop: 8, border: 'none', padding: '4px 0', color: 'var(--text-faint)' }} disabled={busyPost === p.id} onClick={() => cancelPost(p)}>
                      Discard
                    </button>
                    {errorFor(p.id)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section 3 — Upcoming queue */}
      <div style={card}>
        <div style={sectionTitle}>Upcoming</div>
        <p style={sectionSub}>Scheduled with Frekto. Times are in {tz}. Click a picture to see the full post.</p>
        {upcomingGroups.length === 0 ? (
          <p style={{ fontSize: '13px', color: 'var(--text-faint)', margin: 0 }}>
            Nothing scheduled — use AI Suggest below to make your next post.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {upcomingGroups.map(g => g.seriesId && g.items.length > 1 ? (
              <div key={g.key} style={{ border: '1px dashed var(--line)', borderRadius: 10, padding: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', margin: '2px 4px 8px' }}>
                  Series · {g.items.length} upcoming posts on {socialBrand(g.items[0].platform)?.name ?? g.items[0].platform}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{g.items.map(p => postRow(p))}</div>
              </div>
            ) : g.items.map(p => postRow(p)))}
          </div>
        )}

        {history.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <button style={{ ...ghostBtn, border: 'none', padding: 0 }} onClick={() => setShowHistory(v => !v)}>
              {showHistory ? '▾' : '▸'} Past posts ({history.length})
            </button>
            {showHistory && (
              <>
                <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '6px 0 8px' }}>
                  &ldquo;Sent to Frekto&rdquo; means the time has passed; check Frekto to confirm it published.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {history.slice(0, 30).map(p => postRow(p, true))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Section 4 — AI Suggest (single posts) */}
      <div style={card}>
        <div style={sectionTitle}>AI Suggest — single posts</div>
        <p style={sectionSub}>One post idea per platform from your audit. Ideas you&apos;ve already posted, queued or turned down aren&apos;t suggested again. You&apos;ll see a preview before anything is scheduled.</p>

        {!socialModuleId ? (
          <p style={{ fontSize: '13px', color: 'var(--text-faint)', margin: 0 }}>
            Complete the Social Media Audit first to unlock AI suggestions.
          </p>
        ) : (
          <>
            <button disabled={suggestLoading} onClick={fetchSuggestions} style={{ ...primaryBtn(suggestLoading), padding: '8px 18px', fontSize: 13 }}>
              {suggestLoading ? <><Spinner />Thinking…</> : suggestions.some(s => s.id) ? 'Get new suggestions' : 'Get suggestions'}
            </button>

            {suggestError && (
              <p style={{ fontSize: '13px', color: '#ef4444', margin: '12px 0 0' }}>{suggestError}</p>
            )}

            {suggestions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' }}>
                {suggestions.map(s => (
                  <div key={s.id ?? s.platform} style={{
                    padding: '14px 16px', borderRadius: '8px', border: '1px solid var(--line)',
                    background: s.shouldPost ? 'var(--bg)' : 'var(--bg-soft)',
                    opacity: s.shouldPost ? 1 : 0.55,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
                      <PlatformPill platform={s.platform} size="md" />
                      <div style={{ flex: 1, minWidth: 180 }}>
                        {s.shouldPost ? (
                          <>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', marginBottom: '3px' }}>
                              {s.topic}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-faint)' }}>
                              {s.postType} · {formatInZone(s.scheduledAt || null, tz)} · {s.reason}
                            </div>
                          </>
                        ) : (
                          <div style={{ fontSize: '12px', color: 'var(--text-faint)', paddingTop: '2px' }}>
                            {s.reason || 'Not recommended for this brand'}
                          </div>
                        )}
                      </div>
                      {s.shouldPost && s.id && (
                        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                          <button style={ghostBtn} disabled={previewingId === s.id} onClick={() => dismissSuggestion(s.id, 'post')}>Not interested</button>
                          <button style={primaryBtn(previewingId !== null)} disabled={previewingId !== null} onClick={() => createPreview(s)}>
                            {previewingId === s.id ? <><Spinner />Rendering… (up to 1 min)</> : 'Create preview'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Section 5 — Series Suggest */}
      <div style={card}>
        <div style={sectionTitle}>Series Suggest</div>
        <p style={sectionSub}>Plan a full content series — GrowJin writes the brief, Frekto makes and schedules every post. You can cancel or move any of them under Upcoming.</p>

        {!socialModuleId ? (
          <p style={{ fontSize: '13px', color: 'var(--text-faint)', margin: 0 }}>
            Complete the Social Media Audit first to unlock series suggestions.
          </p>
        ) : (
          <>
            <button disabled={seriesLoading} onClick={fetchSeriesSuggestions} style={{ ...primaryBtn(seriesLoading), padding: '8px 18px', fontSize: 13 }}>
              {seriesLoading ? <><Spinner />Planning…</> : 'Plan a content series'}
            </button>

            {seriesError && (
              <p style={{ fontSize: '13px', color: '#ef4444', margin: '12px 0 0' }}>{seriesError}</p>
            )}

            {seriesSuggestions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
                {seriesSuggestions.map(s => {
                  const key = s.id ?? s.platform
                  return (
                    <div key={key} style={{ padding: '14px 16px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
                        <PlatformPill platform={s.platform} size="md" />
                        <div style={{ flex: 1, minWidth: 180 }}>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', marginBottom: '4px' }}>
                            {s.instruction}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-faint)', marginBottom: '6px' }}>
                            {s.count} posts · {s.cadence} · starts {s.startDate}
                          </div>
                          {Array.isArray(s.reason) && s.reason.length > 0 && (
                            <ul style={{ margin: '0 0 0 14px', padding: 0, fontSize: '11px', color: 'var(--text-dim)', lineHeight: 1.6 }}>
                              {s.reason.map((r, ri) => <li key={ri}>{r.replace(/\*\*/g, '')}</li>)}
                            </ul>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          <button style={ghostBtn} disabled={launchingId === key} onClick={() => dismissSuggestion(s.id, 'series')}>Not interested</button>
                          <button
                            disabled={launchingId !== null}
                            onClick={() => { if (window.confirm(`Frekto will make and schedule ${s.count} ${s.platform} posts starting ${s.startDate}. Continue?`)) launchSeries(s) }}
                            style={primaryBtn(launchingId !== null)}
                          >
                            {launchingId === key ? <><Spinner />Generating… (up to 3 min)</> : 'Launch series'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Section 6 — Manual Create */}
      <div style={card}>
        <div style={sectionTitle}>Create a post manually</div>
        <p style={sectionSub}>Describe a post; Frekto renders a preview and it waits for your approval above.</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <select value={manual.platform} onChange={e => setManual(m => ({ ...m, platform: e.target.value }))} style={inputStyle} aria-label="Platform">
            {MANUAL_PLATFORMS.map(p => <option key={p} value={p}>{socialBrand(p)?.name ?? p}</option>)}
          </select>
          <select value={manual.postType} onChange={e => setManual(m => ({ ...m, postType: e.target.value }))} style={inputStyle} aria-label="Post type">
            <option value="image">Image</option>
            <option value="video">Short video</option>
          </select>
        </div>
        <textarea
          value={manual.topic}
          onChange={e => setManual(m => ({ ...m, topic: e.target.value }))}
          placeholder="e.g. 3 mistakes first-time founders make with pricing"
          rows={2}
          maxLength={300}
          style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', fontSize: 13, resize: 'vertical' }}
        />
        <button disabled={manualBusy || !manual.topic.trim()} onClick={createManual} style={{ ...primaryBtn(manualBusy || !manual.topic.trim()), marginTop: 8 }}>
          {manualBusy ? <><Spinner />Rendering… (up to 1 min)</> : 'Create preview'}
        </button>
        {manualError && <p style={{ fontSize: '13px', color: '#ef4444', margin: '10px 0 0' }}>{manualError}</p>}
      </div>

      {openPost && <PreviewModal post={openPost} timezone={tz} onClose={() => setOpenPost(null)} />}
    </div>
  )
}
