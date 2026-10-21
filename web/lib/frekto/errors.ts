// Plain-language Frekto errors: what went wrong and what to do next, instead of
// "Frekto rejected request (422): {...}" or "Render failed". The raw detail is logged for debugging.

const CONNECT_HINT = 'Go to Settings → Integrations → Frekto and check the API key.'

/** Pulls a human message out of a Frekto error body (JSON {error|message|detail} or short text). */
function bodyMessage(body: string): string | null {
  const text = body.trim()
  if (!text) return null
  try {
    const j = JSON.parse(text) as Record<string, unknown>
    const pick = (v: unknown): string | null => {
      if (typeof v === 'string' && v.trim()) return v.trim()
      if (Array.isArray(v)) {
        // FastAPI-style validation errors: [{ loc: [...], msg: '...' }]
        const msgs = v.map(e => {
          if (typeof e === 'string') return e
          if (!e || typeof e !== 'object' || !('msg' in e)) return ''
          const { msg, loc } = e as { msg: unknown; loc?: unknown }
          const field = Array.isArray(loc) && loc.length ? String(loc[loc.length - 1]) : null
          return field ? `${field}: ${String(msg)}` : String(msg)
        }).filter(Boolean)
        return msgs.length ? msgs.join('; ') : null
      }
      if (v && typeof v === 'object') return pick((v as Record<string, unknown>).message)
      return null
    }
    return pick(j.error) ?? pick(j.message) ?? pick(j.detail)
  } catch {
    // An HTML error page says nothing useful to a user
    return /^<(!doctype|html)/i.test(text) ? null : text.slice(0, 200)
  }
}

/** Message for a non-OK HTTP response from Frekto. `action` reads as "create the post", "start the series", ... */
export function frektoHttpError(status: number, body: string, action = 'handle the request'): string {
  const detail = bodyMessage(body)
  console.error(`[frekto] ${action} failed (${status}):`, body.slice(0, 1000))
  if (status === 401 || status === 403) return `Frekto didn't accept GrowJin's API key, so it couldn't ${action}. ${CONNECT_HINT}`
  if (status === 402) return `Frekto couldn't ${action}: your Frekto plan is out of credits${detail ? ` (${detail})` : ''}. Top up in Frekto and try again.`
  if (status === 404) return `Frekto couldn't find what it needed to ${action}${detail ? `: ${detail}` : ''}. It may have been deleted in Frekto.`
  if (status === 429) return `Frekto is limiting requests right now, so it couldn't ${action}. Wait a minute and try again.`
  if (status >= 500) return `Frekto had a problem on its side and couldn't ${action} (error ${status}). Try again in a few minutes.`
  return `Frekto couldn't ${action}: ${detail ?? `it rejected the request (error ${status})`}.`
}

/** Reads the body of a failed response and builds the message. */
export async function frektoResponseError(res: Response, action?: string): Promise<string> {
  const body = await res.text().catch(() => '')
  return frektoHttpError(res.status, body, action)
}

/** Message when Frekto can't be reached at all (DNS, timeout, connection reset). */
export function frektoNetworkError(e: unknown, action = 'handle the request'): string {
  console.error(`[frekto] could not reach Frekto to ${action}:`, e)
  const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
  return timedOut
    ? `Frekto took too long to respond, so it couldn't ${action}. Try again in a minute.`
    : `GrowJin couldn't reach Frekto to ${action}. Frekto may be down; try again in a few minutes.`
}

/** Message for a render/series job Frekto marked failed. `error` is Frekto's own reason, if it gave one. */
export function frektoJobFailed(error: string | null | undefined, what = 'post'): string {
  if (error?.trim()) return `Frekto couldn't make this ${what}: ${error.trim()}`
  return `Frekto couldn't make this ${what} and didn't say why. Try again, or try a different topic or format.`
}

/** Message when checking on a job's progress failed. */
export function frektoPollError(status: number): string {
  if (status === 401 || status === 403) return `Frekto stopped accepting GrowJin's API key while checking on this. ${CONNECT_HINT}`
  if (status === 404) return 'Frekto no longer has this job. It may have been deleted in Frekto; try again.'
  return `GrowJin couldn't check on this in Frekto (error ${status}). Refresh in a minute to see if it finished.`
}
