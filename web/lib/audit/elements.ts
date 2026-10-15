// The actual page elements behind a failing Lighthouse check, plus the full-page screenshot they
// sit on, so a check can show "this one, here" instead of "1 element on this page".
// Everything comes from the PageSpeed Insights response the audit already fetches (lib/psi.ts).

import { suggestContrastFix } from '@/lib/color-contrast'

export interface ElementRect { top: number; left: number; width: number; height: number }

export interface AuditElement {
  selector?: string
  snippet?: string
  label?: string        // the element's visible text, as Lighthouse reports it
  rect?: ElementRect    // position on the full-page screenshot (CSS px)
  // Colour contrast only
  ratio?: number
  fg?: string
  bg?: string
  fontSize?: string
  need?: number         // ratio WCAG asks for here (4.5, or 3 for large text)
  suggestFg?: string    // smallest passing change: a new text colour…
  suggestBg?: string    // …or, for light text on a coloured background, a new background
  suggestRatio?: number
}

// Stored on module_items.ai_data for the check; `shot` is set when the screenshot was saved.
export interface ElementEvidence {
  kind: 'elements'
  total: number
  elements: AuditElement[]
  shot?: { w: number; h: number; at: string }
  url?: string  // the page that was audited (for "See it on your site" links)
}

export function isElementEvidence(d: unknown): d is ElementEvidence {
  return !!d && typeof d === 'object' && (d as ElementEvidence).kind === 'elements' && Array.isArray((d as ElementEvidence).elements)
}

export interface PageScreenshot { data: string; w: number; h: number }

const MAX_ELEMENTS = 10

interface LhNode {
  lhId?: string
  selector?: string
  snippet?: string
  nodeLabel?: string
  explanation?: string
  boundingRect?: { top: number; left: number; width: number; height: number }
}
type Lhr = Record<string, unknown>

// Lighthouse 10+ puts it at lhr.fullPageScreenshot; older runs had it as an audit.
function fullPage(lhr: Lhr): { screenshot?: { data?: string; width?: number; height?: number }; nodes?: Record<string, ElementRect> } | null {
  const top = lhr.fullPageScreenshot as ReturnType<typeof fullPage>
  if (top?.screenshot) return top
  const audits = lhr.audits as Record<string, { details?: unknown }> | undefined
  return (audits?.['full-page-screenshot']?.details as ReturnType<typeof fullPage>) ?? null
}

export function extractScreenshot(lhr: Lhr): PageScreenshot | null {
  const s = fullPage(lhr)?.screenshot
  if (!s?.data?.startsWith('data:image/') || !s.width || !s.height) return null
  return { data: s.data, w: s.width, h: s.height }
}

// "Element has insufficient color contrast of 2.85 (foreground color: #9a9a9a, background color:
// #ffffff, font size: 10.5pt (14px), font weight: normal). Expected contrast ratio of 4.5:1"
const CONTRAST_RE = /contrast of ([\d.]+) \(foreground color: (#[0-9a-f]{3,8}), background color: (#[0-9a-f]{3,8})(?:, font size: ([^,)]+(?:\)[^,)]*)?))?/i
const EXPECTED_RE = /Expected contrast ratio of ([\d.]+):1/i

function toElement(node: LhNode, nodes: Record<string, ElementRect> | undefined): AuditElement {
  // Prefer the position Lighthouse measured while taking the full-page screenshot: it stretches the
  // viewport to the page height first, which moves fixed banners and 100vh sections, so the
  // element's normal-view boundingRect can point at the wrong spot on the image.
  const r = (node.lhId ? nodes?.[node.lhId] : undefined) ?? node.boundingRect
  const el: AuditElement = {}
  if (node.selector) el.selector = node.selector
  if (node.snippet) el.snippet = node.snippet.slice(0, 300)
  if (node.nodeLabel) el.label = node.nodeLabel.slice(0, 160)
  if (r && r.width > 0 && r.height > 0) el.rect = { top: r.top, left: r.left, width: r.width, height: r.height }
  const m = node.explanation ? CONTRAST_RE.exec(node.explanation) : null
  if (m) {
    el.ratio = parseFloat(m[1])
    el.fg = m[2].toLowerCase()
    el.bg = m[3].toLowerCase()
    if (m[4]) el.fontSize = m[4].trim()
    el.need = parseFloat(EXPECTED_RE.exec(node.explanation ?? '')?.[1] ?? '4.5') || 4.5
    const s = suggestContrastFix(el.fg, el.bg, el.need)
    if (s) {
      if (s.fg) el.suggestFg = s.fg
      if (s.bg) el.suggestBg = s.bg
      el.suggestRatio = Math.round(s.ratio * 100) / 100
    }
  }
  return el
}

/** Failing elements across the given Lighthouse audits, or null when none of them listed any. */
export function extractElements(lhr: Lhr, auditIds: string[]): { total: number; elements: AuditElement[] } | null {
  const audits = lhr.audits as Record<string, { score?: number | null; details?: { items?: Array<{ node?: LhNode }> } }> | undefined
  const nodes = fullPage(lhr)?.nodes
  const all: AuditElement[] = []
  for (const id of auditIds) {
    const a = audits?.[id]
    if (!a || a.score === 1) continue
    for (const item of a.details?.items ?? []) {
      if (item.node) all.push(toElement(item.node, nodes))
    }
  }
  if (all.length === 0) return null
  return { total: all.length, elements: all.slice(0, MAX_ELEMENTS) }
}
