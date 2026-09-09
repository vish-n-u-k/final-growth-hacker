'use client'

import { useState } from 'react'
import type { DBItemFull } from '@/lib/modules/types'

export interface CampaignBrief {
  campaignName: string
  objective: 'CONVERSIONS' | 'TRAFFIC' | 'LEAD_GENERATION' | 'AWARENESS'
  dailyBudgetUsd: number
  audience: {
    ageMin: number
    ageMax: number
    genders: number[]
    interests: string[]
    countries: string[]
  }
  adCopy: {
    headline: string
    body: string
    cta: 'LEARN_MORE' | 'SHOP_NOW' | 'SIGN_UP' | 'GET_QUOTE'
  }
  creative: {
    topic: string
    format: '1:1' | '4:5' | '9:16'
    adType: 'single' | 'carousel'
    slides: string[]
  }
}

const OBJECTIVE_LABEL: Record<CampaignBrief['objective'], string> = {
  LEAD_GENERATION: 'Collect leads',
  CONVERSIONS:     'Drive purchases',
  TRAFFIC:         'Get website visitors',
  AWARENESS:       'Build brand awareness',
}

const CTA_LABEL: Record<string, string> = {
  LEARN_MORE: 'Learn More',
  SHOP_NOW:   'Shop Now',
  SIGN_UP:    'Sign Up',
  GET_QUOTE:  'Get Quote',
}

type LaunchState = 'idle' | 'generating' | 'creative-ready' | 'launching' | 'launched' | 'error'

function isVideoUrl(url: string) {
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)
}

interface Props {
  moduleId: string
  item: DBItemFull
  demo?: boolean
}

export default function MetaAdLaunchPanel({ moduleId, item, demo = false }: Props) {
  if (item.slug !== 'next-campaign-brief' || !item.aiData) return null

  const brief = item.aiData as unknown as CampaignBrief
  const [state, setState] = useState<LaunchState>('idle')
  const [images, setImages] = useState<{ url: string; index: number }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [adsManagerUrl, setAdsManagerUrl] = useState<string | null>(null)

  async function handleGenerateCreative() {
    setState('generating')
    setError(null)
    try {
      const res = await fetch('/api/frekto/meta-ad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleId, brief }),
      })
      const data = await res.json() as { images?: { url: string; index: number }[]; error?: string }
      if (!res.ok || data.error) { setError(data.error ?? 'Creative generation failed'); setState('error'); return }
      setImages(data.images ?? [])
      setState('creative-ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
      setState('error')
    }
  }

  async function handleLaunch() {
    setState('launching')
    setError(null)
    try {
      const res = await fetch('/api/meta-ads/launch-campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleId, brief, imageUrls: images.map((i) => i.url) }),
      })
      const data = await res.json() as { campaignId?: string; adId?: string; adsManagerUrl?: string; error?: string }
      if (!res.ok || data.error) { setError(data.error ?? 'Campaign launch failed'); setState('error'); return }
      setAdsManagerUrl(data.adsManagerUrl ?? null)
      setState('launched')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
      setState('error')
    }
  }

  const genderLabel = brief.audience.genders.length === 1
    ? brief.audience.genders[0] === 1 ? 'Men only' : 'Women only'
    : 'Everyone'

  return (
    <div className="mlp" onClick={(e) => e.stopPropagation()}>
      {demo && <div className="mlp-demo-badge">Demo — connect Meta Ads to use your real account data</div>}

      {/* 3 key stats */}
      <div className="mlp-stats">
        <div className="mlp-stat">
          <span className="mlp-stat-label">Goal</span>
          <span className="mlp-stat-value">{OBJECTIVE_LABEL[brief.objective]}</span>
        </div>
        <div className="mlp-stat">
          <span className="mlp-stat-label">Daily budget</span>
          <span className="mlp-stat-value">${brief.dailyBudgetUsd}/day</span>
        </div>
        <div className="mlp-stat">
          <span className="mlp-stat-label">Audience</span>
          <span className="mlp-stat-value">{brief.audience.ageMin}–{brief.audience.ageMax}, {genderLabel}, {brief.audience.countries.join(', ')}</span>
        </div>
      </div>

      {/* Ad preview */}
      <div className="mlp-ad-preview">
        <p className="mlp-ad-headline">{brief.adCopy.headline}</p>
        <p className="mlp-ad-body">{brief.adCopy.body}</p>
        <span className="mlp-ad-cta">{CTA_LABEL[brief.adCopy.cta] ?? brief.adCopy.cta}</span>
      </div>

      {/* Interests */}
      {brief.audience.interests.length > 0 && (
        <div className="mlp-interests">
          <span className="mlp-interests-label">Targeting</span>
          <div className="mlp-tags">
            {brief.audience.interests.map((kw) => (
              <span key={kw} className="mlp-tag">{kw}</span>
            ))}
          </div>
        </div>
      )}

      {/* Why this campaign */}
      {item.aiDetail && <p className="mlp-why">{item.aiDetail}</p>}

      {/* Creative + launch */}
      <div className="mlp-actions">
        {(state === 'idle' || (state === 'error' && images.length === 0)) && (
          <button className="mlp-btn mlp-btn--creative" onClick={handleGenerateCreative}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Generate Ad Video
          </button>
        )}

        {state === 'generating' && (
          <div className="mlp-status">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ animation: 'md-spin .7s linear infinite' }}>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.35"/>
              <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
            </svg>
            Creating your ad video…
          </div>
        )}

        {images.length > 0 && (
          <div className="mlp-previews">
            {images.map((img) => (
              <div key={img.index} className="mlp-preview-item">
                {isVideoUrl(img.url) ? (
                  <video src={img.url} controls playsInline className="mlp-preview-video" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img.url} alt="Ad creative" className="mlp-preview-img" />
                )}
                <a href={img.url} target="_blank" rel="noopener noreferrer" className="mlp-preview-link">
                  Open full size ↗
                </a>
              </div>
            ))}
          </div>
        )}

        {(state === 'creative-ready' || (state === 'error' && images.length > 0)) && (
          demo ? (
            <a href="/settings" className="mlp-btn mlp-btn--launch mlp-btn--locked">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              Connect Meta Ads to Launch
            </a>
          ) : (
            <button className="mlp-btn mlp-btn--launch" onClick={handleLaunch}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Launch Campaign (starts paused)
            </button>
          )
        )}

        {state === 'launching' && (
          <div className="mlp-status">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ animation: 'md-spin .7s linear infinite' }}>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.35"/>
              <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
            </svg>
            Setting up your campaign…
          </div>
        )}

        {state === 'launched' && adsManagerUrl && (
          <div className="mlp-success">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Campaign created — it&apos;s paused so you can review before going live.{' '}
            <a href={adsManagerUrl} target="_blank" rel="noopener noreferrer" className="mlp-ads-link">
              Open in Ads Manager →
            </a>
          </div>
        )}

        {state === 'error' && error && <p className="mlp-error">{error}</p>}
      </div>
    </div>
  )
}
