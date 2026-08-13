# PostHog Setup — GrowJin (Next.js App Router)

## Goal
Install PostHog and instrument all meaningful user actions so the team can see funnels, drop-off, and growth from day one. This is a Next.js App Router project using Supabase auth and Drizzle ORM.

---

## 1. Install

```bash
npm install posthog-js
```

---

## 2. Create the PostHog provider

Create `lib/posthog/provider.tsx` (client component — wraps the app):

```tsx
'use client'
import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'
import { useEffect } from 'react'

export function PHProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
      person_profiles: 'identified_only',
      capture_pageview: false,        // we fire pageviews manually below
      capture_pageleave: true,
      autocapture: false,             // we track explicitly — no noise
    })
  }, [])
  return <PostHogProvider client={posthog}>{children}</PostHogProvider>
}
```

---

## 3. Create the pageview tracker

Create `lib/posthog/pageview.tsx` (client component):

```tsx
'use client'
import { usePathname, useSearchParams } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { useEffect } from 'react'

export function PostHogPageview() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const posthog = usePostHog()

  useEffect(() => {
    if (!posthog) return
    let url = pathname
    const qs = searchParams.toString()
    if (qs) url += `?${qs}`
    posthog.capture('$pageview', { $current_url: url })
  }, [pathname, searchParams, posthog])

  return null
}
```

---

## 4. Wire into the root layout

Edit `app/layout.tsx` — wrap everything with PHProvider and add the pageview tracker inside a Suspense boundary:

```tsx
import { Suspense } from 'react'
import { PHProvider } from '@/lib/posthog/provider'
import { PostHogPageview } from '@/lib/posthog/pageview'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <PHProvider>
          <Suspense fallback={null}>
            <PostHogPageview />
          </Suspense>
          {children}
        </PHProvider>
      </body>
    </html>
  )
}
```

---

## 5. Create the analytics helper

Create `lib/posthog/analytics.ts` — a thin typed wrapper so we never mis-spell event names:

```ts
import posthog from 'posthog-js'

export const analytics = {
  // ── Auth ──────────────────────────────────────────────────────────────────
  userSignedUp(props: { email: string }) {
    posthog.capture('user_signed_up', props)
  },
  userLoggedIn(props: { email: string }) {
    posthog.capture('user_logged_in', props)
  },
  userLoggedOut() {
    posthog.capture('user_logged_out')
    posthog.reset()   // clears identity — MUST call after logout
  },

  // ── Identity ──────────────────────────────────────────────────────────────
  // Call this as soon as you have the logged-in user's ID (e.g. in a client
  // layout that reads from Supabase). Without this, all events are anonymous.
  identify(userId: string, props: { email?: string; name?: string }) {
    posthog.identify(userId, props)
  },

  // ── Onboarding ────────────────────────────────────────────────────────────
  onboardingStarted() {
    posthog.capture('onboarding_started')
  },
  onboardingStepCompleted(props: { step: number; step_name: string }) {
    posthog.capture('onboarding_step_completed', props)
  },
  onboardingCompleted(props: { brand_name: string; website_url: string }) {
    posthog.capture('onboarding_completed', props)
  },

  // ── Analysis ──────────────────────────────────────────────────────────────
  analysisTriggered(props: { module_id: string; module_type: string; trigger: 'auto' | 'manual' | 'reanalyse' }) {
    posthog.capture('analysis_triggered', props)
  },
  analysisCompleted(props: { module_id: string; module_type: string; score: number; duration_ms: number }) {
    posthog.capture('analysis_completed', props)
  },
  analysisFailed(props: { module_id: string; module_type: string; error: string }) {
    posthog.capture('analysis_failed', props)
  },

  // ── Dashboard ─────────────────────────────────────────────────────────────
  moduleViewed(props: { module_id: string; module_type: string; score: number }) {
    posthog.capture('module_viewed', props)
  },
  moduleNavClicked(props: { to_module_id: string; to_module_type: string }) {
    posthog.capture('module_nav_clicked', props)
  },
  moduleUnlocked(props: { module_id: string; module_type: string; unlocked_by: string }) {
    posthog.capture('module_unlocked', props)
  },

  // ── Items ─────────────────────────────────────────────────────────────────
  itemExpanded(props: { item_slug: string; module_type: string; is_verified: boolean }) {
    posthog.capture('item_expanded', props)
  },
  itemChecked(props: { item_slug: string; module_type: string; action: 'check' | 'uncheck' }) {
    posthog.capture('item_checked', props)
  },

  // ── Export ────────────────────────────────────────────────────────────────
  exportTriggered(props: { module_id: string; module_type: string }) {
    posthog.capture('export_triggered', props)
  },

  // ── AI Features ───────────────────────────────────────────────────────────
  aiDraftGenerated(props: { item_slug: string; module_type: string }) {
    posthog.capture('ai_draft_generated', props)
  },
  postIdeasGenerated(props: { module_id: string }) {
    posthog.capture('post_ideas_generated', props)
  },
  playbookGenerated(props: { module_id: string }) {
    posthog.capture('playbook_generated', props)
  },
  playbookSaved(props: { module_id: string }) {
    posthog.capture('playbook_saved', props)
  },

  // ── Score Milestones ──────────────────────────────────────────────────────
  scoreMilestoneReached(props: { module_id: string; module_type: string; score: number }) {
    posthog.capture('score_milestone_reached', props)
  },

  // ── Integrations / Settings ───────────────────────────────────────────────
  integrationSaved(props: { provider: string }) {
    posthog.capture('integration_saved', props)
  },
  integrationRemoved(props: { provider: string }) {
    posthog.capture('integration_removed', props)
  },

  // ── Gmail Hub ─────────────────────────────────────────────────────────────
  gmailHubOpened() {
    posthog.capture('gmail_hub_opened')
  },
  emailOutreachDrafted(props: { prospect_count: number }) {
    posthog.capture('email_outreach_drafted', props)
  },
  emailSent(props: { count: number }) {
    posthog.capture('email_sent', props)
  },
}
```

---

## 6. Add env vars

Add to `.env.local`:
```
NEXT_PUBLIC_POSTHOG_KEY=phc_YOUR_PROJECT_API_KEY
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

Get the key from PostHog → Project Settings → Project API Key (starts with `phc_`).
For EU cloud use `https://eu.i.posthog.com`.

Also add both vars to Vercel → Project → Environment Variables.

---

## 7. Where to fire each event — placement guide

### Auth pages (`app/auth/` or wherever Supabase auth callbacks happen)

```ts
// After successful signup (Supabase onAuthStateChange or callback page)
analytics.identify(user.id, { email: user.email })
analytics.userSignedUp({ email: user.email! })

// After successful login
analytics.identify(user.id, { email: user.email })
analytics.userLoggedIn({ email: user.email! })

// On logout (sign-out button handler)
analytics.userLoggedOut()
```

### Client layout that has the session (`app/dashboard/layout.tsx` or similar)

```ts
// Identify on every page load so PostHog always has the user linked
useEffect(() => {
  if (user) analytics.identify(user.id, { email: user.email, name: user.name })
}, [user])
```

### `app/onboarding/page.tsx`

```ts
// When component mounts
analytics.onboardingStarted()

// After brand name is entered and user clicks Next
analytics.onboardingStepCompleted({ step: 1, step_name: 'brand_name' })

// After website URL is entered and user clicks Next
analytics.onboardingStepCompleted({ step: 2, step_name: 'website_url' })

// After POST /api/onboarding succeeds and before redirect to dashboard
analytics.onboardingCompleted({ brand_name, website_url })
```

### `components/AllModulesDashboard.tsx`

```ts
// When the component first renders (useEffect with no deps or on mount)
analytics.moduleViewed({ module_id: activeModuleId, module_type: activeModuleType, score: liveScore })

// In the module nav pill onClick handler
analytics.moduleNavClicked({ to_module_id: mod.id, to_module_type: mod.type })

// Inside handleReanalyze, before the fetch call
analytics.analysisTriggered({ module_id: modId, module_type: modType, trigger: 'manual' })

// After fetch returns ok inside handleReanalyze
analytics.analysisCompleted({ module_id: modId, module_type: modType, score: newScore, duration_ms: Date.now() - startTime })

// After fetch returns !ok inside handleReanalyze
analytics.analysisFailed({ module_id: modId, module_type: modType, error: errorMessage })

// In the export button onClick
analytics.exportTriggered({ module_id: modData.id, module_type: modData.type })
```

### `components/ModuleDashboard.tsx`

```ts
// When module page mounts (useEffect)
analytics.moduleViewed({ module_id: mod.id, module_type: mod.type, score: currentScore })

// In the item expand toggle (when opening, not closing)
if (!isOpen) analytics.itemExpanded({ item_slug: item.slug, module_type: mod.type, is_verified: !!item.aiVerified })

// In toggleItem (POST /api/items/toggle callback)
analytics.itemChecked({ item_slug: item.slug, module_type: mod.type, action: newChecked ? 'check' : 'uncheck' })

// Inside handleReanalyze, before fetch
analytics.analysisTriggered({ module_id: mod.id, module_type: mod.type, trigger: isFirstAnalysis ? 'auto' : 'reanalyse' })

// After fetch returns ok inside handleReanalyze
analytics.analysisCompleted({ module_id: mod.id, module_type: mod.type, score: newScore, duration_ms: Date.now() - startTime })

// In handleGenerateDraft after response
analytics.aiDraftGenerated({ item_slug: item.slug, module_type: mod.type })

// After playbook is generated
analytics.playbookGenerated({ module_id: mod.id })

// After playbook is saved
analytics.playbookSaved({ module_id: mod.id })
```

### Score milestone — call wherever score is computed after analysis

```ts
const MILESTONES = [25, 50, 75, 100]
const prevScore = previousScore  // store before update
MILESTONES.forEach(m => {
  if (prevScore < m && newScore >= m) {
    analytics.scoreMilestoneReached({ module_id: mod.id, module_type: mod.type, score: m })
  }
})
```

### Settings / Integrations page

```ts
// After a successful integration save
analytics.integrationSaved({ provider: 'google_analytics' }) // or 'posthog', 'gsc', 'serpapi'

// After removing an integration
analytics.integrationRemoved({ provider })
```

### `components/GmailHub.tsx`

```ts
// When the Gmail hub panel opens
analytics.gmailHubOpened()

// After AI draft is generated
analytics.emailOutreachDrafted({ prospect_count: prospects.length })

// After emails are actually sent
analytics.emailSent({ count: sentCount })
```

---

## 8. Key PostHog features to enable after install

1. **Funnels** — create: Onboarding Started → Onboarding Completed → Module Viewed → Analysis Triggered → Analysis Completed
2. **Session Recordings** — enable in PostHog → Project Settings → Session Recording (free tier: 5k sessions/month)
3. **Person Profiles** — auto-created once `posthog.identify()` fires
4. **Cohorts** — "Users who completed analysis" = fired `analysis_completed` at least once
5. **Feature Flags** — use for rolling out new modules to % of users without a deploy

---

## 9. Verify it's working

Open the browser console after installing. Run:
```js
posthog.capture('test_event', { hello: 'world' })
```
Go to PostHog → Activity → Live Events — you should see `test_event` within seconds. If not, check that `NEXT_PUBLIC_POSTHOG_KEY` is set and the app restarted after adding it.
