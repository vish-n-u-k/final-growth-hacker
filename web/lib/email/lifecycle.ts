// ── Lifecycle emails ──────────────────────────────────────────────────────────
// Welcome (onboarding), Pro started / Pro ended (Stripe webhook) and account deleted.
// Sent from the admin Gmail, like the daily email.
//
// Brand emails first claim a row in lifecycle_emails (brand + kind + key), so a retried webhook
// never sends twice. If the table hasn't been created yet, they're skipped.
// Nothing here ever throws: an email must never break onboarding, billing or deletion.

import type Stripe from 'stripe'
import { db } from '@/lib/db'
import { brands, lifecycleEmails } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createAdminClient } from '@/lib/supabase/admin'
import { getValidAdminGmailToken, getAdminGmailAddress } from '@/lib/gmail/admin-token'
import { buildRawMessage } from '@/lib/gmail/send'
import { firstName } from '@/lib/email/followup'
import { renderLifecycleEmail, type LifecycleContext, type LifecycleKind } from '@/lib/email/lifecycle-templates'

const PRO_STATUSES = new Set(['active', 'trialing', 'past_due'])

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.growjin.com').replace(/\/$/, '')
}

type SendResult = 'sent' | 'duplicate' | 'skipped' | 'failed'
type Extra = Partial<Pick<LifecycleContext, 'price' | 'periodEnd' | 'isTrial'>>

function nameFromMetadata(meta: Record<string, unknown> | undefined): string | null {
  const name = typeof meta?.full_name === 'string' ? meta.full_name : typeof meta?.name === 'string' ? meta.name : ''
  return name ? firstName(name) : null
}

/** Renders and sends one email from the admin Gmail. Throws on failure. */
async function deliver(
  kind: LifecycleKind,
  to: { email: string; firstName: string | null },
  brand: { name: string; websiteUrl: string | null } | null,
  extra: Extra = {},
): Promise<void> {
  const accessToken = await getValidAdminGmailToken()
  const fromEmail = await getAdminGmailAddress()
  if (!fromEmail) throw new Error('Admin Gmail address not found')

  const { subject, html } = renderLifecycleEmail(kind, {
    firstName: to.firstName,
    brandName: brand?.name ?? null,
    websiteUrl: brand?.websiteUrl ?? null,
    appUrl: appUrl(),
    replyAddress: fromEmail,
    ...extra,
  })

  const raw = buildRawMessage({ from: `GrowJin <${fromEmail}>`, to: to.email, subject, body: html })
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Gmail API ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

/** Sends a brand email to the brand owner's login email, at most once per (brand, kind, key). */
export async function sendLifecycleEmail(
  brandId: string,
  kind: Exclude<LifecycleKind, 'account_deleted'>,
  key: string,
  extra: Extra = {},
): Promise<SendResult> {
  let claimId: string | undefined
  try {
    const [brand] = await db.select({ userId: brands.userId, name: brands.name, websiteUrl: brands.websiteUrl })
      .from(brands).where(eq(brands.id, brandId)).limit(1)
    if (!brand) return 'skipped'

    // Claim first: a concurrent or retried call for the same email finds the row and stops here
    const [claim] = await db.insert(lifecycleEmails).values({ brandId, kind, key })
      .onConflictDoNothing().returning({ id: lifecycleEmails.id })
    if (!claim) return 'duplicate'
    claimId = claim.id

    const { data, error } = await createAdminClient().auth.admin.getUserById(brand.userId)
    if (error || !data.user?.email) throw new Error('brand owner has no email')
    const to = { email: data.user.email, firstName: nameFromMetadata(data.user.user_metadata) }

    await deliver(kind, to, brand, extra)
    await db.update(lifecycleEmails).set({ toEmail: to.email, sentAt: new Date() }).where(eq(lifecycleEmails.id, claimId))
    return 'sent'
  } catch (e) {
    console.error(`[lifecycle] ${kind} for brand ${brandId} not sent:`, e instanceof Error ? e.message : e)
    // Release the claim so the next webhook retry can try again
    if (claimId) await db.delete(lifecycleEmails).where(eq(lifecycleEmails.id, claimId)).catch(() => {})
    return claimId ? 'failed' : 'skipped'
  }
}

/**
 * "Sorry to see you leave" after an account is deleted. The app has no delete-account flow yet:
 * call this from it, with details read BEFORE the user and brand rows are removed.
 */
export async function sendAccountDeletedEmail(opts: {
  email: string
  fullName?: string | null
  brandName?: string | null
}): Promise<SendResult> {
  try {
    await deliver(
      'account_deleted',
      { email: opts.email, firstName: opts.fullName ? firstName(opts.fullName) : null },
      opts.brandName ? { name: opts.brandName, websiteUrl: null } : null,
    )
    return 'sent'
  } catch (e) {
    console.error('[lifecycle] account_deleted not sent:', e instanceof Error ? e.message : e)
    return 'failed'
  }
}

// ── Stripe subscription changes (called from syncSubscription) ────────────────

type SubState = { status: string | null; currentPeriodEnd: Date | null }

function priceLabel(sub: Stripe.Subscription): string | null {
  const price = sub.items?.data?.[0]?.price
  if (price?.unit_amount == null) return null
  const amount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: price.currency.toUpperCase(),
    minimumFractionDigits: price.unit_amount % 100 === 0 ? 0 : 2,
  }).format(price.unit_amount / 100)
  return price.recurring?.interval ? `${amount}/${price.recurring.interval}` : amount
}

/** Sends "Welcome to Pro" when a brand becomes Pro and "Sorry to see you go" when it stops being Pro. */
export async function onSubscriptionChange(
  brandId: string,
  prev: SubState | null,
  next: SubState,
  sub: Stripe.Subscription,
): Promise<void> {
  try {
    const wasPro = !!prev?.status && PRO_STATUSES.has(prev.status)
    const isPro = !!next.status && PRO_STATUSES.has(next.status)

    // Keyed by subscription, so trial → paid doesn't send a second welcome
    if (isPro && !wasPro) {
      const isTrial = next.status === 'trialing'
      const periodEnd = isTrial && sub.trial_end ? new Date(sub.trial_end * 1000) : next.currentPeriodEnd
      await sendLifecycleEmail(brandId, 'pro_welcome', sub.id, { price: priceLabel(sub), periodEnd, isTrial })
    }

    // Cancelled, trial ended unpaid, or payment finally failed. Not abandoned checkouts: those were never Pro.
    if (wasPro && !isPro) {
      await sendLifecycleEmail(brandId, 'pro_ended', sub.id)
    }
  } catch (e) {
    console.error('[lifecycle] subscription email check failed:', e instanceof Error ? e.message : e)
  }
}
