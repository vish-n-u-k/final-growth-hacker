'use client'

import { useState } from 'react'

const split = (v: string) => v.split(/\s*,\s*/).map(s => s.trim()).filter(Boolean)
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/**
 * Pick one or more options as chips, plus "Other" for your own words.
 * The value stays a comma-separated string, so saved settings and the
 * search prompt read it exactly as before.
 */
export function MultiPick({ label, value, options, onChange, otherHint = 'Add your own' }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void; otherHint?: string
}) {
  const picked = split(value)
  const extras = picked.filter(p => !options.some(o => same(o, p)))
  const [draft, setDraft] = useState('')
  const has = (o: string) => picked.some(p => same(p, o))
  const toggle = (o: string) => onChange((has(o) ? picked.filter(p => !same(p, o)) : [...picked, o]).join(', '))
  const add = () => {
    const words = split(draft).filter(w => !has(w))
    if (words.length) onChange([...picked, ...words].join(', '))
    setDraft('')
  }
  return (
    <div className="lfp-field" role="group" aria-label={label}>
      <span>{label}</span>
      <div className="lfp-pick">
        {[...options, ...extras].map(o => (
          <button key={o} type="button" className={`lfp-chip${has(o) ? ' on' : ''}`} aria-pressed={has(o)} onClick={() => toggle(o)}>
            {has(o) && <span aria-hidden>✓ </span>}{o}
          </button>
        ))}
        <input className="lfp-chip-add" value={draft} placeholder={`+ ${otherHint}`}
          onChange={ev => setDraft(ev.target.value)} onBlur={add}
          onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ',') { ev.preventDefault(); add() } }} />
      </div>
    </div>
  )
}

/** A plain dropdown of numbers; keeps an existing value that isn't in the list. */
export function NumberSelect({ label, value, options, onChange, suffix = '' }: {
  label: string; value: number; options: number[]; onChange: (n: number) => void; suffix?: string
}) {
  const list = options.includes(value) ? options : [...options, value].sort((a, b) => a - b)
  return (
    <label className="lfp-field">{label}
      <select className="lfp-select" value={value} onChange={ev => onChange(Number(ev.target.value))}>
        {list.map(n => <option key={n} value={n}>{n}{suffix}</option>)}
      </select>
    </label>
  )
}
