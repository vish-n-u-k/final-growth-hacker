'use client'

import { useState } from 'react'
import { isElementEvidence, type AuditElement, type ElementEvidence as Evidence } from '@/lib/audit/elements'

// The failing page elements behind a Website Audit check: where each one is on the page
// (a crop of Lighthouse's phone screenshot with the element boxed), what it is, and for
// colour contrast the colours now vs the closest passing colour. Data: module_items.ai_data.

export { isElementEvidence }

/** Plain-text list of the elements, for the Fix with Claude prompt. */
export function describeElements(ev: Evidence): string[] {
  return ev.elements.map((el) => {
    const parts = [el.selector ? `\`${el.selector}\`` : (el.snippet ?? 'element')]
    if (el.label) parts.push(`text "${el.label}"`)
    if (el.fg && el.bg) {
      parts.push(`colour ${el.fg} on ${el.bg} (${el.ratio}:1, needs ${el.need ?? 4.5}:1)`)
      if (el.suggestFg) parts.push(`suggested text colour ${el.suggestFg} (${el.suggestRatio}:1)`)
      if (el.suggestBg) parts.push(`suggested background ${el.suggestBg}, text unchanged (${el.suggestRatio}:1)`)
    }
    return `- ${parts.join(' — ')}`
  })
}

const SHOWN = 3
const PAD = 48      // page px of context around the element
const MIN_H = 130
const MAX_H = 360
const MIN_W = 220   // never zoom in further than this many page px across

// A window onto the page screenshot around the element (zoomed so it's readable), element boxed.
function Crop({ el, shot, src }: { el: AuditElement; shot: NonNullable<Evidence['shot']>; src: string }) {
  const [failed, setFailed] = useState(false)
  const r = el.rect
  if (!r || failed || r.top >= shot.h || r.left >= shot.w) return null
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
  const w = clamp(r.width + 2 * PAD, Math.min(MIN_W, shot.w), shot.w)
  const left = clamp(r.left + r.width / 2 - w / 2, 0, shot.w - w)
  const h = clamp(r.height + 2 * PAD, Math.min(MIN_H, shot.h), Math.min(MAX_H, shot.h))
  const top = clamp(r.top + r.height / 2 - h / 2, 0, shot.h - h)
  const pct = (v: number, of: number) => `${(v / of) * 100}%`
  const boxTop = Math.max(r.top, top)
  return (
    <div className="ee-crop" style={{ aspectRatio: `${w} / ${h}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} style={{ width: pct(shot.w, w), left: pct(-left, w), top: pct(-top, h) }} />
      <span
        className="ee-box"
        style={{
          left: pct(Math.max(r.left, left) - left, w), top: pct(boxTop - top, h),
          width: pct(Math.min(r.left + r.width, left + w) - Math.max(r.left, left), w),
          height: pct(Math.min(r.top + r.height, top + h) - boxTop, h),
        }}
      />
    </div>
  )
}

function CopyChip({ text, children }: { text: string; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="ee-copy"
      title={`Copy ${text}`}
      onClick={(e) => {
        e.stopPropagation()
        navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {})
      }}
    >
      {copied ? 'Copied' : children}
    </button>
  )
}

function Sample({ fg, bg, ratio, pass, show = 'fg' }: { fg: string; bg: string; ratio?: number; pass: boolean; show?: 'fg' | 'bg' | 'both' }) {
  return (
    <span className="ee-sample">
      <span className="ee-swatch" style={{ color: fg, background: bg }}>Aa</span>
      <span className="ee-hex">{show === 'fg' ? `text ${fg}` : show === 'bg' ? `background ${bg}` : `${fg} on ${bg}`}</span>
      {ratio !== undefined && <span className={pass ? 'ee-pass' : 'ee-fail'}>{ratio.toFixed(1)}:1 {pass ? '✓' : '✗'}</span>}
    </span>
  )
}

export default function ElementEvidence({ data, brandId }: { data: unknown; brandId?: string }) {
  const [all, setAll] = useState(false)
  if (!isElementEvidence(data) || data.elements.length === 0) return null
  const { elements, total, shot } = data
  const src = shot ? `/api/brands/screenshot?v=${encodeURIComponent(shot.at)}${brandId ? `&brandId=${brandId}` : ''}` : ''
  const list = all ? elements : elements.slice(0, SHOWN)

  return (
    <div className="ee" onClick={(e) => e.stopPropagation()}>
      <div className="ee-hd">
        <span className="sm-current-label">Where it is on your page</span>
        {shot && <span className="ee-note">Phone view, at the last analysis</span>}
      </div>
      <ul className="ee-list">
        {list.map((el, i) => (
          <li key={i} className="ee-item">
            {shot && <Crop el={el} shot={shot} src={src} />}
            <div className="ee-info">
              {el.label && <p className="ee-label">&ldquo;{el.label}&rdquo;</p>}
              {el.fg && el.bg && (
                <div className="ee-colours">
                  <span className="ee-cr"><span className="ee-k">Now</span><span className="ee-v"><Sample fg={el.fg} bg={el.bg} ratio={el.ratio} pass={false} show="both" /></span></span>
                  {(el.suggestFg || el.suggestBg) && (
                    <span className="ee-cr">
                      <span className="ee-k">Fix</span>
                      <span className="ee-v">
                        <Sample fg={el.suggestFg ?? el.fg} bg={el.suggestBg ?? el.bg} ratio={el.suggestRatio} pass show={el.suggestBg ? 'bg' : 'fg'} />
                        <CopyChip text={(el.suggestFg ?? el.suggestBg)!}>Copy colour</CopyChip>
                      </span>
                    </span>
                  )}
                  <span className="ee-need">Needs {el.need ?? 4.5}:1{el.fontSize ? ` for ${el.fontSize} text` : ''}</span>
                </div>
              )}
              {el.selector && (
                <span className="ee-row ee-sel">
                  <code title={el.snippet}>{el.selector}</code>
                  <CopyChip text={el.selector}>Copy</CopyChip>
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
      {elements.length > SHOWN && (
        <button type="button" className="ee-more" onClick={(e) => { e.stopPropagation(); setAll(v => !v) }}>
          {all ? 'Show fewer' : `Show all ${elements.length}`}
        </button>
      )}
      {total > elements.length && all && <p className="ee-note">{total - elements.length} more not shown: fixing the shared style usually fixes them too.</p>}
    </div>
  )
}
