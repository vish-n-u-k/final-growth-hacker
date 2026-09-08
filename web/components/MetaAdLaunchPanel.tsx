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

type LaunchState = 'idle' | 'generating' | 'creative-ready' | 'launching' | 'launched' | 'error'

function isVideoUrl(url: string) {
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)
}

function CreativePreview({ url, index }: { url: string; index: number }) {
  const isVideo = isVideoUrl(url)
  return (
    <div className="meta-launch-creative-item">
      {isVideo ? (
        <video
          src={url}
          controls
          playsInline
          className="meta-launch-preview-video"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`Ad creative ${index + 1}`} className="meta-launch-preview-img" />
      )}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="meta-launch-preview-url"
      >
        {isVideo ? 'Open video' : 'Open image'} ↗
      </a>
    </div>
  )
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
  const [campaignId, setCampaignId] = useState<string | null>(null)
  const [adId, setAdId] = useState<string | null>(null)

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
      if (!res.ok || data.error) {
        setError(data.error ?? 'Creative generation failed')
        setState('error')
        return
      }
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
      if (!res.ok || data.error) {
        setError(data.error ?? 'Campaign launch failed')
        setState('error')
        return
      }
      setAdsManagerUrl(data.adsManagerUrl ?? null)
      setCampaignId(data.campaignId ?? null)
      setAdId(data.adId ?? null)
      setState('launched')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
      setState('error')
    }
  }

  const genderLabel = brief.audience.genders.length === 1
    ? brief.audience.genders[0] === 1 ? 'Men' : 'Women'
    : 'All genders'

  return (
    <div className="meta-launch-panel" onClick={(e) => e.stopPropagation()}>
      {demo && (
        <div className="meta-launch-demo-badge">Demo data — connect Meta Ads to analyse your real account</div>
      )}

      {/* Campaign Brief */}
      <div className="meta-launch-brief">
        <div className="meta-launch-brief-grid">
          <div className="meta-launch-field">
            <span className="meta-launch-field-label">Campaign</span>
            <span className="meta-launch-field-value">{brief.campaignName}</span>
          </div>
          <div className="meta-launch-field">
            <span className="meta-launch-field-label">Objective</span>
            <span className="meta-launch-field-value">{brief.objective.replace(/_/g, ' ')}</span>
          </div>
          <div className="meta-launch-field">
            <span className="meta-launch-field-label">Daily budget</span>
            <span className="meta-launch-field-value">${brief.dailyBudgetUsd}/day</span>
          </div>
          <div className="meta-launch-field">
            <span className="meta-launch-field-label">Audience</span>
            <span className="meta-launch-field-value">
              {brief.audience.ageMin}–{brief.audience.ageMax}, {genderLabel}, {brief.audience.countries.join(', ')}
            </span>
          </div>
          <div className="meta-launch-field">
            <span className="meta-launch-field-label">Headline</span>
            <span className="meta-launch-field-value">{brief.adCopy.headline}</span>
          </div>
          <div className="meta-launch-field">
            <span className="meta-launch-field-label">Ad copy</span>
            <span className="meta-launch-field-value">{brief.adCopy.body}</span>
          </div>
          <div className="meta-launch-field">
            <span className="meta-launch-field-label">Format</span>
            <span className="meta-launch-field-value">{brief.creative.format} · {brief.creative.adType}</span>
          </div>
          <div className="meta-launch-field">
            <span className="meta-launch-field-label">CTA</span>
            <span className="meta-launch-field-value">{brief.adCopy.cta.replace(/_/g, ' ')}</span>
          </div>
        </div>
        {brief.audience.interests.length > 0 && (
          <div className="meta-launch-interests">
            <span className="meta-launch-field-label">Interests</span>
            <div className="meta-launch-tags">
              {brief.audience.interests.map((kw) => (
                <span key={kw} className="meta-launch-tag">{kw}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Creative section */}
      <div className="meta-launch-section">
        {(state === 'idle' || (state === 'error' && images.length === 0)) && (
          <button className="meta-launch-btn meta-launch-btn-creative" onClick={handleGenerateCreative}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Generate Ad Creative
          </button>
        )}

        {state === 'generating' && (
          <div className="meta-launch-status">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ animation: 'md-spin .7s linear infinite' }}>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.35"/>
              <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
            </svg>
            Generating creative…
          </div>
        )}

        {(state === 'creative-ready' || state === 'launching' || state === 'launched' || state === 'error') && images.length > 0 && (
          <div className="meta-launch-previews">
            {images.map((img) => (
              <CreativePreview key={img.index} url={img.url} index={img.index} />
            ))}
          </div>
        )}

        {(state === 'creative-ready' || (state === 'error' && images.length > 0)) && (
          demo ? (
            <a href="/settings" className="meta-launch-btn meta-launch-btn-launch meta-launch-btn-demo">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              Connect Meta Ads to Launch
            </a>
          ) : (
            <button className="meta-launch-btn meta-launch-btn-launch" onClick={handleLaunch}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Launch in Meta Ads Manager (Paused)
            </button>
          )
        )}

        {state === 'launching' && (
          <div className="meta-launch-status">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ animation: 'md-spin .7s linear infinite' }}>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.35"/>
              <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
            </svg>
            Creating campaign…
          </div>
        )}

        {state === 'launched' && adsManagerUrl && (
          <div className="meta-launch-success-block">
            <div className="meta-launch-success">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Campaign created as PAUSED.{' '}
              <a href={adsManagerUrl} target="_blank" rel="noopener noreferrer" className="meta-launch-ads-link">
                Open in Ads Manager
              </a>
            </div>
            <div className="meta-launch-ids">
              {campaignId && <span>Campaign ID: <code>{campaignId}</code></span>}
              {adId && <span>Ad ID: <code>{adId}</code></span>}
            </div>
          </div>
        )}

        {state === 'error' && error && (
          <p className="meta-launch-error">{error}</p>
        )}
      </div>
    </div>
  )
}
