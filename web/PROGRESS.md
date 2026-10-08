# Dashboard Redesign — Progress Log

Branch: `claude/dashboard-shell-redesign` (cut from `main`).
Goal: replace the current hub-and-spoke dashboard (every tool a standalone page,
reached from `/dashboard`, left via `useSmartBack`) with a persistent sidebar shell,
based on the design worked out in a Claude Artifact mockup:
`https://claude.ai/artifact/41tYWmivwdNc9WEsk8eUxr`

Keep this file updated as work lands — newest entry on top. This is the
source of truth for "what's actually been done" on this branch.

---

## Decisions locked in before building (don't re-litigate these without asking)

1. Branch starts clean from `main`; the two fixes below were re-applied onto it,
   not carried over as uncommitted diff from the old branch.
2. **Shell-first.** Build the persistent sidebar + slot the *existing* real tool
   components into it. Rebuilding each tool's own UI to match the mockup's visual
   style is explicitly parked — revisit only if shell-first turns out insufficient.
3. The new shell **replaces** the dashboard outright (not a side-by-side `/newui`-style
   experiment).
4. Module consolidation (GEO Competitor Gap→GEO, Community Finder→Audience Discovery,
   Outreach Targets→Gmail Outreach, Email Marketing→Foundation) is **pinned, not now**.
5. Meta Ads and Outreach **keep their real `unlockThreshold` gating** from
   `lib/modules/registry.ts` as-is for now. The sidebar must reflect their real lock
   state, not treat them as always-open the way the mockup did.
6. The 0→500 users journey band wires to a **real PostHog signup count**, not a
   placeholder.

## Done

- **Fix settings page credential exposure** (commit `c61e3fd`). Secrets were being
  sent to the browser in plaintext. `web/app/settings/page.tsx` now masks them
  server-side via `maskSecrets()`, distinguishing "never set" (`null`) from "set but
  hidden" (`''`). `web/app/api/settings/integrations/route.ts`'s POST handler merges
  onto the existing row instead of overwriting, so a blank secret field on save
  doesn't null out a previously-saved credential — while blank non-secret optional
  fields (e.g. social URLs) can still be cleared intentionally.

- **Merge User Acquisition into Business Stage** (commit `817a612`). Removed real
  duplication between the two modules. `lib/modules/business-stage/{definition,
  fetcher,agent}.ts` now carries 10 categories (5 diagnostic + 5 tactical), renamed
  "Growth Stage". Updated both module dispatchers — `app/api/modules/analyze/route.ts`
  **and** the independent duplicate switch in `lib/mcp/tools/analyze_module.ts` — plus
  the registry and every page referencing the old type
  (`AllModulesDashboard.tsx`, `analytics/page.tsx`, `authAnalytics/page.tsx`,
  `analytics/page copy.tsx`). `lib/modules/user-acquisition/` deleted. Also dropped the
  empty `community-finder` category stub from Social Media Audit's definition.

## Done (continued)

- **Persistent sidebar shell** (commit `54b7cba`). New `app/(shell)/` route group —
  a route group adds no URL segment, so every page's URL is unchanged — now wraps
  `dashboard`, `today`, `gmail-hub`, `social`, `lead-finder`, `engagement-hub`,
  `reminders`, `settings`, `analytics`, `authAnalytics`, `authJourney`, `tools`.
  `app/(shell)/layout.tsx` does its own auth/brand check (middleware already gates
  the whole app, this is a second line of defense) and renders the new
  `components/AppSidebar.tsx`: real `<Link>`s, `usePathname()` for active-state —
  no client-side fake nav switching like the mockup. Grouped Grow (Growth Path,
  Today) / Work (Outreach→`/gmail-hub`, Social Studio→`/social`,
  Meta Ads→`/dashboard/meta-ads/blueprint`, Lead Finder, Reminders) / Insights
  (Analytics→`/analytics`, the one that's actually live — `authAnalytics` and
  `authJourney` aren't linked from anywhere real, left alone, not in nav).
  Settings pinned at bottom. Engagement Hub intentionally left out of the nav
  (page still works, just unlinked, matching the mockup's decision) — the folder
  still moved into the shell so it gets consistent chrome if visited directly.
  Only one import needed fixing from the move: `components/NextCampaignBlueprintPage.tsx`
  imported a type by absolute path from the old `@/app/dashboard/meta-ads/...`
  location.
  Tool pages' own internals are **untouched** — shell-only, per decision #2.

- **Real unlock gating for Meta Ads / Outreach** (same commit). Per decision #5,
  these keep gating from the real module system rather than becoming always-open.
  New `lib/modules/lock-state.ts` mirrors `AllModulesDashboard.tsx`'s
  `isModuleLocked` rule (order-chain, 80% threshold from the module's persisted
  `score`, locking disabled outside production) server-side, so the sidebar can
  grey out `Outreach`/`Meta Ads` without importing a `'use client'` component or
  duplicating that component's logic. Locked items render as non-clickable with
  a lock icon and a tooltip.

## Corrections to earlier entries in this log

- **The 0→500 journey band already existed before this redesign.**
  `components/AllModulesDashboard.tsx` already has a live, PostHog-wired progress
  bar (`userCount` state, `/api/posthog/user-count`, `JOURNEY_MILESTONES =
  [0,100,200,300,400,500]`, a filled track + "X users · you're here" tag, manual
  entry fallback via localStorage). An earlier version of this log listed building
  this as "not done yet" — that was wrong, written without checking the real
  component first. Nothing to build here; decision #6 (wire to real PostHog) was
  already satisfied before this session started.
- **Trimming the module rail to 10 steps was also a mistake**, now retracted from
  `UI_SPEC.md` too. `gmail-outreach` and `meta-ads` are still real sequential-unlock
  modules in `lib/modules/registry.ts` — hiding them from the visible rail while
  they still gate later modules would be confusing, and it contradicts decision
  #5 ("keep modules as-is for now"). Not doing this without a real registry
  restructure, which is out of scope right now.

## Styling pass (Tier 2, CSS/inline-style only — logic untouched)

Per the UI_SPEC.md Tier 2 note: Reminders' real layout turned out not to be a
list+detail shape at all (it's a sectioned card list that already shows full
detail inline — forcing it into two panes would be worse, not better), so
instead of restructuring any page, did a targeted visual-consistency pass:
converted every status/category "badge" or "tag" chip across the 5 Work tools
from a small rounded rectangle to a true pill (border-radius 99px), matching
the mockup's chip convention. Cards, buttons, and panels were already close to
the mockup's own radii (9-16px) and were left alone. Changed:
- `app/globals.css`: `.rm-cat-badge` (Reminders), `.gh-tag`, `.gh-filter-badge`,
  `.gh-pc-badge`, `.gh-gen-sent-badge`, `.gh-history-badge`,
  `.gh-cmp-status-badge`, `.gh-fu-tag` (Outreach/GmailHub + FollowUpsTab).
- `components/SocialStudioPage.tsx`: `PlatformPill` and `StatusPill` inline
  styles (both were already named "Pill" but rendered as rounded rectangles).
- Lead Finder (`.lf-fit-badge`) and Meta Ads (`.bp-health-pill`, `.mlp-tag`)
  were already pill-shaped — no change needed there.
- Deliberately left out of scope: `GmailOutreachProspects.tsx`'s `.gop-*`
  classes — that component only renders inside Today's inline outreach panel,
  not inside the Outreach page itself, and Today is explicitly not part of this
  redesign. Also left Engagement Hub (`.eh-*`) and Analytics (`.an-*`/`.ov-*`)
  alone — neither is one of the 5 target pages.
- **Not visually verified** — this environment has no `node_modules`/dev
  server, so none of this has been seen rendered. These are small, scoped,
  pure-CSS value changes (no JSX/logic touched), but check it in a browser
  before trusting it.

## Growth Path redesign (dashboard) — rendered and checked this time

`components/AllModulesDashboard.tsx` now follows the mockup's layout. Logic
(scoring, lock rule, analyse/export/fix flows, every module's inner content) is
untouched — the change is the page structure around it:
- **Topbar** (Growth Path / "Step N of M — Module") replaces the old standalone
  header; its logo, Tools and Settings buttons were redundant with the sidebar.
  Theme toggle, Notes and Sign out stay here (the sidebar has none of them).
- **Road-to-500 band** replaces the hero + old milestone bar. Uses the Business
  Stage module's own ranges (0–10 / 10–50 / 50–100 / 100–250 / 250–500) so the
  band and the stage playbook agree. PostHog-disconnected state keeps its
  Connect / See-what-we-track actions.
- **Step rail** + **one module at a time**: the accordion of every module is gone;
  the rail picks which module card shows. Defaults to the first unlocked module
  under 80%. An unlock bar above the card mirrors the real lock rule (it only
  says "unlocks X" when X actually depends on this step — the first three
  modules never gate each other).
- **Growth Stage card** (sticky, right): classification + concern from the
  Business Stage module, with "View full playbook". This also fixes a gap — the
  playbook modal was previously only reachable while PostHog was *disconnected*.
- **Removed:** the hardcoded "Projected MRR $9.5K ($19 × 500)" box. It showed a
  fixed number with a tooltip claiming it was "sourced from your website" — it
  wasn't. Bring it back only if it's wired to real pricing data.
- Sidebar now has the mockup's icons. Fixed two bugs found once this could be
  rendered: the mobile nav strip overlapped its own items (nav items inherited
  `width: 100%`), and unconnected social icons were white boxes in dark mode
  (light-only colors hardcoded).
- **Verified:** `tsc` clean; rendered with mock data in light, dark, mobile
  (390px), PostHog disconnected, a locked step selected, and the playbook modal.
  Not verified against real DB data.

**Polish pass (follow-up).** Topbar now lines up with the content column. The
step rail is a bordered card with a "N of M modules complete" summary, and it
auto-scrolls the selected step into view. The module card is lighter: no
double accent stripe, no dead chevron, a tighter header, and category rows with
a neutral border (green when open). Social icons are smaller. The footnote is
left-aligned under the column. On mobile, the stray divider in the website/social
row is hidden. All styles are scoped under `.gp-*` in the "Growth Path polish"
block of `app/globals.css`, because other pages reuse `.level` / `.md-cat`.
Re-rendered in light, dark and 390px; `tsc` clean.

**Step rail → phases.** The 16-step horizontal rail (mostly identical grey
padlocks, wrapping names, running off-screen) is replaced by 4 phase cards:
Get set up (order 1–3), Get found (4–7), Win attention (8–11), Scale (12+).
Each card shows done/total and a progress bar, or a lock if every module in
it is locked. Only the selected phase's modules show below it, as pills.
Clicking a phase opens its first unlocked, unfinished module. The grouping is
**display-only** (`GROWTH_PHASES` in `AllModulesDashboard.tsx`, by registry
`order`), so locking is still per-module. The phase blurbs are hardcoded, so
update them if modules move. Rendered in light, dark, 390px and with a locked
phase selected; `tsc` clean.

**Mobile pass.** Checked at 320, 360, 390, 430 and 768px, with the page as
loaded, with a category and item expanded, and with the playbook modal open.
No horizontal overflow anywhere. Fixes:
- Module title no longer truncates ("Website Auc…"); it wraps instead.
- Export and Re-analyse are at least 36px tall, and phase pills are 36px, so
  they're easier to tap.
- Expanded items have less nested padding.
- The playbook modal opens as a bottom sheet on phones. Re-analyse no longer
  wraps, and the tabs scroll sideways instead of being clipped.
On phones, Sign out is hidden from the topbar, but it's still reachable via
Settings in the nav strip.

**Mobile pass: Work/Insights pages.** I rendered Today, Outreach (connected and
not connected), Social Studio, Lead Finder, Reminders, Analytics, Settings
(including the integrations tab) and Meta Ads with mock data at 320, 360, 390,
430, 768 and 1024px. None of them scroll sideways any more. Fixes:
- **Outreach**: the connect screen's 2-column layout (1fr + 460px) now stacks
  below 1000px, so the preview no longer runs ~430px off-screen. The stat row
  is 3 columns on tablets and 2 on phones (it was 5 squashed columns). The
  Gmail-permission rows wrap, and the tab bar scrolls sideways.
- **Reminders**: the header buttons wrap, so "+ Add" isn't pushed off-screen.
  On phones, each card's title gets its own line instead of being cut to
  "Review your p…".
- **Analytics**: the fixed 4/3/2-column inline grids (now `.an-g4/.an-g3/.an-g2`)
  become 2 columns below 1000px, and the 2-column grids become 1 column on
  phones. The header wraps, and badges in the card headers wrap.
- Today, Social Studio, Lead Finder, Settings and Meta Ads already worked.
  Not changed.
Caveat: lists that load data client-side (Outreach inbox, Lead Finder results)
were checked with an empty or error state, not with real rows.

**Fix: Foundation's first analysis after signup "spins then shows nothing".**
Cause: the dashboard waited on one long POST (crawl plus two AI calls, sometimes
analysed twice). A dropped connection (phone locked, flaky network, platform
timeout) lost the result. The error was only shown inside a setup form that
Foundation never shows. Every reload started another full run, because
`lastAnalyzedAt` is only set at the very end.
- `POST /api/modules/analyze` with `background: true` now returns 202
  immediately and keeps running via `after()`. The new `GET
  /api/modules/analyze?moduleId=&runId=` reports running / failed (with the
  message) / done (same payload as the synchronous POST). Callers that don't
  pass `background` still get the old synchronous behaviour.
- One run per module: `claimRun()` (`lib/modules/runs.ts`) atomically flips the
  module to `analyzing`. A second request (reload, other device) joins the live
  run. A run still `running` after 5.5 min (killed at maxDuration) is marked
  failed ("took too long") and can be retried.
- Dashboard: starts in background mode and polls every 3s, retrying network
  blips and checking straight away when a backgrounded tab comes back. On load
  it rejoins any module already `analyzing`. Errors now show on the module card,
  and a first run shows "Analysing your site… you can leave this page". When
  Foundation finishes, `router.refresh()` makes the playbook, logo and theme
  appear without a reload.
- AI-generated items (content audit, dynamic modules) are now replaced inside a
  DB transaction, so a page load never sees them half-written.
- **Needs `drizzle/module_runs.sql` run in Supabase.** Without it everything
  still works in the background, but there's no dedupe and no error message
  (the spinner just stops).
- Verified against a local Postgres with a mocked auth service and a
  deliberately slow site:
  - 202 returned at once, and a duplicate POST joins the same run;
  - running → failed with the message, and the module is released;
  - a killed run is reported as failed and taken over by the next POST;
  - legacy stuck `analyzing` with no runs → idle;
  - the table missing → no crash;
  - synchronous callers are unchanged.
  The browser flow was checked with mocked responses: one POST, a dropped poll
  retried, results applied, the error shown, the playbook appearing after the
  refresh. A real AI run was not exercised (no API key here).

**Real-phone pass (after a tester's "UI isn't proper on phone").** Checked against
a local DB with a real (mocked-auth) session, not just mock props: login,
signup, onboarding and every shell page at 390 and 320px.
- **Settings was unreachable on phones**: it lives in the sidebar footer, which
  the mobile strip hid, and so did sign-out (the header's Sign out is also
  hidden on mobile). The footer now shows Settings in the strip.
- **iOS zoom-on-focus**: fields were 12–15px, and iOS Safari zooms (and stays
  zoomed) on any field under 16px. Fields are 16px on phones and touch devices.
- Nav strip: the right edge fades so it reads as scrollable, and the current
  page's item scrolls into view.
- Duplicate pre-shell chrome is hidden on phones (Today's mini nav, the second
  logo bar on Settings/Reminders, "← Back" links). The single-module page and
  Keyword Tracker keep their headers because those hold real actions.
- Analytics' back button had no click handler at all; removed.
- Module card on phones: the buttons keep their labels ("Analysing…",
  "Re-analyse") instead of a bare icon. The Playbook and competitor-URL panels
  get phone margins, and the playbook's long subtitle is hidden. It shows
  "Generating…" while Foundation runs.
- **Noticed, not changed:** when an AI call fails, the raw SDK error text
  reaches the user (e.g. "Could not resolve authentication method…"). Worth
  mapping to a friendly message.

**Phone nav → side drawer.** The horizontal scrolling strip felt odd to testers.
On phones, a slim top bar with a menu button now opens the full sidebar as a
drawer: same groups and labels, Settings and the workspace. It closes on
navigation (including tapping the current page), backdrop tap or Escape. Body
scroll is locked while it's open, and focus goes to Close, then back to the menu
button. Locked items stay visible but greyed out. Desktop is unchanged.
Verified with real routing at 390 and 320px (every shell page still has no
horizontal scroll) and at 1280px.

**Logo and chopped words (checked with the real fonts this time).** Earlier
screenshots used a fallback serif because this sandbox can't reach Google Fonts,
so text that fit for us overflowed on real phones. The test browser now loads
Fraunces/Outfit/Geist/Geist Mono from @fontsource and flags any clipped or
ellipsised text.
- The sidebar, drawer and phone bar use the real `/growjinlogo.svg` instead of
  a plain green square.
- Module card title was cut to "Fo…" on phones: once a module has been analysed
  it shows Export and Re-analyse, and the title had to share their row. On
  phones the header is now a grid: score ring and title on row 1, buttons on a
  full-width row 2.
- The Playbook panel was inset 20px more than the categories: an old
  `.level-body > div:first-child { padding: 12px 18px !important }` phone rule
  was winning. Overridden with a more specific selector.
- Result: no cut-off text on any shell page, login, signup or onboarding at 320,
  360, 390, 430, 768 or 1280px with the real fonts.

**Known, not fixed (pre-existing):** `middleware.ts`'s matcher doesn't exclude
`.js` files in `public/`, so for logged-out visitors (i.e. the real /login page)
`/fb-widget.js` is redirected to `/login` and the HTML is parsed as JS — a
console error on the login/signup pages.

## Not done yet (next up)

- [ ] Nothing currently queued for the Growth Path page — both items above turned
      out to be already-done or inadvisable. If there's a real UI gap here, it
      needs a fresh, specific ask rather than the two retracted items above.
- [ ] Settings-as-tab: on reflection this is likely already satisfied by the shell
      wrap itself — `/settings` already renders inside `app-shell-main` with the
      sidebar still visible, which is functionally what "a section inside the
      shell" meant in the mockup (there, "tab" just meant "the sidebar stays put
      and only the content area swaps," which real routing already gives for free).
      Leaving this un-checked until confirmed there's a concrete gap beyond that.
- [ ] Known perf duplication: the shell layout re-queries `brands` on every
      navigation, on top of each page's own identical query. Not wrong, just
      redundant — worth deduping (React `cache()`, or lift the brand lookup higher)
      once the shell's shape has settled.
- [ ] Not build-tested — this environment has no `node_modules`/`next` binary, so
      none of this has run through `next build` or a dev server. Verified instead
      by exhaustive grep for anything importing the moved paths by filesystem
      location (vs. URL, which route groups don't change). Run a real build before
      trusting this in production.

## Explicitly not doing right now (pinned, see decision #4)

- `lib/modules/competitor-audit/` — looked dead, isn't: still referenced by
  `app/api/modules/analyze/route.ts` and `lib/mcp/tools/get_competitors.ts`.
- Email Marketing → fold into Foundation — too big for a trivial merge (410 lines,
  7 categories, 36 items, its own DNS rule-engine).
- Fold GEO Competitor Gap into GEO Audit.
- Consolidate Community Finder into Audience Discovery.
- Merge Outreach Targets into Gmail Outreach (rename combined module "Outreach").
- Meta Ads missing `lifetime_budget` field; Content Audit missing "Repurpose" verdict.
- SEO `enrichMeta` wiring (the sitemap crawl itself already works).
- User Analytics real-time concurrent-users query + Recharts wiring.

## Reference

- Mockup artifact (design source of truth for the shell's look/structure):
  `https://claude.ai/artifact/41tYWmivwdNc9WEsk8eUxr`
- Earlier, now-superseded module-slider experiment: `web/app/newui/page.tsx`
  (on `main`, commit `58ec688`) — not being carried forward as-is.
