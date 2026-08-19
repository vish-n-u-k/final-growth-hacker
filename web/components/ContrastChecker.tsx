'use client'

import { useState } from 'react'
import { evaluateContrast } from '@/lib/color-contrast'

export default function ContrastChecker() {
  const [fg, setFg] = useState('#1e231f')
  const [bg, setBg] = useState('#ffffff')
  const result = evaluateContrast(fg, bg)

  return (
    <div className="cc-checker" onClick={(e) => e.stopPropagation()}>
      <div className="cc-checker-hd">Contrast checker</div>
      <div className="cc-checker-body">
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

        {result ? (
          <div className="cc-results">
            <div className="cc-ratio">{result.ratio.toFixed(2)}:1</div>
            <div className="cc-badges">
              <span className={`cc-badge ${result.aaNormal ? 'cc-pass' : 'cc-fail'}`}>
                AA Normal {result.aaNormal ? '✓' : '✗'}
              </span>
              <span className={`cc-badge ${result.aaLarge ? 'cc-pass' : 'cc-fail'}`}>
                AA Large {result.aaLarge ? '✓' : '✗'}
              </span>
              <span className={`cc-badge ${result.aaaNormal ? 'cc-pass' : 'cc-fail'}`}>
                AAA Normal {result.aaaNormal ? '✓' : '✗'}
              </span>
            </div>
          </div>
        ) : (
          <p className="cc-error">Enter valid colors to see the contrast ratio.</p>
        )}
      </div>
    </div>
  )
}
