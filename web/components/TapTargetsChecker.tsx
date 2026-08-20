'use client'

import { useEffect, useState } from 'react'
import type { TapTargetsScanResult, TapTargetViolation } from '@/lib/tap-targets-scan'

function ViolationCard({ v }: { v: TapTargetViolation }) {
  const snippet = v.snippet || v.selector
  return (
    <div className="cc-violation">
      <div className="cc-violation-body">
        <div className="cc-violation-ratio">
          {v.size ?? 'Below 48x48px'}
          {v.overlappingSelector && <span className="cc-hex">overlaps {v.overlappingSelector}</span>}
        </div>
        {snippet && <code className="cc-violation-snippet">{snippet.slice(0, 90)}</code>}
      </div>
      <span className="cc-badge cc-fail">Too small</span>
    </div>
  )
}

export default function TapTargetsChecker({ websiteUrl, brandId }: { websiteUrl?: string; brandId?: string }) {
  const [loading, setLoading] = useState(!!websiteUrl)
  const [scan, setScan] = useState<TapTargetsScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const runScan = () => {
    if (!websiteUrl) return
    setLoading(true)
    setError(null)
    fetch('/api/tools/tap-targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteUrl, brandId }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const d = await res.json().catch(() => null) as { error?: string } | null
          throw new Error(d?.error ?? 'Scan failed')
        }
        return res.json() as Promise<TapTargetsScanResult>
      })
      .then((d) => setScan(d))
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
        <span>Live tap target checker</span>
        <button type="button" className="cc-rescan" onClick={runScan} disabled={loading}>
          {loading ? 'Scanning…' : 'Re-scan page'}
        </button>
      </div>
      <div className="cc-checker-body">
        <div className="cc-scan-section">
          {loading ? (
            <p className="cc-scan-status">Scanning {websiteUrl.replace(/^https?:\/\//, '')} for small tap targets…</p>
          ) : error ? (
            <p className="cc-scan-status cc-scan-error">Couldn&apos;t scan your page automatically ({error}).</p>
          ) : scan && scan.violations.length > 0 ? (
            <>
              <p className="cc-scan-status">
                Found {scan.violations.length} tap target issue{scan.violations.length === 1 ? '' : 's'} on your page
                {scan.score !== null && ` — accessibility score ${scan.score}/100`}
              </p>
              <div className="cc-violations">
                {scan.violations.slice(0, 8).map((v, i) => <ViolationCard key={i} v={v} />)}
              </div>
            </>
          ) : scan ? (
            <p className="cc-scan-status cc-scan-ok">
              ✓ No tap target issues found on this page{scan.score !== null && ` — accessibility score ${scan.score}/100`}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
