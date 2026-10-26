import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { reminders } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { verifyReminderToken } from '@/lib/reminders/token'
import { completeReminder } from '@/lib/reminders/complete'
import { withUtm } from '@/lib/email/clean'

export const dynamic = 'force-dynamic'

// "Mark done" link in the daily email. GET only shows a confirm page — email security
// scanners open every link, so a GET that changed state would tick reminders nobody did.
// The confirm button POSTs back here. The signed token is the auth (no session needed).

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.growjin.com'
// People land here from the daily email, so the links into the app carry its UTM tags
const remindersUrl = () => withUtm(`${appUrl()}/reminders`, 'daily_digest')

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

function page(body: string, status = 200): NextResponse {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>GrowJin reminder</title>
<style>body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#f6f7f9;color:#111827;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:28px;max-width:420px;width:100%;box-sizing:border-box}
h1{font-size:18px;margin:0 0 8px}p{margin:0 0 20px;color:#4b5563;font-size:14px;line-height:1.5}
button{background:#f97316;color:#fff;border:0;border-radius:8px;padding:11px 18px;font-size:14px;font-weight:600;cursor:pointer}
a{color:#6b7280;font-size:13px;margin-left:14px}
@media(prefers-color-scheme:dark){body{background:#0f1115;color:#f3f4f6}.card{background:#181b21;border-color:#2a2f38}p{color:#9ca3af}}</style>
</head><body><div class="card">${body}</div></body></html>`
  return new NextResponse(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

async function load(token: string | null) {
  const payload = token ? verifyReminderToken(token) : null
  if (!payload) return null
  const [row] = await db.select({ id: reminders.id, brandId: reminders.brandId, title: reminders.title })
    .from(reminders)
    .where(eq(reminders.id, payload.reminderId))
    .limit(1)
  if (!row || row.brandId !== payload.brandId) return null
  return row
}

const invalid = () => page(
  `<h1>This link has expired</h1><p>Reminder links in the daily email work for 7 days. Open your reminders to mark it done there.</p>
<a href="${esc(remindersUrl())}" style="margin:0">Open reminders →</a>`,
  410,
)

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  const row = await load(token)
  if (!row) return invalid()
  return page(
    `<h1>Mark this reminder done?</h1><p>${esc(row.title)}</p>
<form method="post"><input type="hidden" name="token" value="${esc(token!)}"><button type="submit">Yes, mark done</button><a href="${esc(remindersUrl())}">Not yet</a></form>`,
  )
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null)
  const token = (form?.get('token') as string | null) ?? req.nextUrl.searchParams.get('token')
  const row = await load(token)
  if (!row) return invalid()
  await completeReminder(row.brandId, row.id)
  return NextResponse.redirect(withUtm(new URL('/reminders?done=1', appUrl()).toString(), 'daily_digest'), 303)
}
