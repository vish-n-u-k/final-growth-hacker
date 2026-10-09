import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { billingEnabled, getSubscription } from '@/lib/billing/plan'
import { stripe } from '@/lib/billing/stripe'

// Opens Stripe's hosted Customer Portal (cancel, switch monthly/yearly, card, invoices).
export async function POST(request: NextRequest) {
  if (!billingEnabled()) return NextResponse.json({ error: 'Billing is not enabled.' }, { status: 400 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  const customerId = (await getSubscription(brand.id))?.stripeCustomerId
  if (!customerId) return NextResponse.json({ error: 'No billing account yet — upgrade first.' }, { status: 400 })
  try {
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin
    const session = await stripe().billingPortal.sessions.create({ customer: customerId, return_url: `${origin}/pricing` })
    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('[billing] portal failed', err)
    return NextResponse.json({ error: 'Could not open billing. Please try again.' }, { status: 502 })
  }
}
