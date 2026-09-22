'use client'

import { useState } from 'react'
import FrektoPostingSection from '@/components/FrektoPostingSection'

export interface ScheduledPost {
  id: string
  platform: string
  topic: string
  postType: string
  scheduledAt: string | null
  status: string
  outputUrl: string | null
  createdAt: string | null
}

interface PostSuggestion {
  platform: string
  shouldPost: boolean
  topic: string
  postType: string
  scheduledAt: string
  reason: string
}

interface SeriesSuggestion {
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

function PlatformPill({ platform, size = 'sm' }: { platform: string; size?: 'sm' | 'md' }) {
  const color = PLATFORM_COLORS[platform] ?? 'var(--green)'
  const pad = size === 'md' ? '4px 10px' : '2px 8px'
  const fs = size === 'md' ? '12px' : '10px'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      padding: pad, borderRadius: '5px', fontSize: fs, fontWeight: 700,
      background: `${color}18`, color, border: `1px solid ${color}40`,
      letterSpacing: '0.02em', textTransform: 'uppercase',
    }}>
      {PLATFORM_ICONS[platform] ?? platform.slice(0, 2).toUpperCase()}
    </span>
  )
}

function StatusPill({ status }: { status: string }) {
  const configs: Record<string, { bg: string; color: string; border: string; label: string }> = {
    done: { bg: 'rgba(23,154,80,.10)', color: 'var(--green)', border: 'rgba(23,154,80,.25)', label: 'Done' },
    scheduled: { bg: 'rgba(122,90,8,.08)', color: 'var(--gold)', border: 'rgba(122,90,8,.25)', label: 'Scheduled' },
    failed: { bg: 'rgba(220,38,38,.08)', color: '#dc2626', border: 'rgba(220,38,38,.25)', label: 'Failed' },
  }
  const cfg = configs[status] ?? configs.scheduled
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '10px',
      fontWeight: 600, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
    }}>
      {cfg.label}
    </span>
  )
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

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function SocialStudioPage({
  brandId,
  brandName,
  frektoConnected,
  socialModuleId,
  autoPostEnabled: initialAutoPost,
  frektoMeta,
  initialQueue,
}: {
  brandId: string
  brandName: string
  frektoConnected: boolean
  socialModuleId: string | null
  autoPostEnabled: boolean
  frektoMeta: { timezone: string; preferred_time: string; auto_post_platforms: string }
  initialQueue: ScheduledPost[]
}) {
  const [autoPost, setAutoPost] = useState(initialAutoPost)
  const [autoPostLoading, setAutoPostLoading] = useState(false)

  const [queue, setQueue] = useState<ScheduledPost[]>(initialQueue)

  const [suggestions, setSuggestions] = useState<PostSuggestion[]>([])
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestError, setSuggestError] = useState<string | null>(null)
  const [schedulingIdx, setSchedulingIdx] = useState<number | null>(null)
  const [scheduledSet, setScheduledSet] = useState<Set<number>>(new Set())

  const [seriesSuggestions, setSeriesSuggestions] = useState<SeriesSuggestion[]>([])
  const [seriesLoading, setSuggestSeriesLoading] = useState(false)
  const [seriesError, setSeriesError] = useState<string | null>(null)
  const [launchingIdx, setLaunchingIdx] = useState<number | null>(null)
  const [launchedSet, setLaunchedSet] = useState<Set<number>>(new Set())

  // ── Auto-post toggle ──────────────────────────────────────────────────────────
  const toggleAutoPost = async () => {
    setAutoPostLoading(true)
    try {
      const res = await fetch('/api/settings/frekto-auto-post', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !autoPost }),
      })
      if (res.ok) setAutoPost(p => !p)
    } finally {
      setAutoPostLoading(false)
    }
  }

  // ── AI Suggest ────────────────────────────────────────────────────────────────
  const fetchSuggestions = async () => {
    if (!socialModuleId) return
    setSuggestLoading(true)
    setSuggestError(null)
    setSuggestions([])
    setScheduledSet(new Set())
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

  const schedulePost = async (s: PostSuggestion, idx: number) => {
    setSchedulingIdx(idx)
    try {
      const res = await fetch('/api/frekto/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandId,
          platform: s.platform,
          topic: s.topic,
          postType: s.postType,
          scheduledAt: s.scheduledAt,
        }),
      })
      const data = await res.json() as { outputUrl?: string; error?: string }
      if (data.error) { alert(data.error); return }

      const newPost: ScheduledPost = {
        id: Math.random().toString(36).slice(2),
        platform: s.platform,
        topic: s.topic,
        postType: s.postType,
        scheduledAt: s.scheduledAt,
        status: 'scheduled',
        outputUrl: data.outputUrl ?? null,
        createdAt: new Date().toISOString(),
      }
      setQueue(q => [newPost, ...q])
      setScheduledSet(prev => new Set([...prev, idx]))
    } finally {
      setSchedulingIdx(null)
    }
  }

  // ── Series Suggest ────────────────────────────────────────────────────────────
  const fetchSeriesSuggestions = async () => {
    if (!socialModuleId) return
    setSuggestSeriesLoading(true)
    setSeriesError(null)
    setSeriesSuggestions([])
    setLaunchedSet(new Set())
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

  const launchSeries = async (s: SeriesSuggestion, idx: number) => {
    setLaunchingIdx(idx)
    try {
      const res = await fetch('/api/frekto/series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandId,
          platform: s.platform,
          instruction: s.instruction,
          count: s.count,
          cadence: s.cadence,
          format: s.format,
          outputFormat: s.outputFormat,
          startDate: s.startDate,
        }),
      })
      const data = await res.json() as { posts?: { topic: string; scheduledAt: string; outputUrl: string | null }[]; error?: string }
      if (data.error) { alert(data.error); return }

      const newPosts: ScheduledPost[] = (data.posts ?? []).map(p => ({
        id: Math.random().toString(36).slice(2),
        platform: s.platform,
        topic: p.topic,
        postType: s.outputFormat === 'mp4' ? 'video' : 'image',
        scheduledAt: p.scheduledAt,
        status: 'scheduled',
        outputUrl: p.outputUrl,
        createdAt: new Date().toISOString(),
      }))
      setQueue(q => [...newPosts, ...q])
      setLaunchedSet(prev => new Set([...prev, idx]))
    } finally {
      setLaunchingIdx(null)
    }
  }

  const locked = !frektoConnected

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '32px 16px' }}>

      {/* Page header */}
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text)', margin: '0 0 4px', fontFamily: 'var(--font-display)' }}>
          Social Studio
        </h1>
        <p style={{ fontSize: '13px', color: 'var(--text-faint)', margin: 0 }}>
          AI-driven post scheduling powered by Frekto — {brandName}
        </p>
      </div>

      {/* Not-connected banner */}
      {locked && (
        <div style={{ ...card, background: 'var(--bg-soft)', borderColor: 'var(--line)', padding: '16px 20px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-dim)' }}>
            Connect Frekto to get started.
          </span>
          <a href="/settings?tab=integrations" style={{ marginLeft: 'auto', fontSize: '12px', fontWeight: 600, color: 'var(--green)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
            Settings → Integrations →
          </a>
        </div>
      )}

      {/* Section 1 — Auto-Post Control */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
          <div>
            <div style={sectionTitle}>Auto-posting</div>
            <p style={{ ...sectionSub, marginBottom: 0 }}>
              {autoPost
                ? 'GrowJin will suggest and publish posts daily via Frekto.'
                : 'Enable to let GrowJin suggest and publish posts daily via Frekto.'}
            </p>
            {autoPost && frektoMeta.auto_post_platforms && (
              <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: '6px 0 0' }}>
                Platforms: {frektoMeta.auto_post_platforms} · Time: {frektoMeta.preferred_time} · TZ: {frektoMeta.timezone}
              </p>
            )}
            {!frektoConnected && (
              <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: '6px 0 0' }}>
                <a href="/settings?tab=integrations" style={{ color: 'var(--green)', textDecoration: 'none' }}>
                  Connect Frekto in Settings → Integrations
                </a>
              </p>
            )}
          </div>
          <button
            disabled={!frektoConnected || autoPostLoading}
            onClick={toggleAutoPost}
            style={{
              flexShrink: 0,
              width: '44px', height: '24px', borderRadius: '12px', border: 'none',
              cursor: frektoConnected && !autoPostLoading ? 'pointer' : 'not-allowed',
              background: autoPost && frektoConnected ? 'var(--green)' : 'var(--line)',
              position: 'relative', transition: 'background .2s',
            }}
          >
            <span style={{
              position: 'absolute', top: '3px', width: '18px', height: '18px', borderRadius: '50%',
              background: '#fff', transition: 'left .2s',
              left: autoPost && frektoConnected ? '23px' : '3px',
              boxShadow: '0 1px 3px rgba(0,0,0,.2)',
            }} />
          </button>
        </div>
      </div>

      {/* Section 2 — Scheduled Queue */}
      <div style={card}>
        <div style={sectionTitle}>Scheduled queue</div>
        <p style={sectionSub}>Upcoming and recent posts</p>
        {queue.length === 0 ? (
          <p style={{ fontSize: '13px', color: 'var(--text-faint)', margin: 0 }}>
            No posts scheduled yet — use AI Suggest below to generate your first batch.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {queue.map(p => (
              <div key={p.id} style={{
                display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
                borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)',
              }}>
                <PlatformPill platform={p.platform} size="md" />
                <span style={{ flex: 1, fontSize: '13px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.topic}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
                  {formatDate(p.scheduledAt)}
                </span>
                <StatusPill status={p.status} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section 3 — AI Suggest (single posts) */}
      <div style={{ ...card, opacity: locked ? 0.6 : 1 }}>
        <div style={sectionTitle}>AI Suggest — single posts</div>
        <p style={sectionSub}>GrowJin picks one best post per platform based on your audit findings and content strategy.</p>

        {!socialModuleId ? (
          <p style={{ fontSize: '13px', color: 'var(--text-faint)', margin: 0 }}>
            Complete the Social Media Audit first to unlock AI suggestions.
          </p>
        ) : (
          <>
            <button
              disabled={suggestLoading || locked}
              onClick={fetchSuggestions}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '7px',
                padding: '8px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
                border: 'none', cursor: suggestLoading || locked ? 'not-allowed' : 'pointer',
                background: suggestLoading || locked ? 'var(--bg-soft)' : 'var(--green)',
                color: suggestLoading || locked ? 'var(--text-dim)' : '#fff',
                fontFamily: 'var(--font-body)',
              }}
            >
              {suggestLoading ? 'Thinking…' : 'Get suggestions'}
            </button>

            {suggestError && (
              <p style={{ fontSize: '13px', color: '#ef4444', margin: '12px 0 0' }}>{suggestError}</p>
            )}

            {suggestions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' }}>
                {suggestions.map((s, i) => (
                  <div key={s.platform} style={{
                    padding: '14px 16px', borderRadius: '8px', border: '1px solid var(--line)',
                    background: s.shouldPost ? 'var(--bg)' : 'var(--bg-soft)',
                    opacity: s.shouldPost ? 1 : 0.55,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                      <PlatformPill platform={s.platform} size="md" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {s.shouldPost ? (
                          <>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', marginBottom: '3px' }}>
                              {s.topic}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-faint)', marginBottom: '6px' }}>
                              {s.postType} · {formatDate(s.scheduledAt)} · {s.reason}
                            </div>
                          </>
                        ) : (
                          <div style={{ fontSize: '12px', color: 'var(--text-faint)', paddingTop: '2px' }}>
                            Not recommended for this brand
                          </div>
                        )}
                      </div>
                      {s.shouldPost && (
                        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                          {scheduledSet.has(i) ? (
                            <span style={{ fontSize: '11px', color: 'var(--green)', padding: '5px 10px' }}>Scheduled</span>
                          ) : (
                            <button
                              disabled={schedulingIdx === i}
                              onClick={() => schedulePost(s, i)}
                              style={{
                                padding: '5px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
                                border: 'none', cursor: schedulingIdx === i ? 'wait' : 'pointer',
                                background: 'var(--green)', color: '#fff', fontFamily: 'var(--font-body)',
                              }}
                            >
                              {schedulingIdx === i ? '…' : 'Schedule'}
                            </button>
                          )}
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

      {/* Section 4 — Series Suggest */}
      <div style={{ ...card, opacity: locked ? 0.6 : 1 }}>
        <div style={sectionTitle}>Series Suggest</div>
        <p style={sectionSub}>Plan and launch a full content series — GrowJin builds the brief, Frekto creates all posts.</p>

        {!socialModuleId ? (
          <p style={{ fontSize: '13px', color: 'var(--text-faint)', margin: 0 }}>
            Complete the Social Media Audit first to unlock series suggestions.
          </p>
        ) : (
          <>
            <button
              disabled={seriesLoading || locked}
              onClick={fetchSeriesSuggestions}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '7px',
                padding: '8px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
                border: 'none', cursor: seriesLoading || locked ? 'not-allowed' : 'pointer',
                background: seriesLoading || locked ? 'var(--bg-soft)' : 'var(--green)',
                color: seriesLoading || locked ? 'var(--text-dim)' : '#fff',
                fontFamily: 'var(--font-body)',
              }}
            >
              {seriesLoading ? 'Planning…' : 'Plan a content series'}
            </button>

            {seriesError && (
              <p style={{ fontSize: '13px', color: '#ef4444', margin: '12px 0 0' }}>{seriesError}</p>
            )}

            {seriesSuggestions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
                {seriesSuggestions.map((s, i) => (
                  <div key={s.platform} style={{
                    padding: '14px 16px', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--bg)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                      <PlatformPill platform={s.platform} size="md" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', marginBottom: '4px' }}>
                          {s.instruction}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-faint)', marginBottom: '6px' }}>
                          {s.count} posts · {s.cadence} · starts {s.startDate}
                        </div>
                        {Array.isArray(s.reason) && s.reason.length > 0 && (
                          <ul style={{ margin: '0 0 0 14px', padding: 0, fontSize: '11px', color: 'var(--text-dim)', lineHeight: 1.6 }}>
                            {s.reason.map((r, ri) => <li key={ri}>{r}</li>)}
                          </ul>
                        )}
                      </div>
                      <div style={{ flexShrink: 0 }}>
                        {launchedSet.has(i) ? (
                          <span style={{ fontSize: '11px', color: 'var(--green)', padding: '5px 10px' }}>Launched</span>
                        ) : (
                          <button
                            disabled={launchingIdx === i}
                            onClick={() => launchSeries(s, i)}
                            style={{
                              padding: '5px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
                              border: 'none', cursor: launchingIdx === i ? 'wait' : 'pointer',
                              background: 'var(--green)', color: '#fff', fontFamily: 'var(--font-body)',
                            }}
                          >
                            {launchingIdx === i ? 'Generating… (up to 3 min)' : 'Launch series'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Section 5 — Manual Create */}
      <div style={card}>
        <div style={sectionTitle}>Create a post manually</div>
        <p style={{ ...sectionSub, marginBottom: 0 }}>Generate a one-off social media image or video with Frekto.</p>
        <FrektoPostingSection
          moduleId={socialModuleId ?? ''}
          brandName={brandName}
          connected={frektoConnected}
        />
      </div>

    </div>
  )
}
