'use client'

import { useRef, useState, type ReactNode } from 'react'
import FixWithClaudeModal, { FIX_CHOICE_KEY, type FixChoice } from '@/components/FixWithClaudeModal'

// Shared "do this with Claude" hand-off, used by Growth Path checks and the Today page.
// start() shows the FixWithClaudeModal (GrowJin MCP first, or Claude Code with a plain prompt),
// unless the user remembered a choice, in which case it opens Claude straight away. Every
// hand-off also copies the prompt, and hint(key) renders the "Opened Claude… / Change how I fix"
// line under the button that started it.

export interface HandoffArgs {
  key: string    // identifies the button, so the hint shows under the right one
  label: string  // shown in the popup ("Fix this with Claude: <label>")
  plain: string  // full prompt for Claude Code without the GrowJin MCP
  mcp: string    // prompt that uses the GrowJin MCP tools
  title?: string // popup title; defaults to "Fix this with Claude"
}

const claudeWebUrl = (text: string) => `https://claude.ai/new?q=${encodeURIComponent(text)}`
const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
const readLocal = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const writeLocal = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch { /* private mode */ } }

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Older browsers and some app views refuse the clipboard API: fall back to a temporary text box.
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try { document.execCommand('copy') } catch { /* nothing more to try */ }
    document.body.removeChild(ta)
  }
}

export function useClaudeHandoff({ mcpLastUsedAt = null, githubRepo = null }: { mcpLastUsedAt?: string | null; githubRepo?: string | null }) {
  const [modal, setModal] = useState<HandoffArgs | null>(null)
  const [mcpMarked, setMcpMarked] = useState(false)
  const [last, setLast] = useState<{ key: string; prompt: string; via: 'claude' | 'code' } | null>(null)
  const lastArgs = useRef<HandoffArgs | null>(null)
  // Connected = a Claude client has actually used GrowJin's MCP (or the user just said they connected it).
  const mcpConnected = !!mcpLastUsedAt || mcpMarked

  const run = (choice: FixChoice, args: HandoffArgs) => {
    const text = choice === 'code' ? args.plain : args.mcp
    void copyText(text)
    const via = choice === 'mcp' || isPhone() ? 'claude' : 'code'
    setLast({ key: args.key, prompt: text, via })
    window.setTimeout(() => setLast(prev => (prev?.key === args.key && prev.prompt === text ? null : prev)), 12000)
    if (via === 'claude') {
      window.open(claudeWebUrl(text), '_blank', 'noopener')
    } else {
      // A link click (not location.href) hands the claude-cli:// URL to the OS without starting a
      // page navigation, so nothing on this page is interrupted.
      const a = document.createElement('a')
      a.href = `claude-cli://open?q=${encodeURIComponent(text.slice(0, 4900))}${githubRepo ? `&repo=${encodeURIComponent(githubRepo)}` : ''}`
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    }
  }

  const start = (args: HandoffArgs) => {
    lastArgs.current = args
    const saved = readLocal(FIX_CHOICE_KEY) as FixChoice | null
    if (saved === 'code' || ((saved === 'mcp' || saved === 'mcp-code') && mcpConnected)) run(saved, args)
    else setModal(args)
  }

  // "Change how I fix": forget the remembered choice and show the popup again.
  const changeChoice = () => {
    writeLocal(FIX_CHOICE_KEY, null)
    setLast(null)
    if (lastArgs.current) setModal(lastArgs.current)
  }

  const hint = (key: string): ReactNode => {
    if (last?.key !== key) return null
    return (
      <p className="sm-claude-hint" role="status">
        Opened {last.via === 'code' ? 'Claude Code' : 'Claude'}, prompt copied too.{' '}
        {last.via === 'code' && <>Nothing opened? <a href={claudeWebUrl(last.prompt)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>Use Claude on the web</a>{' · '}</>}
        <button type="button" className="sm-claude-change" onClick={(e) => { e.stopPropagation(); changeChoice() }}>Change how I fix</button>
      </p>
    )
  }

  const modalEl: ReactNode = modal && (
    <FixWithClaudeModal
      title={modal.title}
      itemLabel={modal.label}
      mcpConnected={mcpConnected}
      mcpLastUsedAt={mcpLastUsedAt}
      isPhone={isPhone()}
      onChoose={(choice, remember) => {
        if (remember) writeLocal(FIX_CHOICE_KEY, choice)
        run(choice, modal)
        setModal(null)
      }}
      onMarkConnected={() => setMcpMarked(true)}
      onClose={() => setModal(null)}
    />
  )

  return { start, hint, modal: modalEl, mcpConnected }
}
