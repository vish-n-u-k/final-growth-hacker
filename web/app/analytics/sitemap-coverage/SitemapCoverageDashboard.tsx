'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'

interface CoverageData {
  websiteUrl: string
  sitemapStatus: number
  sitemapCount: number
  internalLinkCount: number
  missing: string[]
  covered: string[]
  sitemapUrls: string[]
}

const card = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 14,
  padding: '20px 22px',
} as const

function UrlRow({ url, dot }: { url: string; dot: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  let path = url
  try { path = new URL(url).pathname || '/' } catch { /* keep full */ }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 0',
        borderBottom: '1px solid var(--line)',
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} />
      <span
        style={{
          flex: 1,
          fontSize: 12.5,
          color: 'var(--text)',
          fontFamily: 'var(--font-mono, monospace)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={url}
      >
        {path}
      </span>
      <button
        onClick={copy}
        style={{
          fontSize: 10.5,
          color: copied ? 'var(--green)' : 'var(--text-faint)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          flexShrink: 0,
          padding: '2px 6px',
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

export default function SitemapCoverageDashboard({
  brandId,
  brandName,
  websiteUrl,
}: {
  brandId: string
  brandName: string
  websiteUrl: string
}) {
  const router = useRouter()
  const [data, setData] = useState<CoverageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [coveredOpen, setCoveredOpen] = useState(false)

  const load = useCallback(async (soft = false) => {
    soft ? setBusy(true) : setLoading(true)
    setErr(null)
    try {
      const res = await fetch(`/api/analytics/sitemap-coverage?brandId=${brandId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json() as CoverageData)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
      setBusy(false)
    }
  }, [brandId])

  useEffect(() => { load() }, [load])

  const Header = ({ right }: { right?: React.ReactNode }) => (
    <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg)', borderBottom: '1px solid var(--line)' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '13px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => router.back()}
            style={{ width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer' }}
          >
            <ArrowLeft size={14} />
          </button>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.3px', color: 'var(--text)', fontFamily: 'var(--font-display, Fraunces, serif)' }}>Sitemap Coverage</div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 1 }}>{brandName} · {websiteUrl}</div>
          </div>
        </div>
        {right}
      </div>
    </div>
  )

  if (loading) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'var(--font-body, Outfit, sans-serif)' }}>
      <Header />
      <div style={{ maxWidth: 900, margin: '40px auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {[80, 200, 180].map((h, i) => (
          <div key={i} style={{ height: h, borderRadius: 14, background: 'var(--line)', animation: 'an-skeleton-pulse 1.4s ease-in-out infinite', opacity: 0.8 - i * 0.2 }} />
        ))}
      </div>
    </div>
  )

  if (err) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'var(--font-body, Outfit, sans-serif)' }}>
      <Header />
      <div style={{ maxWidth: 900, margin: '32px auto', padding: '0 24px' }}>
        <div style={{ background: '#2a1515', border: '1px solid #6b2626', borderRadius: 12, padding: '16px 20px', color: '#f08080', fontSize: 13 }}>
          {err}
        </div>
      </div>
    </div>
  )

  if (!data) return null

  const { sitemapStatus, sitemapCount, internalLinkCount, missing, covered } = data
  const noSitemap = sitemapStatus !== 200
  const missingCount = missing.length
  const coveredCount = covered.length
  const missingColor = missingCount > 0 ? '#fb923c' : 'var(--green)'

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'var(--font-body, Outfit, sans-serif)' }}>
      <Header right={
        <button
          onClick={() => load(true)}
          disabled={busy}
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, padding: '6px 14px', borderRadius: 99, border: '1px solid var(--line)', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}
        >
          <RefreshCw size={11} style={{ animation: busy ? 'an-spin 0.8s linear infinite' : 'none' }} />
          Refresh
        </button>
      } />

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '28px 24px 80px', opacity: busy ? 0.65 : 1, transition: 'opacity 0.2s' }}>

        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
          <div style={card}>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Internal links found</div>
            <div style={{ fontSize: 36, fontWeight: 700, color: 'var(--text)', letterSpacing: '-1px', lineHeight: 1 }}>{internalLinkCount}</div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>from homepage</div>
          </div>
          <div style={card}>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>In sitemap</div>
            <div style={{ fontSize: 36, fontWeight: 700, color: 'var(--green)', letterSpacing: '-1px', lineHeight: 1 }}>{coveredCount}</div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>
              {noSitemap ? 'no sitemap.xml found' : `sitemap has ${sitemapCount} URLs`}
            </div>
          </div>
          <div style={card}>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Missing from sitemap</div>
            <div style={{ fontSize: 36, fontWeight: 700, color: missingColor, letterSpacing: '-1px', lineHeight: 1 }}>{missingCount}</div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>
              {missingCount === 0 ? 'all covered' : 'not indexed'}
            </div>
          </div>
        </div>

        {/* No sitemap warning */}
        {noSitemap && (
          <div style={{ background: '#2a1515', border: '1px solid #6b2626', borderRadius: 12, padding: '14px 18px', color: '#f08080', fontSize: 13, marginBottom: 24 }}>
            No sitemap.xml found (HTTP {sitemapStatus || 'timeout'}). Search engines may struggle to discover your pages. Create one and submit it to Google Search Console.
          </div>
        )}

        {/* Tip */}
        {!noSitemap && missingCount > 0 && (
          <div style={{ background: 'color-mix(in srgb, #fb923c 8%, var(--card))', border: '1px solid color-mix(in srgb, #fb923c 30%, var(--line))', borderRadius: 12, padding: '12px 18px', fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 24 }}>
            These pages are linked from your homepage but missing from sitemap.xml. Add them so search engines can discover and index them.
          </div>
        )}

        {/* Missing pages */}
        <div style={{ ...card, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: missingCount > 0 ? 4 : 0 }}>
            Missing from sitemap
            <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: missingColor, background: 'color-mix(in srgb, currentColor 12%, transparent)', padding: '2px 8px', borderRadius: 99 }}>
              {missingCount}
            </span>
          </div>

          {missingCount === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--green)', marginTop: 10 }}>
              All internal links are covered in your sitemap.
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              {missing.map((url, i) => (
                <UrlRow key={i} url={url} dot="#fb923c" />
              ))}
            </div>
          )}
        </div>

        {/* Covered pages (collapsible) */}
        {coveredCount > 0 && (
          <div style={card}>
            <button
              onClick={() => setCoveredOpen(o => !o)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, width: '100%' }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                Covered by sitemap
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)', background: 'color-mix(in srgb, var(--green) 12%, transparent)', padding: '2px 8px', borderRadius: 99 }}>
                {coveredCount}
              </span>
              <span style={{ marginLeft: 'auto', color: 'var(--text-faint)' }}>
                {coveredOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
            </button>

            {coveredOpen && (
              <div style={{ marginTop: 8 }}>
                {covered.map((url, i) => (
                  <UrlRow key={i} url={url} dot="var(--green)" />
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
