'use client'

import Link from 'next/link'
import type { DBItemFull } from '@/lib/modules/types'

interface Props {
  brandName: string
  lastAnalyzedAt: string | null
  items: DBItemFull[]
}

const CARD_CONFIG: Record<string, { label: string; accent: string; icon: React.ReactNode }> = {
  'next-campaign-objective': {
    label: 'Objective',
    accent: '#179a50',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
      </svg>
    ),
  },
  'next-campaign-audience': {
    label: 'Audience',
    accent: '#5a9200',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
  },
  'next-campaign-creative': {
    label: 'Creative',
    accent: '#92650a',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
    ),
  },
  'next-campaign-budget': {
    label: 'Budget',
    accent: '#0e7490',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
      </svg>
    ),
  },
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Not yet analysed'
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return 'Just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function NextCampaignBlueprintPage({ brandName, lastAnalyzedAt, items }: Props) {
  const hasItems = items.length > 0

  return (
    <div className="bp-page">
      {/* Header */}
      <div className="bp-header">
        <Link href="/dashboard" className="bp-back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Back to Audit
        </Link>
        <div className="bp-header-meta">
          <span className="bp-brand">{brandName}</span>
          <span className="bp-dot">·</span>
          <span className="bp-updated">Updated {timeAgo(lastAnalyzedAt)}</span>
        </div>
      </div>

      {/* Hero */}
      <div className="bp-hero">
        <div className="bp-hero-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        </div>
        <div>
          <h1 className="bp-title">Next Campaign Blueprint</h1>
          <p className="bp-subtitle">
            AI-generated based on your last 7 days of Meta Ads performance data
          </p>
        </div>
      </div>

      {/* Cards */}
      {!hasItems ? (
        <div className="bp-empty">
          <p>Run the Meta Ads Audit to generate your campaign blueprint.</p>
          <Link href="/dashboard" className="bp-empty-cta">Go to Audit</Link>
        </div>
      ) : (
        <div className="bp-grid">
          {items.map((item) => {
            const cfg = CARD_CONFIG[item.slug] ?? { label: item.label, accent: '#2fbf71', icon: null }
            return (
              <div
                key={item.slug}
                className="bp-card"
                style={{ '--bp-accent': cfg.accent } as React.CSSProperties}
              >
                <div className="bp-card-top">
                  <span className="bp-card-icon" style={{ color: cfg.accent }}>{cfg.icon}</span>
                  <span className="bp-card-type" style={{ color: cfg.accent }}>{cfg.label}</span>
                </div>

                <p className="bp-card-label">{item.label}</p>

                {item.aiNarrative && (
                  <p className="bp-card-narrative">{item.aiNarrative}</p>
                )}

                {item.aiDetail && !item.aiNarrative && (
                  <p className="bp-card-narrative">{item.aiDetail}</p>
                )}

                {item.aiAction && (
                  <div className="bp-card-action">
                    <span className="bp-card-action-label">In Ads Manager</span>
                    <span
                      dangerouslySetInnerHTML={{
                        __html: item.aiAction.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'),
                      }}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Footer note */}
      {hasItems && (
        <p className="bp-footer-note">
          This blueprint is generated from your live campaign data. Re-run the Meta Ads Audit to refresh it.
        </p>
      )}
    </div>
  )
}
