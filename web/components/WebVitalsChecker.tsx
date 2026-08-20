'use client'

import { useEffect, useState } from 'react'
import type { WebVitalsScanResult } from '@/lib/web-vitals-scan'

export default function WebVitalsChecker({ websiteUrl }: { websiteUrl?: string }) {
  const [loading, setLoading] = useState(!!websiteUrl)
  const [result, setResult] = useState<WebVitalsScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const runScan = () => {
    if (!websiteUrl) return
    setLoading(true)
    setError(null)
    fetch('/api/tools/web-vitals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteUrl }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const d = await res.json().catch(() => null) as { error?: string } | null
          throw new Error(d?.error ?? 'Check failed')
        }
        return res.json() as Promise<WebVitalsScanResult>
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

  const lcpGood = result?.lcpMs !== null && result?.lcpMs !== undefined ? result.lcpMs <= 2500 : null
  const tbtGood = result?.tbtMs !== null && result?.tbtMs !== undefined ? result.tbtMs <= 200 : null
  const clsGood = result?.clsScore !== null && result?.clsScore !== undefined ? result.clsScore <= 0.1 : null

  return (
    <div className="cc-checker" onClick={(e) => e.stopPropagation()}>
      <div className="cc-checker-hd">
        <span>Live Core Web Vitals</span>
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
            {result.performanceScore !== null && (
              <div className="as-score-row">
                <span className="as-score-num">{result.performanceScore}</span>
                <span className="as-score-label">/ 100 performance</span>
              </div>
            )}
            <div className="cc-badges">
              {result.lcpMs !== null && (
                <span className={`cc-badge ${lcpGood ? 'cc-pass' : 'cc-fail'}`}>
                  LCP {(result.lcpMs / 1000).toFixed(1)}s {lcpGood ? '✓' : '✗'}
                </span>
              )}
              {result.tbtMs !== null && (
                <span className={`cc-badge ${tbtGood ? 'cc-pass' : 'cc-fail'}`}>
                  TBT {Math.round(result.tbtMs)}ms {tbtGood ? '✓' : '✗'}
                </span>
              )}
              {result.clsScore !== null && (
                <span className={`cc-badge ${clsGood ? 'cc-pass' : 'cc-fail'}`}>
                  CLS {result.clsScore.toFixed(3)} {clsGood ? '✓' : '✗'}
                </span>
              )}
              {result.renderBlockingCount !== null && (
                <span className={`cc-badge ${result.renderBlockingCount === 0 ? 'cc-pass' : 'cc-fail'}`}>
                  {result.renderBlockingCount} render-blocking resource{result.renderBlockingCount === 1 ? '' : 's'}
                </span>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
