'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

type State = 'step1' | 'step2' | 'analyzing' | 'error'

const ANALYZING_MESSAGES = [
  'Reading your homepage…',
  'Checking title tags and meta descriptions…',
  'Scanning heading structure…',
  'Inspecting robots.txt and sitemap…',
  'Checking structured data and Open Graph tags…',
  'Evaluating content quality and messaging…',
  'Reviewing internal links and image alt text…',
  'Generating your personalised action plan…',
]

export default function OnboardingPage() {
  const [state, setState] = useState<State>('step1')
  const [brandName, setBrandName] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [error, setError] = useState('')
  const [msgIdx, setMsgIdx] = useState(0)
  const router = useRouter()

  // Cycle through messages while analyzing
  useEffect(() => {
    if (state !== 'analyzing') return
    const interval = setInterval(() => {
      setMsgIdx((i) => (i + 1) % ANALYZING_MESSAGES.length)
    }, 2800)
    return () => clearInterval(interval)
  }, [state])

  const handleStep1 = (e: React.FormEvent) => {
    e.preventDefault()
    if (!brandName.trim()) return
    setState('step2')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setState('analyzing')
    setMsgIdx(0)

    // Step A: create brand + channel
    const onboardRes = await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandName, websiteUrl }),
    })

    const onboardData = await onboardRes.json()

    if (!onboardRes.ok) {
      setError(onboardData.error ?? 'Something went wrong')
      setState('error')
      return
    }

    // Step B: run analysis
    const analyzeRes = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId: onboardData.channelId }),
    })

    const analyzeData = await analyzeRes.json()

    if (!analyzeRes.ok) {
      setError(analyzeData.error ?? 'Analysis failed')
      setState('error')
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  const displayUrl = websiteUrl
    ? websiteUrl.replace(/^https?:\/\//, '')
    : ''

  return (
    <div className="ob-page">
      {/* Header */}
      <header className="ob-header">
        <div className="logo">
          <span className="mark">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M5 12h4l2-6 3 12 2-6h3" stroke="#06140c" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          Growth Tracker
        </div>
      </header>

      <div className="ob-center">

        {/* ── Analyzing state ── */}
        {(state === 'analyzing') && (
          <div className="ob-card ob-analyzing">
            <div className="ob-analyze-spinner">
              <svg viewBox="0 0 50 50" className="ob-spinner-svg">
                <circle cx="25" cy="25" r="20" fill="none" stroke="var(--line)" strokeWidth="3" />
                <circle cx="25" cy="25" r="20" fill="none" stroke="var(--green-bright)" strokeWidth="3"
                  strokeDasharray="40 90" strokeLinecap="round" />
              </svg>
            </div>
            <div className="ob-label">Analysing</div>
            <h1 className="ob-heading" style={{ fontSize: '24px' }}>
              {displayUrl}
            </h1>
            <p className="ob-analyze-msg">{ANALYZING_MESSAGES[msgIdx]}</p>
            <p className="ob-hint" style={{ marginTop: '8px' }}>
              This takes 20–40 seconds. Do not close this tab.
            </p>
          </div>
        )}

        {/* ── Error state ── */}
        {state === 'error' && (
          <div className="ob-card">
            <div className="ob-steps">
              <div className="ob-pill ob-pill-done">1</div>
              <div className="ob-pill-connector" />
              <div className="ob-pill ob-pill-done">2</div>
            </div>
            <div className="ob-form">
              <div className="ob-label" style={{ color: '#f87171' }}>Error</div>
              <h1 className="ob-heading" style={{ fontSize: '24px' }}>Something went wrong</h1>
              <p className="auth-error">{error}</p>
              <button
                onClick={() => { setState('step2'); setError('') }}
                className="ob-btn-primary"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {/* ── Step 1 ── */}
        {state === 'step1' && (
          <div className="ob-card">
            <div className="ob-steps">
              <div className="ob-pill ob-pill-active">1</div>
              <div className="ob-pill-connector" />
              <div className="ob-pill ob-pill-idle">2</div>
            </div>
            <form onSubmit={handleStep1} className="ob-form">
              <div className="ob-label">Step 1 of 2</div>
              <h1 className="ob-heading">What&apos;s your product called?</h1>
              <p className="ob-desc">
                We&apos;ll personalise your entire growth dashboard around your brand.
              </p>
              <input
                autoFocus
                type="text"
                placeholder="e.g. AIFeed"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                required
                className="ob-input"
              />
              <button type="submit" disabled={!brandName.trim()} className="ob-btn-primary">
                Continue
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </form>
          </div>
        )}

        {/* ── Step 2 ── */}
        {state === 'step2' && (
          <div className="ob-card">
            <div className="ob-steps">
              <div className="ob-pill ob-pill-done">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="ob-pill-connector" />
              <div className="ob-pill ob-pill-active">2</div>
            </div>
            <form onSubmit={handleSubmit} className="ob-form">
              <div className="ob-label">Step 2 of 2</div>
              <h1 className="ob-heading">
                Where&apos;s <span className="ob-brand-name">{brandName}</span> online?
              </h1>
              <p className="ob-desc">
                We&apos;ll crawl your homepage and generate a personalised SEO action plan — takes about 30 seconds.
              </p>

              <div className="ob-url-wrap">
                <span className="ob-url-prefix">https://</span>
                <input
                  autoFocus
                  type="text"
                  placeholder="yourdomain.com"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  required
                  className="ob-url-input"
                />
              </div>

              <div className="ob-btn-row">
                <button type="button" onClick={() => setState('step1')} className="ob-btn-back">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M19 12H5M11 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Back
                </button>
                <button
                  type="submit"
                  disabled={!websiteUrl.trim()}
                  className="ob-btn-primary"
                  style={{ flex: 1 }}
                >
                  Analyse my site
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </form>
          </div>
        )}

        {state !== 'analyzing' && (
          <p className="ob-footer-note">
            Your data is private. We only read your public website.
          </p>
        )}
      </div>
    </div>
  )
}
