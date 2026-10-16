'use client'

// Timezone picker with search: every IANA zone with its current UTC offset, the device's zone
// first. Type a city, country, abbreviation (IST, PST…) or offset (+5:30). The list is built after
// mount (Intl data differs between server and browser).

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { Popover } from '@/components/ui/popover'

// Old names some browsers still report, and the names in today's list
const RENAMED: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Saigon': 'Asia/Ho_Chi_Minh', 'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon', 'Europe/Kiev': 'Europe/Kyiv', 'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'Pacific/Truk': 'Pacific/Chuuk', 'Atlantic/Faeroe': 'Atlantic/Faroe',
}
export const canonicalTimezone = (tz: string) => RENAMED[tz] ?? tz

export const deviceTimezone = (): string | null => {
  try { const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; return tz ? canonicalTimezone(tz) : null } catch { return null }
}

/** "UTC+5:30" for a zone right now */
export function utcOffset(tz: string): string {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
      .formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value ?? ''
    return name === 'GMT' ? 'UTC' : name.replace('GMT', 'UTC')
  } catch { return '' }
}

// Words people search for that aren't in the zone's name
const KEYWORDS: Record<string, string> = {
  'Asia/Kolkata': 'india ist mumbai delhi bangalore bengaluru chennai hyderabad',
  'America/New_York': 'est edt eastern et usa us new york',
  'America/Chicago': 'cst cdt central ct usa us texas',
  'America/Denver': 'mst mdt mountain mt usa us',
  'America/Los_Angeles': 'pst pdt pacific pt usa us california san francisco seattle',
  'Europe/London': 'gmt bst uk united kingdom britain england',
  'Europe/Berlin': 'cet cest germany',
  'Europe/Paris': 'cet cest france',
  'Asia/Dubai': 'gst uae emirates',
  'Asia/Singapore': 'sgt',
  'Asia/Tokyo': 'jst japan',
  'Australia/Sydney': 'aest aedt australia',
  'Asia/Karachi': 'pkt pakistan',
  'Asia/Dhaka': 'bangladesh',
  'Asia/Shanghai': 'china cst beijing',
  'Asia/Kathmandu': 'nepal npt',
  'America/Sao_Paulo': 'brazil brt',
  'Africa/Lagos': 'nigeria wat',
  'Africa/Nairobi': 'kenya eat',
  'America/Toronto': 'canada est',
  UTC: 'gmt coordinated universal',
}

type Zone = { tz: string; offset: string; label: string; hay: string; city: string; keys: string[] }
let ALL: Zone[] | null = null
function allZones(): Zone[] {
  if (!ALL) {
    let list: string[] = []
    try { list = (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone') } catch { /* old browser */ }
    // Browsers list some zones under old names (Chrome: Asia/Calcutta): use today's, once each
    const names = [...new Set(['UTC', ...list.map(canonicalTimezone)])]
    ALL = names.map(tz => {
      const offset = tz === 'UTC' ? 'UTC' : utcOffset(tz)
      const label = tz.replace(/_/g, ' ')
      const city = (tz.split('/').pop() ?? tz).replace(/_/g, ' ').toLowerCase()
      return { tz, offset, label, city, keys: (KEYWORDS[tz] ?? '').split(' ').filter(Boolean), hay: `${label} ${tz} ${offset} ${offset.replace('UTC', '')} ${KEYWORDS[tz] ?? ''}`.toLowerCase() }
    })
  }
  return ALL
}

export default function TimezoneSelect({ value: raw, onChange, disabled, style, className, ariaLabel = 'Timezone', compact }: {
  value: string
  onChange: (tz: string) => void
  disabled?: boolean
  style?: React.CSSProperties
  className?: string
  ariaLabel?: string
  compact?: boolean // next to a date/time: no "your device" wording on the button
}) {
  const value = canonicalTimezone(raw)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [device, setDevice] = useState<string | null>(null)
  const [offset, setOffset] = useState('')
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)

  useEffect(() => { setDevice(deviceTimezone()) }, [])
  useEffect(() => { setOffset(value === 'UTC' ? '' : utcOffset(value)) }, [value])

  const results = useMemo(() => {
    if (!open) return []
    const zones = allZones()
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const hits = words.length ? zones.filter(z => words.every(w => z.hay.includes(w))) : zones
    // Device zone and the current one first when not searching; when searching, best matches first:
    // a known word (IST, india) or the city name, then a city or word that starts with it
    if (words.length) {
      const query = words.join(' ')
      const score = (z: Zone) =>
        (z.keys.includes(query) || z.city === query ? 4 : 0)
        + (z.city.startsWith(query) ? 2 : 0)
        + (words.every(w => z.keys.some(k => k.startsWith(w)) || new RegExp(`(^|[ /])${w.replace(/[^a-z0-9+:]/g, '')}`).test(z.label.toLowerCase())) ? 1 : 0)
      return hits.map(z => [z, score(z)] as const).sort((a, b) => b[1] - a[1]).map(([z]) => z)
    }
    const top = [device, value].filter((t, i, a): t is string => !!t && a.indexOf(t) === i)
    return [...top.map(t => zones.find(z => z.tz === t) ?? { tz: t, offset: utcOffset(t), label: t.replace(/_/g, ' '), hay: '' }), ...hits.filter(z => !top.includes(z.tz))]
  }, [open, q, device, value])

  useEffect(() => { setActive(0) }, [q])
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const pick = (tz: string) => { setOpen(false); setQ(''); if (tz !== value) onChange(tz) }

  return (
    <div className="pk-wrap">
      <button
        ref={trigger} type="button" className={`pk-trigger ${className ?? ''}`} style={style} disabled={disabled}
        aria-label={`${ariaLabel}: ${value}`} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <span className="pk-trigger-text">
          {value.replace(/_/g, ' ')}{offset && <span className="pk-dim"> ({offset})</span>}
          {!compact && device === value && <span className="pk-dim"> · your device</span>}
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <Popover anchor={trigger} open={open} onClose={() => setOpen(false)} width={340} className="pk-pop--tz" label={ariaLabel}>
          <label className="pk-search">
            <Search size={14} aria-hidden="true" />
            <input
              autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search city, country, IST, +5:30…"
              aria-label="Search timezones" role="combobox" aria-expanded="true" aria-controls="pk-tz-list"
              onKeyDown={e => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
                else if (e.key === 'Enter') { e.preventDefault(); if (results[active]) pick(results[active].tz) }
                else if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
              }}
            />
          </label>
          <ul className="pk-list" id="pk-tz-list" role="listbox" ref={list}>
            {results.length === 0 && <li className="pk-empty">No timezone matches “{q}”</li>}
            {results.slice(0, 200).map((z, i) => (
              <li
                key={z.tz} data-i={i} role="option" aria-selected={z.tz === value}
                className={`pk-opt${i === active ? ' is-active' : ''}${z.tz === value ? ' is-on' : ''}`}
                onMouseEnter={() => setActive(i)} onMouseDown={e => e.preventDefault()} onClick={() => pick(z.tz)}
              >
                <span>{z.label}{z.tz === device && <span className="pk-tag">your device</span>}</span>
                <span className="pk-dim">{z.offset}</span>
              </li>
            ))}
          </ul>
      </Popover>
    </div>
  )
}
