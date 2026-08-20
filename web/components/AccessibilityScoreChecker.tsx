'use client'

import { useEffect, useState } from 'react'
import type { AccessibilityScoreResult } from '@/lib/accessibility-score-scan'

const CHECKS: { key: keyof Omit<AccessibilityScoreResult, 'score'>; label: string }[] = [
  { key: 'colorContrastPass', label: 'Color contrast' },
  { key: 'fontSizePass', label: 'Font size' },
  { key: 'tapTargetsPass', label: 'Tap targets' },
  { key: 'accessibleNamesPass', label: 'Accessible names' },
]

export default function AccessibilityScoreChecker({ websiteUrl, brandId }: { websiteUrl?: string; brandId?: string }) {
  const [loading, setLoading] = useState(!!websiteUrl)
  const [result, setResult] = useState<AccessibilityScoreResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const runScan = () => {
    if (!websiteUrl) return
    setLoading(true)
    setError(null)
    fetch('/api/tools/accessibility-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteUrl, brandId }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const d = await res.json().catch(() => null) as { error?: string } | null
          throw new Error(d?.error ?? 'Check failed')
        }
        return res.json() as Promise<AccessibilityScoreResult>
      })
      .then((d) => setResult(d))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    runScan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [websiteUrl])

  if (!websiteUrl) return null

  return (
    <div className="cc-checker" onClick={(e) => e.stopPropagation()}>
      <div className="cc-checker-hd">
        <span>Live accessibility score</span>
        <button type="button" className="cc-rescan" onClick={runScan} disabled={loading}>
          {loading ? 'Checking…' : 'Re-check'}
        </button>
      </div>
      <div className="cc-checker-body">
        {loading ? (
          <p className="cc-scan-status">Checking {websiteUrl.replace(/^https?:\/\//, '')}…</p>
        ) : error ? (
          <p className="cc-scan-status cc-scan-error">Couldn&apos;t check your page automatically ({error}). Try again in a moment.</p>
        ) : result ? (
          <>
            <div className="as-score-row">
              <span className="as-score-num">{result.score}</span>
              <span className="as-score-label">/ 100</span>
            </div>
            <div className="cc-badges">
              {CHECKS.map(({ key, label }) => {
                const pass = result[key]
                if (pass === null) return null
                return (
                  <span key={key} className={`cc-badge ${pass ? 'cc-pass' : 'cc-fail'}`}>
                    {label} {pass ? '✓' : '✗'}
                  </span>
                )
              })}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
