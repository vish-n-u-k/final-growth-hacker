// ── Lifecycle emails ──────────────────────────────────────────────────────────
// Welcome (onboarding), Pro trial / Pro welcome and the cancellation sequence (Stripe webhook),
// and the time-based ones (lifecycle cron). Sent from the admin Gmail, like the daily email.
//
// Every send first claims a row in lifecycle_emails (brand + kind + key), so a retried webhook or
// a re-run cron never sends twice. If the table hasn't been created yet, emails are skipped.
// Nothing here ever throws: an email must never break onboarding or billing.

import { createHmac, timingSafeEqual } from 'crypto'
import type Stripe from 'stripe'
import { db } from '@/lib/db'
import { brands, brandSubscriptions, lifecycleEmails } from '@/lib/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { createAdminClient } from '@/lib/supabase/admin'
import { getValidAdminGmailToken, getAdminGmailAddress } from '@/lib/gmail/admin-token'
import { buildRawMessage } from '@/lib/gmail/send'
import { firstName } from '@/lib/email/followup'
import { renderLifecycleEmail, type LifecycleContext, type LifecycleKind } from '@/lib/email/lifecycle-templates'

const PRO_STATUSES = new Set(['active', 'trialing', 'past_due'])
const DAY = 24 * 3600 * 1000

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.growjin.com').replace(/\/$/, '')
}

// ── Unsubscribe links (win-back emails only; the rest are transactional) ──────

function unsubSig(brandId: string): string {
  return createHmac('sha256', process.env.CRON_SECRET ?? 'dev').update(`unsubscribe:${brandId}`).digest('hex').slice(0, 24)
}

export function unsubscribeUrl(brandId: string): string {
  return `${appUrl()}/api/r/unsubscribe?b=${brandId}&s=${unsubSig(brandId)}`
}

export function isValidUnsubSig(brandId: string, sig: string): boolean {
  const expected = Buffer.from(unsubSig(brandId))
  const given = Buffer.from(sig)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export async function unsubscribeBrand(brandId: string): Promise<void> {
  await db.insert(lifecycleEmails).values({ brandId, kind: 'unsubscribed', key: 'marketing' }).onConflictDoNothing()
}

async function isUnsubscribed(brandId: string): Promise<boolean> {
  const [row] = await db.select({ id: lifecycleEmails.id }).from(lifecycleEmails)
    .where(and(eq(lifecycleEmails.brandId, brandId), eq(lifecycleEmails.kind, 'unsubscribed'))).limit(1)
  return !!row
}

// ── Sending ───────────────────────────────────────────────────────────────────

type SendResult = 'sent' | 'duplicate' | 'skipped' | 'failed'

/** The brand owner's login email and first name, from Supabase Auth. */
async function recipientFor(userId: string): Promise<{ email: string; firstName: string | null } | null> {
  const { data, error } = await createAdminClient().auth.admin.getUserById(userId)
  if (error || !data.user?.email) return null
  const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>
  const name = typeof meta.full_name === 'string' ? meta.full_name : typeof meta.name === 'string' ? meta.name : ''
  return { email: data.user.email, firstName: name ? firstName(name) : null }
}

/**
 * Sends one lifecycle email to the brand owner, at most once per (brand, kind, key).
 * `extra` carries the plan details for billing emails.
 */
export async function sendLifecycleEmail(
  brandId: string,
  kind: LifecycleKind,
  key: string,
  extra: Partial<Pick<LifecycleContext, 'price' | 'periodEnd' | 'wasTrial'>> = {},
): Promise<SendResult> {
  let claimId: string | undefined
  try {
    const [brand] = await db.select({ id: brands.id, userId: brands.userId, name: brands.name, websiteUrl: brands.websiteUrl })
      .from(brands).where(eq(brands.id, brandId)).limit(1)
    if (!brand) return 'skipped'

    // Claim first: a concurrent or retried call for the same email finds the row and stops here
    const [claim] = await db.insert(lifecycleEmails).values({ brandId, kind, key })
      .onConflictDoNothing().returning({ id: lifecycleEmails.id })
    if (!claim) return 'duplicate'
    claimId = claim.id

    const to = await recipientFor(brand.userId)
    if (!to) throw new Error('brand owner has no email')

    const accessToken = await getValidAdminGmailToken()
    const fromEmail = await getAdminGmailAddress()
    if (!fromEmail) throw new Error('Admin Gmail address not found')

    const isWinback = kind === 'winback_1' || kind === 'winback_2'
    const { subject, html } = renderLifecycleEmail(kind, {
      firstName: to.firstName,
      brandName: brand.name,
      websiteUrl: brand.websiteUrl,
      appUrl: appUrl(),
      replyAddress: fromEmail,
      ...(isWinback ? { unsubscribeUrl: unsubscribeUrl(brandId) } : {}),
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

    await db.update(lifecycleEmails).set({ toEmail: to.email, sentAt: new Date() }).where(eq(lifecycleEmails.id, claimId))
    return 'sent'
  } catch (e) {
    console.error(`[lifecycle] ${kind} for brand ${brandId} not sent:`, e instanceof Error ? e.message : e)
    // Release the claim so the next webhook retry / cron run can try again
    if (claimId) await db.delete(lifecycleEmails).where(eq(lifecycleEmails.id, claimId)).catch(() => {})
    return claimId ? 'failed' : 'skipped'
  }
}

// ── Stripe subscription changes (called from syncSubscription) ────────────────

type SubState = { status: string | null; cancelAtPeriodEnd: boolean; currentPeriodEnd: Date | null }

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

/** Compares the stored subscription with the new one and sends the email for whatever changed. */
export async function onSubscriptionChange(
  brandId: string,
  prev: SubState | null,
  next: SubState,
  sub: Stripe.Subscription,
): Promise<void> {
  try {
    const price = priceLabel(sub)
    const periodEnd = next.currentPeriodEnd
    const periodKey = `${sub.id}:${periodEnd?.toISOString().slice(0, 10) ?? 'none'}`
    // Cancel flags only count on a subscription that was running: a row left over from an
    // older, ended subscription can still carry cancelAtPeriodEnd
    const wasPro = !!prev?.status && PRO_STATUSES.has(prev.status)
    const isPro = !!next.status && PRO_STATUSES.has(next.status)

    if (next.status === 'trialing' && prev?.status !== 'trialing') {
      const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000) : periodEnd
      await sendLifecycleEmail(brandId, 'pro_trial_started', sub.id, { price, periodEnd: trialEnd })
    }

    if (next.status === 'active' && prev?.status !== 'active' && prev?.status !== 'past_due') {
      await sendLifecycleEmail(brandId, 'pro_welcome', sub.id, { price, periodEnd, wasTrial: prev?.status === 'trialing' })
    }

    if (wasPro && isPro && next.cancelAtPeriodEnd && !prev?.cancelAtPeriodEnd) {
      await sendLifecycleEmail(brandId, 'cancel_scheduled', periodKey, { periodEnd })
    }

    if (wasPro && isPro && !next.cancelAtPeriodEnd && prev?.cancelAtPeriodEnd) {
      await sendLifecycleEmail(brandId, 'cancel_undone', periodKey, { periodEnd })
    }

    // Only for subscriptions that were actually running, not abandoned checkouts
    if (next.status === 'canceled' && wasPro) {
      await sendLifecycleEmail(brandId, 'subscription_ended', sub.id)
    }
  } catch (e) {
    console.error('[lifecycle] subscription email check failed:', e instanceof Error ? e.message : e)
  }
}

// ── Time-based emails (lifecycle cron, once a day) ────────────────────────────

export async function runLifecycleCron(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  const tally = (kind: string, r: SendResult) => { counts[`${kind}:${r}`] = (counts[`${kind}:${r}`] ?? 0) + 1 }
  const now = Date.now()

  let subs: (typeof brandSubscriptions.$inferSelect)[]
  try {
    subs = await db.select().from(brandSubscriptions).where(inArray(brandSubscriptions.status, ['active', 'trialing', 'past_due', 'canceled']))
  } catch (e) {
    console.error('[lifecycle] brand_subscriptions read failed — has drizzle/billing.sql been run?', e)
    return counts
  }

  for (const s of subs) {
    if (!s.stripeSubscriptionId) continue

    // Access ends in the next 3 days. Skipped when they cancelled in the last 4 days:
    // the cancellation email they just got already gives the date.
    if (s.cancelAtPeriodEnd && s.status !== 'canceled' && s.currentPeriodEnd
        && s.currentPeriodEnd.getTime() > now && s.currentPeriodEnd.getTime() - now <= 3 * DAY
        && now - s.updatedAt.getTime() > 4 * DAY) {
      const key = `${s.stripeSubscriptionId}:${s.currentPeriodEnd.toISOString().slice(0, 10)}`
      tally('access_ending', await sendLifecycleEmail(s.brandId, 'access_ending', key, { periodEnd: s.currentPeriodEnd }))
      continue
    }

    // Win-backs, timed from the last subscription event (the cancellation). The windows mean
    // someone who churned long before this shipped isn't suddenly emailed.
    if (s.status === 'canceled') {
      const since = now - s.updatedAt.getTime()
      const kind: LifecycleKind | null =
        since >= 14 * DAY && since < 21 * DAY ? 'winback_1'
        : since >= 30 * DAY && since < 40 * DAY ? 'winback_2'
        : null
      if (!kind) continue
      if (await isUnsubscribed(s.brandId).catch(() => true)) { tally(kind, 'skipped'); continue }
      tally(kind, await sendLifecycleEmail(s.brandId, kind, s.stripeSubscriptionId))
    }
  }
  return counts
}
