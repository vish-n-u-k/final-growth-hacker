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
