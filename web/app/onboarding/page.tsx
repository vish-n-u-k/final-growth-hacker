'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type State = 'step1' | 'step2' | 'step3' | 'analyzing' | 'error'

const ANALYZING_MESSAGES = [
  'Checking your domain and SSL…',
  'Looking for Google Analytics…',
  'Scanning for essential pages…',
  'Checking contact info and privacy policy…',
  'Evaluating your homepage content…',
  'Verifying brand basics…',
  'Building your Foundation audit…',
]

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
  const router = useRouter()

  useEffect(() => {
    if (state !== 'analyzing') return
    const interval = setInterval(() => setMsgIdx((i) => (i + 1) % ANALYZING_MESSAGES.length), 2800)
    return () => clearInterval(interval)
  }, [state])

  const handleStep1 = (e: React.FormEvent) => {
    e.preventDefault()
    if (!brandName.trim()) return
    setState('step2')
  }

  const handleStep2 = (e: React.FormEvent) => {
    e.preventDefault()
    if (!websiteUrl.trim()) return
    setState('step3')
  }

  const handleSubmit = async (skip = false) => {
    setError('')
    setState('analyzing')
    setMsgIdx(0)

    // Step A: create brand + all modules
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

    // Step B: analyse Foundation module
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
                onClick={() => { setState('step3'); setError('') }}
                className="w-full h-12 bg-gradient-to-br from-[var(--green-bright)] to-[var(--green)] text-[#06140c] font-semibold hover:opacity-90"
              >
                Try again
              </Button>
            </div>
          </div>
        )}

        {/* Step 1 */}
        {state === 'step1' && (
          <div className="ob-card">
            <div className="ob-steps">
              <div className="ob-pill ob-pill-active">1</div>
              <div className="ob-pill-connector" />
              <div className="ob-pill ob-pill-idle">2</div>
              <div className="ob-pill-connector" />
              <div className="ob-pill ob-pill-idle">3</div>
            </div>
            <form onSubmit={handleStep1} className="ob-form">
              <div className="ob-label">Step 1 of 2</div>
              <h1 className="ob-heading">What&apos;s your product called?</h1>
              <p className="ob-desc">We&apos;ll personalise your entire growth dashboard around your brand.</p>
              <Input
                autoFocus type="text" placeholder="e.g. AIFeed"
                value={brandName} onChange={(e) => setBrandName(e.target.value)}
                required
                className="h-12 bg-[var(--bg-soft)] border-[var(--line)] text-[var(--text)] placeholder:text-[var(--text-faint)] focus-visible:border-[var(--green)] focus-visible:ring-[var(--green)]/20 text-base"
              />
              <Button
                type="submit"
                disabled={!brandName.trim()}
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

        {/* Step 2 */}
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
              <div className="ob-pill-connector" />
              <div className="ob-pill ob-pill-idle">3</div>
            </div>
            <form onSubmit={handleStep2} className="ob-form">
              <div className="ob-label">Step 2 of 3</div>
              <h1 className="ob-heading">
                Where&apos;s <span className="ob-brand-name">{brandName}</span> online?
              </h1>
              <p className="ob-desc">
                We&apos;ll run a Foundation audit first — checking your domain, analytics, and essential pages are in place before we get into SEO and growth.
              </p>
              <div className="ob-url-wrap">
                <span className="ob-url-prefix">https://</span>
                <input
                  autoFocus type="text" placeholder="yourdomain.com"
                  value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)}
                  required className="ob-url-input"
                />
              </div>
              <div className="ob-btn-row">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setState('step1')}
                  className="h-12 gap-1.5 border-[var(--line)] text-[var(--text-dim)] hover:border-[var(--text-faint)] bg-transparent"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M19 12H5M11 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Back
                </Button>
                <Button
                  type="submit"
                  disabled={!websiteUrl.trim()}
                  className="h-12 flex-1 gap-2 bg-gradient-to-br from-[var(--green-bright)] to-[var(--green)] text-[#06140c] font-semibold hover:opacity-90 disabled:opacity-50"
                >
                  Continue
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* Step 3 */}
        {state === 'step3' && (
          <div className="ob-card">
            <div className="ob-steps">
              <div className="ob-pill ob-pill-done">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="ob-pill-connector" />
              <div className="ob-pill ob-pill-done">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="ob-pill-connector" />
              <div className="ob-pill ob-pill-active">3</div>
            </div>
            <div className="ob-form">
              <div className="ob-label">Step 3 of 3</div>
              <h1 className="ob-heading">Tell us about your brand</h1>
              <p className="ob-desc">
                Used to personalise your Brand Audit and competitor analysis. You can skip and fill these in later.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <Input
                  type="text"
                  placeholder="Industry (e.g. SaaS, E-commerce, Healthcare)"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="h-12 bg-[var(--bg-soft)] border-[var(--line)] text-[var(--text)] placeholder:text-[var(--text-faint)] focus-visible:border-[var(--green)] focus-visible:ring-[var(--green)]/20 text-base"
                />
                <Input
                  type="text"
                  placeholder="Target audience (e.g. Shopify sellers, Marketing managers)"
                  value={targetAudience}
                  onChange={(e) => setTargetAudience(e.target.value)}
                  className="h-12 bg-[var(--bg-soft)] border-[var(--line)] text-[var(--text)] placeholder:text-[var(--text-faint)] focus-visible:border-[var(--green)] focus-visible:ring-[var(--green)]/20 text-base"
                />
                <Input
                  type="text"
                  placeholder="Your USP (e.g. No expertise required, AI-powered)"
                  value={usp}
                  onChange={(e) => setUsp(e.target.value)}
                  className="h-12 bg-[var(--bg-soft)] border-[var(--line)] text-[var(--text)] placeholder:text-[var(--text-faint)] focus-visible:border-[var(--green)] focus-visible:ring-[var(--green)]/20 text-base"
                />
                <Input
                  type="text"
                  placeholder="Brand voice (e.g. Professional, friendly, direct)"
                  value={brandVoice}
                  onChange={(e) => setBrandVoice(e.target.value)}
                  className="h-12 bg-[var(--bg-soft)] border-[var(--line)] text-[var(--text)] placeholder:text-[var(--text-faint)] focus-visible:border-[var(--green)] focus-visible:ring-[var(--green)]/20 text-base"
                />
              </div>
              <div className="ob-btn-row" style={{ marginTop: '20px' }}>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setState('step2')}
                  className="h-12 gap-1.5 border-[var(--line)] text-[var(--text-dim)] hover:border-[var(--text-faint)] bg-transparent"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M19 12H5M11 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Back
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleSubmit(true)}
                  className="h-12 border-[var(--line)] text-[var(--text-dim)] hover:border-[var(--text-faint)] bg-transparent"
                >
                  Skip
                </Button>
                <Button
                  type="button"
                  onClick={() => handleSubmit(false)}
                  className="h-12 flex-1 gap-2 bg-gradient-to-br from-[var(--green-bright)] to-[var(--green)] text-[#06140c] font-semibold hover:opacity-90"
                >
                  Run Foundation Audit
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Button>
              </div>
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
