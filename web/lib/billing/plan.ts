import { db } from '@/lib/db'
import { brandSubscriptions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

// Free vs Pro access. Everything else in the app asks this module — never re-implement the rule.
//
// BILLING_ENABLED=true        turns billing on. Anything else: everyone has full access, no Stripe.
// BILLING_FREE_MODULES        comma-separated module types free users get (default: the first three).
// BILLING_PRO_EMAILS          comma-separated emails that always get Pro (founders, testers).

const DEFAULT_FREE_MODULES = ['foundation', 'website', 'seo']

// past_due keeps access while Stripe retries the card; the UI shows a "payment failed" banner.
const PRO_STATUSES = new Set(['active', 'trialing', 'past_due'])

export function billingEnabled(): boolean {
  return process.env.BILLING_ENABLED === 'true'
}

export function freeModuleTypes(): string[] {
  const raw = process.env.BILLING_FREE_MODULES
  const list = raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_FREE_MODULES
  return list.length ? list : DEFAULT_FREE_MODULES
}

function proEmails(): Set<string> {
  return new Set((process.env.BILLING_PRO_EMAILS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean))
}

export type Access = {
  enabled: boolean            // billing switched on at all
  pro: boolean                // full access (always true when billing is off)
  source: 'billing-off' | 'override' | 'subscription' | 'free'
  status: string | null       // Stripe subscription status
  interval: string | null     // 'month' | 'year'
  periodEnd: string | null    // ISO
  cancelAtPeriodEnd: boolean
  paymentFailed: boolean
  freeModules: string[]
}

const FULL: Omit<Access, 'source'> = {
  enabled: false, pro: true, status: null, interval: null, periodEnd: null,
  cancelAtPeriodEnd: false, paymentFailed: false, freeModules: [],
}

export async function getSubscription(brandId: string) {
  try {
    const [row] = await db.select().from(brandSubscriptions).where(eq(brandSubscriptions.brandId, brandId)).limit(1)
    return row ?? null
  } catch (err) {
    console.error('[billing] brand_subscriptions read failed — has drizzle/billing.sql been run?', err)
    return null
  }
}

export async function getAccess(brandId: string, email?: string | null): Promise<Access> {
  if (!billingEnabled()) return { ...FULL, source: 'billing-off' }
  const freeModules = freeModuleTypes()
  const sub = await getSubscription(brandId)
  const base = {
    enabled: true,
    status: sub?.status ?? null,
    interval: sub?.billingInterval ?? null,
    periodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
    paymentFailed: sub?.status === 'past_due',
    freeModules,
  }
  if (email && proEmails().has(email.toLowerCase())) return { ...base, pro: true, source: 'override' }
  if (sub?.status && PRO_STATUSES.has(sub.status)) return { ...base, pro: true, source: 'subscription' }
  return { ...base, pro: false, source: 'free' }
}

export function canUseModule(access: Access, moduleType: string): boolean {
  return access.pro || access.freeModules.includes(moduleType)
}

/** Module types the brand can't use on its current plan (empty when billing is off or Pro). */
export function planLockedTypes(access: Access, allTypes: string[]): string[] {
  return access.pro ? [] : allTypes.filter(t => !access.freeModules.includes(t))
}
