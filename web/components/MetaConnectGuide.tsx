'use client'

import { useState } from 'react'
import Link from 'next/link'
import { connectUrl } from '@/lib/integrations/connect-url'

export interface MetaConnection {
  connected: boolean          // a Meta Ads token is saved
  adAccountId: string | null
  pageId: string | null
  instagramId: string | null
}

type Step = string | { text: string; href: string; link: string }

interface GuideItem {
  key: 'ad_account_id' | 'page_id' | 'access_token' | 'instagram_account_id'
  label: string
  need: 'Required' | 'Required to launch' | 'Optional'
  what: string
  steps: Step[]
  tip?: string
}

const PREREQS: { title: string; body: string; href?: string; link?: string }[] = [
  {
    title: 'A Facebook Page for your business',
    body: 'Every Meta ad runs from a Page. A personal profile won\'t work.',
    href: 'https://www.facebook.com/pages/create', link: 'Create a Page',
  },
  {
    title: 'A Meta Business portfolio that owns the Page and the ad account',
    body: 'You need to be an Admin of it. GrowJin connects through a "system user" created there.',
    href: 'https://business.facebook.com/overview', link: 'Open Meta Business Suite',
  },
  {
    title: 'An ad account with a payment method',
    body: 'GrowJin creates campaigns paused. Meta only runs them once a card or other payment method is on the account.',
    href: 'https://adsmanager.facebook.com/billing_hub/payment_settings', link: 'Add a payment method',
  },
]

const ITEMS: GuideItem[] = [
  {
    key: 'ad_account_id',
    label: 'Ad Account ID',
    need: 'Required',
    what: 'Tells GrowJin which ad account to audit and launch campaigns in.',
    steps: [
      { text: 'Open', href: 'https://adsmanager.facebook.com', link: 'Meta Ads Manager' },
      'Click the account name in the top-left. The number under it is your Ad Account ID (it\'s also in the page URL as act=…)',
      'Copy just the digits, e.g. 1234567890. Leaving "act_" on is fine too.',
    ],
  },
  {
    key: 'page_id',
    label: 'Facebook Page ID',
    need: 'Required to launch',
    what: 'The Page your ads are posted from. The audit runs without it, but you can\'t launch a campaign.',
    steps: [
      { text: 'Go to', href: 'https://business.facebook.com/settings/pages', link: 'Business settings → Accounts → Pages' },
      'Click your Page. The long number shown under its name is the Page ID',
      'Or: open your Facebook Page → About → Page transparency → Page ID',
    ],
  },
  {
    key: 'access_token',
    label: 'Access Token',
    need: 'Required',
    what: 'Lets GrowJin read your ad results and create campaigns for you. Use a system user token: it doesn\'t expire.',
    steps: [
      { text: 'Create an app:', href: 'https://developers.facebook.com/apps/creation/', link: 'developers.facebook.com → Create App' },
      'Choose the "Business" type (or "Other" → "Business") and link it to your Business portfolio. Then, in the app, click Add product → Marketing API → Set up',
      { text: 'Create a system user:', href: 'https://business.facebook.com/settings/system-users', link: 'Business settings → Users → System users' },
      'Click Add → give it any name → role: Admin',
      'With the system user selected, click Assign assets: your ad account (Full control), your Page (Full control) and your app (Full control)',
      'Click Generate new token → pick your app → expiry: Never',
      'Tick these permissions: ads_management, ads_read, business_management, pages_show_list, pages_read_engagement, pages_manage_ads (plus instagram_basic if you\'ll run Instagram ads)',
      'Copy the token (it starts with EAA). Meta shows it only once',
    ],
    tip: 'Skip the token from Graph API Explorer. It expires within a couple of hours, and GrowJin would stop working.',
  },
  {
    key: 'instagram_account_id',
    label: 'Instagram Account ID',
    need: 'Optional',
    what: 'Only needed if you want ads to show under your Instagram account. Your Instagram has to be a professional account linked to your Page.',
    steps: [
      { text: 'Open', href: 'https://developers.facebook.com/tools/explorer/', link: 'Graph API Explorer' },
      'Paste your token into the Access Token box, then run GET me/accounts and copy your Page\'s id',
      'Run GET {page-id}?fields=instagram_business_account and copy the id it returns (it starts with 1784…)',
    ],
  },
]

function renderStep(step: Step) {
  if (typeof step === 'string') return step
  return <>{step.text} <a href={step.href} target="_blank" rel="noopener noreferrer" className="mcg-link">{step.link} ↗</a></>
}

function isDone(key: GuideItem['key'], c: MetaConnection) {
  if (key === 'access_token') return c.connected
  if (key === 'ad_account_id') return c.connected && !!c.adAccountId
  if (key === 'page_id') return c.connected && !!c.pageId
  return c.connected && !!c.instagramId
}

export default function MetaConnectGuide({ connection }: { connection: MetaConnection }) {
  const required = ITEMS.filter((i) => i.need !== 'Optional')
  const doneCount = required.filter((i) => isDone(i.key, connection)).length
  const ready = doneCount === required.length

  const [open, setOpen] = useState(!ready)
  const [expanded, setExpanded] = useState<string | null>(() => {
    const firstMissing = required.find((i) => !isDone(i.key, connection))
    return ready ? null : firstMissing?.key ?? null
  })

  if (ready && !open) {
    return (
      <div className="mcg mcg--ready">
        <span className="mcg-ready-dot" />
        <p className="mcg-ready-text">
          Meta Ads connected · Ad account <strong>act_{connection.adAccountId?.replace(/^act_/, '')}</strong> · Page <strong>{connection.pageId}</strong>
        </p>
        <button type="button" className="mcg-text-btn" onClick={() => setOpen(true)}>Setup guide</button>
        <Link href={connectUrl('meta_ads')} className="mcg-text-btn">Edit</Link>
      </div>
    )
  }

  return (
    <section className="mcg">
      <div className="mcg-hd">
        <div>
          <p className="mcg-eyebrow">{ready ? 'Connected' : 'Before you run the audit'}</p>
          <h2 className="mcg-title">{ready ? 'Your Meta Ads connection' : 'Connect your Meta Ads account'}</h2>
          <p className="mcg-sub">
            GrowJin needs 3 things from Meta. It takes about 10 minutes the first time.
            Click any item below for exact steps.
          </p>
        </div>
        <div className="mcg-hd-side">
          <span className={`mcg-count ${ready ? 'mcg-count--good' : ''}`}>{doneCount}/{required.length} ready</span>
          {ready && <button type="button" className="mcg-text-btn" onClick={() => setOpen(false)}>Hide</button>}
        </div>
      </div>

      {!ready && (
        <div className="mcg-prereqs">
          <p className="mcg-label">You need these first</p>
          <ul className="mcg-prereq-list">
            {PREREQS.map((p) => (
              <li key={p.title} className="mcg-prereq">
                <span className="mcg-prereq-check" aria-hidden>□</span>
                <div>
                  <p className="mcg-prereq-title">{p.title}</p>
                  <p className="mcg-prereq-body">
                    {p.body}{' '}
                    {p.href && <a href={p.href} target="_blank" rel="noopener noreferrer" className="mcg-link">{p.link} ↗</a>}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mcg-items">
        <p className="mcg-label">What to paste into GrowJin</p>
        {ITEMS.map((item) => {
          const done = isDone(item.key, connection)
          const isOpen = expanded === item.key
          return (
            <div key={item.key} className="mcg-item">
              <button type="button" className="mcg-item-btn" onClick={() => setExpanded(isOpen ? null : item.key)} aria-expanded={isOpen}>
                <span className={`mcg-status ${done ? 'mcg-status--done' : ''}`}>{done ? '✓' : ''}</span>
                <span className="mcg-item-label">{item.label}</span>
                <span className={`mcg-need mcg-need--${item.need === 'Optional' ? 'opt' : 'req'}`}>{item.need}</span>
                <span className="mcg-toggle">{isOpen ? '−' : '+'}</span>
              </button>
              {isOpen && (
                <div className="mcg-item-detail">
                  <p className="mcg-what">{item.what}</p>
                  <ol className="mcg-steps">
                    {item.steps.map((s, i) => <li key={i}>{renderStep(s)}</li>)}
                  </ol>
                  {item.tip && <p className="mcg-tip">{item.tip}</p>}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mcg-ft">
        <Link href={connectUrl('meta_ads')} className="btn btn-primary">
          {connection.connected ? 'Update Meta Ads details' : 'Paste them in Settings'}
        </Link>
        <p className="mcg-ft-note">
          Then come back here and click Run Audit. Campaigns GrowJin launches start paused, so nothing spends until you switch it on in Ads Manager.
        </p>
      </div>
    </section>
  )
}
