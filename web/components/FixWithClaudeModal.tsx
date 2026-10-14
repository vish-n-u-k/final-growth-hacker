'use client'

import { useEffect, useRef, useState } from 'react'

// "Fix with Claude" chooser. Leads with the GrowJin MCP connector (Claude reads the check, fixes it
// and ticks it off here), with "do it myself in Claude Code" as the alternative. The choice can be
// remembered, after which the button opens Claude straight away (see AllModulesDashboard).

export type FixChoice = 'mcp' | 'code'
export const FIX_CHOICE_KEY = 'growjin_fix_with'
const MCP_URL = 'https://app.growjin.com/api/mcp'

export default function FixWithClaudeModal({ itemLabel, mcpConnected, isPhone, onChoose, onMarkConnected, onClose }: {
  itemLabel: string
  mcpConnected: boolean
  isPhone: boolean
  onChoose: (choice: FixChoice, remember: boolean) => void
  onMarkConnected: () => void
  onClose: () => void
}) {
  const [remember, setRemember] = useState(true)
  const [setupOpen, setSetupOpen] = useState(!mcpConnected)
  const [copied, setCopied] = useState(false)
  const firstBtn = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    firstBtn.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const copyUrl = async () => {
    try { await navigator.clipboard.writeText(MCP_URL) } catch { /* shown in the box anyway */ }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fwc-backdrop" onClick={(e) => { e.stopPropagation(); onClose() }}>
      <div className="fwc" role="dialog" aria-modal="true" aria-labelledby="fwc-title" onClick={(e) => e.stopPropagation()}>
        <div className="fwc-hd">
          <div>
            <h2 id="fwc-title" className="fwc-title">Fix this with Claude</h2>
            <p className="fwc-sub">{itemLabel}</p>
          </div>
          <button type="button" className="fwc-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        {/* Option 1: GrowJin MCP */}
        <section className="fwc-opt fwc-opt--main">
          <div className="fwc-opt-hd">
            <span className="fwc-opt-name">Let Claude do it with GrowJin</span>
            <span className="fwc-badge">Recommended</span>
          </div>
          <p className="fwc-text">
            Connect GrowJin to Claude once. Claude then sees all your checks, makes the fix, and ticks it off here when it&apos;s done. No copying and pasting.
          </p>

          {mcpConnected ? (
            <p className="fwc-ok">✓ GrowJin is connected to your Claude</p>
          ) : (
            <div className="fwc-setup">
              <button type="button" className="fwc-setup-toggle" aria-expanded={setupOpen} onClick={() => setSetupOpen(v => !v)}>
                One-time setup (1 minute)
              </button>
              {setupOpen && (
                <>
                  <ol className="fwc-steps">
                    <li>In Claude, open <b>Settings → Connectors</b> and click <b>Add custom connector</b></li>
                    <li>Name it <b>GrowJin</b> and paste this URL:
                      <span className="fwc-url">
                        <code>{MCP_URL}</code>
                        <button type="button" onClick={copyUrl}>{copied ? 'Copied' : 'Copy'}</button>
                      </span>
                    </li>
                    <li>Click <b>Add</b> and log in to GrowJin when asked</li>
                  </ol>
                  <div className="fwc-setup-actions">
                    <a href="https://claude.ai/settings/connectors" target="_blank" rel="noopener noreferrer" className="fwc-link-btn">Open Claude connectors ↗</a>
                    <button type="button" className="fwc-link-btn" onClick={onMarkConnected}>I&apos;ve connected it</button>
                  </div>
                </>
              )}
            </div>
          )}

          <button ref={firstBtn} type="button" className="fwc-primary" onClick={() => onChoose('mcp', remember)}>
            {mcpConnected ? 'Open Claude and fix it' : 'Open Claude'}
          </button>
        </section>

        {/* Option 2: do it yourself in Claude Code */}
        <section className="fwc-opt">
          <div className="fwc-opt-hd">
            <span className="fwc-opt-name">{isPhone ? 'Just send the fix to Claude' : 'Fix it myself in Claude Code'}</span>
          </div>
          <p className="fwc-text">
            {isPhone
              ? 'Claude Code runs on a computer. On this phone we’ll open Claude with the fix written out for you.'
              : 'Opens Claude Code in your project with the fix already typed in. You review it and press Enter.'}
          </p>
          <button type="button" className="fwc-secondary" onClick={() => onChoose('code', remember)}>
            {isPhone ? 'Open in Claude' : 'Open Claude Code'}
          </button>
        </section>

        <label className="fwc-remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember my choice for next time
        </label>
      </div>
    </div>
  )
}
