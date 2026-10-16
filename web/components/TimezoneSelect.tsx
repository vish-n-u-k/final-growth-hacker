'use client'

// Timezone picker: every IANA zone with its current UTC offset, the device's zone first.
// The list is built after mount (Intl data differs between server and browser).

import { useEffect, useState } from 'react'

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

let ALL: string[] | null = null
function allZones(): string[] {
  if (!ALL) {
    let list: string[] = []
    try { list = (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone') } catch { /* old browser */ }
    ALL = ['UTC', ...list.filter(z => z !== 'UTC')]
  }
  return ALL
}

const label = (tz: string) => `${tz.replace(/_/g, ' ')}${tz === 'UTC' ? '' : ` (${utcOffset(tz)})`}`

export default function TimezoneSelect({ value: raw, onChange, disabled, style, ariaLabel = 'Timezone', compact }: {
  value: string
  onChange: (tz: string) => void
  disabled?: boolean
  style?: React.CSSProperties
  ariaLabel?: string
  compact?: boolean // next to a date/time: no "your device" wording
}) {
  const value = canonicalTimezone(raw)
  const [zones, setZones] = useState<string[] | null>(null)
  const [device, setDevice] = useState<string | null>(null)
  useEffect(() => { setZones(allZones()); setDevice(deviceTimezone()) }, [])

  return (
    <select value={value} onChange={e => onChange(e.target.value)} disabled={disabled} aria-label={ariaLabel} style={style}>
      {!zones ? (
        <option value={value}>{value.replace(/_/g, ' ')}</option>
      ) : (
        <>
          {!compact && device && device !== value && <option value={device}>Your device: {label(device)}</option>}
          {!zones.includes(value) && <option value={value}>{label(value)}</option>}
          {zones.map(z => <option key={z} value={z}>{z === device && !compact ? `${label(z)} · your device` : label(z)}</option>)}
        </>
      )}
    </select>
  )
}
