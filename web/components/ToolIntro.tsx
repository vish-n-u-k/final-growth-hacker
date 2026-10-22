'use client'

import { useEffect, useState } from 'react'
import { TOOL_INTROS, type ToolIntroId } from '@/lib/tool-intros'

// One line under a tool's header saying what the tool is for, with "How it works" to open the
// three steps. × hides it for good in this browser (regulars don't need it every visit).
export default function ToolIntro({ id }: { id: ToolIntroId }) {
  const text = TOOL_INTROS[id]
  const key = `tool-intro-hidden:${id}`
  const [hidden, setHidden] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    try { setHidden(localStorage.getItem(key) === '1') } catch { /* storage blocked: keep it shown */ }
  }, [key])
  if (hidden) return null
  const hide = () => {
    setHidden(true)
    try { localStorage.setItem(key, '1') } catch { /* ignore */ }
  }
  return (
    <>
      <div className="ti-strip">
        <span className="ti-strip-text">{text.what}</span>
        <button type="button" className="ti-strip-how" aria-expanded={open} onClick={() => setOpen(v => !v)}>
          {open ? 'Hide steps ▴' : 'How it works ▾'}
        </button>
        <button type="button" className="ti-strip-x" onClick={hide} aria-label="Hide this explanation" title="Hide">×</button>
      </div>
      {open && (
        <div className="ti-strip-steps">
          <ol>
            {text.steps.map((s, i) => (
              <li key={s.title}><span className="ti-num" aria-hidden="true">{i + 1}</span><span><b>{s.title}.</b> {s.body}</span></li>
            ))}
          </ol>
          {'note' in text && text.note && <p className="ti-strip-note">✓ {text.note}</p>}
        </div>
      )}
    </>
  )
}
