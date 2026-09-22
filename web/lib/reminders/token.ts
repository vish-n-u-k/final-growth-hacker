import { createHmac, timingSafeEqual } from 'crypto'

interface TokenPayload {
  reminderId: string
  brandId: string
  exp: number
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url')
}

function secret(): string {
  return process.env.CRON_SECRET ?? 'dev-secret'
}

export function signReminderToken(reminderId: string, brandId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ reminderId, brandId, exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600 }),
  ).toString('base64url')
  const sig = b64url(createHmac('sha256', secret()).update(payload).digest())
  return `${payload}.${sig}`
}

export function verifyReminderToken(token: string): TokenPayload | null {
  try {
    const dot = token.lastIndexOf('.')
    if (dot < 0) return null
    const payload = token.slice(0, dot)
    const sig = token.slice(dot + 1)
    const expected = b64url(createHmac('sha256', secret()).update(payload).digest())
    if (sig.length !== expected.length) return null
    if (!timingSafeEqual(Buffer.from(sig, 'ascii'), Buffer.from(expected, 'ascii'))) return null
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as TokenPayload
    if (data.exp < Math.floor(Date.now() / 1000)) return null
    return data
  } catch { return null }
}
