import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { analysisRequests, moduleItems, brands } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { getValidAdminGmailToken } from '@/lib/gmail/admin-token'

function buildNotificationEmail(opts: {
  moduleName: string
  brandName: string
  brandWebsiteUrl: string
  brandLogoUrl: string | null
  completedAt: Date
  aiPct: number
  dashboardUrl: string
}): string {
  const { moduleName, brandName, brandWebsiteUrl, brandLogoUrl, completedAt, aiPct, dashboardUrl } = opts

  const formattedDate = completedAt.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  const pctColor = aiPct >= 70 ? '#2fbf71' : aiPct >= 40 ? '#e7c873' : '#f87171'

  const brandLogoHtml = brandLogoUrl
    ? `<img src="${brandLogoUrl}" alt="${brandName}" width="32" height="32" style="width:32px;height:32px;border-radius:6px;object-fit:contain;vertical-align:middle;margin-right:10px;" />`
    : `<span style="display:inline-block;width:32px;height:32px;border-radius:6px;background:#e0e8e3;vertical-align:middle;margin-right:10px;"></span>`

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;padding:32px 16px 40px;background:#f2f4f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <tr><td align="center">

    <!-- GrowJin header mark -->
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;margin-bottom:14px;">
      <tr>
        <td style="padding:0 4px;">
          <img src="https://final-growth-hacker.vercel.app/favicon.svg" alt="" width="22" height="22" style="width:22px;height:22px;vertical-align:middle;margin-right:6px;" />
          <span style="font-size:18px;font-weight:700;color:#2fbf71;letter-spacing:-0.4px;vertical-align:middle;">GrowJin</span>
        </td>
      </tr>
    </table>

    <!-- Main card -->
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e0e8e3;border-radius:8px;overflow:hidden;">

      <tr>
        <td style="padding:36px 40px 32px;">

          <h1 style="margin:0 0 24px;font-size:26px;font-weight:700;color:#0d1f14;line-height:1.25;letter-spacing:-0.5px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">Your ${moduleName} analysis is ready</h1>

          <p style="margin:0 0 16px;font-size:15px;line-height:1.75;color:#1a2e20;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">Hi there,</p>

          <p style="margin:0 0 24px;font-size:15px;line-height:1.75;color:#1a2e20;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
            Your <strong style="font-weight:700;color:#1a2e20;">${moduleName}</strong> analysis has been completed. Here's a summary of what was found:
          </p>

          <!-- Brand card -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;padding:16px 20px;background:#f7faf8;border:1px solid #e0e8e3;border-radius:8px;">
            <tr>
              <td style="vertical-align:middle;">
                ${brandLogoHtml}
                <span style="font-size:16px;font-weight:700;color:#0d1f14;vertical-align:middle;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${brandName}</span>
              </td>
              <td style="text-align:right;vertical-align:middle;">
                <a href="${brandWebsiteUrl}" style="font-size:13px;color:#2fbf71;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${brandWebsiteUrl.replace(/^https?:\/\//, '')}</a>
              </td>
            </tr>
          </table>

          <!-- Stats row -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border:1px solid #e0e8e3;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="padding:20px 24px;border-right:1px solid #e0e8e3;width:33.3%;text-align:center;">
                <p style="margin:0 0 4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#8a9e90;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">Module</p>
                <p style="margin:0;font-size:15px;font-weight:700;color:#0d1f14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${moduleName}</p>
              </td>
              <td style="padding:20px 24px;border-right:1px solid #e0e8e3;width:33.3%;text-align:center;">
                <p style="margin:0 0 4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#8a9e90;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">Completed</p>
                <p style="margin:0;font-size:15px;font-weight:700;color:#0d1f14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${formattedDate}</p>
              </td>
              <td style="padding:20px 24px;width:33.3%;text-align:center;">
                <p style="margin:0 0 4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#8a9e90;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">Your Score</p>
                <p style="margin:0;font-size:22px;font-weight:700;color:${pctColor};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${aiPct}%</p>
              </td>
            </tr>
          </table>

          <p style="margin:0 0 28px;font-size:15px;line-height:1.75;color:#1a2e20;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
            Log in to GrowJin to view your full results, see what needs fixing, and track your progress.
          </p>

          <!-- CTA button -->
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr>
              <td>
                <a href="${dashboardUrl}" style="display:inline-block;padding:13px 32px;background:#2fbf71;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:7px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:-0.2px;">View My Results</a>
              </td>
            </tr>
          </table>

          <!-- Fallback link -->
          <p style="margin:0 0 24px;font-size:12px;color:#8a9e90;line-height:1.5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
            If the button does not work, paste this link into your browser:<br/>
            <a href="${dashboardUrl}" style="color:#2fbf71;text-decoration:underline;">${dashboardUrl}</a>
          </p>

          <p style="margin:0;font-size:15px;line-height:1.75;color:#1a2e20;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">&#8212; The GrowJin Team</p>

        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="padding:18px 40px;background:#f7f9f7;border-top:1px solid #e0e8e3;text-align:center;">
          <p style="margin:0;font-size:12px;color:#8a9e90;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
            You received this email because you requested an analysis on <a href="https://growjin.com" style="color:#2fbf71;text-decoration:none;">growjin.com</a>.
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>`
}

function isAdmin(email: string | undefined): boolean {
  const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return adminEmails.includes(email ?? '')
}

// GET /api/admin/requests — list all requests (newest first)
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rows = await db.select().from(analysisRequests).orderBy(desc(analysisRequests.requestedAt))
  return NextResponse.json({ requests: rows })
}

// PATCH /api/admin/requests — mark a request as done + notify the user
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await req.json() as { id: string }
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const [request] = await db.select().from(analysisRequests).where(eq(analysisRequests.id, id))
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const completedAt = new Date()
  await db.update(analysisRequests)
    .set({ status: 'done', completedAt })
    .where(eq(analysisRequests.id, id))

  // Notify the user via admin Gmail
  try {
    const accessToken = await getValidAdminGmailToken()

    // Fetch brand logo
    const [brand] = await db
      .select({ logoUrl: brands.logoUrl, websiteUrl: brands.websiteUrl })
      .from(brands)
      .where(eq(brands.userId, request.userId))
      .limit(1)

    // Calculate AI-verified percentage for this module
    const items = await db
      .select({ weight: moduleItems.weight, aiVerified: moduleItems.aiVerified })
      .from(moduleItems)
      .where(eq(moduleItems.moduleId, request.moduleId))

    const totalWeight = items.reduce((s, i) => s + i.weight, 0)
    const verifiedWeight = items.filter(i => i.aiVerified).reduce((s, i) => s + i.weight, 0)
    const aiPct = totalWeight > 0 ? Math.round((verifiedWeight / totalWeight) * 100) : 0

    const dashboardUrl = `https://growjin.com/dashboard/${request.moduleId}`
    const bodyHtml = buildNotificationEmail({
      moduleName:      request.moduleName,
      brandName:       request.brandName,
      brandWebsiteUrl: brand?.websiteUrl ?? request.websiteUrl,
      brandLogoUrl:    brand?.logoUrl ?? null,
      completedAt,
      aiPct,
      dashboardUrl,
    })

    const message = [
      `To: ${request.userEmail}`,
      `Subject: Your ${request.moduleName} analysis is ready`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      bodyHtml,
    ].join('\r\n')

    const encoded = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encoded }),
    })

    if (!sendRes.ok) {
      console.error('[admin/requests] Gmail send failed:', await sendRes.text())
    }
  } catch (err) {
    console.error('[admin/requests] User notification email failed (non-fatal):', err)
  }

  return NextResponse.json({ ok: true })
}
