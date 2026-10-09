import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { billingEnabled, getAccess, getSubscription } from '@/lib/billing/plan'
import { stripe, priceIdFor, trialDays, linkCustomer, type Interval } from '@/lib/billing/stripe'

// Starts a Stripe Checkout session for GrowJin Pro (monthly or yearly) and returns its URL.
export async function POST(request: NextRequest) {
  if (!billingEnabled()) return NextResponse.json({ error: 'Billing is not enabled.' }, { status: 400 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  const { interval } = await request.json().catch(() => ({})) as { interval?: Interval }
  const price = priceIdFor(interval === 'year' ? 'year' : 'month')
  if (!price) return NextResponse.json({ error: 'This plan is not configured yet.' }, { status: 500 })

  const access = await getAccess(brand.id, user.email)
  if (access.source === 'subscription') {
    return NextResponse.json({ error: 'You already have Pro. Use “Manage billing” to change plan.' }, { status: 409 })
  }

  try {
    let customerId = (await getSubscription(brand.id))?.stripeCustomerId ?? null
    if (!customerId) {
      const customer = await stripe().customers.create({ email: user.email ?? undefined, name: brand.name, metadata: { brandId: brand.id } })
      customerId = customer.id
      await linkCustomer(brand.id, customerId)
    }
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin
    const trial = trialDays()
    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: brand.id,
      line_items: [{ price, quantity: 1 }],
      allow_promotion_codes: true,
      metadata: { brandId: brand.id },
      subscription_data: { metadata: { brandId: brand.id }, ...(trial ? { trial_period_days: trial } : {}) },
      success_url: `${origin}/pricing?checkout=success`,
      cancel_url: `${origin}/pricing?checkout=cancelled`,
    })
    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('[billing] checkout failed', err)
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 502 })
  }
}
