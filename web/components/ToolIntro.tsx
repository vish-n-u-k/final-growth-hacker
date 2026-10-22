'use client'

import { useEffect, useState } from 'react'
import ToolIcon from '@/components/ToolIcon'
import { TOOL_INTROS, type ToolIntroId } from '@/lib/tool-intros'

// "What this does" panel under a tool's header, so a first-time visitor knows what the page is for
// without anyone explaining it: the tool's icon and one plain sentence, then three titled steps.
// Open by default; closing it folds it to a small "What is this?" link and is remembered in this
// browser, so regulars aren't shown it every visit.
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
    <section className="ti" aria-label="What this tool does">
      <button type="button" className="ti-close" onClick={() => set(true)} aria-label="Hide this explanation" title="Hide">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      </button>
      <div className="ti-head">
        <div className="ti-icon"><ToolIcon name={text.icon} size={20} /></div>
        <div className="ti-head-text">
          <div className="ti-eyebrow">What this does</div>
          <p className="ti-what">{text.what}</p>
        </div>
      </div>
      <ol className="ti-steps">
        {text.steps.map((s, i) => (
          <li key={s.title} className="ti-step">
            <div className="ti-step-hd">
              <span className="ti-num" aria-hidden="true">{i + 1}</span>
              <span className="ti-step-title">{s.title}</span>
            </div>
            <p>{s.body}</p>
          </li>
        ))}
      </ol>
      {'note' in text && text.note && (
        <p className="ti-note">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {text.note}
        </p>
      )}
    </section>
  )
}
