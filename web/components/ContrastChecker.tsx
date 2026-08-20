'use client'

import { useEffect, useState } from 'react'
import { evaluateContrast } from '@/lib/color-contrast'
import type { ColorContrastScanResult, ColorContrastViolation } from '@/lib/color-contrast-scan'

function ViolationCard({ v }: { v: ColorContrastViolation }) {
  const result = evaluateContrast(v.fg, v.bg)
  return (
    <div className="cc-violation">
      <div className="cc-violation-swatches">
        <span className="cc-violation-dot" style={{ background: v.fg }} />
        <span className="cc-violation-dot" style={{ background: v.bg }} />
      </div>
      <div className="cc-violation-body">
        <div className="cc-violation-ratio">{v.ratio.toFixed(2)}:1 <span className="cc-hex">{v.fg} on {v.bg}</span></div>
        {v.snippet && <code className="cc-violation-snippet">{v.snippet.slice(0, 90)}</code>}
      </div>
      {result && (
        <span className={`cc-badge ${result.aaNormal ? 'cc-pass' : 'cc-fail'}`}>
          {result.aaNormal ? 'AA ✓' : 'AA ✗'}
        </span>
      )}
    </div>
  )
}

export default function ContrastChecker({ websiteUrl, brandId }: { websiteUrl?: string; brandId?: string }) {
  const [loading, setLoading] = useState(!!websiteUrl)
  const [scan, setScan] = useState<ColorContrastScanResult | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)

  const [fg, setFg] = useState('#1e231f')
  const [bg, setBg] = useState('#ffffff')
  const manualResult = evaluateContrast(fg, bg)

  const runScan = () => {
    if (!websiteUrl) return
    setLoading(true)
    setScanError(null)
    fetch('/api/tools/color-contrast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteUrl, brandId }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const d = await res.json().catch(() => null) as { error?: string } | null
          throw new Error(d?.error ?? 'Scan failed')
        }
        return res.json() as Promise<ColorContrastScanResult>
      })
      .then((d) => setScan(d))
      .catch((e: Error) => setScanError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    runScan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [websiteUrl])

  return (
    <div className="cc-checker" onClick={(e) => e.stopPropagation()}>
      <div className="cc-checker-hd">
        <span>Contrast checker</span>
        {websiteUrl && (
          <button type="button" className="cc-rescan" onClick={runScan} disabled={loading}>
            {loading ? 'Scanning…' : 'Re-scan page'}
          </button>
        )}
      </div>

      <div className="cc-checker-body">
        {websiteUrl && (
          <div className="cc-scan-section">
            {loading ? (
              <p className="cc-scan-status">Scanning {websiteUrl.replace(/^https?:\/\//, '')} for contrast issues…</p>
            ) : scanError ? (
              <p className="cc-scan-status cc-scan-error">Couldn&apos;t scan your page automatically ({scanError}). Test colors manually below.</p>
            ) : scan && scan.violations.length > 0 ? (
              <>
                <p className="cc-scan-status">
                  Found {scan.violations.length} contrast issue{scan.violations.length === 1 ? '' : 's'} on your page
                  {scan.score !== null && ` — accessibility score ${scan.score}/100`}
                </p>
                <div className="cc-violations">
                  {scan.violations.slice(0, 8).map((v, i) => <ViolationCard key={i} v={v} />)}
                </div>
              </>
            ) : scan ? (
              <p className="cc-scan-status cc-scan-ok">
                ✓ No contrast issues found on this page{scan.score !== null && ` — accessibility score ${scan.score}/100`}
              </p>
            ) : null}
          </div>
        )}

        <details className="cc-manual" open={!websiteUrl}>
          <summary className="cc-manual-summary">Test custom colors</summary>
          <div className="cc-manual-body">
            <div className="cc-swatch-row">
              <label className="cc-swatch">
                <input type="color" value={fg} onChange={(e) => setFg(e.target.value)} />
                <span className="cc-swatch-label">Text</span>
                <span className="cc-hex">{fg}</span>
              </label>
              <label className="cc-swatch">
                <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} />
                <span className="cc-swatch-label">Background</span>
                <span className="cc-hex">{bg}</span>
              </label>
            </div>

            <div className="cc-preview" style={{ color: fg, background: bg }}>
              <span className="cc-preview-normal">Normal text sample</span>
              <span className="cc-preview-large">Large text sample</span>
            </div>

            {manualResult ? (
              <div className="cc-results">
                <div className="cc-ratio">{manualResult.ratio.toFixed(2)}:1</div>
                <div className="cc-badges">
                  <span className={`cc-badge ${manualResult.aaNormal ? 'cc-pass' : 'cc-fail'}`}>
                    AA Normal {manualResult.aaNormal ? '✓' : '✗'}
                  </span>
                  <span className={`cc-badge ${manualResult.aaLarge ? 'cc-pass' : 'cc-fail'}`}>
                    AA Large {manualResult.aaLarge ? '✓' : '✗'}
                  </span>
                  <span className={`cc-badge ${manualResult.aaaNormal ? 'cc-pass' : 'cc-fail'}`}>
                    AAA Normal {manualResult.aaaNormal ? '✓' : '✗'}
                  </span>
                </div>
              </div>
            ) : (
              <p className="cc-error">Enter valid colors to see the contrast ratio.</p>
            )}
          </div>
        </details>
      </div>
    </div>
  )
}
