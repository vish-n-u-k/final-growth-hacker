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

## Not done yet (next up)

- [ ] Persistent sidebar shell (Grow / Work / Insights groups, per the artifact) as a
      real `layout.tsx` wrapping the authenticated app routes.
- [ ] Wire real components (`GmailHub`, `SocialStudioPage`, `LeadFinder`,
      `RemindersPage`, the Meta Ads blueprint page) into the new shell as the Work
      tools' content, in place of each one's current standalone full-page layout.
- [ ] Growth Path page: build the module stepper + the 0→500 journey band against
      live module data (respecting real lock state per decision #5) and a real
      PostHog signup count (decision #6) instead of the mockup's hardcoded numbers.
- [ ] Decide routing: does `/dashboard` itself become the shell, or does the shell
      live at a new path and `/dashboard` redirect into it?
- [ ] Settings becomes a tab/section inside the shell rather than its own standalone
      page (matches the mockup's `Settings` nav item).

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
