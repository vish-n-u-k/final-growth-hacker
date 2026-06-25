'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

type State = 'step1' | 'step2' | 'analyzing' | 'error'

const ANALYZING_MESSAGES = [
  'Checking your domain and SSL…',
  'Looking for Google Analytics…',
  'Scanning for essential pages…',
  'Checking contact info and privacy policy…',
  'Evaluating your homepage content…',
  'Verifying brand basics…',
  'Building your Foundation audit…',
]

const CHECK_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
    <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export default function OnboardingPage() {
  const [state, setState] = useState<State>('step1')
  const [brandName, setBrandName] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [industry, setIndustry] = useState('')
  const [targetAudience, setTargetAudience] = useState('')
  const [usp, setUsp] = useState('')
  const [brandVoice, setBrandVoice] = useState('')
  const [error, setError] = useState('')
  const [msgIdx, setMsgIdx] = useState(0)
  const [prefilling, setPrefilling] = useState(false)
  const router = useRouter()

  useEffect(() => {
    if (state !== 'analyzing') return
    const interval = setInterval(() => setMsgIdx((i) => (i + 1) % ANALYZING_MESSAGES.length), 2800)
    return () => clearInterval(interval)
  }, [state])

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
    setState('analyzing')
    setMsgIdx(0)

    const onboardRes = await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brandName,
        websiteUrl,
        industry: skip ? '' : industry,
        targetAudience: skip ? '' : targetAudience,
        usp: skip ? '' : usp,
        brandVoice: skip ? '' : brandVoice,
      }),
    })
    const onboardData = await onboardRes.json()
    if (!onboardRes.ok) {
      setError(onboardData.error ?? 'Something went wrong')
      setState('error')
      return
    }

    const analyzeRes = await fetch('/api/modules/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moduleId: onboardData.moduleId }),
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

  const displayUrl = websiteUrl.replace(/^https?:\/\//, '')

  return (
    <div className="ob-page">
      <header className="ob-header">
        <div className="logo">
          <span className="mark">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M5 12h4l2-6 3 12 2-6h3" stroke="#06140c" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          Growth Hacker
        </div>
      </header>

      <div className="ob-center">

        {/* Analyzing */}
        {state === 'analyzing' && (
          <div className="ob-card ob-analyzing">
            <div className="ob-analyze-spinner">
              <svg viewBox="0 0 50 50" className="ob-spinner-svg">
                <circle cx="25" cy="25" r="20" fill="none" stroke="var(--line)" strokeWidth="3" />
                <circle cx="25" cy="25" r="20" fill="none" stroke="var(--green-bright)" strokeWidth="3"
                  strokeDasharray="40 90" strokeLinecap="round" />
              </svg>
            </div>
            <div className="ob-label">Foundation Audit</div>
            <h1 className="ob-heading" style={{ fontSize: '22px' }}>{displayUrl}</h1>
            <p className="ob-analyze-msg">{ANALYZING_MESSAGES[msgIdx]}</p>
            <p className="ob-hint" style={{ marginTop: '8px' }}>Takes 20–40 seconds. Do not close this tab.</p>
          </div>
        )}

        {/* Error */}
        {state === 'error' && (
          <div className="ob-card">
            <div className="ob-form">
              <div className="ob-label" style={{ color: '#f87171' }}>Error</div>
              <h1 className="ob-heading" style={{ fontSize: '24px' }}>Something went wrong</h1>
              <p className="auth-error">{error}</p>
              <Button
                onClick={() => { setState('step2'); setError('') }}
                className="w-full h-12 bg-gradient-to-br from-[var(--green-bright)] to-[var(--green)] text-[#06140c] font-semibold hover:opacity-90"
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
              <div className="ob-url-wrap">
                {/* <span className="ob-url-prefix">https://</span> */}
                <input
                  autoFocus type="text" placeholder="yourdomain.com"
                  value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)}
                  required className="ob-url-input"
                />
              </div>
              <Button
                type="submit"
                disabled={!websiteUrl.trim()}
                className="w-full h-12 gap-2 bg-gradient-to-br from-[var(--green-bright)] to-[var(--green)] text-[#06140c] font-semibold hover:opacity-90 disabled:opacity-50"
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
                <div className="ob-btn-row" style={{ marginTop: '20px' }}>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setState('step1')}
                    className="h-14 px-8 flex-1 gap-2 border-[var(--line)] text-[var(--text-dim)] hover:border-[var(--text-faint)] bg-transparent text-sm font-medium"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M19 12H5M11 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Back
                  </Button>
                  
                  <Button
                    type="button"
                    disabled={!brandName.trim()}
                    onClick={() => handleSubmit(false)}
                    className="h-14 flex-1 gap-2 bg-gradient-to-br from-[var(--green-bright)] to-[var(--green)] text-[#06140c] font-semibold hover:opacity-90 disabled:opacity-50"
                  >
                    Run Foundation Audit
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {state !== 'analyzing' && (
          <p className="ob-footer-note">Your data is private. We only read your public website.</p>
        )}
      </div>
    </div>
  )
}
