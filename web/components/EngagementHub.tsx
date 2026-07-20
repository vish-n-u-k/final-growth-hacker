'use client'

import { useState } from 'react'
import Link from 'next/link'


interface Platform {
  id: string
  icon: string
  iconClass: string
  label: string
  handle: string
  status: 'connected' | 'limited' | 'disconnected'
  dms: number
  comments: number
  leadScore: number
  leadLevel: 'hot' | 'warm' | 'cold' | null
}

interface FeedItem {
  id: string
  initials: string
  isLead: boolean
  text: React.ReactNode
  platform: string
  time: string
  actions: { label: string; style?: 'default' | 'danger' | 'success' }[]
}

interface Complication {
  name: string
  severity: 'high' | 'medium' | 'low'
  problem: string
  solution: string
}

const PLATFORMS: Platform[] = [
  { id: 'ig', icon: 'IG', iconClass: 'eh-icon-ig', label: 'Instagram', handle: '@yourbrand', status: 'connected', dms: 6, comments: 3, leadScore: 92, leadLevel: 'hot' },
  { id: 'fb', icon: 'FB', iconClass: 'eh-icon-fb', label: 'Facebook', handle: 'Your Brand Page', status: 'connected', dms: 4, comments: 2, leadScore: 76, leadLevel: 'warm' },
  { id: 'yt', icon: 'YT', iconClass: 'eh-icon-yt', label: 'YouTube', handle: '@yourbrand', status: 'connected', dms: 0, comments: 5, leadScore: 45, leadLevel: 'cold' },
  { id: 'li', icon: 'IN', iconClass: 'eh-icon-li', label: 'LinkedIn', handle: 'Your Brand', status: 'limited', dms: 0, comments: 2, leadScore: 0, leadLevel: null },
  { id: 'x', icon: 'X', iconClass: 'eh-icon-x', label: 'X', handle: '@yourbrand', status: 'connected', dms: 3, comments: 1, leadScore: 68, leadLevel: 'warm' },
  { id: 'tt', icon: 'TT', iconClass: 'eh-icon-tt', label: 'TikTok', handle: '@yourbrand', status: 'connected', dms: 1, comments: 1, leadScore: 34, leadLevel: 'cold' },
  { id: 'pt', icon: 'P', iconClass: 'eh-icon-pt', label: 'Pinterest', handle: '', status: 'disconnected', dms: 0, comments: 0, leadScore: 0, leadLevel: null },
]

const FEED_ITEMS: FeedItem[] = [
  {
    id: '1', initials: 'JD', isLead: true,
    text: <><strong>@jessicad</strong> commented on your Reel: &ldquo;This is exactly what I needed! Does it work for e-commerce?&rdquo; <span className="eh-feed-lead-tag">Hot Lead</span></>,
    platform: 'Instagram', time: '2m ago',
    actions: [{ label: 'Reply' }, { label: 'Delete', style: 'danger' }, { label: '→ Convert', style: 'success' }],
  },
  {
    id: '2', initials: 'MR', isLead: false,
    text: <><strong>@mikeross</strong> sent a DM: &ldquo;Any chance of a discount code for agencies? We manage 12 clients.&rdquo;</>,
    platform: 'Instagram DM', time: '14m ago',
    actions: [{ label: 'Reply' }, { label: '→ Lead', style: 'success' }],
  },
  {
    id: '3', initials: 'SK', isLead: false,
    text: <><strong>Sarah K.</strong> commented on your post: &ldquo;How does this compare to competitors? Looks interesting.&rdquo;</>,
    platform: 'Facebook', time: '32m ago',
    actions: [{ label: 'Reply' }, { label: 'Hide', style: 'danger' }],
  },
  {
    id: '4', initials: 'TW', isLead: false,
    text: <><strong>@techwithtom</strong> replied to your comment: &ldquo;Great breakdown, really helpful — thanks!&rdquo;</>,
    platform: 'YouTube', time: '1h ago',
    actions: [{ label: 'View thread' }],
  },
  {
    id: '5', initials: 'SA', isLead: true,
    text: <><strong>@sama</strong> mentioned you: &ldquo;Just tried @yourbrand — <span className="eh-feed-highlight">game changer</span> for small biz. Must-have.&rdquo; <span className="eh-feed-lead-tag">Hot Lead</span></>,
    platform: 'X', time: '2h ago',
    actions: [{ label: 'Reply' }, { label: 'Repost' }, { label: '→ Lead', style: 'success' }],
  },
  {
    id: '6', initials: 'CL', isLead: false,
    text: <><strong>@creatorlife</strong> commented: &ldquo;This AI is insane! How do I get started with the free trial?&rdquo;</>,
    platform: 'TikTok', time: '3h ago',
    actions: [{ label: 'Reply' }, { label: '→ Lead', style: 'success' }],
  },
]

const COMPLICATIONS: Complication[] = [
  {
    name: 'Meta App Review Required',
    severity: 'high',
    problem: 'To read/reply to Instagram DMs and Facebook messages, your app needs instagram_manage_messages and pages_messaging permissions. Meta manually reviews these — can take 1–4 weeks and they frequently reject vague use cases.',
    solution: 'Start with read-only permissions (comments, mentions) which auto-approve. Prepare a screen recording demo of the exact DM flow and submit with a detailed use case. Apply for messaging permissions only after the core product is working.',
  },
  {
    name: 'LinkedIn DMs Unavailable',
    severity: 'high',
    problem: "LinkedIn's public API does not support DMs for Pages. The Messaging API is only available to approved Marketing Partners (enterprise contracts). No API key will unlock this — it is a policy wall, not a technical one.",
    solution: 'Support LinkedIn comment replies only. Show a clear "DM not supported via LinkedIn API" notice in the UI. Users who need DMs must use LinkedIn natively. This cannot be engineered around.',
  },
  {
    name: 'OAuth Token Expiry',
    severity: 'high',
    problem: 'Instagram access tokens expire in 60 days. X tokens can be revoked at any time. When tokens expire silently, the feed stops pulling data with no visible error — it just goes stale.',
    solution: 'Store both access token and refresh token (encrypted). Run a daily cron that checks expiry dates and preemptively refreshes any token within 7 days of expiry. Show a "Reconnect" warning banner in the UI when a token is stale.',
  },
  {
    name: 'Per-Platform Rate Limits',
    severity: 'medium',
    problem: 'Meta allows ~200 API calls/hour per token. X Free tier allows only 15 read requests per 15 minutes. Polling multiple connected accounts will hit these limits quickly, causing silent failures.',
    solution: 'Track per-platform call counts in DB. Implement exponential backoff on 429 errors. Stagger polling intervals. Cache responses aggressively. Show "Last synced" timestamps so users know data freshness.',
  },
  {
    name: 'TikTok Business API Restrictions',
    severity: 'medium',
    problem: 'TikTok Business API requires application and approval. The DM API is invite-only and requires business verification. Even comment reading has strict rate limits and is not publicly accessible.',
    solution: "Show TikTok in the UI as 'Coming soon — requires TikTok Business account approval.' Proceed with Instagram, Facebook, and X first. Apply for TikTok access in parallel while building the core product.",
  },
  {
    name: 'Vercel Serverless Limitations',
    severity: 'medium',
    problem: 'Vercel serverless functions time out at 10 seconds (Hobby plan) and cannot run persistent background loops. A long-running polling process is not possible out of the box on Vercel.',
    solution: 'Use Vercel Cron Jobs (Pro plan) to hit a /api/sync endpoint every 5 minutes per platform. Alternatively, use a free external cron service to trigger syncs via HTTP. The UI just reads from DB on load.',
  },
  {
    name: 'X (Twitter) API Cost',
    severity: 'medium',
    problem: 'X Free tier gives 1 app and only 500 write operations per month with very limited read access. Basic tier ($100/month) is required for meaningful usage. This cost falls on you, not the end user.',
    solution: 'Cache X data aggressively — only refetch on explicit user request. Be transparent in the UI with a "X Basic API — limited syncs per month" label. Consider letting users connect their own X developer app credentials.',
  },
  {
    name: 'Webhook Delivery Complexity',
    severity: 'low',
    problem: 'Each platform uses different webhook verification methods. Platforms also send duplicate events — without deduplication, interactions appear multiple times in the feed.',
    solution: 'Skip webhooks entirely in v1. Use polling + a manual Refresh button. Users do not need sub-minute updates for an engagement management tool. Add webhooks in v2 starting with Meta, which has the best documentation.',
  },
]

const PIPELINE = [
  { key: 'new', label: 'New', count: 4, barClass: 'new-bar', width: '40%' },
  { key: 'contacted', label: 'Contacted', count: 6, barClass: 'contacted-bar', width: '60%' },
  { key: 'qualified', label: 'Qualified', count: 3, barClass: 'qualified-bar', width: '30%' },
  { key: 'closed', label: 'Closed', count: 2, barClass: 'closed-bar', width: '20%' },
]

export default function EngagementHub({ brandName }: { brandName: string }) {
  const [activeTab, setActiveTab] = useState<'overview' | 'complications'>('overview')

  const totalDms = PLATFORMS.filter(p => p.status !== 'disconnected').reduce((s, p) => s + p.dms, 0)
  const totalComments = PLATFORMS.filter(p => p.status !== 'disconnected').reduce((s, p) => s + p.comments, 0)
  const hotLeads = PLATFORMS.filter(p => p.leadLevel === 'hot').length
  const mentions = FEED_ITEMS.filter(f => f.isLead || f.platform === 'X').length

  return (
    <div className="eh-page">
      <div className="eh-inner">

        {/* Header */}
        <div className="eh-header">
          <div>
            <Link href="/dashboard" className="eh-back">← Dashboard</Link>
            <div className="eh-title">
              Social Engagement Hub
              <span className="eh-beta">Beta</span>
            </div>
            <div className="eh-subtitle">{brandName} — manage all social interactions in one place</div>
          </div>
          <div className="eh-header-right">
            <div className="eh-live-badge">
              <span className="eh-live-dot" />
              Live
            </div>
            <button className="eh-hbtn eh-hbtn-outline">Analytics</button>
            <button className="eh-hbtn eh-hbtn-green">+ Connect Account</button>
          </div>
        </div>

        {/* Stats */}
        <div className="eh-stats">
          <div className="eh-stat">
            <div className="eh-stat-label">Unread DMs</div>
            <div className="eh-stat-num">{totalDms}</div>
            <span className="eh-stat-sub">+3 since yesterday</span>
          </div>
          <div className="eh-stat">
            <div className="eh-stat-label">Pending Comments</div>
            <div className="eh-stat-num">{totalComments}</div>
            <span className="eh-stat-sub">needs reply</span>
          </div>
          <div className="eh-stat">
            <div className="eh-stat-label">Mentions</div>
            <div className="eh-stat-num">{mentions}</div>
            <span className="eh-stat-sub">last 24 hours</span>
          </div>
          <div className="eh-stat">
            <div className="eh-stat-label">Hot Leads</div>
            <div className="eh-stat-num">{hotLeads}</div>
            <span className="eh-stat-trend">↑ 2 this week</span>
          </div>
          <div className="eh-stat">
            <div className="eh-stat-label">Pipeline Value</div>
            <div className="eh-stat-num">$12.4k</div>
            <span className="eh-stat-sub">estimated</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="eh-tabs">
          <button className={`eh-tab${activeTab === 'overview' ? ' active' : ''}`} onClick={() => setActiveTab('overview')}>
            Overview
          </button>
          <button className={`eh-tab${activeTab === 'complications' ? ' active' : ''}`} onClick={() => setActiveTab('complications')}>
            Complications & Solutions
          </button>
        </div>

        {/* ── Overview ── */}
        {activeTab === 'overview' && (
          <>
            <div className="eh-main-grid">

              {/* Left: Platform cards */}
              <div className="eh-plat-list">
                {PLATFORMS.map(p => (
                  <div
                    key={p.id}
                    className={`eh-plat-card${p.status === 'limited' ? ' limited' : ''}${p.status === 'disconnected' ? ' disconnected' : ''}`}
                  >
                    {/* Section 1: info */}
                    <div className="eh-pc-info">
                      <div className={`eh-plat-icon ${p.iconClass}`}>{p.icon}</div>
                      <div>
                        <div className="eh-plat-name">{p.label}</div>
                        {p.handle && <div className="eh-plat-handle">{p.handle}</div>}
                      </div>
                    </div>

                    {/* Section 2: metrics */}
                    <div className="eh-pc-metrics">
                      {p.status === 'disconnected' ? (
                        <span style={{ fontSize: 12, color: 'var(--text-faint)', fontStyle: 'italic' }}>Not connected</span>
                      ) : (
                        <>
                          {p.dms > 0 && (
                            <div className="eh-metric">
                              <span className="eh-metric-label">DMs</span>
                              <span className="eh-metric-val blue">{p.dms}</span>
                            </div>
                          )}
                          {p.comments > 0 && (
                            <div className="eh-metric">
                              <span className="eh-metric-label">Comments</span>
                              <span className={`eh-metric-val ${p.comments >= 3 ? 'alert' : 'blue'}`}>{p.comments}</span>
                            </div>
                          )}
                          {p.status === 'limited' && (
                            <span className="eh-plat-note">DMs unavailable via API</span>
                          )}
                          {p.leadLevel && (
                            <span className={`eh-lead-score ${p.leadLevel}`}>
                              {p.leadLevel === 'hot' ? '↑' : p.leadLevel === 'warm' ? '~' : '–'} {p.leadScore}
                            </span>
                          )}
                        </>
                      )}
                    </div>

                    {/* Section 3: actions */}
                    <div className="eh-pc-actions">
                      <span className={`eh-status-dot ${p.status}`} title={p.status} />
                      {p.status === 'disconnected'
                        ? <button className="eh-plat-btn connect">Connect</button>
                        : p.status === 'limited'
                        ? <button className="eh-plat-btn">View</button>
                        : <button className="eh-plat-btn open">Open</button>
                      }
                    </div>
                  </div>
                ))}
              </div>

              {/* Right: Activity feed */}
              <div className="eh-feed-panel">
                <div className="eh-feed-hd">
                  <div className="eh-feed-hd-left">
                    <h3>Live Activity</h3>
                    <span className="eh-feed-new-pill">6 new</span>
                  </div>
                  <span className="eh-feed-time">Just now</span>
                </div>

                <div className="eh-feed-scroll">
                  {FEED_ITEMS.map(item => (
                    <div key={item.id} className={`eh-feed-item${item.isLead ? ' is-lead' : ''}`}>
                      <div className={`eh-feed-avatar${item.isLead ? ' lead-av' : ''}`}>
                        {item.initials}
                      </div>
                      <div className="eh-feed-body">
                        <div className="eh-feed-text">{item.text}</div>
                        <div className="eh-feed-meta">
                          <span className="eh-plat-tag">{item.platform}</span>
                          <span>{item.time}</span>
                          {item.actions.map(a => (
                            <button
                              key={a.label}
                              className={`eh-feed-link${a.style === 'danger' ? ' danger' : a.style === 'success' ? ' success' : ''}`}
                            >
                              {a.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="eh-feed-footer">
                  <span>View all 23 interactions →</span>
                </div>
              </div>
            </div>

            {/* Bottom bar */}
            <div className="eh-bottom">

              <div className="eh-action-sum">
                <div>
                  <div className="eh-sum-title">Action Items</div>
                  <div className="eh-sum-rows">
                    <div className="eh-sum-row">
                      <span className="eh-sum-row-num">8</span>
                      <span>comments need a reply</span>
                      <span className="eh-sum-badge urgent">urgent</span>
                    </div>
                    <div className="eh-sum-row">
                      <span className="eh-sum-row-num">3</span>
                      <span>DMs to follow up</span>
                    </div>
                    <div className="eh-sum-row">
                      <span className="eh-sum-row-num">1</span>
                      <span>post flagged for review</span>
                      <span className="eh-sum-badge review">review</span>
                    </div>
                    <div className="eh-sum-row">
                      <span className="eh-sum-row-num">2</span>
                      <span>hot leads to contact today</span>
                    </div>
                  </div>
                </div>
                <button className="eh-resolve-btn">Resolve All</button>
              </div>

              <div className="eh-pipeline">
                <div className="eh-pipe-left">
                  <div className="eh-pipe-title">Sales Pipeline</div>
                  <div className="eh-pipe-stages">
                    {PIPELINE.map(s => (
                      <div key={s.key} className="eh-pipe-stage">
                        <div className="eh-pipe-stage-label">{s.label}</div>
                        <div className={`eh-pipe-bar ${s.barClass}`} style={{ width: s.width }} />
                        <div className="eh-pipe-stage-count">{s.count}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div className="eh-pipe-value-label">Est. value</div>
                  <div className="eh-pipe-value">$12.4k</div>
                </div>
              </div>

            </div>
          </>
        )}

        {/* ── Complications & Solutions ── */}
        {activeTab === 'complications' && (
          <div className="eh-complications">
            <p className="eh-comp-intro">
              These are the real technical and policy blockers you will face building this feature —
              even with valid API keys provided by the user. Each card shows the exact problem and
              the recommended path forward.
            </p>
            <div className="eh-comp-grid">
              {COMPLICATIONS.map(c => (
                <div key={c.name} className={`eh-comp-card ${c.severity}`}>
                  <div className="eh-comp-head">
                    <div className="eh-comp-name">{c.name}</div>
                    <span className={`eh-comp-sev ${c.severity}`}>
                      {c.severity === 'high' ? 'Blocker' : c.severity === 'medium' ? 'Medium' : 'Low'}
                    </span>
                  </div>
                  <p className="eh-comp-problem">{c.problem}</p>
                  <div className="eh-comp-sol-label">Solution</div>
                  <div className="eh-comp-solution">{c.solution}</div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
