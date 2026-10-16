'use client'

// Time picker that replaces the browser's scroll wheel: tap an hour, a minute and AM/PM.
// value / onChange use 24-hour "HH:MM", like <input type="time">.

import { useRef, useState } from 'react'
import { Clock } from 'lucide-react'
import { Popover } from '@/components/ui/popover'

const pad = (n: number) => String(n).padStart(2, '0')
const parse = (v: string) => {
  const [h, m] = (v || '09:00').split(':').map(Number)
  return { h: Number.isFinite(h) ? h : 9, m: Number.isFinite(m) ? m : 0 }
}
export const formatTime = (v: string) => {
  const { h, m } = parse(v)
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`
}

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]
const PRESETS = ['09:00', '12:00', '15:00', '18:00', '20:00']

export default function TimeField({ value, onChange, disabled, className, style, ariaLabel = 'Time' }: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  className?: string
  style?: React.CSSProperties
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const { h, m } = parse(value)
  const pm = h >= 12
  const h12 = h % 12 || 12

  const set = (hour24: number, minute: number) => onChange(`${pad(hour24)}:${pad(minute)}`)
  const setHour = (hr12: number) => set((hr12 % 12) + (pm ? 12 : 0), m)
  const setPm = (toPm: boolean) => set((h % 12) + (toPm ? 12 : 0), m)

  return (
    <div className="pk-wrap">
      <button ref={trigger} type="button" className={`pk-trigger ${className ?? ''}`} style={style} disabled={disabled}
        aria-label={`${ariaLabel}: ${formatTime(value)}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Clock size={14} aria-hidden="true" />
        <span className="pk-trigger-text">{formatTime(value)}</span>
      </button>
      <Popover anchor={trigger} open={open} onClose={() => setOpen(false)} width={290} className="pk-pop--time" label={ariaLabel}>
          <div className="pk-presets">
            {PRESETS.map(p => (
              <button key={p} type="button" className={`pk-chip${p === value ? ' is-on' : ''}`} onClick={() => { onChange(p); setOpen(false) }}>{formatTime(p)}</button>
            ))}
          </div>
          <div className="pk-time-hd">
            <span className="pk-label">Hour</span>
            <div className="pk-seg" role="group" aria-label="AM or PM">
              <button type="button" className={!pm ? 'is-on' : ''} aria-pressed={!pm} onClick={() => setPm(false)}>AM</button>
              <button type="button" className={pm ? 'is-on' : ''} aria-pressed={pm} onClick={() => setPm(true)}>PM</button>
            </div>
          </div>
          <div className="pk-grid pk-grid--6">
            {HOURS.map(hr => <button key={hr} type="button" className={hr === h12 ? 'is-on' : ''} aria-pressed={hr === h12} onClick={() => setHour(hr)}>{hr}</button>)}
          </div>
          <span className="pk-label">Minute</span>
          <div className="pk-grid pk-grid--6">
            {MINUTES.map(mi => <button key={mi} type="button" className={mi === m ? 'is-on' : ''} aria-pressed={mi === m} onClick={() => set(h, mi)}>:{pad(mi)}</button>)}
          </div>
          <div className="pk-time-foot">
            <span className="pk-time-now">{formatTime(value)}</span>
            <button type="button" className="pk-done" onClick={() => setOpen(false)}>Done</button>
          </div>
      </Popover>
    </div>
  )
}
