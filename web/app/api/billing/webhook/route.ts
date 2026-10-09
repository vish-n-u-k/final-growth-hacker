import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { stripe, linkCustomer, syncSubscription } from '@/lib/billing/stripe'

// Stripe → GrowJin. The source of truth for who is Pro (not the browser redirect after checkout).
// Excluded from the auth middleware; authenticated by the Stripe signature instead.
export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  const signature = request.headers.get('stripe-signature')
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  const body = await request.text() // raw body — required for signature verification
  let event: Stripe.Event
  try {
    event = stripe().webhooks.constructEvent(body, signature, secret)
  } catch (err) {
    console.error('[billing] webhook signature check failed', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object
        const brandId = (s.metadata?.brandId as string | undefined) ?? s.client_reference_id
        const customerId = typeof s.customer === 'string' ? s.customer : s.customer?.id
        const subscriptionId = typeof s.subscription === 'string' ? s.subscription : s.subscription?.id
        if (brandId && customerId) await linkCustomer(brandId, customerId, subscriptionId)
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed': {
        const result = await syncSubscription(event.data.object, event.created)
        if (result === 'unknown-brand') console.warn('[billing] subscription for unknown brand', event.data.object.id)
        break
      }
      default:
        break // other events (invoices etc.) are reflected through subscription.updated
    }
  } catch (err) {
    console.error('[billing] webhook handling failed', event.type, err)
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 }) // Stripe will retry
  }
  return NextResponse.json({ received: true })
}
