'use client'

import { useEffect, useState } from 'react'
import type { AccessibleNamesScanResult, AccessibleNameViolation } from '@/lib/accessible-names-scan'

function ViolationCard({ v }: { v: AccessibleNameViolation }) {
  const snippet = v.snippet || v.selector
  return (
    <div className="cc-violation">
      <div className="cc-violation-body">
        <div className="cc-violation-ratio">{v.type === 'button' ? 'Button' : 'Link'} missing accessible name</div>
        {snippet && <code className="cc-violation-snippet">{snippet.slice(0, 90)}</code>}
      </div>
      <span className="cc-badge cc-fail">No label</span>
    </div>
  )
}

export default function AccessibleNamesChecker({ websiteUrl }: { websiteUrl?: string }) {
  const [loading, setLoading] = useState(!!websiteUrl)
  const [scan, setScan] = useState<AccessibleNamesScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const runScan = () => {
    if (!websiteUrl) return
    setLoading(true)
    setError(null)
    fetch('/api/tools/accessible-names', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteUrl }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const d = await res.json().catch(() => null) as { error?: string } | null
          throw new Error(d?.error ?? 'Scan failed')
        }
        return res.json() as Promise<AccessibleNamesScanResult>
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
        <span>Live accessible names checker</span>
        <button type="button" className="cc-rescan" onClick={runScan} disabled={loading}>
          {loading ? 'Scanning…' : 'Re-scan page'}
        </button>
      </div>
      <div className="cc-checker-body">
        <div className="cc-scan-section">
          {loading ? (
            <p className="cc-scan-status">Scanning {websiteUrl.replace(/^https?:\/\//, '')} for unlabeled buttons and links…</p>
          ) : error ? (
            <p className="cc-scan-status cc-scan-error">Couldn&apos;t scan your page automatically ({error}).</p>
          ) : scan && scan.violations.length > 0 ? (
            <>
              <p className="cc-scan-status">
                Found {scan.violations.length} unlabeled element{scan.violations.length === 1 ? '' : 's'} on your page
                {scan.score !== null && ` — accessibility score ${scan.score}/100`}
              </p>
              <div className="cc-violations">
                {scan.violations.slice(0, 8).map((v, i) => <ViolationCard key={i} v={v} />)}
              </div>
            </>
          ) : scan ? (
            <p className="cc-scan-status cc-scan-ok">
              ✓ Every button and link on this page has an accessible name{scan.score !== null && ` — accessibility score ${scan.score}/100`}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
