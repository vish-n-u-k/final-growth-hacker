import Stripe from 'stripe'
import { db } from '@/lib/db'
import { brandSubscriptions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

// STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_MONTHLY, STRIPE_PRICE_YEARLY,
// optional STRIPE_TRIAL_DAYS. Only used when BILLING_ENABLED=true.

let client: Stripe | null = null
export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
  client ??= new Stripe(key, { timeout: 15_000, maxNetworkRetries: 1 })
  return client
}

export type Interval = 'month' | 'year'

// STRIPE_PRICE_MONTHLY / STRIPE_PRICE_YEARLY accept either a price id (price_…) or a product id
// (prod_…). For a product, its default price is used — the price created with the product in the
// Stripe dashboard — so changing the amount there needs no env change.
const resolvedPrices = new Map<string, string>()
export async function priceIdFor(interval: Interval): Promise<string | undefined> {
  const raw = (interval === 'year' ? process.env.STRIPE_PRICE_YEARLY : process.env.STRIPE_PRICE_MONTHLY)?.trim()
  if (!raw || !raw.startsWith('prod_')) return raw || undefined
  const cached = resolvedPrices.get(raw)
  if (cached) return cached
  const product = await stripe().products.retrieve(raw)
  const def = product.default_price
  const id = typeof def === 'string' ? def : def?.id
  if (!id) throw new Error(`Stripe product ${raw} has no default price`)
  resolvedPrices.set(raw, id)
  return id
}

export function trialDays(): number | undefined {
  const n = Number(process.env.STRIPE_TRIAL_DAYS)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
}

export type PriceInfo = { interval: Interval; amount: number; currency: string }
let priceCache: { at: number; prices: PriceInfo[] } | null = null

/** Display prices straight from Stripe, so changing a price needs no code change. */
export async function getPrices(): Promise<PriceInfo[]> {
  if (priceCache && Date.now() - priceCache.at < 10 * 60_000) return priceCache.prices
  const out: PriceInfo[] = []
  for (const interval of ['month', 'year'] as const) {
    try {
      const id = await priceIdFor(interval)
      if (!id) continue
      const p = await stripe().prices.retrieve(id)
      if (p.unit_amount != null) out.push({ interval, amount: p.unit_amount / 100, currency: p.currency })
    } catch (err) {
      console.error(`[billing] could not load ${interval} price`, err)
    }
  }
  priceCache = { at: Date.now(), prices: out }
  return out
}

const customerIdOf = (c: string | Stripe.Customer | Stripe.DeletedCustomer | null) =>
  !c ? null : typeof c === 'string' ? c : c.id

/** Records the Stripe customer for a brand (first checkout, or checkout.session.completed). */
export async function linkCustomer(brandId: string, customerId: string, subscriptionId?: string | null) {
  await db.insert(brandSubscriptions)
    // epoch updatedAt so the first subscription event is never treated as stale
    .values({ brandId, stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId ?? null, updatedAt: new Date(0) })
    .onConflictDoUpdate({
      target: brandSubscriptions.brandId,
      set: { stripeCustomerId: customerId, ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}) },
    })
}

/**
 * Applies a subscription object from a webhook event. Events can arrive out of order,
 * so an event older than the last one applied is ignored.
 */
export async function syncSubscription(sub: Stripe.Subscription, eventCreated: number): Promise<'applied' | 'stale' | 'unknown-brand'> {
  const customerId = customerIdOf(sub.customer)
  let brandId = (sub.metadata?.brandId as string | undefined) ?? null
  if (!brandId && customerId) {
    const [row] = await db.select({ brandId: brandSubscriptions.brandId }).from(brandSubscriptions)
      .where(eq(brandSubscriptions.stripeCustomerId, customerId)).limit(1)
    brandId = row?.brandId ?? null
  }
  if (!brandId) return 'unknown-brand'

  const eventAt = new Date(eventCreated * 1000)
  const [existing] = await db.select().from(brandSubscriptions).where(eq(brandSubscriptions.brandId, brandId)).limit(1)
  if (existing && existing.updatedAt > eventAt && existing.stripeSubscriptionId === sub.id) return 'stale'

  // Since API 2025-03-31 the billing period lives on the subscription items.
  const item = sub.items?.data?.[0]
  const values = {
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    status: sub.status,
    priceId: item?.price?.id ?? null,
    billingInterval: item?.price?.recurring?.interval ?? null,
    currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
    updatedAt: eventAt,
  }
  await db.insert(brandSubscriptions).values({ brandId, ...values })
    .onConflictDoUpdate({ target: brandSubscriptions.brandId, set: values })
  return 'applied'
}
