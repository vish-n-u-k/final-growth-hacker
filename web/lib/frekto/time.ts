// Timezone helpers shared by the server and Social Studio (no server-only imports here)

export function validTimezone(tz: string | undefined | null): tz is string {
  if (!tz) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

// UTC instant → "YYYY-MM-DD" + "HH:MM" in the given timezone (what Frekto's schedule wants)
export function utcToZoned(d: Date, tz: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(d).map((p) => [p.type, p.value]),
  )
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

// "Tue, Oct 20, 9:00 AM" in the brand's timezone
export function formatInZone(iso: string | null, tz: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
