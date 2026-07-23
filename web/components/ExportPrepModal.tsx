'use client'

import { useState } from 'react'

export interface ExportPrepItem {
  id: string
  label: string
  exportType: string
  choiceOptions: string[] | null
  userChoice: string | null
  aiDetail: string | null
  aiAction: string | null
  weight: number
}

interface Props {
  brandName: string
  moduleName: string
  items: ExportPrepItem[]
  classifying?: boolean
  onChoiceSave: (itemId: string, choice: string) => Promise<void>
  onDone: (localChoices: Record<string, string>, skippedIds: Set<string>) => void
  onSkip: () => void
}

function weightLabel(w: number) {
  return w === 3 ? 'Critical' : w === 2 ? 'Important' : 'Minor'
}

function weightColor(w: number) {
  return w === 3 ? '#ff8c42' : w === 2 ? '#e7c873' : 'var(--text-dim)'
}

export default function ExportPrepModal({ brandName, moduleName, items, classifying, onChoiceSave, onDone, onSkip }: Props) {
  const [localChoices, setLocalChoices] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.filter(i => i.userChoice).map(i => [i.id, i.userChoice!]))
  )
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({})
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  const needsChoiceItems = items.filter(i => i.exportType === 'needs_choice')

  const toggleSkip = (itemId: string) => {
    setSkippedIds(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  const handleGenerate = async () => {
    setSaving(true)
    try {
      const toSave = Object.entries(localChoices).filter(([id, v]) => v && !skippedIds.has(id))
      await Promise.all(toSave.map(([itemId, choice]) => onChoiceSave(itemId, choice)))
      onDone(localChoices, skippedIds)
    } finally {
      setSaving(false)
    }
  }

  const selectChip = (itemId: string, opt: string) => {
    setLocalChoices(prev => ({ ...prev, [itemId]: opt }))
    setCustomInputs(prev => ({ ...prev, [itemId]: '' }))
  }

  const handleCustomInput = (itemId: string, val: string) => {
    setCustomInputs(prev => ({ ...prev, [itemId]: val }))
    if (val) {
      setLocalChoices(prev => ({ ...prev, [itemId]: val }))
    } else {
      setLocalChoices(prev => {
        const next = { ...prev }
        delete next[itemId]
        return next
      })
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        style={{
          background: 'var(--card)', border: '1px solid var(--line)',
          borderRadius: '16px', width: '100%', maxWidth: '580px',
          maxHeight: '88vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '24px 24px 20px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
            <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-display)', lineHeight: 1.2 }}>
              Almost ready to export
            </div>
            <button
              onClick={onSkip}
              style={{
                background: 'transparent', border: 'none', color: 'var(--text-dim)',
                cursor: 'pointer', padding: '2px 4px', lineHeight: 1, fontSize: 18, flexShrink: 0,
              }}
              title="Close"
            >
              ×
            </button>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 }}>
            {classifying
              ? 'Analyzing which items need your input…'
              : needsChoiceItems.length > 0
              ? `Answer a few quick questions so Claude Code has everything it needs to implement ${moduleName} fixes for ${brandName} without asking questions.`
              : `Your Claude Code prompt is ready. Click Generate to copy it.`}
          </div>
          <div style={{ height: '1px', background: 'var(--line)', marginTop: 20 }} />
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '4px 24px 20px', flex: 1 }}>
          {/* Classifying spinner */}
          {classifying && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 0', color: 'var(--text-dim)', fontSize: 13 }}>
              <span style={{
                display: 'inline-block', width: 14, height: 14, flexShrink: 0,
                border: '2px solid rgba(255,255,255,0.1)', borderTopColor: 'var(--green)',
                borderRadius: '50%', animation: 'spin 0.7s linear infinite',
              }} />
              Figuring out what needs your input…
            </div>
          )}

          {/* Section: needs_choice */}
          {!classifying && needsChoiceItems.length > 0 && (
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14, marginTop: 16 }}>
                Choose values
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {needsChoiceItems.map(item => {
                  const selected = localChoices[item.id]
                  const customVal = customInputs[item.id] ?? ''
                  const isCustomSelected = selected && (!item.choiceOptions || !item.choiceOptions.includes(selected))
                  const isSkipped = skippedIds.has(item.id)
                  return (
                    <div
                      key={item.id}
                      style={{
                        background: isSkipped ? 'rgba(255,255,255,0.01)' : 'rgba(255,255,255,0.025)',
                        border: `1px solid ${isSkipped ? 'rgba(255,255,255,0.04)' : 'var(--line)'}`,
                        borderRadius: 10, padding: '14px 15px',
                        opacity: isSkipped ? 0.45 : 1, transition: 'opacity 0.15s',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: item.aiDetail ? 6 : 10 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', flex: 1, textDecoration: isSkipped ? 'line-through' : 'none' }}>{item.label}</span>
                        <span style={{
                          fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                          background: `${weightColor(item.weight)}18`,
                          color: weightColor(item.weight),
                          border: `1px solid ${weightColor(item.weight)}40`,
                          textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0,
                        }}>
                          {weightLabel(item.weight)}
                        </span>
                        <button
                          onClick={() => toggleSkip(item.id)}
                          style={{
                            background: 'transparent', border: '1px solid var(--line)', borderRadius: 5,
                            color: isSkipped ? 'var(--green)' : 'var(--text-dim)', cursor: 'pointer',
                            fontSize: 11, padding: '2px 8px', fontFamily: 'inherit', flexShrink: 0,
                          }}
                        >
                          {isSkipped ? 'Undo' : 'Skip'}
                        </button>
                      </div>
                      {item.aiDetail && !isSkipped && (
                        <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10, lineHeight: 1.55, margin: '0 0 10px' }}>
                          {item.aiDetail}
                        </p>
                      )}
                      {/* Option chips */}
                      {!isSkipped && item.choiceOptions && item.choiceOptions.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 8 }}>
                          {item.choiceOptions.map((opt, i) => {
                            const isSelected = selected === opt && !isCustomSelected
                            return (
                              <button
                                key={i}
                                onClick={() => selectChip(item.id, opt)}
                                style={{
                                  textAlign: 'left', padding: '8px 11px', borderRadius: 7, cursor: 'pointer',
                                  fontSize: 12.5, lineHeight: 1.5, transition: 'all 0.1s',
                                  border: isSelected ? '1px solid var(--green)' : '1px solid var(--line)',
                                  background: isSelected ? 'rgba(47,191,113,0.1)' : 'rgba(255,255,255,0.02)',
                                  color: isSelected ? 'var(--green-bright)' : 'var(--text)',
                                  fontFamily: 'inherit',
                                }}
                              >
                                {opt}
                              </button>
                            )
                          })}
                        </div>
                      )}
                      {/* Custom input */}
                      {!isSkipped && <input
                        type="text"
                        placeholder={item.choiceOptions?.length ? 'Or type your own…' : 'Enter your value…'}
                        value={customVal}
                        onChange={e => handleCustomInput(item.id, e.target.value)}
                        style={{
                          width: '100%', boxSizing: 'border-box',
                          background: isCustomSelected ? 'rgba(47,191,113,0.06)' : 'var(--bg)',
                          border: isCustomSelected ? '1px solid var(--green)' : '1px solid var(--line)',
                          borderRadius: 7, padding: '7px 10px', fontSize: 12.5,
                          color: 'var(--text)', fontFamily: 'inherit', outline: 'none',
                          transition: 'border-color 0.1s',
                        }}
                      />}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {!classifying && needsChoiceItems.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.65, marginTop: 16 }}>
              All pending items can be auto-implemented by Claude Code. Click Generate to copy your prompt.
            </p>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px 20px', flexShrink: 0,
          borderTop: '1px solid var(--line)',
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10,
        }}>
          <button
            onClick={onSkip}
            style={{
              fontSize: 13, color: 'var(--text-dim)', background: 'transparent',
              border: '1px solid var(--line)', borderRadius: 8, padding: '8px 16px',
              cursor: 'pointer', fontFamily: 'inherit', transition: 'border-color 0.12s, color 0.12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text-dim)'; e.currentTarget.style.color = 'var(--text)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--text-dim)' }}
          >
            Skip for now
          </button>
          <button
            onClick={handleGenerate}
            disabled={saving || classifying}
            style={{
              fontSize: 13, fontWeight: 600, color: '#06140c',
              background: (saving || classifying) ? 'rgba(47,191,113,0.6)' : 'var(--green)',
              border: 'none', borderRadius: 8, padding: '8px 18px',
              cursor: (saving || classifying) ? 'default' : 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 7, opacity: (saving || classifying) ? 0.8 : 1,
            }}
          >
            {saving ? (
              <>
                <span style={{
                  display: 'inline-block', width: 12, height: 12,
                  border: '2px solid rgba(6,20,12,0.25)', borderTopColor: '#06140c',
                  borderRadius: '50%', animation: 'spin 0.7s linear infinite',
                }} />
                Saving…
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M8 17l4 4 4-4M12 12v9M16 7h2a2 2 0 0 1 0 4h-2M8 11H6a2 2 0 0 1 0-4h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M8 7a4 4 0 0 1 8 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                Generate Claude Code Export
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
