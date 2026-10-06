# GrowJin Dashboard UI Spec

Authoritative reference for how the authenticated app's UI is supposed to look and
be structured. Branch: `claude/dashboard-shell-redesign`. Read `PROGRESS.md` first
for what's actually been built vs. still pending — this file is the *design* spec;
`PROGRESS.md` is the *status* tracker. Keep both in sync as work lands.

There are two tiers here, and mixing them up will cause rework:

- **Tier 1 — decided and (mostly) built.** The persistent sidebar shell, its
  grouped navigation, real routes, lock-gating, and the app's real color/font
  tokens. Treat this as prescriptive.
- **Tier 2 — a visual reference only, not yet authorized to implement.** A
  from-scratch mockup of what each individual tool's *own* UI could look like
  (list+detail panes, health pills, etc.) exists as a Claude Artifact. The
  explicit decision so far is **shell-first**: wrap the existing real tool
  components in the new shell as-is, and only consider rebuilding their internals
  later if shell-first turns out insufficient. Do not rebuild GmailHub,
  SocialStudioPage, LeadFinder, or RemindersPage's actual markup to match the
  mockup without a fresh go-ahead — that's explicitly parked, not cancelled.

Mockup reference (Tier 2, visual language only): `https://claude.ai/artifact/41tYWmivwdNc9WEsk8eUxr`

---

## 1. Structure (Tier 1 — built)

`app/(shell)/layout.tsx` wraps every authenticated route in a persistent sidebar
shell. It's a Next.js route group — adding it changed zero URLs. It does its own
auth/brand check (second line of defense after `middleware.ts`), computes which
modules are locked (`lib/modules/lock-state.ts`), and renders:

```
<div class="app-shell">
  <AppSidebar brandName lockedTypes />   <!-- components/AppSidebar.tsx -->
  <div class="app-shell-main">{page content}</div>
</div>
```

Routes currently inside `app/(shell)/`: `dashboard` (+ `[moduleId]`, `keywords`,
`meta-ads/blueprint`), `today`, `gmail-hub`, `social`, `lead-finder`,
`engagement-hub`, `reminders`, `settings`, `analytics`, `authAnalytics`,
`authJourney`, `tools`. Everything outside it — `(auth)/login`, `/signup`,
`/onboarding`, `/admin/*`, `/oauth/*` — is intentionally unwrapped.

## 2. Navigation (Tier 1 — built)

`components/AppSidebar.tsx`. Real `<Link>`s, `usePathname()` for active state —
no client-side fake nav switching.

```
Grow
  Growth Path     → /dashboard
  Today           → /today
Work
  Outreach        → /gmail-hub                    (locked if 'gmail-outreach' module is locked)
  Social Studio   → /social
  Meta Ads        → /dashboard/meta-ads/blueprint  (locked if 'meta-ads' module is locked)
  Lead Finder     → /lead-finder
  Reminders       → /reminders
Insights
  Analytics       → /analytics
— pinned at bottom —
  Settings        → /settings
  [workspace: avatar initial + brand name]
```

Deliberate omissions:
- **Engagement Hub** (`/engagement-hub`) is not in the nav. The page still works,
  it's just unlinked — a design call, not a bug.
- **Outreach and Meta Ads are not in the Growth Path module rail** (see §4) even
  though `gmail-outreach` and `meta-ads` still exist as real modules in
  `lib/modules/registry.ts`. They're Work tools now; keeping them in both the
  rail and the sidebar would duplicate the same thing in two places.
- **`authAnalytics` and `authJourney` are not linked anywhere.** `/analytics` is
  the one real pages actually link to; the other two are dead ends, left
  reachable by direct URL only.

**Lock gating.** `lib/modules/lock-state.ts` mirrors the real rule from
`components/AllModulesDashboard.tsx`'s `isModuleLocked`: a module is locked if
the previous module (by `order`, skipping `comingSoon` ones) scored under 80%,
and nothing is locked outside `NEXT_PUBLIC_APP_ENV=production`. A locked nav item
renders as non-clickable with a lock icon and a tooltip — see
`.app-navitem-locked` in `app/globals.css`.

**Mobile (≤760px):** the sidebar becomes a horizontal scrollable strip (icons +
labels, no wrap, no group labels, workspace footer hidden) instead of stacking —
see the `@media (max-width: 760px)` block appended to `app/globals.css`.

## 3. Design tokens (Tier 1 — use these, don't invent new ones)

Pulled directly from the app's real `app/globals.css` (`:root` = dark default,
`html.light` = light override) — this is the actual production palette, not a
mockup invention.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#fafcfb` | `#0a0c0b` | page background |
| `--bg-soft` | `#f0f6f2` | `#111413` | sidebar / subtle panel bg |
| `--card` | `#ffffff` | `#181b19` | card/surface bg |
| `--line` | `#c8ddd0` | `#262b28` | borders |
| `--text` | `#0c1d13` | `#edf0ee` | primary text |
| `--text-dim` | `#3a6048` | `#8d9690` | secondary text |
| `--text-faint` | `#7aaa8a` | `#555f5a` | tertiary/meta text |
| `--green` | `#179a50` | `#2fbf71` | brand accent |
| `--accent` | `#d0eadb` | `#1c2420` | soft accent bg (active nav item, chips) |
| `--accent-foreground` | `#14a04e` | `#4ade80` | text on `--accent` |
| `--gold` | `#7a5a08` | `#e7c873` | secondary accent |
| `--locked` | `#90b8a0` | `#363b38` | locked-state indicator |

Warn/danger (reused from the real Gmail Outreach prospect-card tokens, don't
reinvent — `--gop-warn-*` / `--gop-err-*` in `app/globals.css`):

| | bg | border | text |
|---|---|---|---|
| warn (light) | `#fffbeb` | `#fde68a` | `#92400e` |
| warn (dark) | `#1a1000` | `#3d2800` | `#fbbf24` |
| danger (light) | `#fef2f2` | `#fecaca` | `#dc2626` |
| danger (dark) | `#1a0505` | `#4a1515` | `#f87171` |

**Fonts** (`app/layout.tsx`'s `next/font` setup — exact, don't substitute):
- **Fraunces** (serif) — headings/display, `var(--font-display, 'Fraunces', serif)`
- **Outfit** (sans) — body text, `var(--font-body, 'Outfit', sans-serif)`
- **Geist Mono** — numerals, labels, stat values, mono-styled uppercase tags

Shell-specific classes already in `app/globals.css`: `.app-shell`,
`.app-sidebar`, `.app-sidebar-brand`, `.app-sidebar-mark`, `.app-sidebar-group`,
`.app-sidebar-glabel`, `.app-navitem` (`.active`, `.app-navitem-locked`),
`.app-sidebar-foot`, `.app-sidebar-workspace`, `.app-sidebar-avatar`,
`.app-sidebar-wsname`, `.app-shell-main`.

## 4. Page-by-page (mix of built, partially built, and pending — see PROGRESS.md)

**Growth Path** (`/dashboard`, `components/AllModulesDashboard.tsx`) — currently
renders its pre-existing real module-list UI, just wrapped in the new shell.
**Pending** (not yet built in real code): a "0→500 users" journey band above the
module list, and trimming the rail's step count now that Outreach/Meta Ads moved
out (rail should show Foundation, Website Audit, SEO, GEO, Social Media, Brand
Audit, Content Audit, Competitor Analysis, User Analytics, Audience Discovery —
10 steps). Journey band should wire to a real PostHog signup count, not a
placeholder. Visual reference for the journey band concept: the mockup's
`renderJourney()` (Tier 2 — layout/visual idea only, data source must be real).

**Today** (`/today`, `components/TodayDashboard.tsx`) — real, already fully
built (signal cards, streak, analytics bar, social feed, weekly blog section).
Just wrapped in the shell. Not part of the visual redesign — leave its internals
alone unless separately asked.

**Outreach** (`/gmail-hub`, `components/GmailHub.tsx`) — real component, own
existing UI (Inbox Intelligence / Campaigns / Follow-ups tabs). Untouched by this
redesign (Tier 1 = shell wrapper only).

**Social Studio** (`/social`, `components/SocialStudioPage.tsx`) — same: real,
untouched, shell wrapper only.

**Meta Ads** (`/dashboard/meta-ads/blueprint`, `components/NextCampaignBlueprintPage.tsx`
+ `components/MetaAdLaunchPanel.tsx`) — real, untouched, shell wrapper only.

**Lead Finder** (`/lead-finder`, `components/LeadFinder.tsx`) — real, untouched,
shell wrapper only.

**Reminders** (`/reminders`, `components/RemindersPage.tsx`) — real, untouched,
shell wrapper only.

**Analytics** (`/analytics`, `components/AnalyticsDashboard.tsx` under
`app/(shell)/analytics/`) — real, untouched, shell wrapper only. (The mockup
merged "Analytics" and a separate "User Journey" Insights page into one — that
was a mockup-only simplification; the real app never had two competing pages
here, so there's nothing to merge in real code.)

**Settings** (`/settings`, `components/SettingsPage.tsx`) — real, untouched for
now. **Pending decision**: should eventually become a tab/section inside the
shell rather than its own standalone page, to match the sidebar's mental model.
Not started.

**Engagement Hub** (`/engagement-hub`) — real, untouched, shell wrapper applies,
but intentionally not linked from the sidebar (see §2).

## 5. Tier 2 — the mockup's visual language (reference only, needs go-ahead before use)

If/when the decision is made to rebuild a tool's own UI (not just wrap it), the
mockup at the artifact URL above establishes a visual direction worth reusing
rather than re-inventing:

- A shared **list + detail** two-pane pattern for simple tools (300px list rail,
  flexible detail pane) — used there for Outreach/Lead Finder/Reminders.
- **Health pills** (small rounded status chips with a colored dot + optional
  issue count) for audit-style overviews — used there for Meta Ads.
- **Chip semantics**: `new`/accent-soft for positive/ready states, `warn` for
  needs-attention, `danger` for blocked/restricted/critical.
- Real per-tool content shapes researched directly from the actual components
  (GmailHub's AI-draft + quick-actions pattern, SocialStudioPage's
  per-platform AI-Suggest cards gated by `shouldPost`, LeadFinder's
  review-mined `fitScore`/pain-points, RemindersPage's `category`+`intervalDays`
  model) — if this tier is ever greenlit, match the *real* component's actual
  data shape, not a generic placeholder, the way that mockup round did.

Do not implement this tier without an explicit decision to move past shell-first.

## 6. What's next

See `PROGRESS.md`'s "Not done yet" section for the live, authoritative list —
as of this writing: the Growth Path journey band + PostHog wiring, trimming the
module rail to 10 steps, and the Settings-as-tab decision. Also check the open
task list (tasks #10–#19 as of this writing) for unrelated-to-UI but still
pending backend/content gaps found during this session's audits — those are not
UI work, don't conflate them with this spec.
