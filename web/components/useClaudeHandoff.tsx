'use client'

import { useRef, useState, type ReactNode, type MouseEvent } from 'react'
import FixWithClaudeModal, { FIX_CHOICE_KEY, type FixChoice } from '@/components/FixWithClaudeModal'

// Shared "do this with Claude" hand-off, used by Growth Path checks and the Today page.
// start() shows the FixWithClaudeModal (GrowJin MCP first, or Claude Code with a plain prompt),
// unless the user remembered a choice, in which case it opens Claude straight away. Every
// hand-off also copies the prompt, and hint(key) renders the "Opened Claude… / Change how I fix"
// line under the button that started it.
//
// Fixes open in Claude Code (claude.ai/code, or the Claude Code app on this computer), with the
// prompt typed in and the website's repo selected — not in a Claude chat. GrowJin keeps one
// Claude tab: a second fix goes to the tab it already opened instead of opening another.

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
let claudeTab: Window | null = null
// claude.ai may cut the link between tabs (browser isolation). Then we can't reach or even see the
// tab we opened, so we don't open another automatically: the hint offers it instead.
let claudeTabUnreachable = false

/** Opens Claude Code on the web in GrowJin's Claude tab. 'kept' = a Claude tab is already open and we can't reach it. */
function openClaudeTab(url: string, force = false): 'opened' | 'reused' | 'kept' {
  if (claudeTab && !claudeTab.closed) {
    window.open(url, CLAUDE_TAB)
    try { claudeTab.focus() } catch { /* focus is best effort */ }
    return 'reused'
  }
  if (claudeTabUnreachable && !force) return 'kept'
  const w = window.open(url, CLAUDE_TAB)
  if (!w) return 'opened' // popup blocked: the hint still offers the link
  claudeTab = w
  claudeTabUnreachable = false
  // If the tab reads as closed within seconds of loading, the browser isolated it from us
  // (nobody closes it that fast), so later fixes mustn't open more tabs
  let checks = 0
  const watch = window.setInterval(() => {
    checks++
    if (claudeTab !== w) return window.clearInterval(watch)
    if (w.closed) { claudeTab = null; claudeTabUnreachable = true; window.clearInterval(watch) }
    else if (checks >= 15) window.clearInterval(watch)
  }, 1000)
  return 'opened'
}
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
  // via: web = Claude Code on the web, app = Claude Code on this computer; kept = a Claude tab is already open
  const [last, setLast] = useState<{ key: string; prompt: string; via: 'web' | 'app'; tab?: 'opened' | 'reused' | 'kept' } | null>(null)
  const lastArgs = useRef<HandoffArgs | null>(null)
  // Connected = a Claude client has actually used GrowJin's MCP (or the user just said they connected it).
  const mcpConnected = !!mcpLastUsedAt || mcpMarked

  const run = (choice: FixChoice, args: HandoffArgs) => {
    const text = choice === 'code' ? args.plain : args.mcp
    void copyText(text)
    // 'mcp' = Claude Code on the web (also on phones); 'mcp-code' / 'code' = the Claude Code app here
    const via = choice === 'mcp' || isPhone() ? 'web' : 'app'
    if (via === 'web') {
      const tab = openClaudeTab(claudeCodeWebUrl(text, githubRepo))
      setLast({ key: args.key, prompt: text, via, tab })
      // A tab we couldn't reuse keeps its hint until the user acts on it
      if (tab !== 'kept') window.setTimeout(() => setLast(prev => (prev?.key === args.key && prev.prompt === text ? null : prev)), 12000)
    } else {
      setLast({ key: args.key, prompt: text, via })
      window.setTimeout(() => setLast(prev => (prev?.key === args.key && prev.prompt === text ? null : prev)), 12000)
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
    const webUrl = claudeCodeWebUrl(last.prompt, githubRepo)
    const openAnyway = (e: MouseEvent) => {
      e.preventDefault(); e.stopPropagation()
      openClaudeTab(webUrl, true)
      setLast(prev => (prev ? { ...prev, tab: 'opened' } : prev))
    }
    return (
      <p className="sm-claude-hint" role="status">
        {last.via === 'app' && <>Opened the Claude Code app, prompt copied too. Nothing opened? <a href={webUrl} onClick={openAnyway}>Use Claude Code on the web</a>{' · '}</>}
        {last.via === 'web' && last.tab === 'kept' && <>Claude Code is already open in another tab. The fix is copied: start a new session there and paste it (Ctrl+V). <a href={webUrl} onClick={openAnyway}>Open it in a new tab instead</a>{' · '}</>}
        {last.via === 'web' && last.tab === 'reused' && <>Sent to your open Claude Code tab, prompt copied too.{' '}</>}
        {last.via === 'web' && last.tab === 'opened' && <>Opened Claude Code, prompt copied too. Nothing opened? <a href={webUrl} onClick={openAnyway}>Open Claude Code</a>{' · '}</>}
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
