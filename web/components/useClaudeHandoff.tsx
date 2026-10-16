'use client'

import { useRef, useState, type ReactNode, type MouseEvent } from 'react'
import FixWithClaudeModal, { FIX_CHOICE_KEY, type FixChoice } from '@/components/FixWithClaudeModal'

// Shared "do this with Claude" hand-off, used by Growth Path checks and the Today page.
// start() shows the FixWithClaudeModal (GrowJin MCP first, or a plain prompt), unless the user
// remembered a choice, in which case it opens Claude straight away. Every hand-off also copies the
// prompt, and hint(key) renders what happened under the button that started it.
//
// Fixes open in Claude Code on the web (claude.ai/code) with the prompt typed in and the website's
// repo selected. GrowJin tries to keep one Claude tab: a second fix goes to the tab it opened.
// claude.ai usually cuts the link between tabs, though, so GrowJin then can't see that tab or tell
// whether it was closed. It doesn't pretend to: it says the fix is copied for the tab you may still
// have open, and offers a new tab. After 20 minutes, or once you choose "always open a new tab",
// it just opens a new one.

export interface HandoffArgs {
  key: string    // identifies the button, so the hint shows under the right one
  label: string  // shown in the popup ("Fix this with Claude: <label>")
  plain: string  // full prompt for Claude Code without the GrowJin MCP
  mcp: string    // prompt that uses the GrowJin MCP tools
  title?: string // popup title; defaults to "Fix this with Claude"
}

// Which repo to work in: people often have many GitHub repos connected to Claude, so name the
// website's (from GrowJin's GitHub integration) or have Claude ask rather than guess.
export const repoLine = (githubRepo: string | null | undefined) => githubRepo
  ? `My website's code is in the GitHub repo ${githubRepo}. Make changes in that repo only.`
  : 'If you can\'t tell which repo or folder holds my website\'s code, ask me before changing anything.'

// Claude Code on the web, prefilled (https://code.claude.com/docs/en/web-quickstart#pre-fill-sessions)
export const claudeCodeWebUrl = (text: string, repo?: string | null) =>
  `https://claude.ai/code?prompt=${encodeURIComponent(text.slice(0, 6000))}${repo ? `&repositories=${encodeURIComponent(repo)}` : ''}`

// The one Claude tab GrowJin opens. Kept for the life of this page so later fixes reuse it.
const CLAUDE_TAB = 'growjin-claude'
const NEW_TAB_KEY = 'growjin_claude_new_tab' // '1' = always open a new tab
const KEEP_MS = 20 * 60 * 1000 // after this, assume the old tab is gone
let claudeTab: Window | null = null
// The browser isolated the tab we opened: we can't reach it, see it or tell if it's closed
let claudeTabUnreachable = false
let lastOpenedAt = 0

/**
 * Opens Claude Code on the web in GrowJin's Claude tab.
 * reused = sent to the tab we opened; kept = we may still have an (unreachable) Claude tab open,
 * so nothing was opened; opened = a new tab.
 */
function openClaudeTab(url: string, force = false): 'opened' | 'reused' | 'kept' {
  if (claudeTab && !claudeTab.closed) {
    window.open(url, CLAUDE_TAB)
    try { claudeTab.focus() } catch { /* focus is best effort */ }
    lastOpenedAt = Date.now()
    return 'reused'
  }
  const recent = Date.now() - lastOpenedAt < KEEP_MS
  if (claudeTabUnreachable && recent && !force && readLocal(NEW_TAB_KEY) !== '1') return 'kept'
  const w = window.open(url, CLAUDE_TAB)
  lastOpenedAt = Date.now()
  if (!w) return 'opened' // popup blocked: the hint still offers the link
  claudeTab = w
  claudeTabUnreachable = false
  // If the tab reads as closed within seconds of loading, the browser isolated it from us
  // (nobody closes it that fast), so the next fix asks instead of piling up tabs
  let checks = 0
  const watch = window.setInterval(() => {
    checks++
    if (claudeTab !== w) return window.clearInterval(watch)
    if (w.closed) { claudeTab = null; claudeTabUnreachable = true; window.clearInterval(watch) }
    else if (checks >= 15) window.clearInterval(watch)
  }, 1000)
  return 'opened'
}
const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
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
  const [last, setLast] = useState<{ key: string; prompt: string; tab: 'opened' | 'reused' | 'kept' } | null>(null)
  const lastArgs = useRef<HandoffArgs | null>(null)
  // Connected = a Claude client has actually used GrowJin's MCP (or the user just said they connected it).
  const mcpConnected = !!mcpLastUsedAt || mcpMarked

  // Hide the hint after a while, unless it's asking the user something ('kept')
  const autoHide = (key: string, prompt: string) =>
    window.setTimeout(() => setLast(prev => (prev?.key === key && prev.prompt === prompt && prev.tab !== 'kept' ? null : prev)), 12000)

  const run = (choice: FixChoice, args: HandoffArgs) => {
    const text = choice === 'code' ? args.plain : args.mcp
    void copyText(text)
    const tab = openClaudeTab(claudeCodeWebUrl(text, githubRepo))
    setLast({ key: args.key, prompt: text, tab })
    if (tab !== 'kept') autoHide(args.key, text)
  }

  const start = (args: HandoffArgs) => {
    lastArgs.current = args
    const raw = readLocal(FIX_CHOICE_KEY)
    const saved: FixChoice | null = raw === 'code' ? 'code' : raw === 'mcp' || raw === 'mcp-code' ? 'mcp' : null
    if (saved === 'code' || (saved === 'mcp' && mcpConnected)) run(saved, args)
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
    const webUrl = claudeCodeWebUrl(last.prompt, githubRepo)
    const openNew = (e: MouseEvent, always = false) => {
      e.preventDefault(); e.stopPropagation()
      if (always) writeLocal(NEW_TAB_KEY, '1')
      openClaudeTab(webUrl, true)
      setLast(prev => (prev ? { ...prev, tab: 'opened' } : prev))
      autoHide(last.key, last.prompt)
    }
    const change = <button type="button" className="sm-claude-change" onClick={(e) => { e.stopPropagation(); changeChoice() }}>Change how I fix</button>

    // We may still have a Claude tab from the last fix but can't see it: say so plainly, let them choose
    if (last.tab === 'kept') {
      return (
        <div className="sm-claude-callout" role="status" onClick={(e) => e.stopPropagation()}>
          <p className="sm-claude-callout-title">Fix copied. Paste it into your Claude Code tab</p>
          <p className="sm-claude-callout-text">
            You opened Claude Code for an earlier fix, so GrowJin didn&apos;t open another tab. If it&apos;s still open,
            switch to it, start a new session and paste ({isMac() ? '⌘V' : 'Ctrl+V'}). Closed it? Open a new one.
          </p>
          <div className="sm-claude-callout-actions">
            <a href={webUrl} className="sm-claude-callout-btn" onClick={(e) => openNew(e)}>Open a new Claude Code tab</a>
            <button type="button" className="sm-claude-change" onClick={(e) => openNew(e, true)}>Always open a new tab</button>
            {change}
          </div>
        </div>
      )
    }
    return (
      <p className="sm-claude-hint" role="status">
        {last.tab === 'reused' && <>Sent to your Claude Code tab with the fix typed in (also copied). Switch to that tab to see it.{' '}</>}
        {last.tab === 'opened' && <>Opened Claude Code in a new tab with the fix typed in (also copied). Nothing opened? <a href={webUrl} onClick={(e) => openNew(e)}>Open Claude Code</a>{' · '}</>}
        {change}
      </p>
    )
  }

  const modalEl: ReactNode = modal && (
    <FixWithClaudeModal
      title={modal.title}
      itemLabel={modal.label}
      mcpConnected={mcpConnected}
      mcpLastUsedAt={mcpLastUsedAt}
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
