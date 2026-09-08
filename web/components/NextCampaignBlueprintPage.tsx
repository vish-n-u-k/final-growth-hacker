'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { DBItemFull } from '@/lib/modules/types'
import MetaAdLaunchPanel from '@/components/MetaAdLaunchPanel'
import type { CampaignBrief } from '@/components/MetaAdLaunchPanel'

interface Props {
  moduleId: string
  moduleStatus: string
  brandName: string
  lastAnalyzedAt: string | null
  items: DBItemFull[]
}

// Realistic demo brief shown when user doesn't have Meta Ads connected
const DEMO_BRIEF: CampaignBrief = {
  campaignName: 'Lead Gen — Q4 Growth Push',
  objective: 'LEAD_GENERATION',
  dailyBudgetUsd: 35,
  audience: {
    ageMin: 25,
    ageMax: 44,
    genders: [1, 2],
    interests: ['entrepreneurship', 'digital marketing', 'small business owners'],
    countries: ['US'],
  },
  adCopy: {
    headline: 'Grow Your Business Faster',
    body: 'Join 2,000+ founders who use AI to audit and fix their online presence in days, not months.',
    cta: 'SIGN_UP',
  },
  creative: {
    topic: 'Clean modern ad showing a green growth dashboard with upward metrics and a confident entrepreneur at a laptop',
    format: '4:5',
    adType: 'single',
    slides: [],
  },
}

const DEMO_ITEM: DBItemFull = {
  id: 'demo',
  slug: 'next-campaign-brief',
  label: 'Next Campaign Blueprint',
  weight: 2,
  categorySlug: 'next-campaign',
  aiDetail: 'Based on typical account patterns, a lead generation campaign targeting cold audiences at $35/day is recommended as the highest-impact next step.',
  aiHighlight: null,
  aiNarrative: null,
  aiAction: null,
  aiDraft: null,
  aiData: DEMO_BRIEF as unknown as Record<string, unknown>,
  aiVerified: false,
  userChecked: false,
  completedBy: null,
  fixable: false,
  fixType: null,
  fixInputKey: null,
  fixIntegrationProvider: null,
  userSkipped: false,
  userSkipReason: null,
  exportType: null,
  choiceOptions: null,
  userChoice: null,
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

export default function NextCampaignBlueprintPage({ moduleId, moduleStatus, brandName, lastAnalyzedAt, items }: Props) {
  const router = useRouter()
  const [analysing, setAnalysing] = useState(moduleStatus === 'analyzing')
  const [analyseError, setAnalyseError] = useState<string | null>(null)
  const [demoMode, setDemoMode] = useState(false)

  const briefItem = items.find((i) => i.slug === 'next-campaign-brief' && i.aiData)
  const hasBrief = !!briefItem
  const isLocked = moduleStatus === 'locked'

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
      router.refresh()
    } catch (e) {
      setAnalyseError(e instanceof Error ? e.message : 'Network error')
      setAnalysing(false)
    }
  }

  return (
    <div className="bp-page">
      {/* Header */}
      <div className="bp-header">
        <Link href="/dashboard" className="bp-back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Back to Dashboard
        </Link>
        <div className="bp-header-meta">
          <span className="bp-brand">{brandName}</span>
          <span className="bp-dot">·</span>
          <span className="bp-updated">
            {analysing ? 'Analysing…' : timeAgo(lastAnalyzedAt)}
          </span>
        </div>
      </div>

      {/* Hero */}
      <div className="bp-hero">
        <div className="bp-hero-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        </div>
        <div className="bp-hero-text">
          <h1 className="bp-title">Next Campaign Blueprint</h1>
          <p className="bp-subtitle">
            AI designs your next Meta Ads campaign from live account data — then generates the creative and launches it directly to Ads Manager.
          </p>
        </div>
        <div className="bp-hero-actions">
          {isLocked ? (
            <p className="bp-locked-note">Complete earlier modules to unlock Meta Ads.</p>
          ) : (
            <div className="bp-action-row">
              <button className="bp-analyse-btn" onClick={runAudit} disabled={analysing}>
                {analysing ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ animation: 'md-spin .7s linear infinite' }}>
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.35"/>
                      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                    </svg>
                    Analysing…
                  </>
                ) : hasBrief ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.18-6.17"/>
                    </svg>
                    Re-run Audit
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                    </svg>
                    Run Meta Ads Audit
                  </>
                )}
              </button>
              {!hasBrief && !analysing && (
                <button
                  className="bp-demo-btn"
                  onClick={() => setDemoMode(true)}
                >
                  Try Demo
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Error banner */}
      {analyseError && (
        <div className="bp-analyse-error">
          {analyseError}
          {isCredentialError(analyseError) && (
            <Link href="/settings" className="bp-error-settings-link">
              Update credentials in Settings
            </Link>
          )}
        </div>
      )}

      {/* Blueprint + Launch Panel */}
      {displayItem ? (
        <div className="bp-launch-wrapper">
          {displayItem.aiDetail && (
            <p className="bp-brief-summary">{displayItem.aiDetail}</p>
          )}
          <MetaAdLaunchPanel moduleId={moduleId} item={displayItem} demo={demoMode} />
        </div>
      ) : !analysing && !isLocked && (
        <div className="bp-empty">
          <p>Run the Meta Ads Audit above to generate your campaign blueprint.</p>
        </div>
      )}

      {displayItem && !demoMode && (
        <p className="bp-footer-note">
          This blueprint is generated from your live campaign data. Re-run the audit to refresh it.
        </p>
      )}
    </div>
  )
}
