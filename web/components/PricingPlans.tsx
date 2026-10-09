'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Access } from '@/lib/billing/plan'
import type { PriceInfo } from '@/lib/billing/stripe'

const PRO_FEATURES = [
  'Every Growth Path module after the free ones — GEO, competitors, social, brand, content, Meta Ads, outreach, analytics',
  'Today — your daily action list, plus the daily email',
  'Outreach inbox, Social Studio, Lead Finder and Reminders',
  'Analytics: live users, retention and traffic',
]

function money(p: PriceInfo) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: p.currency.toUpperCase(), maximumFractionDigits: p.amount % 1 ? 2 : 0 }).format(p.amount)
}

export default function PricingPlans({ access, prices, freeModuleNames, checkout }: {
  access: Access
  prices: PriceInfo[]
  freeModuleNames: string[]
  checkout: 'success' | 'cancelled' | null
}) {
  const router = useRouter()
  const monthly = prices.find(p => p.interval === 'month')
  const yearly = prices.find(p => p.interval === 'year')
  const [interval, setBillingInterval] = useState<'month' | 'year'>(monthly || !yearly ? 'month' : 'year')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const price = interval === 'year' ? yearly : monthly
  const savings = monthly && yearly ? Math.round((1 - yearly.amount / (monthly.amount * 12)) * 100) : 0
  const subscribed = access.source === 'subscription'

  // Back from Stripe Checkout: Pro arrives via webhook a moment later, so re-check briefly.
  useEffect(() => {
    if (checkout !== 'success' || access.pro) return
    let n = 0
    const t = window.setInterval(() => { if (++n > 10) window.clearInterval(t); router.refresh() }, 3000)
    return () => window.clearInterval(t)
  }, [checkout, access.pro, router])

  const go = async (path: '/api/billing/checkout' | '/api/billing/portal') => {
    setBusy(path); setError(null)
    try {
      const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ interval }) })
      const data = await res.json().catch(() => ({})) as { url?: string; error?: string }
      if (res.ok && data.url) { window.location.href = data.url; return }
      setError(data.error ?? 'Something went wrong. Please try again.')
    } catch {
      setError('Network error. Please try again.')
    }
    setBusy(null)
  }

  if (!access.enabled) {
    return (
      <div className="pricing">
        <h1 className="pricing-title">Plans</h1>
        <p className="pricing-sub">Billing isn&apos;t switched on yet — every module and tool is unlocked for everyone.</p>
      </div>
    )
  }

  return (
    <div className="pricing">
      <h1 className="pricing-title">Plans</h1>
      <p className="pricing-sub">Start free. Upgrade when the fix loop has worked for you once.</p>

      {checkout === 'success' && (
        <div className="pricing-note pricing-note--ok" role="status">
          {access.pro ? 'You’re on Pro — everything is unlocked.' : 'Payment received — activating Pro (this takes a few seconds)…'}
        </div>
      )}
      {checkout === 'cancelled' && <div className="pricing-note" role="status">Checkout cancelled — you haven’t been charged.</div>}
      {access.paymentFailed && <div className="pricing-note pricing-note--warn" role="alert">Your last payment failed. Update your card in billing to keep Pro.</div>}
      {error && <div className="pricing-note pricing-note--warn" role="alert">{error}</div>}

      {(monthly && yearly) && (
        <div className="pricing-toggle" role="group" aria-label="Billing period">
          <button className={interval === 'month' ? 'on' : ''} onClick={() => setBillingInterval('month')} aria-pressed={interval === 'month'}>Monthly</button>
          <button className={interval === 'year' ? 'on' : ''} onClick={() => setBillingInterval('year')} aria-pressed={interval === 'year'}>
            Yearly{savings > 0 && <span className="pricing-save">Save {savings}%</span>}
          </button>
        </div>
      )}

      <div className="pricing-grid">
        <div className={`pricing-card${!access.pro ? ' pricing-card--current' : ''}`}>
          <div className="pricing-card-name">Free</div>
          <div className="pricing-price">$0 <span>forever</span></div>
          <ul className="pricing-list">
            {freeModuleNames.map(n => <li key={n}>{n}</li>)}
            <li>Full prescriptive fixes for those modules</li>
          </ul>
          {!access.pro && <div className="pricing-current">Your current plan</div>}
        </div>

        <div className={`pricing-card pricing-card--pro${access.pro ? ' pricing-card--current' : ''}`}>
          <div className="pricing-card-name"><span className="pro-badge">Pro</span> GrowJin Pro</div>
          <div className="pricing-price">
            {price ? <>{money(price)} <span>/ {interval === 'year' ? 'year' : 'month'}</span></> : <span>Price not set</span>}
          </div>
          <ul className="pricing-list">
            <li>Everything in Free</li>
            {PRO_FEATURES.map(f => <li key={f}>{f}</li>)}
          </ul>
          {subscribed ? (
            <>
              <div className="pricing-current">
                {access.cancelAtPeriodEnd && access.periodEnd
                  ? `Ends ${new Date(access.periodEnd).toLocaleDateString()}`
                  : access.periodEnd ? `Renews ${new Date(access.periodEnd).toLocaleDateString()} · ${access.interval === 'year' ? 'yearly' : 'monthly'}` : 'Your current plan'}
              </div>
              <button className="pricing-btn pricing-btn--ghost" onClick={() => go('/api/billing/portal')} disabled={!!busy}>
                {busy ? 'Opening…' : 'Manage billing'}
              </button>
            </>
          ) : access.pro ? (
            <div className="pricing-current">Pro access granted to your account</div>
          ) : (
            <button className="pricing-btn" onClick={() => go('/api/billing/checkout')} disabled={!!busy || !price}>
              {busy ? 'Opening checkout…' : `Upgrade to Pro${price ? ` — ${money(price)}/${interval === 'year' ? 'yr' : 'mo'}` : ''}`}
            </button>
          )}
        </div>
      </div>
      <p className="pricing-fine">Payments are handled by Stripe. Cancel any time from “Manage billing”; Pro stays on until the end of the period you paid for.</p>
    </div>
  )
}
