'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { DBItemFull } from '@/lib/modules/types'
import MetaAdLaunchPanel from '@/components/MetaAdLaunchPanel'
import type { CampaignBrief } from '@/components/MetaAdLaunchPanel'
import type { OGTagResult, PixelStatus } from '@/app/dashboard/meta-ads/blueprint/page'

const AUDIT_CATEGORIES = [
  { slug: 'campaign-performance', label: 'Campaigns' },
  { slug: 'budget-efficiency',    label: 'Budget' },
  { slug: 'audience-reach',       label: 'Audience' },
  { slug: 'conversion-performance', label: 'Conversions' },
  { slug: 'tracking-setup',       label: 'Tracking' },
]

// Health overview — one pill per category
function HealthOverview({ items }: { items: DBItemFull[] }) {
  return (
    <div className="bp-health-row">
      {AUDIT_CATEGORIES.map(({ slug, label }) => {
        const catItems = items.filter((i) => i.categorySlug === slug)
        if (catItems.length === 0) return null
        const failing = catItems.filter((i) => !i.aiVerified).length
        const status = failing === 0 ? 'good' : failing <= 2 ? 'warn' : 'bad'
        return (
          <div key={slug} className={`bp-health-pill bp-health-pill--${status}`}>
            <span className="bp-health-dot" />
            <span>{label}</span>
            {failing > 0 && <span className="bp-health-count">{failing} issue{failing !== 1 ? 's' : ''}</span>}
          </div>
        )
      })}
    </div>
  )
}

// Top issues — only failing items, sorted by weight, max 5
function TopIssues({ items }: { items: DBItemFull[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const issues = items
    .filter((i) => !i.aiVerified && i.categorySlug !== 'meta-score' && i.categorySlug !== 'next-campaign')
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)

  if (issues.length === 0) return null

  return (
    <div className="bp-issues">
      <p className="bp-issues-title">Things to fix</p>
      {issues.map((item) => (
        <div key={item.id} className="bp-issue">
          <button className="bp-issue-row" onClick={() => setExpanded(expanded === item.id ? null : item.id)}>
            <span className={`bp-issue-dot ${item.weight === 3 ? 'bp-issue-dot--critical' : 'bp-issue-dot--warn'}`} />
            <span className="bp-issue-label">{item.label}</span>
            {item.aiHighlight && <span className="bp-issue-highlight">{item.aiHighlight}</span>}
            <span className="bp-issue-toggle">{expanded === item.id ? '−' : '+'}</span>
          </button>
          {expanded === item.id && item.aiAction && (
            <div className="bp-issue-action">
              <span className="bp-issue-action-label">What to do</span>
              <p>{item.aiAction}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function PixelStatusCard({ status }: { status: PixelStatus }) {
  const found = status.found
  return (
    <div className={`bp-pixel-card ${found === true ? 'bp-pixel-card--good' : found === false ? 'bp-pixel-card--bad' : 'bp-pixel-card--unknown'}`}>
      <div className="bp-pixel-icon">
        {found === true ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        ) : found === false ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2"/>
            <path d="M12 8v5M12 16v.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
        )}
      </div>
      <div className="bp-pixel-body">
        <p className="bp-pixel-title">
          Meta Pixel&nbsp;
          <span className="bp-pixel-badge">
            {found === true ? 'Found on your website' : found === false ? 'Not found on your website' : 'Could not check'}
          </span>
        </p>
        <p className="bp-pixel-desc">
          {found === true
            ? 'Your pixel is installed. It tracks what people do after clicking your ad — purchases, sign-ups, page views — so Meta knows which ads are actually working and can find more people like your buyers.'
            : found === false
            ? "Your pixel isn't installed. Without it, Meta can't see what happens after someone clicks your ad. It can't optimise for buyers, it can't retarget visitors, and it has no idea if your ads are working."
            : "We couldn't check your website. Make sure your pixel is installed — without it Meta can only optimise for clicks, not actual results."
          }
        </p>
        {found === false && (
          <a
            href="https://business.facebook.com/events_manager"
            target="_blank"
            rel="noopener noreferrer"
            className="bp-pixel-link"
          >
            Set it up in Meta Events Manager →
          </a>
        )}
      </div>
    </div>
  )
}

function MetaTagsSection({ tags, websiteUrl }: { tags: OGTagResult[]; websiteUrl: string }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const missing = tags.filter((t) => !t.value)
  const present = tags.filter((t) => t.value)

  return (
    <div className="bp-metatags">
      <div className="bp-metatags-hd">
        <div>
          <p className="bp-metatags-title">Facebook meta tags</p>
          <p className="bp-metatags-sub">
            These tags control what image, title and text Meta shows when your website appears in an ad.
            {websiteUrl && <> Checked on <span className="bp-metatags-url">{websiteUrl}</span>.</>}
          </p>
        </div>
        <div className="bp-metatags-score">
          <span className={present.length === tags.length ? 'bp-metatags-score--good' : 'bp-metatags-score--warn'}>
            {present.length}/{tags.length} found
          </span>
        </div>
      </div>

      <div className="bp-metatags-list">
        {tags.map((tag) => (
          <div key={tag.property} className="bp-metatag-row">
            <button
              className="bp-metatag-btn"
              onClick={() => setExpanded(expanded === tag.property ? null : tag.property)}
            >
              <span className={`bp-metatag-status ${tag.value ? 'bp-metatag-status--ok' : 'bp-metatag-status--missing'}`}>
                {tag.value ? '✓' : '✗'}
              </span>
              <span className="bp-metatag-label">{tag.label}</span>
              {tag.value
                ? <span className="bp-metatag-value">{tag.value.length > 60 ? tag.value.slice(0, 60) + '…' : tag.value}</span>
                : <span className="bp-metatag-missing">Not set</span>
              }
              <span className="bp-metatag-toggle">{expanded === tag.property ? '−' : '+'}</span>
            </button>

            {expanded === tag.property && (
              <div className="bp-metatag-detail">
                <p className="bp-metatag-why">{tag.why}</p>
                {!tag.value && (
                  <div className="bp-metatag-fix">
                    <p className="bp-metatag-fix-label">Add this inside your <code>&lt;head&gt;</code></p>
                    <code className="bp-metatag-snippet">{tag.snippet}</code>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {missing.length > 0 && (
        <p className="bp-metatags-note">
          Missing tags won&apos;t break your ads, but Meta may pick a random image or truncate your title. Fix them for better-looking ads.
        </p>
      )}
    </div>
  )
}

interface Props {
  moduleId: string
  moduleStatus: string
  brandName: string
  websiteUrl: string
  lastAnalyzedAt: string | null
  items: DBItemFull[]
  ogTags: OGTagResult[]
  pixelStatus: PixelStatus
}

const DEMO_BRIEF: CampaignBrief = {
  campaignName: 'Lead Gen — Q4 Growth Push',
  objective: 'LEAD_GENERATION',
  dailyBudgetUsd: 35,
  audience: { ageMin: 25, ageMax: 44, genders: [1, 2], interests: ['entrepreneurship', 'digital marketing', 'small business owners'], countries: ['US'] },
  adCopy: { headline: 'Grow Your Business Faster', body: 'Join 2,000+ founders who use AI to audit and fix their online presence in days, not months.', cta: 'SIGN_UP' },
  creative: { topic: 'Clean modern ad showing a green growth dashboard with upward metrics and a confident entrepreneur at a laptop', format: '4:5', adType: 'single', slides: [] },
}

const DEMO_ITEM: DBItemFull = {
  id: 'demo', slug: 'next-campaign-brief', label: 'Next Campaign Blueprint', weight: 2,
  categorySlug: 'next-campaign',
  aiDetail: 'Based on typical account patterns, a lead generation campaign targeting cold audiences at $35/day is recommended as the highest-impact next step.',
  aiHighlight: null, aiNarrative: null, aiAction: null, aiDraft: null,
  aiData: DEMO_BRIEF as unknown as Record<string, unknown>,
  aiVerified: false, userChecked: false, completedBy: null,
  fixable: false, fixType: null, fixInputKey: null, fixIntegrationProvider: null,
  userSkipped: false, userSkipReason: null, exportType: null, choiceOptions: null, userChoice: null,
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Not yet analysed'
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return 'Just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function isCredentialError(msg: string) {
  return /token|credential|expired|invalid|auth|permission|oauth/i.test(msg)
}

export default function NextCampaignBlueprintPage({ moduleId, moduleStatus, brandName, websiteUrl, lastAnalyzedAt, items, ogTags, pixelStatus }: Props) {
  const router = useRouter()
  const [analysing, setAnalysing] = useState(moduleStatus === 'analyzing')
  const [analyseError, setAnalyseError] = useState<string | null>(null)
  const [demoMode, setDemoMode] = useState(false)

  const briefItem = items.find((i) => i.slug === 'next-campaign-brief' && i.aiData)
  const hasBrief = !!briefItem
  const isLocked = moduleStatus === 'locked'
  const hasAudit = items.some((i) => i.categorySlug !== 'next-campaign')
  const displayItem = demoMode ? DEMO_ITEM : briefItem

  async function runAudit() {
    setAnalysing(true)
    setAnalyseError(null)
    setDemoMode(false)
    try {
      const res = await fetch('/api/modules/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleId }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok || data.error) {
        setAnalyseError(data.error ?? 'Analysis failed. Please try again.')
        setAnalysing(false)
        return
      }
      setAnalysing(false)
      router.refresh()
    } catch (e) {
      setAnalyseError(e instanceof Error ? e.message : 'Network error')
      setAnalysing(false)
    }
  }

  return (
    <div className="bp-page">
      {/* Top bar */}
      <div className="bp-topbar">
        <Link href="/dashboard" className="bp-back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Dashboard
        </Link>
        <div className="bp-topbar-center">
          <span className="bp-topbar-title">Meta Ads</span>
          <span className="bp-dot">·</span>
          <span className="bp-topbar-brand">{brandName}</span>
          <span className="bp-dot">·</span>
          <span className="bp-topbar-updated">{analysing ? 'Analysing…' : timeAgo(lastAnalyzedAt)}</span>
        </div>
        <div className="bp-topbar-actions">
          {isLocked ? (
            <span className="bp-locked-note">Complete earlier modules to unlock.</span>
          ) : (
            <div className="bp-action-row">
              {!hasBrief && !analysing && (
                <button className="bp-demo-btn" onClick={() => setDemoMode(true)}>Try Demo</button>
              )}
              <button className="bp-analyse-btn" onClick={runAudit} disabled={analysing}>
                {analysing ? (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ animation: 'md-spin .7s linear infinite' }}>
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.35"/>
                      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                    </svg>
                    Analysing…
                  </>
                ) : hasBrief ? 'Re-run' : 'Run Audit'}
              </button>
            </div>
          )}
        </div>
      </div>

      {analyseError && (
        <div className="bp-analyse-error">
          {analyseError}
          {isCredentialError(analyseError) && (
            <Link href="/settings" className="bp-error-settings-link">Update credentials</Link>
          )}
        </div>
      )}

      <div className="bp-content">
        {/* Audit results */}
        {hasAudit && (
          <div className="bp-audit-group">
            <div className="bp-audit-group-hd">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              <span>Account health</span>
            </div>
            <HealthOverview items={items} />
            <TopIssues items={items} />
          </div>
        )}

        {/* Pixel status — always shown */}
        <PixelStatusCard status={pixelStatus} />

        {/* Meta tags */}
        {ogTags.length > 0 && <MetaTagsSection tags={ogTags} websiteUrl={websiteUrl} />}

        {/* Blueprint */}
        <div className="bp-blueprint-section">
          <div className="bp-section-hd">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
            <span>Your next campaign</span>
          </div>

          {displayItem ? (
            <div className="bp-launch-card">
              <MetaAdLaunchPanel moduleId={moduleId} item={displayItem} demo={demoMode} />
            </div>
          ) : !analysing && !isLocked ? (
            <div className="bp-empty">
              <p>Run the audit to generate your next campaign.</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
