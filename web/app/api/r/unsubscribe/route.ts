import { NextRequest, NextResponse } from 'next/server'
import { isValidUnsubSig, unsubscribeBrand } from '@/lib/email/lifecycle'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function page(title: string, text: string, status = 200) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:64px 16px;background:#f2f4f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;text-align:center;color:#1a2e20;">
<div style="max-width:440px;margin:0 auto;background:#fff;border:1px solid #e0e8e3;border-radius:10px;padding:32px 28px;">
<h1 style="margin:0 0 10px;font-size:20px;">${title}</h1><p style="margin:0;font-size:15px;line-height:1.6;color:#5d7166;">${text}</p></div></body></html>`
  return new NextResponse(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

// "Unsubscribe" link in the win-back emails. Public (no login): the link is signed per brand.
// Only stops marketing emails; account and billing emails still go out.
async function handle(req: NextRequest) {
  const brandId = req.nextUrl.searchParams.get('b') ?? ''
  const sig = req.nextUrl.searchParams.get('s') ?? ''
  if (!UUID.test(brandId) || !isValidUnsubSig(brandId, sig)) {
    return page('Link not valid', 'This unsubscribe link is broken or incomplete. Reply to any of our emails and we\'ll remove you by hand.', 400)
  }
  try {
    await unsubscribeBrand(brandId)
  } catch (e) {
    console.error('[unsubscribe] failed:', e instanceof Error ? e.message : e)
    return page('Something went wrong', 'We couldn\'t save that just now. Please try the link again in a minute.', 500)
  }
  return page('You\'re unsubscribed', 'You won\'t get any more "come back" emails from GrowJin. Account and billing emails will still reach you.')
}

export const GET = handle
export const POST = handle
