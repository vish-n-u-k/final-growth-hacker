'use client'

import { useEffect, useState } from 'react'
import { TOOL_INTROS, type ToolIntroId } from '@/lib/tool-intros'

// "What is this?" panel under a tool's header, so a first-time visitor knows what the page is for
// without anyone explaining it. Open by default; "Hide" folds it to a small link and is remembered
// in this browser, so regulars aren't shown it every visit.
export default function ToolIntro({ id }: { id: ToolIntroId }) {
  const text = TOOL_INTROS[id]
  const key = `tool-intro-hidden:${id}`
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    try { setHidden(localStorage.getItem(key) === '1') } catch { /* storage blocked: keep it open */ }
  }, [key])
  const set = (h: boolean) => {
    setHidden(h)
    try { if (h) localStorage.setItem(key, '1'); else localStorage.removeItem(key) } catch { /* ignore */ }
  }

  if (hidden) {
    return (
      <button type="button" className="ti-show" onClick={() => set(false)}>
        <span className="ti-q" aria-hidden="true">?</span>What is this?
      </button>
    )
  }
  return (
    <section className="ti" aria-label="What is this?">
      <div className="ti-top">
        <p className="ti-what">{text.what}</p>
        <button type="button" className="btn btn-link ti-hide" onClick={() => set(true)}>Hide</button>
      </div>
      <ol className="ti-steps">
        {text.steps.map((s, i) => (
          <li key={i}><span className="ti-num" aria-hidden="true">{i + 1}</span><span>{s}</span></li>
        ))}
      </ol>
      {'note' in text && text.note && <p className="ti-note">{text.note}</p>}
    </section>
  )
}
