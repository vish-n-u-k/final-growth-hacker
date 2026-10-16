'use client'

// A dropdown panel drawn on top of the page (portal, position: fixed) next to its button, so a
// scrolling card or popup can't cut it off. Opens below, or above when there's no room; stays
// inside the screen; closes on a click outside or Escape.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

const GAP = 6
const EDGE = 12

export function Popover({ anchor, open, onClose, width, className = '', label, children }: {
  anchor: RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  width: number
  className?: string
  label: string
  children: ReactNode
}) {
  const pop = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number; width: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const place = () => {
      const a = anchor.current?.getBoundingClientRect()
      if (!a) return
      const vw = window.innerWidth, vh = window.innerHeight
      const w = Math.min(width, vw - EDGE * 2)
      const left = Math.max(EDGE, Math.min(a.left, vw - w - EDGE))
      const below = vh - a.bottom - GAP - EDGE
      const above = a.top - GAP - EDGE
      const h = pop.current?.scrollHeight ?? 320
      // Below if it fits (or below still has more room than above); else above
      if (below >= h || below >= above) setPos({ left, top: a.bottom + GAP, maxHeight: Math.max(160, below), width: w })
      else setPos({ left, bottom: vh - a.top + GAP, maxHeight: Math.max(160, above), width: w })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open, anchor, width])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node
      if (!pop.current?.contains(t) && !anchor.current?.contains(t)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, onClose, anchor])

  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div
      ref={pop} role="dialog" aria-label={label} className={`pk-pop ${className}`}
      // Clicks inside shouldn't reach whatever the trigger sits in (cards, modals with click-to-close)
      onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
      style={{ position: 'fixed', left: pos?.left ?? -9999, top: pos?.top, bottom: pos?.bottom, width: pos?.width ?? width, maxHeight: pos?.maxHeight, visibility: pos ? 'visible' : 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  )
}
