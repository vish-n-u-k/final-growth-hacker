import { db } from '@/lib/db'
import { brands, analysisRequests } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

// Puts a module in the admin queue (/admin) and emails the admin. Used when module runs are
// switched to the queue, and as the fallback a user can pick when a direct run fails.
export async function queueAnalysisRequest(opts: {
  userId: string
  userEmail: string
  moduleId: string
  moduleName: string
  reason?: string // e.g. the error a direct run hit
}): Promise<void> {
  const [brand] = await db.select().from(brands).where(eq(brands.userId, opts.userId))
  const brandName = brand?.name ?? '(unknown brand)'
  const websiteUrl = brand?.websiteUrl ?? '(unknown website)'

  await db.insert(analysisRequests).values({
    moduleId: opts.moduleId,
    userId: opts.userId,
    userEmail: opts.userEmail,
    brandName,
    websiteUrl,
    moduleName: opts.moduleName,
    status: 'pending',
  })

  const moduleUrl = `https://app.growjin.com/dashboard/${opts.moduleId}`

  // Fire email notification (non-fatal)
  try {
    await resend.emails.send({
      from: 'GrowJin <onboarding@resend.dev>',
      to: 'vishnu@kuchnaya.com',
      subject: `Analysis Requested — ${brandName} / ${opts.moduleName}`,
      text: [
        `User: ${opts.userEmail}`,
        `Brand: ${brandName}`,
        `Website: ${websiteUrl}`,
        `Module: ${opts.moduleName} (moduleId: ${opts.moduleId})`,
        `Module URL: ${moduleUrl}`,
        ...(opts.reason ? [``, `Direct run failed with: ${opts.reason}`] : []),
        ``,
        `Admin queue: https://app.growjin.com/admin`,
      ].join('\n'),
    })
  } catch (err) {
    console.error('[request-analysis] Email failed (non-fatal):', err)
  }
}
