'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import type { SiteCheckResult } from '@/app/api/check-site/route'

type State = 'step1' | 'step2' | 'error'
type SiteCheck = { status: 'checking' } | ({ status: 'done' } & SiteCheckResult) | null

const CHECK_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
    <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const SEVERITY_STYLES: Record<string, { border: string; iconColor: string; icon: React.ReactNode }> = {
  success: {
    border: 'rgba(47, 191, 113, 0.25)',
    iconColor: 'var(--green-bright)',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  warning: {
    border: 'rgba(231, 200, 115, 0.3)',
    iconColor: 'var(--gold)',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  info: {
    border: 'rgba(138, 168, 151, 0.25)',
    iconColor: 'var(--text-dim)',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
        <path d="M12 8h.01M12 12v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
}

function SiteCheckNotice({ check }: { check: NonNullable<SiteCheck> }) {
  if (check.status === 'checking') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: 'var(--text-dim)', padding: '2px 0' }}>
        <span className="md-spin" style={{ width: '13px', height: '13px', borderWidth: '2px', flexShrink: 0 }} />
        Checking your site…
      </div>
    )
  }

  const s = SEVERITY_STYLES[check.severity] ?? SEVERITY_STYLES.info
  return (
    <div style={{
      display: 'flex',
      gap: '10px',
      padding: '11px 14px',
      borderRadius: '10px',
      border: `1px solid ${s.border}`,
      background: 'rgba(255,255,255,0.025)',
    }}>
      <span style={{ color: s.iconColor, flexShrink: 0, marginTop: '1px' }}>{s.icon}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text)' }}>{check.title}</span>
        <span style={{ fontSize: '12px', color: 'var(--text-dim)', lineHeight: 1.5 }}>{check.message}</span>
      </div>
    </div>
  )
}

export default function OnboardingPage() {
  const [state, setState] = useState<State>('step1')
  const [brandName, setBrandName] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [keywords, setKeywords] = useState('')
  const [industry, setIndustry] = useState('')
  const [targetAudience, setTargetAudience] = useState('')
  const [usp, setUsp] = useState('')
  const [brandVoice, setBrandVoice] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [prefilling, setPrefilling] = useState(false)
  const [siteCheck, setSiteCheck] = useState<SiteCheck>(null)
  const router = useRouter()

  const runSiteCheck = (url: string) => {
    const trimmed = url.trim()
    if (!trimmed || !trimmed.includes('.')) return
    setSiteCheck({ status: 'checking' })
    const fullUrl = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`
    fetch('/api/check-site', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteUrl: fullUrl }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SiteCheckResult | null) => {
        if (data) setSiteCheck({ status: 'done', ...data })
        else setSiteCheck(null)
      })
      .catch(() => setSiteCheck(null))
  }

  const autoResize = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  useEffect(() => {
    if (prefilling) return
    document.querySelectorAll<HTMLTextAreaElement>('.ob-textarea').forEach((el) => {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    })
  }, [prefilling])

  const handleStep1 = (e: React.FormEvent) => {
    e.preventDefault()
    if (!websiteUrl.trim()) return
    setState('step2')
    setPrefilling(true)

    const url = websiteUrl.trim().startsWith('http') ? websiteUrl.trim() : `https://${websiteUrl.trim()}`
    fetch('/api/onboarding/prefill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteUrl: url }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          if (data.brandName) setBrandName(data.brandName)
          if (data.industry) setIndustry(data.industry)
          if (data.keywords) setKeywords(data.keywords)
          if (data.targetAudience) setTargetAudience(data.targetAudience)
          if (data.usp) setUsp(data.usp)
          if (data.brandVoice) setBrandVoice(data.brandVoice)
        }
      })
      .catch(() => {})
      .finally(() => setPrefilling(false))
  }

  const handleSubmit = async (skip = false) => {
    setError('')
    setSubmitting(true)

    const onboardRes = await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brandName,
        websiteUrl,
        keywords: skip ? '' : keywords,
        industry: skip ? '' : industry,
        targetAudience: skip ? '' : targetAudience,
        usp: skip ? '' : usp,
        brandVoice: skip ? '' : brandVoice,
      }),
    })
    const onboardData = await onboardRes.json()
    if (!onboardRes.ok) {
      setError(onboardData.error ?? 'Something went wrong')
      setSubmitting(false)
      return
    }

    router.push(`/dashboard`)
  }

  return (
    <div className="ob-page">
      <header className="ob-header">
        <div className="logo">
          <span className="mark">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M5 12h4l2-6 3 12 2-6h3" stroke="#06140c" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          GrowJin
        </div>
      </header>

      <div className="ob-center">

        {/* Error */}
        {state === 'error' && (
          <div className="ob-card">
            <div className="ob-form">
              <div className="ob-label" style={{ color: '#f87171' }}>Error</div>
              <h1 className="ob-heading" style={{ fontSize: '24px' }}>Something went wrong</h1>
              <p className="auth-error">{error}</p>
              <Button
                onClick={() => { setState('step2'); setError('') }}
                className="w-full gap-2 bg-gradient-to-br from-[var(--green-bright)] to-[var(--green)] text-[#06140c] font-semibold hover:opacity-90 py-3 sm:py-3 h-auto sm:h-12 rounded-12"
              >
                Try again
              </Button>
            </div>
          </div>
        )}

        {/* Step 1 — Website URL */}
        {state === 'step1' && (
          <div className="ob-card">
            <div className="ob-steps">
              <div className="ob-pill ob-pill-active">1</div>
              <div className="ob-pill-connector" />
              <div className="ob-pill ob-pill-idle">2</div>
            </div>
            <form onSubmit={handleStep1} className="ob-form">
              <div className="ob-label">Step 1 of 2</div>
              <h1 className="ob-heading">Where&apos;s your business online?</h1>
              <p className="ob-desc">
                We&apos;ll run a Foundation audit first — checking your domain, analytics, and essential pages are in place before we get into SEO and growth.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div className="ob-url-wrap">
                  <input
                    autoFocus type="text" placeholder="yourdomain.com"
                    value={websiteUrl}
                    onChange={(e) => { setWebsiteUrl(e.target.value); setSiteCheck(null) }}
                    onBlur={(e) => runSiteCheck(e.target.value)}
                    required className="ob-url-input"
                  />
                </div>
                {siteCheck && <SiteCheckNotice check={siteCheck} />}
              </div>
              <Button
                type="submit"
                disabled={!websiteUrl.trim()}
                className="w-full h-14 gap-2 bg-gradient-to-br from-[var(--green-bright)] to-[var(--green)] text-[#06140c] font-semibold hover:shadow-lg hover:shadow-[var(--green-glow)] disabled:opacity-50 rounded-14 transition-all"
              >
                Continue
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Button>
            </form>
          </div>
        )}

        {/* Step 2 — Brand details (pre-filled) */}
        {state === 'step2' && (
          <div className="ob-card">
            <div className="ob-steps">
              <div className="ob-pill ob-pill-done">{CHECK_ICON}</div>
              <div className="ob-pill-connector" />
              <div className="ob-pill ob-pill-active">2</div>
            </div>
            <div className="ob-form">
              <div className="ob-label">Step 2 of 2</div>
              <h1 className="ob-heading">Your Brand Details</h1>
              <p className="ob-desc">
                Used to personalise your Brand Audit and competitor analysis.
              </p>
              {prefilling ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '32px 0', color: 'var(--text-dim)', fontSize: '12px' }}>
                  <div style={{ width: '32px', height: '32px' }}>
                    <svg viewBox="0 0 50 50" className="ob-spinner-svg">
                      <circle cx="25" cy="25" r="20" fill="none" stroke="var(--line)" strokeWidth="5" />
                      <circle cx="25" cy="25" r="20" fill="none" stroke="var(--green-bright)" strokeWidth="5" strokeDasharray="40 90" strokeLinecap="round" />
                    </svg>
                  </div>
                  Reading your website…
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span className="ob-field-label">Brand name</span>
                    <textarea
                      autoFocus rows={1}
                      placeholder="e.g. Acme Inc"
                      value={brandName}
                      onChange={(e) => setBrandName(e.target.value)}
                      onInput={autoResize}
                      className="ob-textarea"
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span className="ob-field-label">Industry</span>
                    <textarea
                      rows={1}
                      placeholder="e.g. SaaS, E-commerce, Healthcare"
                      value={industry}
                      onChange={(e) => setIndustry(e.target.value)}
                      onInput={autoResize}
                      className="ob-textarea"
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span className="ob-field-label">Brand Keywords</span>
                    <textarea
                      rows={1}
                      placeholder="e.g. AI, content creation, marketing (comma-separated)"
                      value={keywords}
                      onChange={(e) => setKeywords(e.target.value)}
                      onInput={autoResize}
                      className="ob-textarea"
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span className="ob-field-label">Target audience</span>
                    <textarea
                      rows={1}
                      placeholder="e.g. Shopify sellers, Marketing managers"
                      value={targetAudience}
                      onChange={(e) => setTargetAudience(e.target.value)}
                      onInput={autoResize}
                      className="ob-textarea"
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span className="ob-field-label">Unique selling point</span>
                    <textarea
                      rows={1}
                      placeholder="e.g. No expertise required, AI-powered"
                      value={usp}
                      onChange={(e) => setUsp(e.target.value)}
                      onInput={autoResize}
                      className="ob-textarea"
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span className="ob-field-label">Brand voice</span>
                    <textarea
                      rows={1}
                      placeholder="e.g. Professional, friendly, direct"
                      value={brandVoice}
                      onChange={(e) => setBrandVoice(e.target.value)}
                      onInput={autoResize}
                      className="ob-textarea"
                    />
                  </label>
                </div>
              )}
              {!prefilling && (
                <div className="ob-btn-row">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setState('step1')}
                    className="w-full h-14 gap-2 border-2 border-[var(--line)] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--green)] bg-transparent rounded-14 font-semibold transition-all"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M19 12H5M11 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Back
                  </Button>

                  <Button
                    type="button"
                    disabled={!brandName.trim()}
                    onClick={() => { if (!submitting) handleSubmit(false) }}
                    className="w-full h-14 gap-2 bg-gradient-to-br from-[var(--green-bright)] to-[var(--green)] text-[#06140c] font-semibold hover:shadow-lg hover:shadow-[var(--green-glow)] disabled:opacity-50 rounded-14 transition-all"
                    style={{ cursor: submitting ? 'not-allowed' : undefined }}
                  >
                    {submitting ? (
                      <><span className="md-spin" style={{ borderColor: 'rgba(6,20,12,0.2)', borderTopColor: '#000000' }} />Setting up…</>
                    ) : (
                      <>Set Up My Website
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        <p className="ob-footer-note">Your data is private. We only read your public website.</p>
      </div>
    </div>
  )
}
