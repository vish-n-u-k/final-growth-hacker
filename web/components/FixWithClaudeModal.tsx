'use client'

import { useEffect, useRef, useState } from 'react'

// "Fix with Claude" chooser. Leads with the GrowJin MCP connector (Claude reads the check, fixes it
// and ticks it off here), with "do it myself in Claude Code" as the alternative. The choice can be
// remembered, after which the button opens Claude straight away (see AllModulesDashboard).

// mcp = GrowJin MCP in Claude Code on the web (claude.ai/code); mcp-code = GrowJin MCP in the Claude Code
// app on this computer; code = plain prompt in the Claude Code app (on phones: Claude Code on the web).
export type FixChoice = 'mcp' | 'mcp-code' | 'code'
export const FIX_CHOICE_KEY = 'growjin_fix_with'
const MCP_URL = 'https://app.growjin.com/api/mcp'
const CLAUDE_CODE_CMD = `claude mcp add --transport http growjin ${MCP_URL}`

function agoText(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 60) return m <= 1 ? 'just now' : `${m} minutes ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

function CopyBox({ text, mono = true }: { text: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <span className="fwc-url">
      <code style={mono ? undefined : { fontFamily: 'inherit' }}>{text}</code>
      <button type="button" onClick={async () => {
        try { await navigator.clipboard.writeText(text) } catch { /* visible in the box anyway */ }
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2000)
      }}>{copied ? 'Copied' : 'Copy'}</button>
    </span>
  )
}

export default function FixWithClaudeModal({ title = 'Fix this with Claude', itemLabel, mcpConnected, mcpLastUsedAt = null, isPhone, onChoose, onMarkConnected, onClose }: {
  title?: string
  itemLabel: string
  mcpConnected: boolean
  mcpLastUsedAt?: string | null
  isPhone: boolean
  onChoose: (choice: FixChoice, remember: boolean) => void
  onMarkConnected: () => void
  onClose: () => void
}) {
  const [remember, setRemember] = useState(true)
  const [setupOpen, setSetupOpen] = useState(!mcpConnected)
  const [client, setClient] = useState<'app' | 'code'>('app')
  const firstBtn = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    firstBtn.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fwc-backdrop" onClick={(e) => { e.stopPropagation(); onClose() }}>
      <div className="fwc" role="dialog" aria-modal="true" aria-labelledby="fwc-title" onClick={(e) => e.stopPropagation()}>
        <div className="fwc-hd">
          <div>
            <h2 id="fwc-title" className="fwc-title">{title}</h2>
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

          {mcpConnected && !isPhone && (
            <div className="fwc-tabs" role="tablist" aria-label="Open in">
              <button type="button" role="tab" aria-selected={client === 'app'} className={client === 'app' ? 'is-on' : ''} onClick={() => setClient('app')}>Claude Code on the web</button>
              <button type="button" role="tab" aria-selected={client === 'code'} className={client === 'code' ? 'is-on' : ''} onClick={() => setClient('code')}>Claude Code on this computer</button>
            </div>
          )}
          {mcpConnected ? (
            <p className="fwc-ok">✓ GrowJin is connected to your Claude{mcpLastUsedAt ? ` · last used ${agoText(mcpLastUsedAt)}` : ''}</p>
          ) : (
            <div className="fwc-setup">
              <button type="button" className="fwc-setup-toggle" aria-expanded={setupOpen} onClick={() => setSetupOpen(v => !v)}>
                Not connected yet · one-time setup (1 minute)
              </button>
              {setupOpen && (
                <>
                  <div className="fwc-tabs" role="tablist" aria-label="Where you use Claude">
                    <button type="button" role="tab" aria-selected={client === 'app'} className={client === 'app' ? 'is-on' : ''} onClick={() => setClient('app')}>Claude Code on the web</button>
                    <button type="button" role="tab" aria-selected={client === 'code'} className={client === 'code' ? 'is-on' : ''} onClick={() => setClient('code')}>Claude Code on this computer</button>
                  </div>
                  {client === 'app' ? (
                    <>
                      <ol className="fwc-steps">
                        <li>In Claude, open <b>Settings → Connectors</b> and click <b>Add custom connector</b></li>
                        <li>Name it <b>GrowJin</b> and paste this URL:<CopyBox text={MCP_URL} /></li>
                        <li>Click <b>Add</b>, then <b>Connect</b>, and log in to GrowJin when asked</li>
                      </ol>
                      <p className="fwc-note">Once added, it works in Claude Code on the web and in the Claude apps.</p>
                      <div className="fwc-setup-actions">
                        <a href="https://claude.ai/settings/connectors" target="_blank" rel="noopener noreferrer" className="fwc-link-btn">Open Claude connectors ↗</a>
                        <button type="button" className="fwc-link-btn" onClick={onMarkConnected}>I&apos;ve connected it</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <ol className="fwc-steps">
                        <li>In your project folder, run:<CopyBox text={CLAUDE_CODE_CMD} /></li>
                        <li>Start <b>claude</b>, type <b>/mcp</b>, pick <b>growjin</b> and log in to GrowJin</li>
                      </ol>
                      <div className="fwc-setup-actions">
                        <a href="/settings?tab=claude-code" className="fwc-link-btn">More options in Settings</a>
                        <button type="button" className="fwc-link-btn" onClick={onMarkConnected}>I&apos;ve connected it</button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          <button ref={firstBtn} type="button" className="fwc-primary" onClick={() => onChoose(client === 'code' && !isPhone ? 'mcp-code' : 'mcp', remember)}>
            {`${mcpConnected ? '' : 'Connected? '}Open Claude Code and fix it`}
          </button>
        </section>

        {/* Option 2: do it yourself in Claude Code */}
        <section className="fwc-opt">
          <div className="fwc-opt-hd">
            <span className="fwc-opt-name">{isPhone ? 'Just send the fix to Claude Code' : 'Fix it myself in the Claude Code app'}</span>
          </div>
          <p className="fwc-text">
            {isPhone
              ? 'Opens Claude Code with the fix already typed in and your website’s repo selected. You review it and press Enter.'
              : 'Opens the Claude Code app on this computer with the fix already typed in. You review it and press Enter.'}
          </p>
          <button type="button" className="fwc-secondary" onClick={() => onChoose('code', remember)}>
            {isPhone ? 'Open Claude Code' : 'Open the Claude Code app'}
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
