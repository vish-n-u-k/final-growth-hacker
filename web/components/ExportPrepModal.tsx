'use client'

import React, { useState } from 'react'

interface Props {
  moduleName: string
  onDownload: () => Promise<void>
  onSkip: () => void
  onMarkConnected: () => void
}

const MCP_URL = 'https://app.growjin.com/api/mcp'

export default function ExportPrepModal({ moduleName, onDownload, onSkip, onMarkConnected }: Props) {
  const [mcpOpen, setMcpOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)

  const handleDownload = async () => {
    setDownloading(true)
    try {
      await onDownload()
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
      }}
    >
      <div
        style={{
          background: 'var(--card)', border: '1px solid var(--line)',
          borderRadius: 16, width: '100%', maxWidth: '460px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '22px 24px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-display)', lineHeight: 1.2 }}>
              Export — {moduleName}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 5, lineHeight: 1.5 }}>
              Choose how you want to action these items
            </div>
          </div>
          <button
            onClick={onSkip}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '2px 4px', flexShrink: 0 }}
          >×</button>
        </div>

        {/* Options */}
        <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Option 1: Solve with Claude MCP */}
          <div style={{ border: `1px solid ${mcpOpen ? 'rgba(47,191,113,0.4)' : 'var(--line)'}`, borderRadius: 10, overflow: 'hidden', transition: 'border-color 0.15s' }}>
            <button
              onClick={() => setMcpOpen(v => !v)}
              style={{
                width: '100%', padding: '14px 16px', background: mcpOpen ? 'rgba(47,191,113,0.06)' : 'rgba(255,255,255,0.02)',
                border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14,
                fontFamily: 'inherit', transition: 'background 0.15s',
              }}
            >
              <div style={{ width: 38, height: 38, borderRadius: 9, background: 'rgba(47,191,113,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="3" width="18" height="18" rx="2" stroke="var(--green)" strokeWidth="2"/>
                  <path d="M8 12l3 3 5-5" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div style={{ flex: 1, textAlign: 'left' }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>Solve with Claude MCP</div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>Connect Claude to your GrowJin data — ask questions live, no file needed</div>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ transform: mcpOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
                <path d="M6 9l6 6 6-6" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            {mcpOpen && (
              <div style={{ borderTop: '1px solid rgba(47,191,113,0.15)', padding: '16px', background: 'rgba(47,191,113,0.03)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Connect via Claude.ai Connectors
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {([
                    <>Go to <a href="https://claude.ai" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--green)', textDecoration: 'none' }}>claude.ai</a> → Settings → Connectors → Add</>,
                    <>Set Name to <code style={{ fontSize: 11, background: 'var(--bg)', padding: '1px 5px', borderRadius: 3, color: 'var(--text)' }}>GrowJin</code> and paste the URL below into the server URL field</>,
                    <>Click Add — you&apos;ll be redirected to log in and it connects automatically</>,
                  ] as React.ReactNode[]).map((text, i) => (
                    <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                      <span style={{ width: 19, height: 19, borderRadius: '50%', background: 'var(--green)', color: '#0a1410', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>{i + 1}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.55 }}>{text}</span>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg)', borderRadius: 7, padding: '9px 12px', border: '1px solid var(--line)' }}>
                  <code style={{ flex: 1, fontSize: 11, color: 'var(--text)', wordBreak: 'break-all' }}>{MCP_URL}</code>
                  <button
                    onClick={async () => { await navigator.clipboard.writeText(MCP_URL); setCopiedUrl(true); setTimeout(() => setCopiedUrl(false), 2000) }}
                    style={{ fontSize: 11, color: copiedUrl ? 'var(--green)' : 'var(--text-dim)', background: 'transparent', border: '1px solid var(--line)', borderRadius: 5, padding: '3px 9px', cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit' }}
                  >{copiedUrl ? 'Copied' : 'Copy'}</button>
                </div>

                <button
                  onClick={() => { onMarkConnected(); onSkip() }}
                  style={{
                    alignSelf: 'flex-start', fontSize: 12, fontWeight: 600,
                    color: 'var(--green-bright)', background: 'rgba(47,191,113,0.1)',
                    border: '1px solid rgba(47,191,113,0.3)', borderRadius: 7,
                    padding: '7px 14px', cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  Already connected with MCP server
                </button>
              </div>
            )}
          </div>

          {/* Option 2: Download .md */}
          <button
            onClick={handleDownload}
            disabled={downloading}
            style={{
              width: '100%', padding: '14px 16px', background: 'rgba(255,255,255,0.02)',
              border: '1px solid var(--line)', borderRadius: 10,
              cursor: downloading ? 'default' : 'pointer', display: 'flex', alignItems: 'center',
              gap: 14, fontFamily: 'inherit', opacity: downloading ? 0.85 : 1,
              transition: 'border-color 0.15s',
            }}
            onMouseEnter={e => { if (!downloading) e.currentTarget.style.borderColor = 'var(--text-dim)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)' }}
          >
            <div style={{ width: 38, height: 38, borderRadius: 9, background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {downloading ? (
                <span style={{ display: 'inline-block', width: 15, height: 15, border: '2px solid rgba(255,255,255,0.15)', borderTopColor: 'var(--text-dim)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              ) : (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>
                {downloading ? 'Preparing your file…' : 'Download .md file'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                {downloading ? 'Running analysis — this takes a few seconds' : 'Full action plan as a Markdown file'}
              </div>
            </div>
          </button>

        </div>
      </div>
    </div>
  )
}
