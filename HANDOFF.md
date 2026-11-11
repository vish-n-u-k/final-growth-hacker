# GrowJin: handoff for the next session

Last updated 4 Nov 2026. Read this first. It covers what the app is, how the code is laid out, what was built recently, and what we are in the middle of.

## 1. What the app is

> **11 Nov:** the app works as before (login lands where it did, Today and Growth Path are back). **Ask (`/ask`)** is open to any signed-in user from an "Ask" item at the top of the sidebar or by typing `/ask`; its header links "Back to the app". `NEXT_PUBLIC_ASK_HOME=on` makes Ask the home page for early-access users again (section 4g-6). Ask's APIs use `askAccess()` (signed in + brand + Pro when billing is on), not `agentAccess()`.

**GrowJin** helps a small business grow. A user adds their brand (website, audience, competitors). GrowJin then tells them what to fix and does a lot of the outreach work for them. The test brand we use in demos is **Frekto**, an AI social media post maker.

The app has three parts, which match the left sidebar (`web/components/AppSidebar.tsx`):

1. **Today** (`/today`): a daily to-do list of the most useful things to do, picked from all the data.
2. **Your roadmap / Growth Path** (`/dashboard`): modules such as Foundation and Website Audit. Each one is a checklist that is analysed and scored. **These module pages are the visual reference for the whole app** (see section 5).
3. **Tools**, in three groups:
   - **Get customers**:
     - **Lead Agent** (`/agents/leads`)
     - **Competitor Leads** (`/lead-finder`)
     - **Email Outreach** (`/gmail-hub`)
   - **Get seen**:
     - **Search & AI** (`/search-ai`): rankings, AI answers, keywords judged weekly (see 4e-4)
     - **Search Agent** (`/agents/search`)
     - Social Studio
     - Meta Ads
   - **Keep track**:
     - Reminders
     - Analytics

What each tool does today:

| Tool | What it does |
|---|---|
| **Lead Agent** | Two jobs, shown as two tabs. **Email**: finds businesses on Google Maps through DataForSEO, or online **companies like your customers** through Hunter Discover (see 4d), finds their email through Hunter, writes an email and you approve it. Follow-ups go out by themselves and stop when they reply. **Add your own emails** (top of the Email tab): paste or upload your own people, one email written for all with first name and company filled in, approve all at once; sent within the daily limit with the same follow-ups. **Community**: finds Reddit and Hacker News posts asking for a tool like yours, writes a reply, and you post it yourself. It does **not** read competitor reviews any more; that is Competitor Leads' job. |
| **Competitor Leads** | You pick a competitor. It reads their newest Trustpilot or Shopify App Store reviews, scores how well each unhappy reviewer fits, and you reach out in two steps (their email, then review & send). |
| **Email Outreach** | Campaigns from your Gmail, as a list, each done in three steps: who gets it, write the emails, review & send. Recipients can be pasted or uploaded as a file (CSV, Excel, PDF, Word, text, .vcf). Also has follow-ups as cards, an Inbox limited to threads GrowJin sent (replies first, tagged by what they say), and a Done tab. |
| **Search Agent** | Weekly research (DataForSEO plus AI answers), then a to-do list: posts to write (drafted for you), sites to pitch, and "other things to do". Those last ones are actionable: fix how AI describes you, get listed on G2 and similar, pitch article sites. Also Rankings and AI answers tabs. |

## 2. Code and stack

- **App:** `web/` is a Next.js 16 App Router app (Turbopack). It is **not** the Next.js in your training data, so read `web/AGENTS.md` and `node_modules/next/dist/docs/`.
- **Database:** Postgres on Supabase, through Drizzle (`web/lib/db/schema.ts`).
  - **SQL migrations are run by hand** in the Supabase SQL editor (`web/drizzle/*.sql`).
  - `web/drizzle/tool_suggestions.sql` must have been run, or saving leads and campaigns silently does nothing.
- **Auth:** Supabase. `web/middleware.ts` protects every route.
- **Styles:** one big `web/app/globals.css`, with prefixes per area:
  - `th-*` the tool header
  - `tu-*` the shared tool UI
  - `cl-*` Competitor Leads
  - `ro-*` step pages
  - `eo-*` Email Outreach
  - `gp-*` and `md-*` the Growth Path modules
  - `td-*` Today
- **Fonts:** Fraunces for display, Outfit for body. Colours are CSS tokens (`--green`, `--text`, `--text-dim`, `--text-faint`, `--line`, `--warn`, `--crit`…).
- **Agents' storage:** each brand gets JSON documents in `signal_snapshots`: `agent:lead`, `agent:search`, `agent:demo`, plus `…:demo` copies (see `web/lib/agents/store.ts`).
- **Saved suggestions:** every lead, email, topic and link is also saved as its own row in the `tool_suggestions` table (`web/lib/tool-suggestions.ts`).
- **Daily run:** a cron job in `web/vercel.json` calls `/api/cron/agents` at 04:00 UTC, in production only, for agents that are switched on.

### Key files

| Area | Files |
|---|---|
| Shared tool UI | `web/components/ToolHeader.tsx`, `web/components/tool-ui.tsx` (Tabs, Card, ActionBar, Flow, Side, LiveProgress, Pager / usePages, useShowAll, DemoSwitch) |
| Lead Agent | `web/components/agents/LeadAgentPage.tsx`, `web/lib/agents/lead-agent.ts`, `web/app/api/agents/lead/route.ts` |
| Search Agent | `web/components/agents/SearchAgentPage.tsx`, `web/lib/agents/search-agent.ts`, `link-opportunities.ts`, `task-help.ts` + `task-kinds.ts` (actionable to-dos), `web/app/api/agents/search/route.ts` |
| Competitor Leads | `web/components/LeadFinder.tsx`, `web/components/lead-finder/ReachOut.tsx`, `web/app/api/lead-finder/*` |
| Email Outreach | `web/components/GmailHub.tsx`, `web/components/email-outreach/*` (Campaigns, FollowUps, Done, shared), `web/components/InboxTab.tsx`, `web/lib/email-outreach/followups.ts`, `web/lib/gmail/conversations.ts` (Inbox list), `web/lib/outreach/file-contacts.ts` (file upload), `web/app/api/outreach/campaign/route.ts` |
| Demo mode | `web/lib/agents/demo.ts` (`withDemo` / `agentsDemo` use AsyncLocalStorage, so the setting applies per brand, per request) |
| Today | `web/components/TodayDashboard.tsx` |
| Loading | `web/components/ui/loading.tsx` (every loader), `web/lib/page-info.ts` (the cards' words), `ld-*` block in `globals.css` |
| Modules | `web/components/AllModulesDashboard.tsx`, `web/lib/modules/registry.ts` |

### Outside services and keys

| Service | Used for | Key |
|---|---|---|
| DataForSEO | Google Maps businesses, search data, rankings, AI answers, backlinks, Trustpilot reviews. All calls in `web/lib/agents/dataforseo.ts`. Pay-as-you-go; the owner bought $50 of credit on 26 Oct 2026. Backlinks no longer need a monthly commitment (dropped 1 Jul 2026). | `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` |
| Hunter | Emails, all through `findEmail` in `web/lib/agents/hunter.ts`. Free plan for now: 50 credits a month, 1 credit per email returned, misses free. | `HUNTER_API_KEY` |
| Gmail | Sending, through OAuth per brand | (per-brand OAuth) |
| Claude | Scoring and writing, through `web/lib/ai/client.ts` | — |

- **Demo mode** is a per-brand switch on the agent pages. Businesses, results and emails are made up, and nothing is sent.
- Demo mode is **forced on until the DataForSEO keys are set**.

## 3. Branch and working rules

- **Work and push on `dev`.** Push to **`main` only when the owner says so.**
  - `main` and `dev` were both brought up to the Ask branch (`claude/understanding-session-7y3nz3`, sections 4g–4g-10) on 11 Nov 2026.
  - Before that, `main` was last brought up to `dev` on 10 Nov 2026 (MCP Search Agent tool and audit false-pass fix; `main` and `dev` had split on 6 Nov and were joined again then).
  - 6 Nov: only the work log commit (4h) was cherry-picked to `main`; the Search & AI and Foundation work (4–5 Nov) is still on `dev` only.
- **Release notes:** add what users will notice to `CHANGELOG.md` (newest first: New / Improved / Fixed). Frekto (GitHub: this repo) turns GitHub releases and merged pull requests into update posts. Direct pushes to `main` don't show up there.
- Don't open pull requests unless asked.
- Commit message footer used so far:
  ```
  Co-Authored-By: <the model>
  Claude-Session: <link>
  ```
  No model names in code.
- Before pushing:
  - `cd web && npx tsc --noEmit -p .`
  - For anything going to `main`, run a full build. In a sandbox without secrets it needs placeholder env vars:
    ```
    NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=x RESEND_API_KEY=re_x \
    OPENAI_API_KEY=x ANTHROPIC_API_KEY=x STRIPE_SECRET_KEY=sk_x DATABASE_URL=postgres://u:p@127.0.0.1:9/db npx next build
    ```
- ESLint has no config in this repo, so skip it.

### Testing UI without a login or database

This is how every screen was checked:

1. Make a temporary `web/app/zz-preview/<name>/page.tsx` that renders the component with made-up props.
   - To get the real sidebar, wrap it in `RoadmapProvider` + `.app-shell` + `AppSidebar`.
2. Let `/zz-preview` past the auth check in `web/middleware.ts`:
   ```
   pathname.startsWith('/api/cron/') || pathname.startsWith('/zz-preview')
   ```
3. Run:
   ```
   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=x npx next dev -p 3125
   ```
4. Drive it with Playwright, using Chromium at `/opt/pw-browsers/chromium`. Fake the API with `page.route('**/api/**', …)`.
5. **Afterwards always:**
   ```
   rm -rf web/app/zz-preview web/.next && git checkout -- web/middleware.ts
   ```

Gotchas:

- The dev server often keeps serving **old global CSS**. Kill it, delete `.next`, and start it on a fresh port.
- Kill servers with `lsof -t -iTCP:<port>`. **Never** use `pkill`/`pgrep -f "next…"`: it matches your own shell and kills it.
- `globals.css` has a bare `header { display:flex; border-bottom… }` rule. Any `<header>` you add must override it. `.th` already does.

## 4. What was done recently (all on `dev`)

1. **Email Outreach rebuilt.**
   - Tabs: Follow-ups / Inbox / Campaigns / Done.
   - Inbox lists only threads GrowJin sent, from our own records (`outreach_emails`, reminders, agent data); messages load from Gmail on open and aren't stored. The reply check tags replies (wants a call / interested / question / objection / later / other) in `reminders.followup_intent` — **run `web/drizzle/reminders.sql` before deploying**, or every reminders query fails.
   - Campaign step 1 has "Upload a file": `/api/outreach/parse-file` takes emails straight from the file (no AI).
   - Campaigns are a list, each in 3 steps, autosaved.
   - The campaign API keeps one row per campaign.
   - Follow-ups are cards with Skip + Undo.
2. **Lead Agent, Search Agent and Competitor Leads** rebuilt on shared parts:
   - Tabs, cards, action bar.
   - A two-step page per item.
   - Live progress on the page.
   - Skip with Undo.
3. **Lead Agent:**
   - Competitor reviews removed as a source.
   - Each source is capped at 10 finds, so Reddit can't crowd out the others.
   - Emails: from DataForSEO's listing, then the business's own contact pages (free), then Hunter.
   - Email / Community tabs, each with a To do / Waiting / Done filter.
4. **Lead Agent "Add your own emails"** (`components/agents/OwnListFlow.tsx`, `lib/agents/own-list.ts` + `own-list-text.ts`, ops `list_check` / `list_draft` / `list_add`).
   - 3 steps: who gets it (paste or file, via `/api/outreach/parse-file`), the email (`{first name}` / `{company}` filled per person), review & approve all.
   - Skips repeats, people already in the Lead Agent, already emailed (`outreach_emails`) or opted out (`email_suppressions`). Up to 100 per list.
   - Each person becomes a lead (`source: 'own'`, `listId`), queued; today's share sends at once, the rest with the daily run.
   - The daily run now also runs for brands with daily search **off** if they have queued or sent leads: it checks replies, sends follow-ups and queued emails, but doesn't search.
5. **Demo mode switch** per brand. Demo data is stored apart from real data.
6. **Paging:** every list longer than 8 pages at 8. Tables and short lists use "Show all".
7. **Search Agent "other things to do"** are actionable:
   - Fix-it wording
   - Directory listing + review request
   - Article sites turned into pitches
   - Reddit
8. **Look matched to the module pages:**
   - Breadcrumb, 32px serif title, 14px line under it.
   - Module page width.
   - Eyebrow section labels, 14px card corners.
   - Applies to every tool and Today.

8. **Loaders, all in one place** (preview: `design-previews/tools-cleanup/loaders-calm.html`).
   - `web/components/ui/loading.tsx` holds every loader: `Spinner`, `LoadingState`, `Skeleton` / `ListSkeleton` / `PageSkeleton`, `WaitPanel`, `WhileYouWait`, `AboutPage`. `ui/spinner.tsx` only re-exports. Styles are the `ld-*` block in `globals.css`. To change or replace the look, change those two places; the `LOADING` settings at the top set the 300 ms delay, the card speed, and `cards: false` hides the "While you wait" cards everywhere.
   - Page switch: grey blocks in the shape of the page (tool, module, Today), fading in after 150 ms.
   - Long waits (Lead and Search Agent runs, reading reviews, first module analysis, onboarding) show steps, a bar, time left, "Taking longer than usual" after 2× the usual time, and a "While you wait" card.
   - "About this page" sits in every tool header that has an intro (and Today). Card text lives in `web/lib/page-info.ts`; each fact names its source.
   - The ~10 old spinners and 6 skeleton styles were replaced; "Loading…" texts now say what is happening.

## 4b. New tool: Lead Finder (`/leads`)

One board for every lead source, built from the approved preview `design-previews/tools-cleanup/lead-finder-visual.html` (https://claude.ai/artifact/W3fg6EZv63MUXyeLNnN5yA).

- **Files:** `web/app/(shell)/leads/` (page + layout), `web/components/leads/LeadFinderHub.tsx` (the page), `web/components/leads/model.ts` (joins the two data sets), `lfh-*` block at the end of `globals.css`.
- **No new API or tables.** Google Maps, Reddit, Hacker News and your own lists go through `/api/agents/lead` (Lead Agent data); competitor reviewers through `/api/lead-finder/step` and `/saved` (Competitor Leads data). The old Lead Agent and Competitor Leads pages still work and share the same data.
- **Layout:** source buttons (All, Google Maps, each competitor, Reddit, Hacker News, Your list, +) → a panel for the picked source → board To do / Contacted / Replied → a drawer on the right per item. Finishing one opens the next.
- A competitor's reviewers are merged across all its reads, so people already emailed or skipped stay that way after a re-read.
- The big search button runs the Lead Agent search and re-reads competitors not read in the last 24 h.
- Sidebar: first item under Get customers, icon `people`. Parked like the others (`/leads` in `lib/features.ts`), so only early-access users see it.
- **Calm colours (27 Oct):** no colour per source or person any more. Avatars, source coins, the mix bar, stars, fit bars, follow-up dots, switches and the radar/search buttons are grey. Green is only the "Start here" tag and the drawer's main button; red only marks a reply (thin border + dot on the tile, the Replied lane icon, their message).
- **Caught up with the Lead Agent:** the Hunter "credits used up" note (`hunterOut` flag from `hunterOutThisMonth`), "Finding companies like your customers" in the progress steps, and "Pick for me" in Settings (Google Maps search field only shows when Maps is on).
- Not done yet: the competitor part has no demo mode (the switch only covers the Lead Agent part); replies to competitor emails aren't tracked on the board (they show in Email Outreach); there's no way to remove a competitor from the row.

## 4b-2. Lead Agent and Competitor Leads merged into Lead Finder (29 Oct)

Sketch the owner approved: https://claude.ai/artifact/XA8RCki5iyHUXtV6sH7Jco (the source row on top was kept, as on the real page).
- **Sidebar / Tools:** Lead Finder, Lead Agent and Email Outreach under Get customers (`lib/tools.ts`). The owner asked to keep the old Lead Agent page (`/agents/leads`) as it was (29 Oct); only `/lead-finder` now `redirect('/leads')`; `/lead-finder/review/[id]` still works (ReachOut's back links and its redirect go to `/leads`). Links in Email Outreach, the Search Agent, the agents overview and Today's tasks point to `/leads`. `LeadAgentPage.tsx` and `LeadFinder.tsx` are kept, unused, for now.
- **Source row grouped** (`LeadFinderHub.tsx` `sourceRow`, `FOUND`): All · *Found for you* (Companies, Seller pages, Reddit, Hacker News, Google Maps) · *Search* (LinkedIn) · *Competitors* · Your list · +. Labels `lfh-grp`, each group in `lfh-grp-set` so its label stays with its buttons; on phones the row scrolls sideways as before.
- **From the Lead Agent page:** under the board, "Show 10 more companies and seller pages" (op `more`, lane `email`), "Show 10 more posts" (lane `community`) and "Checked but not kept (N)", a drawer (`panel.kind 'maybe'`, `maybeIn(view)`) with **Use anyway** (op `use`). Shown on All, Companies, Seller pages, Reddit and Hacker News.
- The hero's grey line now names what's searched every morning from the settings.

## 4b-3. Lead Finder: one funnel for every source, two tabs (29 Oct)

Preview the owner approved: `design-previews/tools-cleanup/lead-finder-unified.html` (https://claude.ai/artifact/A9dP2mUPRJ3uUxrjftvojs). The owner asked for the Lead Agent's list look (cards with Skip / Review email).
- **Page (fixed 29 Oct):** `/leads` renders its own page, `web/components/leads/LeadFinderPage.tsx` (`lfp-*` CSS), laid out like the approved preview: quiet top line (Last search · How it finds people · Settings · Find new leads), two tabs, a red line per reply, one green "Start here" panel, then the **Lead Agent's cards** (the owner wanted only the list to look like the Lead Agent, not the whole page). Opened lead = preview's view (who + facts left, email or message right); finishing one opens the next. Side views: Settings (reuses the Lead Agent's `Settings` with `variant="finder"`), How it finds people, Checked but not kept, Sent or skipped, Add your own emails. Same data and API as the Lead Agent (`/api/agents/lead`). Tabs **Contact directly** (everyone you email or message: websites, Maps, LinkedIn, competitor reviewers, seller pages, social-page messages) and **Join conversations** (Reddit, Hacker News). Source is a grey "from LinkedIn / from Google…" word. The opened lead shows the same facts for every source (`LeadFacts`: Sells, Size, Active, Marketing, Social, then Found through and how the email was found). `LeadFinderHub.tsx`, `LinkedInPanel.tsx` and the `/api/lead-finder/linkedin*` routes are kept, unused by the page. The old Lead Agent page is unchanged apart from sharing these fields.
- **New sources inside `runLeadAgent`** (so they go through the same checks):
  - **LinkedIn people** (`settings.sources.linkedin`, `settings.linkedin` filters, Apify via `searchLeads`): `findLinkedIn` → their company's website goes through `checkSites` / `judgeCompanies` like any company (`WaitingSite.person`), plus a `role` check (is this person a decider) and an `owner` name from the page. Cursor `data.linkedinCursor`. "Fill in from my brand" = op `linkedin_suggest` (`suggestFilters`).
  - **Competitor reviewers** (`settings.sources.reviews`, `settings.rivals`): `findReviews` reads Trustpilot (DataForSEO task, waited on briefly, else picked up next search; `data.reviewReads`) or Shopify App Store, 3★ or less, re-read daily, scored by `scoreCandidates`. Old Competitor Leads saves (tool_suggestions) are **not** shown on the new page.
- **After the checks, for kept leads only:** the social check (`checkDomains`, Apify Instagram/Facebook last post, now also the email in an Instagram bio). Not posting for 90 days (or no accounts) adds 1 to the score when `icp.quietSocial` is on (checkbox in the card; unset = on when the brand is a social / content tool, `quietSocialOf`).
- **Email order** (same for every source): email that came with the lead → a person's email on their own site → Hunter (person's name or the owner the site names, else owner/marketing; ≤ `PER_SOURCE` per run) → LinkedIn search for a decider at that domain (`companyDomainIncludes`, one batched call) → shared inbox (contact page or LinkedIn) → Instagram bio email → `lead.dm` (message on their Instagram/Facebook, written on open). "Have their email? Write an email instead" switches a message lead to email.
- New lead fields: `role`, `linkedinUrl`, `foundVia`, `facts`, `emailVia`, `social`, `dm`, `reviewOn`; `LeadSource 'linkedin'`.
- Not tried against real Apify / Trustpilot yet. The run's deadline skips the social check or the LinkedIn lookup when time is short. Demo mode skips LinkedIn and reviews.

## 4b-4. Lead Finder runs on the Lead Engine prompt (30 Oct)

The owner's call: forget our pipeline for Lead Finder, use the "Growjin Lead Engine" prompt as the logic.
- **Prompt:** `web/lib/leads/engine-prompt.ts` (`ENGINE_PROMPT`), the owner's text with three fixes (profile goes in section 8; the app removes repeats, and gets `already_known` domains + `today` in the input; the app enforces a spending cap). Edit the logic there.
- **Engine:** `web/lib/leads/engine.ts`. Claude (`claude-opus-5-5`, default effort) runs the prompt with the MCP tools `dataforseo` / `hunter` / `apify` (same functions as `lib/mcp/tools/*`, same descriptions from `tool-registry.ts`). Manual tool loop; system prompt + tools cached, a breakpoint on the last message each turn; tool results are compacted (nulls and layout fields dropped) and cut to 6,000 characters.
  - **A job in `signal_snapshots` `agent:lead-engine`** (conversation, log, costs). Each request advances it for ~230 s (`advanceEngine`, lock in `lockUntil`); `/api/leads/engine` GET (the page polls every 4 s while running) starts the next stretch with `after()`. **If nobody has the page open, a search pauses** until it's opened again.
  - **Caps** (code, not the prompt): tools `LEAD_ENGINE_TOOL_CAP_USD` (default $0.10 × leads, at least $1), AI `LEAD_ENGINE_AI_CAP_USD` ($3), Hunter `LEAD_ENGINE_HUNTER_CAP` (2 × leads, at least 10), 40 turns, 30 minutes. At a cap, one last turn with `tool_choice: none` and a note asks for the JSON with what it has. "Stop and keep what's found" does the same.
  - **Saving** (`saveAnswer`): leads become Lead Agent leads (`source: 'company'`, `fitLabel` = the rating, score 10…2 from Very Likely…Very Unlikely). Neutral or better go to the list, the rest and `dropped` to "Checked but not kept". Repeats, people already emailed and opted out (`alreadyContacted`) are removed. `email_status` verified / found / guessed / generic → an email to review (guessed and generic say so in `emailVia`); none → "Needs an email", or a message on their Instagram / Facebook if the answer has one. `profile`, `summary`, `tool_issues` and cost go to `data.engineRun`.
- **Page** (`LeadFinderPage.tsx`): Settings is now the brief + five filters (industry, location, company size, who to contact, leads per search), Reddit switch, morning follow-ups, daily limit. "Find new leads" starts a search; the "Searching…" panel shows the last steps, lookups, cost so far and "Stop and keep what's found". "How it finds people" explains the steps and shows the last search's profile, summary, tool problems and cost. Cards show the rating as their badge.
- **Old pipeline:** once `settings.engine` is set, `runLeadAgent` no longer searches companies / Maps / LinkedIn / reviews (it still checks replies, sends follow-ups and finds Reddit posts for "Join conversations"). The Lead Agent page is unchanged.
- `linkedin_people` cap fixed: its actor refuses a run capped under $0.50 (`minimalMaxTotalChargeUsd`), so its cap is never below $0.50 (`minCapUsd`). Opus 5.5 priced at $4 / $20 in `lib/ai/pricing.ts`.
- Tested with a mocked Claude and mocked tools (tool loop, caching, cap wrap-up, saving, dedupe). **Not run against the real API yet.** Tool spend shows in Usage as "Claude (MCP)"; AI as feature `lead-engine`.

## 4b-5. Lead Finder: less text on a lead (2 Nov)

Users kept saying there's too much to read. An opened lead went from about 250 words to about 80.
- **Engine prompt** (section 8 notes): `why` ≤ 15 words, `what_it_does` ≤ 6, size ≤ 4, social activity ≤ 6, ≤ 3 signals, `not_checked` as short nouns, summary ≤ 3 sentences, and no tool names or run notes in lead fields (only in `sources` / `tool_issues`).
- **Saving** (`saveAnswer`): `why` is its first sentence (≤ 140 chars); facts are Sells / Size / Where / Social (all socials on one line), then up to 3 extras; `emailVia` is one of four phrases (Checked email, Found not checked, Guessed from their email pattern, Shared inbox) without the tool details.
- **Opened lead** (`LeadFinderPage.tsx`): name, site link, "Very Likely · from Google", one line on why, four short facts (`ShortFacts`), the rest (extras, not checked, found by, LinkedIn) behind a closed "More details". The email side has no heading or follow-up sentence; a grey tag by the address says Shared inbox / Guessed / Not checked; the text box grows with the email (`GrowText`). "1 of 6" by "← All leads". Cards and Start here show the one-line why. Older leads are cut the same way on the page (bracketed notes dropped).
- **Emails** (`draftMessages`, shared with the Lead Agent): under 60 words (was 90), "Hi <company> team," when no name; DMs under 50.
- The long `app.frekto.ai/preview?t=…` link seen in a live email isn't written by this repo's code; check where it's added.

## 4b-6. Lead Finder: Download leads (2 Nov)

- A grey **Download leads** link in the top line (shown when there's at least one) saves `leads-YYYY-MM-DD.csv` in the outreach lead format the owner shared (26 columns, same order; `web/lib/leads/export-csv.ts`, built in the browser).
- Which leads: not sent or skipped, no Reddit / HN posts; leads without an email are kept (`notes` says how to reach them).
- Filled only from what a lead has: website, contact name / email / role, company, country (last part of the Where fact), LinkedIn company page, Instagram, `posting_activity` only `none` / `dormant` (60+ days, from the social check), last post date, priority (Very Likely A, Likely B, else C; score for older leads), notes (why, social, email not checked / guessed). Hook, assets, avoid and the rest stay empty: the search doesn't find them yet.

## 4b-7. Analytics Website tab: website data only, visits grouped by source (3 Nov)

- The owner wants the Website tab to show **only website data (GA4 + Search Console)**, no PostHog (that's the App tab). The PostHog "New visitors" section added earlier on 3 Nov was removed (component and `/api/analytics/new-visitors` deleted).
- `/api/analytics/ga4-traffic` has a 9th report, `sessionSource` + `sessionMedium` (sessions, newUsers, 250 rows), grouped by `classifyChannel` (`lib/posthog/channel.ts`) into `sourceGroups`: AI tools, Social media, Search engines, Email, Search / Social media ads, Other websites, Direct / typed in, Your own app or site, each with its top 4 sources. GA4's own channel groups file ChatGPT and the like under Referral, which is why this exists.
- "How they found you" shows those groups (visits · new · %, top sites in grey; the AI tools bar is green); it falls back to GA4's channels when `sourceGroups` is missing. Entry pages and Browsers show new users too (`newUsers` added to those reports).
- Checked with mocked GA4 data at desktop and phone width; not run against a real GA4 property yet.
- **Search Console fix (3 Nov):** the page reads `clicks7d` / `impressions7d` / `avgCtr7d` / `avgPosition7d`, but `fetchGsc` (`lib/analytics/google-providers.ts`) returns `clicks` / `impressions` / `avgCtr` / `avgPosition`, so the four numbers were always "—". `auth-dashboard` now adds the 7-day names (snapshot `_v` 13, so cached snapshots refetch; the Keywords page reads them from the snapshot too). Top queries drop operator searches (`site:`, `inurl:`… our own DataForSEO lookups show up in GSC), sort by clicks then impressions, and show impressions; the GSC grid uses `minmax(0, 1fr)` so a long query can't squeeze the trend card.

## 4c. Costs: Usage & costs tab and Hunter credits

- **Settings → Usage & costs** (`web/components/settings/UsageSection.tsx`, data shaped in `web/lib/usage.ts`, `st-usage-*` CSS). Per account, this month: the total, split by tool, by DataForSEO API and by AI feature, plus up to 12 past months.
  - DataForSEO dollars and Hunter credits are stored per brand in `signal_snapshots` key `agent:usage`, as `{ months: { 'YYYY-MM': { dataforseo, hunter, tools, apis, hunterOutAt } } }` (`addUsage` / `readAccountCosts` in `web/lib/agents/store.ts`). The old one-month shape is still read.
  - Each DataForSEO call adds its cost to the run's meter under an API name (`apiLabel` in `dataforseo.ts`). `addUsage(brandId, meter, tool)` takes the tool: Lead Agent, Search Agent or Competitor Leads.
  - AI dollars come from `ai_usage_logs` for the whole app, grouped by feature (names in `lib/usage.ts`).
  - The split by API only exists for runs after 26 Oct 2026; older spend shows in the totals with a note.
- **Hunter** (`web/lib/agents/hunter.ts`):
  - Every request asks for one email: Email Finder when the person's name is known, then Domain Search with `limit=1` for an owner, manager or marketing person, then any one address. A lead costs at most 1 credit (it used to ask for 10, costing up to 10).
  - `meter.hunter` counts credits, i.e. emails returned, not requests. Hunter doesn't charge repeats in the same month, so the count can run slightly high.
  - HTTP 429 means the credits are used up (403 is only the rate limit). The meter gets `hunterOut`, Hunter isn't asked again that run, and `hunterOutAt` is saved for the month. It clears once Hunter returns an email again.
  - Where it shows: Lead Agent run progress and a note on the page, Competitor Leads' "No public email found", Search Agent's contacts step, Settings and the agents overview.
  - Not checked on the real free plan: whether Domain Search's `department` and `type` filters are allowed there. If not, that request fails and the plain one-email search still runs.

## 4d. Lead Agent: sources picked from the brand, and "Companies like your customers"

- **Why:** Google Maps only suits brands that sell to local shops. Frekto's buyers are online businesses, which aren't on Maps and rarely have a findable email there.
- **New source `companies`** (`LeadSource 'company'`, `settings.sources.companies`, `settings.companyQuery`):
  - `findCompanies` in `lead-agent.ts`: Claude turns `companyQuery` into Hunter Discover filters once per wording (`data.companyFilters`: 8 keywords + company size).
  - Each run uses 3 of the keywords, rotating daily, because without Premium paging Discover always returns the same first 100.
  - `discoverCompanies` in `hunter.ts` uses filters only (keywords, `headcount`, `headquarters_location` = the country). Discover is free; its natural-language `query` is avoided because the free plan allows only 30 of those a month.
  - Companies Hunter has personal emails for come first. Each one's home-page title and description are read so Claude can score the fit. Then it's the usual flow: score, Hunter email (≤ 1 credit), draft, approve.
  - Demo stand-in: `demoDiscover` in `demo.ts`.
- **Companies search, fourth version (27 Oct): free store facts and the AI's yes/no checks.**
  - `web/lib/agents/site-facts.ts`: `storeFacts(domain)` reads Shopify's public `/products.json` (or WooCommerce's `/wp-json/wc/store/v1/products`) for what a store sells, how many products and days since the newest one; `contactEmail(domain)` finds an email the business lists on its home / contact / about pages (mailto or plain text, own domain first, junk addresses dropped); `inBatches` limits parallel fetches.
  - Up to `COMPANY_CHECK` (30) sites per run are read (home page + store facts, 8 at a time). `NOT_A_FIT` still drops PR/B2B wording. The old `tradeMatch` word gate is no longer used for new finds (only for re-checking older To-do leads).
  - `judgeCompanies` (one AI call for all companies) answers `trade`, `small`, `active`, `need` separately, plus `score` and `why`. A company failing any check can't be kept; the summary says how many failed each ("12 wrong trade, 5 too big…").
  - Email order for every kept business: listed by DataForSEO → listed on its own pages (`contactEmail`, free) → Hunter (≤ `PER_SOURCE` credits per run).
- **Companies search, third version (27 Oct): DataForSEO finds the websites, Hunter only finds emails.** Hunter Discover was removed (`discoverCompanies`, `demoDiscover` deleted): its keyword matches brought law firms and estate agents. `findCompanies` now asks DataForSEO's technology index for sites whose title/description has the trade words, on the picked platforms (or any platform when `platforms` is empty), then runs the same checks, scoring and Hunter email lookup. Log: `[lead-agent] DataForSEO websites (…): N back`. The notes below about Hunter Discover and the half-and-half mix are history.
- **Companies search, second version (27 Oct):** `findCompanies` now has two halves, mixed half and half:
  - **Online stores** from DataForSEO's technology index (`storesByPlatform` in `dataforseo.ts`, `/domain_analytics/technologies/domains_by_technology/live`): sites in the country (or anywhere) running the platforms Claude picks in `companyFilters` (`platforms`: Shopify / WooCommerce / Wix / Squarespace, or none), a different page of 50 each day (wrapping round when past the end). The trade words go to DataForSEO as single-word `keywords`; with no match it searches the platforms alone. There is no rank filter in the request (most small shops have no rank, and `domain_rank < 300` cut the whole index down to ~200 sites); sites ranked 400+ are dropped afterwards. Each call logs `[dataforseo] stores …: N back of TOTAL`. Emails it lists are used without a Hunter lookup. Not tried against the real API yet: if the filter or field names are off, the run shows "Online stores: …" and the Hunter half still runs.
  - **Small agencies and brands** from Hunter Discover, now **smallest first** (fewest addresses on file) instead of most emails first, which surfaced big PR firms.
  - Names or home pages matching `NOT_A_FIT` (PR, B2B, enterprise, consulting, award-winning, staffing…) are dropped before scoring.
  - The home page is read for title, description and **social links** (`socialsIn`: Instagram, Facebook, TikTok…); the scorer gives 8-10 to small businesses that post or should post on social.
  - **Trade check (free, before scoring):** every company's home page is read; `tradeMatch` keeps it only if its name, description or page text has one of the trade words from `companyFilters.keywords` (plain words like shop, online, brand don't count). This drops Hunter's loose matches, e.g. an estate agent "matching" etsy shop. The scorer also gets "Companies we look for" (`companyQuery`) and scores a different trade 1-3. Each run logs `[lead-agent] companies: N found · … kept`.
  - Up to `COMPANY_CHECK` (10) companies are scored per run; Hunter still looks up at most `PER_SOURCE` (3) emails.
  - The run summary adds "Companies: N checked, N good fits, N with an email".
- **Picked from the brand:** `pickSources` (Claude) chooses Google Maps / companies / Reddit with a who-line each and one `why` sentence, saved as `settings.picked = { at, why }`.
  - Op `pick` in `/api/agents/lead`.
  - Runs on the first visit (no `lastRunAt`, no leads) and from "Pick for me" in Settings.
  - Changing sources by hand clears the `why`.
  - Brands saved before this read `companies: false`, `companyQuery: ''` (`readLeadData`).
- **Lead Agent page:**
  - First visit shows one card, "Where we'll look": the why line, each source with who it looks for, **Start finding leads** (the only green), Change, and a grey "Add your own emails" link. Tabs and list stay hidden until the first search.
  - Afterwards the action bar's grey line reads "Searching: Companies like your customers · Reddit and Hacker News".
  - Settings has "Where to look" with "Pick for me", a switch per source, and the who-line under each one that's on. `la-pick-*` / `la-src-*` CSS at the end of `globals.css`.
- **Lead Finder (`/leads`):** a "Companies" source button with its own "Looking for" line, a switch and field in Settings. The first visit runs `pick` then searches.
- **Kept small while testing:** `PER_SOURCE` in `lead-agent.ts` is 3: at most 3 new finds per source and 3 Hunter emails per run, one Reddit search instead of two, a Google Maps depth of 12 instead of 40. Set `AGENTS_LEADS_PER_SOURCE=10` to go back to the old size.
- **Not tested against real Hunter:** whether Discover's keyword search gives good small online stores. If it's weak, DataForSEO's technology search ("sites running Shopify in the US") is the next thing to try.

## 4d-2. Lead Agent: more than one batch (27 Oct)

- **Each search moves on:** `data.cursor = { sites, phrase }` counts searches; the next company search asks DataForSEO for the next page of 50, and Reddit / Hacker News use the next phrase (no longer once a day).
- **Waiting list:** finds not checked in a run (sites beyond the 30, posts beyond `PER_SOURCE`) are kept in `data.waiting = { sites, posts }`.
- **"Show 10 more"** under each tab's To do list (op `more`, `runLeadAgent({ more: 'email' | 'community' })`): skips replies and sending, checks the next 10 from the waiting list, or searches the next page / phrase when fewer are waiting, then the usual checks, emails and drafts. It doesn't change "Last search".
- **"Checked but not kept":** companies that failed a check, and posts or businesses scoring 4-6, go to `data.maybe` (newest first, up to 60) with a plain reason. Shown under the list; **Use anyway** (op `use`, `useMaybe`) makes it a lead (a forum post gets its reply drafted; a business gets an email from its pages or one Hunter lookup, then its email drafted).

## 4d-3. Lead Agent: the ideal-customer card (27 Oct)

Why: Frekto's leads stayed e-commerce after the owner asked for SaaS founders who do their own social marketing.
- **The card** (`settings.icp`, type `Icp` in `store.ts`): `kind` (ecommerce / saas / local / creator / other), `who`, `marketing` (how they market today), `fit[]`, `notFit[]`, `examples[]` (domains of customers the user loves), `by`.
  - Drafted by `draftIcp` in `lead-agent.ts` (reads the example sites for free), op `icp_draft` (fills the form, not saved until Save). Op `pick` drafts and saves one first when there's none.
  - Edited in Settings of the Lead Agent and Lead Finder (`components/agents/IcpFields.tsx`, `icp-*` CSS). All fields always show; **Fill in with AI** at the top fills the whole card from the brand (and the example sites, if given). "Who is your customer" now is the card's `who` (kept in `customer` too).
  - `customerBlock(b, s)` puts it in every prompt (search phrases, company search words, checks, scoring, drafting, source pick). "NOT a fit" items score 1-3.
- **Fresh start:** saving a changed card, "who to look for" or customer line clears `waiting`, `cursor`, `companyFilters` and `queries` (`freshStart` in the route). The search-word cache key includes `icpKey`. Older To-do company leads not matching the new words move to Skipped (existing `tradeMatch` re-check).
- **SaaS buyers (`kind: 'saas'`):**
  - Companies: recent Hacker News "Show HN" launches first (`showHnSites`, free Algolia, last 90 days, a new page of 50 per search; code hosts, app stores, blogs dropped), then DataForSEO websites by keyword. Store platforms are never searched when the card isn't `ecommerce`.
  - Reddit searches r/SaaS, r/indiehackers, r/startups, r/Entrepreneur, r/microsaas instead of all of Reddit.
  - Product Hunt / BetaList not added (no free API).
- **Who does their marketing** (`marketingFacts` / `marketingLine` in `site-facts.ts`, free): marketing roles on /careers or /jobs and /about or /team, creator / ambassador / affiliate programmes, their own X (founder or company) or a founder's LinkedIn on the home page, newest blog date. Sent to `judgeCompanies`, which now has a `diy` check; failing it is "Has a marketing team or creators" in "Checked but not kept" and "N with a marketing team" in the summary. `need` is judged against the card, not "social posts" any more.
- **After the first real Frekto run (27 Oct):** Show HN gave real founder-led products, but mostly developer tools. Added:
  - a `reach` check in `judgeCompanies`: does the brand help this business reach *its own* buyers (for Frekto: are their buyers found on social media; dev, hardware, IT and investor tools fail). Reason "Their buyers aren’t reached this way".
  - Show HN finds (`Candidate.launch`) need a score of 7 (`MIN_LAUNCH_SCORE`), other companies 6.
  - A launch whose post title reads like a sentence ("I made…") takes the site's own name.
  - The owner's call: a company X account counts like the founder's own (both mean they post themselves); non-English sites are fine.
- Not tested against real AI / DataForSEO yet.

## 4d-4. Lead Agent: DataForSEO playbook for companies (28 Oct)

- **Why:** the company search always asked one question ("Shopify sites with these words in their title"), sorted by crawl date, so leads were random.
- **Playbook** (`web/lib/agents/lead-playbook.ts`, `PLAYBOOK`): tells Claude which DataForSEO questions find small, live businesses. Three kinds (`LeadQuery.kind`):
  - `google`: a Google search with operators (`"powered by shopify" soy candles`, `inurl:collections …`, `<trade> "book now"`). Each search reads 20 results deeper (up to 100).
  - `stores`: the old technology index search (trade words + platforms), next page of 50 each time.
  - `lookalike`: `similarSites` (Labs `competitors_domain`) on a customer site: companies the owner approved, the example customers on the ideal-customer card, plus business email domains of PostHog paying users (`getPosthogProUsers`, re-read weekly).
- **Plan and memory** (`data.plan`): 3 active questions. Each search records `page`, `checked`, `kept`, `empty`; approvals and skips per question come from `lead.queryId`. A question is dropped when nothing new came back twice, fewer than 1 in 10 checked was kept (after 12), the owner skipped most of its leads, or a Google search is used up. Claude (Sonnet) then writes different replacements, seeing what worked and what was dropped.
- **Size check:** `siteVisits` (Labs `bulk_traffic_estimation`, one call per run) estimates visits from Google; over 20,000 a month is dropped, and the number goes to the AI check.
- **AI check learns from the owner:** `judgeCompanies` gets up to 8 approved and 8 skipped companies (`ownerExamples`). Skips the agent made itself are marked `skippedBy: 'auto'` and don't count.
- Marketplaces, social networks and big sites are dropped (`NOT_A_SITE`). Spend cap per run: `AGENTS_LEADS_DFS_CAP` (default $0.25). Usage shows "Similar sites" and "Site size (visits)".
- A new plan is made when "who to look for" or the card changes (`icpKey`). `stores` questions are only allowed for e-commerce cards (when `companyFilters.platforms` isn't empty). Show HN launches (SaaS cards) still come first, then the plan's questions.
- The old "move off-trade To-do leads to Skipped" only applies to leads found before this (no `queryId`).
- Not tried with the real API yet: `competitors_domain` and `bulk_traffic_estimation`. Google Jobs and Google Shopping were left out: DataForSEO only offers them as queued tasks, not live calls.

## 4d-4. Lead Agent: failed company searches (28 Oct)

- DataForSEO's Google returns "Internal SE Server Error" for some operator mixes the playbook plans (e.g. `inurl:product-category "family run" -site:etsy.com`). `googleWithFallback` in `lead-agent.ts` retries such a question without the `inurl:` / `intitle:` / `-site:` parts, then as plain words.
- **The real cause:** that error comes back as task code **40101**, which `dataforseo.ts` didn't count as busy (only 5xxxx), so nothing retried. `busy()` now includes 40101 (one retry, then the simpler wordings), and **40102** "No Search Results" becomes an empty list (`DfsNoResults`). Reddit: when every phrase gets 40101, it's logged and the run moves on (next phrase next time), with no message on the page.
- A failed question is logged and counts as an empty try (`q.empty`, so `weak()` replaces it after two). The page only shows "The last search had a problem" when **every** question of the run failed.

## 4d-5. Lead Agent: "Also use my brand profile" switch (28 Oct)

- `settings.useBrand` (default on), a checkbox at the top of the ideal-customer card (`IcpFields.tsx`, `icp-brand` CSS), so it's in both the Lead Agent's and Lead Finder's Settings.
- Off: every Lead Agent prompt (search phrases, company filters, playbook plan, checks, scoring, drafting, source pick) uses `leadBrandBlock(b, false)` in `context.ts`: only name, website, what it does and what it doesn't offer. The brand's "Who it's for", keywords and notes are left out. `draftIcp` ("Fill in with AI") still reads the full brand on purpose.
- On or off, `customerBlock` now says the search settings win where they differ from the brand's "Who it's for".
- The switch is part of `icpKey`, so changing it starts the search afresh (new plan, search words, waiting list).

## 4d-6. Lead Agent: seller pages (Etsy shops, Instagram…) as leads (28 Oct)

- **Why:** many small sellers (Frekto's best buyers) have only an Etsy shop or an Instagram / Facebook / TikTok page. They were thrown away (`NOT_A_SITE`, and the planner added `-site:etsy.com`) because they have no website or email.
- `web/lib/agents/profiles.ts`: `profileOf(url)` recognises one seller's page (Etsy `/shop/`, Instagram, Facebook page, TikTok `@`, eBay `/str/` `/usr/`, Amazon `/stores/`, YouTube `@`, Substack, Medium `@`, Pinterest) and gives `{ platform, handle, key }`; posts, listings and groups are null. `PLATFORM_GLYPH` for avatars.
- New `LeadSource 'profile'` ("Seller page"). Google results from the playbook that are seller pages become `WaitingSite { domain: key, profile: platform }`; `checkSites` turns them into candidates without reading the page (those sites block it), scored by `scoreCandidates` from Google's title and text (keep at 6+, like companies). Not size-checked.
- Drafted as a **DIRECT MESSAGE** (`reply`, under 70 words) in `draftMessages`. They live in the **Community** tab next to Reddit posts: "Write message →", steps Check the message / Send it ("Copy message", "Open their page", "I've sent it", op `posted`). Lead Finder: a "Seller pages" source button; the drawer says "Your message", "Open their {platform} page", "I sent it".
- Playbook: no more `-site:etsy.com`; it now suggests `site:etsy.com/shop <product>`, `site:instagram.com <product> "shop"`, etc., and at least one such question when the buyers sell on a marketplace or on social media. `googleWithFallback` keeps a positive `site:` in its simpler wordings.
- Sites on a builder's free address (`name.blogspot.com`, `name.myshopify.com`, `wixsite`, `squarespace`, `weebly`, `webflow.io`, `carrd.co`, `square.site`) now count as the business's own site (`BUILDER_SITE`) instead of being dropped.
- **Forced, not only suggested (28 Oct, removed 29 Oct, see 4d-7):** plans kept their old Shopify / WooCommerce questions, so Etsy was never searched. `addMarketQuery` in `lead-playbook.ts` now makes one of the 3 questions `site:etsy.com/shop <trade word>` whenever "who to look for" / the card's `who` / the customer line names Etsy (also eBay, Instagram, TikTok, Facebook: `MARKETS`). It takes the newest other question's place; a used-up one moves on to the next trade word. The plan key got a `v2|` so every plan is redone once.
- **After the 28 Oct Frekto run** (one Etsy shop found, 59 junk companies, article titles as names):
  - `MARKET_SHARE = 2`: two of the three plan questions are seller-page searches with different trade words; seller-page searches read 50 results deep (`step` in `askQuery`), others 20.
  - Names: `siteNameOf` (og:site_name, else the shortest non-generic part of the home page title) replaces the Google result's title for every Google find ("The History of Handmade Jewelry" → "Dailot").
  - Junk: the playbook no longer suggests `"powered by shopify"` and `weak()` retires any such question; Google results that are help / docs / forum pages (`HELP_PAGE`) or titled "How to… / Remove…" (`HELP_TITLE`) are skipped. Blog posts on a store are kept (the store is the lead).
- Not tried against real Google results yet.

## 4d-7. Lead Agent: Find leads only searches; nothing written until opened; no competitors (29 Oct)

- **Find leads** (op `run`, `findOnly`) only searches. Checking replies, follow-ups and queued emails are left to the daily run (and Demo "skip days"), as with "Show 10 more" (`mailOff` in `runLeadAgent`).
- **Nothing is written during a search.** Reddit / Hacker News replies and seller-page messages are written when the lead is opened (op `reply`, `addLeadReply`), like emails (op `email`). Leads are `ready` with no `reply` until then. Only auto mode still writes (and sends) strong emails during the run. "Use anyway" on a post no longer drafts either.
- **No forced Etsy / Instagram:** `MARKETS` / `addMarketQuery` were removed. The playbook asks the AI to search a platform's pages (`site:<platform> <trade>`) only when these buyers typically have their page there, picked from who the buyers are. Plan key `v3|`, so every plan is redone once. Any `site:` question reads 50 results deep.
- **Competitors kept out** (Frekto's 29 Oct run found mostly other AI social tools): the playbook says search for the buyers' trade, never the product's category; `customerBlock` adds "Never a fit: anyone who sells a product like {brand}" (with the brand's competitors) to every prompt; `judgeCompanies` has a `rival` check ("Sells something like yours (a competitor)", "N competitors" in the summary); `scoreCandidates` scores rivals 1; `draftIcp` adds such a line to Not a fit.

- **Kinds of business on the card (29 Oct):** after the next Frekto run searched "social media marketing" words (a card that describes a habit, not a trade) and found agencies, articles and rival tools, the card got `trades` ("Kinds of business to search", 5-8 like "yoga studio", "candle maker"; `draftIcp` writes them and never the product's own category or businesses selling what it does). With trades on the card, every google / stores question must contain one of them word for word (others are dropped), the AI is shown which aren't searched yet, and empty slots are filled in code with the next untried trade (`inurl:collections <t>` for stores, `<t> "book now"` for local, else `<t> "founded by"`). Trades are the stores keywords too, part of `icpKey`, and the judge's trade check accepts them. Plan key `v4|`. Cards saved before have no trades: "Fill in again with AI" + Save adds them; until then the old search words are used.
- **Same leads again (29 Oct):** the saved Frekto card had no trades, so the old search words ran, and old finds stayed in To do and "Checked but not kept". Now a run on a card without trades writes them once from the brand (`draftIcp`, saved on the card) and starts the company search afresh. `retireOldFinds` (on that, and on every `freshStart`) moves unopened company / seller-page To-do leads to Skipped (`skippedBy: 'auto'`, restorable) and empties `maybe`. `companyFilters` key `v4:` (its prompt no longer gives "social media agency" as an example).

## 4e. Search Agent: better output (27 Oct)

Built from the review in `md_files/SEARCH_AGENT_HOW_IT_WORKS.md` (the report the owner shared).
- **Improve, don't compete:** searches the site already ranks #5-#20 for become topics with `kind: 'improve'` and `pageUrl`. "Write" then rewrites that page (`readOwnPage` reads it) instead of a new post, and lists what changed. A "Refresh a page" to-do has **Draft a rewrite** (op `improve`, `refreshToTopic`), which turns it into such a topic.
- **What only the business knows:** before writing, the page asks three optional questions (a real example, a number, their view), saved as `topic.inputs` and sent with op `write`. Without them the writer is told not to invent stories or numbers. Posts also show 2-3 labelled examples of what the product makes, when it makes something visible.
- **Length follows the search:** about 1.15× the typical top-3 result, 600-2,500 words (else 1,200-1,600).
- **AI answers you can trust more:** `AGENTS_AI_QUESTIONS` (default 5) questions × `AGENTS_AI_REPEATS` (default 2) per engine, merged into one answer with `samples` / `hits` (named = half or more). Google's **AI Overview** for each starting keyword (`googleAiOverview`, `load_async_ai_overview`, engine `google_ai`). Brands named are read by a fast AI call (`namedBrands`), with the old text search as the fallback.
  - "Write a page answering…" and "Get mentioned on…" to-dos only appear when the pattern held last week too (or, in the first week, in every sample / 3+ citations).
  - The AI answers tab leads with the **4-week average** and **the sites AI cites when it leaves you out**, then the questions ("1 of 2") and Google AI Overviews.
- **Keywords tab** (was Rankings): "Keyword ideas" lists the top 100 ideas from the last research (`data.ideas`, saved by `ideaRows`), each with why it was or wasn't picked (in your to-do, good fit waiting for room, too broad, hard to win, not your buyers, difficulty unknown, too few searches, your brand name, not checked for fit). "Write about this" (op `idea`, `ideaToTopic`) makes any of them a post to write. "Where you rank now" below is the old Rankings table. Topic picking also skips ideas over 20,000 searches a month, treats difficulty 0 as unknown, and keeps only what Claude's fit check (`relevantKeywords`, top 20 candidates) says a buyer would search.
- **Starting keywords chosen by the app** (`settings.seedsBy`): new brands no longer copy the profile's keywords (they describe the product, not what buyers type). `ensureSeedsAndQuestions` has Claude write 5 buyer searches (2-5 words); seeds saved before `seedsBy` existed are rewritten once. After each research `reviewSeeds` swaps up to 2 weak seeds (too few / too many searches, or failing the fit check) for the best good-fit ideas; the progress step names what was dropped. Seeds typed in Settings are `'user'` and left alone; emptying the list hands it back.
- **Failed AI answers are no longer silent:** if some (not all) AI answers fail, `lastError` says how many, so the AI answers tab showing fewer questions has a reason on the page.
- **Pitches:** "best of" list pitches go to the article's **author by name** (`authorOf`: JSON-LD, meta author, rel=author, microdata, byline class; "Staff"/"Team" skipped), looked up with Hunter's Email Finder. Pitches are 50-90 words: their page, the gap, an offer (a free account, a ready-to-paste two-line description), one question. The same rules apply to `taskToPitch`.

## 4e-2. Search Agent: link suggestions checked against real data (3 Nov)

The owner's screenshot showed instagram.com as a "List article" to pitch, "Get mentioned on blog.hootsuite.com" and "easy (0)". Checked with live DataForSEO and fixed:
- **Competitors were empty for the agents.** Competitor Analysis only writes competitors the user typed to the `competitors` table; a suggested set (Frekto's Predis.ai, Later, Buffer) lives in the module's `competitor_urls`. `loadBrandContext` now also reads `competitor_urls` of the competitor-analysis and GEO modules (names from `achievable_competitors`, else the domain).
- **Rivals' sites:** `isRivalSite` (`context.ts`) matches subdomains (`blog.hootsuite.com`) and hosted pages named after a rival (`predis.crisp.help`). `namedRivals` / `isNamedRival`: products AI answers recommend as options in 2+ answers count as rivals too. The `namedBrands` call now also returns `others` (untracked products each answer recommends, `AiAnswer.others`), so this works from the next research.
- **"Get mentioned on" to-dos** (`buildTasks`, `citableSite`): no platforms (`PLATFORM`, now in `context.ts`, also Spotify, Yandex, link shorteners), no rivals, and the cited page must list or compare options (`LISTY`: best, top, a number, vs, alternatives, tools…; Reddit exempt). Today cards for to-dos a research drops are cleared.
- **Links to rivals** (`findGap`): app stores, help desks, builder previews, podcast hosts (`NOT_PITCHABLE`) and referral / affiliate / app-market links (`PAID_LINK`) are dropped before ranking. On Predis.ai's top 30 backlinks this removes 17 of 30 (Play Store, Spotify, Yandex, bit.ly, Zendesk, their own crisp.help…).
- **Old data:** `tidySearchData` removes open "Get mentioned on" to-dos and unsent pitches that fail these checks, with their Today cards. It runs where the data is read: the Search Agent page (server-rendered, reads the store directly), its API GET, `getTodayTasks` (Today, daily email, MCP; via `tidySearchFor`) and the daily run. The first version only ran in the API GET, so the page still showed instagram.com.
- **Rivals not in any saved list** (Hootsuite, SocialBee for Frekto): `rivalSites` asks a fast AI once per domain whether it sells a product like the brand; answers are cached in `data.rivalCheck`. Used by `tidySearchData` and on new "Get mentioned on" to-dos at research.
- Pitches made from a to-do have `source: 'cited'` ("Cited by AI"), no longer "List article"; older ones are recognised by their why line.
- Difficulty 0 shows as "difficulty unknown" (label, card, table, and saved "easy (0)" texts).

## 4e-3. Search Agent: data you can trust (4 Nov)

From a review of whether the Search Agent's numbers are valid.
- **Rankings from Search Console when it's connected** (`gscRanks` in `search-agent.ts`, `fetchGscQueryPages` in `lib/modules/seo/keyword-fetchers.ts`): one row per search over the last 28 days (ending 3 days ago), the page shown most, the impression-weighted average position, searches with fewer than 5 impressions dropped. Volume is DataForSEO's when the idea list has it. Otherwise (or when Search Console fails or has no data, noted in `lastError`) DataForSEO Labs as before. `ranks.source` is `'gsc'` or `'labs'`.
- **Rank changes:** only like with like (`gsc` with `gsc`). A search missing from DataForSEO's capped list is no longer "dropped outside the top 100". Search Console moves need 20+ impressions on both sides. Refresh to-dos need a 5-place drop on DataForSEO's estimate, 3 on Search Console, and say which source.
- DataForSEO ranks use `rank_group` (place among normal results), not `rank_absolute` (counts ads and boxes).
- Keyword ideas, rankings and AI Overviews ask in German / French for DE / FR (`languageOf` in `dataforseo.ts`). The Lead Agent's Google searches stay English.
- **AI answers:** buyer questions take turns (`rotate`, `questionRound`), so all 10 get asked. "Named in X%" and the overview counts leave out Google AI Overviews. A "Write a page answering…" to-do now also counts the untracked products in `AiAnswer.others`, so it no longer needs a listed competitor. A gap holds when it was there the last time that question was asked (`questionLog`).
- "How AI describes you" asks ChatGPT and Perplexity and only flags a problem they share. The judge is told the brand profile may itself be out of date.
- The page says the AI numbers come from the assistants' APIs (gpt-4.1-mini, Sonar, Gemini 2.5 Flash), so they're a direction, not an exact score. It also shows how many answers the average rests on and where the rankings come from.
- Not tried against real Search Console / DataForSEO yet.

## 4e-4. Search & AI page (`/search-ai`): SEO and GEO tabs (4 Nov)

Rebuilt from the owner's brief: show the keywords the site already uses, where it stands, what to change (title / H1 / headings), the same for AI answers, and **when you'll know a change worked**. Approved preview: `design-previews/tools-cleanup/search-seo-geo.html` (https://claude.ai/artifact/M8TBxFdsG4Vj5Lqxgdrhqx). The first version (to-do list + keyword table, preview `search-hub.html`) is replaced.
- **Files:** `app/(shell)/search-ai/` (page + layout, parked like `/agents`), `components/search-hub/SearchHubPage.tsx`, `lib/search-hub/model.ts` (pure: page and question cards, tests), `pages.ts` (reads the site, keyword per page, new wording), `verdict.ts` (keyword judging, swap suggestion, history), `site.ts` (SEO / GEO module scores + AI readiness checklist), `sa-*` CSS at the end of `globals.css`. Sidebar: first under Get seen, icon `target`.
- **Colour-coded on purpose** (owner's call, overrides the calm grey rule for this page): green working / named, blue testing, red needs a change / not named, grey waiting, purple keywords to add; rank zones green page 1, yellow #11–30, orange #31–100, grey not found. Dark values on `.sa`, light under `html.light .sa`.
- **How it runs:** the Search Agent's research (weekly via the daily cron when the Search Agent is on, or **Recheck all keywords** = op `research`) now starts with a `pages` step: `refreshSitePages` reads the homepage + up to 9 main pages (menu/header links, then main, footer, then sitemap; legal/login/cart skipped), stores title / H1 / H2s / meta in `data.pages`, and asks a fast AI for the search each page targets (once per wording, `keyFor`; `keywordBy: 'user'` is never re-guessed). A title or H1 that changed since the last read becomes a test (`data.changes`, `by: 'auto'`). Page keywords are tracked first, and get Google AI Overview checks. Each snapshot now also stores per-question AI results (`RankSnapshot.questions`).
- **Tests** (`SiteChange`, judged in `model.ts`): know-by 6 weeks after the change, first sign at 2. SEO: up 5+ places or on page 1 → Working; up 1–4 → 2 more weeks (once); else → Needs a change. GEO: named in half the answers or more (average of the last 3 checks) → Named; better than before → 2 more weeks; else Not named. Ops: `change_add` (`area`, `path` + `to` or `question`, `what`; a new `to` becomes the page's keyword), `change_stop`.
- **SEO tab:** where you stand (bar + four zone boxes with each page's search), then cards grouped Needs a change / Testing / Working / Waiting (first fix has the green "Fix this first"), then Keywords to add (good-fit ideas no page targets; placed on a page sharing 2+ words, else a new post; "Plan it" = op `idea`). Opened page: title / H1 / H2s / meta with the search highlighted, position chart shaded by zone with the test date marked, and the box for its status. Needs a change: the reason, a closer search when `findSwap` finds one, **Write the new wording** (op `page_suggest`, `suggestWording`, cached in `page.sugg` per status + keyword) with Copy, **I've made this change** (starts the test), and for a slipping page "Draft the full rewrite" (`kw_rewrite` + `write`).
- **GEO tab:** four tiles (share of answers naming you, questions named for, rival named most, site cited most), question cards grouped Not named / Testing / Named with dots per assistant (green named, red ring not), and "Site ready for AI" from the AI readiness module. Opened question: per-assistant result, named instead, cited sites, share-named chart, and what to do (get on the most-cited site → Search Agent pitch, answer it on your site, say it plainly on the homepage), each with "I've done this" (starts a test).
- Also: How this works (cadence + when you'll know), I changed something (form for SEO or GEO), Settings (weekly check, country, pages read, Search Console, questions → Search Agent, Demo).
- The page gets the server's time (`now` prop) so progress bars and dates match on first render; dates are formatted in UTC.
- Checked with made-up Frekto data in the preview harness (desktop + phone, light + dark). **Not run against real pages / DataForSEO / AI yet**; history and tests start with the first check after deploy.
- **Judged from the first check (4 Nov, after the owner's first real run showed every page "Not found / too early to judge"):**
  - Each page lists the searches Google really shows it for (`PageView.real`: Search Console rows grouped by their page URL, else DataForSEO's; impressions, clicks, position). "Where you stand" places a page by its target if found, else its best real search (`stand`); a page aimed at a buyer's search ignores searches for the brand name.
  - Target not found → judged now: Google shows it for another buyer's search → **Needs a change** (aim at what it already gets, swap = that search); brand-name page (e.g. pricing, FAQ) found by name → Working, else "for people who know you (fine)"; nobody searches the target (`page.volume` < 20) → Needs a change; else Waiting with the date it'll be judged. The 6-week wait now only applies to changes being tested.
  - `keywordVolumes` (Labs `keyword_overview`, one call, Usage "Keyword volumes") looks up searches a month for each page's target when it's new or changed (`page.volume` / `difficulty` / `volFor`).
  - **Change date:** "I changed something" has "When it went live" (up to a year back); `change_add` takes `at` (YYYY-MM-DD) and takes "before" from the last check on or before that day. Each "Needs a change" box links to it ("Made it on an earlier day?").
  - The weekly check switches on the first time the page is opened (`hubOnAt`, once; turning it off in Settings sticks).
  - **Brand typos count as the brand** (`isBrandWord` in `model.ts`): the name, it with up to 3 letters stuck on, 1 letter off, or (names of 6+ letters) 2 off with a letter added or missing ("frektok", "fraktok", "freekto"; not "fresco"). A buyer page found only for the brand stands at "not found" for its search and is never told to aim at a brand search.
  - **Too competitive (5 Nov):** `siteReach` (`model.ts`) = the hardest DataForSEO difficulty this site can win: 30, or 40 / 50 once it's on page 1 for a non-brand search with 300+ / 1,000+ searches a month. `tooHard` = difficulty > reach + 10, or 5,000+ searches a month. A page aimed at such a search (not found, or below #20) is **Needs a change** with easier options: `refreshSitePages` calls `keywordSuggestions` (Labs `keyword_suggestions`, up to 4 pages per check, once per search, Usage "Easier keywords") plus fit ideas sharing 2+ words, keeps difficulty ≤ reach and 20+ searches, top 5 by searches (`page.alts` / `altsFor`). The page shows them as a pick list; "Write the new wording" and "I've made this change" use the picked one (`page_suggest` takes `to`). Keywords to add leave out too-hard ideas. Cards say "Too competitive: difficulty N".
  - **Editable dates (5 Nov):** "Change date" on any running test (op `change_date`: `id`, `at`; "before" re-read from the check on or before that day) and on a page's "Aiming at this since" (op `kw_since`: `keyword`, `at`; moves the tracked keyword's `addedAt`, so its judge-from date moves too). Inline `DateEdit` in `SearchHubPage.tsx`.
  - Keywords to add come from the Search Agent's keyword ideas (DataForSEO Labs around the starting keywords, kept when the fit check passes), placed on a page sharing 2+ words, else a new post.

## 4f. MCP data passthrough tools (29 Oct)

Three thin tools on the MCP server (`app/api/mcp/route.ts`, defined in `lib/mcp/tool-registry.ts`), so Claude can call the data sources directly and work out lead-gen logic in conversation. No scoring, filtering or deduping: raw API JSON back, the API's own message on errors (`{ error, http_status, response }`).
- **`dataforseo`** (`lib/mcp/tools/dataforseo.ts`): any v3 endpoint + payload (one task or up to 10), through `dfsRaw` in `lib/agents/dataforseo.ts`. `limit` becomes `depth` on `serp/…` and `limit` on Labs / Backlinks / Domain Analytics / Business Listings, capping any value in the payload.
- **`hunter`** (`lib/mcp/tools/hunter.ts`): `domain-search` / `email-finder` / `email-verifier` with raw params, through `hunterFetch` in `lib/agents/hunter.ts`; `limit` sets domain-search's limit; a caller's `api_key` is ignored.
- **`apify`** (`lib/mcp/tools/apify.ts`): an alias or any actor ID. Field names were read from each actor's input schema (`GET /v2/acts/{id}` → latest build → `inputSchema`). Each alias sets its actor's max-results field and Apify's `maxItems`, and caps the run's cost (`maxTotalChargeUsd` = price × limit × 1.5 + $0.02, at most the alias's `capUsd`; `MCP_APIFY_CAP_<ALIAS>` overrides the ceiling, `MCP_APIFY_CAP_DEFAULT` for raw IDs, $0.50). Waits 45 s (the MCP client gives up at 60 s); otherwise `{ run_id, status: 'RUNNING' }`, then call again with `{ run_id }`. Run ids are kept per brand in `signal_snapshots` `mcp:apify-runs`, so a brand can only read its own runs.
  - `b2b_database` (was `linkedin`, still accepted as deprecated): pipelinelabs leads database, `totalResults`. Not live LinkedIn; data can be years old (a test row had a `mediaone.net` email).
  - `linkedin_company`: `dev_fusion~Linkedin-Company-Scraper`, `profileUrls` (cut to limit; no max field), $0.008 each. **Needs its full-permission request approved once in Apify Console** (403 `full-permission-actor-not-approved` until then).
  - `linkedin_people`: `themineworks~linkedin-employees`, `companyName` / `jobTitle` / `maxResults`, Google SERP proxy by default, $0.0075 a profile.
  - `instagram` / `facebook`: unchanged (profile scraper, page posts scraper).
  - `meta_ads`: `curious_coder~facebook-ads-library-scraper` (`urls`, `count`; it refuses `count` < 10, so it's asked for 10 and the answer is cut to limit). Fallback `apify~facebook-ads-scraper` (`startUrls`, `resultsLimit`, `activeStatus`) when the primary fails to start or its run fails; the answer has `actor_used` and `fallback_from`. Both checked live on Nike's page.
  - `producthunt`: primary `maximedupre~product-hunt-scraper` (`target`, `startDate`/`endDate` or weeks/months, or `topicSlugs`, one target per run; `maxNbItemsToScrape`; emails on by default). Fallback `runtime~producthunt-scraper` (daily leaderboards only: `startDate`/`endDate`, end defaults to the start date, or Product Hunt URLs as `startUrls`; `getDetails: true` for makers, hunters, websites; `maxResults`). A primary that fails after the first wait falls back when its `run_id` is fetched (once; the failed run then names `fallback_run_id`).
  - **Added 11 Nov** (field names and prices read from each actor's latest build, `GET /v2/actor-builds/{id}`): `contacts` (`vdrmota~contact-info-scraper`, `startUrls` cut to limit = sites, 5 pages deep, merged per site, plain domains turned into URLs, ~$0.01 a site), `x` (`apidojo~tweet-scraper`, `searchTerms` / `twitterHandles` / `startUrls`, `maxItems`, $0.0004 a tweet, min cap $0.05; **`fallbackOnEmpty`**: a run that fails *or finishes with no items* retries on `xtdata~twitter-x-scraper` with the same fields, $0.005 a tweet on Apify's free plan), `reddit` (`trudax~reddit-scraper-lite`, `searches`, `maxItems` + `maxPostCount`, comments / users / communities off, `ignoreStartUrls` when searching: its example start URL was being scraped instead of the search; slow, 10-20 min), `capterra` (`khadinakbar~capterra-reviews-scraper`, `startUrls` or `searchQuery`, limit = `maxReviewsPerProduct`; anonymous reviewers, so research not leads), `telegram` (`memo23~telegram-channel-scraper`, `startUrls` / `usernames`, limit = messages, `includeChannelStats` on). New `prepare` hook on an alias for last fix-ups. Tested against a faked Apify only; the owner's earlier live runs: contacts worked every time, x worked then went empty (plan / credit), reddit slow, capterra fine, telegram not run.
- `limit`: default 10, hard max 50 (`lib/mcp/tools/limit.ts`). DataForSEO dollars and Hunter credits show in Settings → Usage as "Claude (MCP)".
- Checked against mocked APIs, and (29 Oct) live through the deployed tool with the inputs the new code builds: `meta_ads` primary + fallback and `b2b_database` worked. **Blocked:** `linkedin_company` (approve its permissions in Apify Console), `linkedin_people` (Apify 402: the account had $0.21 of monthly usage left; the new limit-sized caps should get small runs through, else upgrade the plan), `producthunt` (the old deployed tool waited 60 s and the MCP client timed out; the new 45 s wait fixes that). Re-test those after deploying. `dataforseo` / `hunter` still untested live.

## 4g. Ask (`/ask`), phase 1 (5 Nov)

A new page with one ask box and no sidebar, in its own look (Geist, paper and ink, one blue, red only for replies). Plan and phases: `md_files/ASK_PLAN.md`. Approved preview: `design-previews/seo-ask/ask-app-flow-v2.html`.
- **Early access only, not in the sidebar.** Open it at `/ask`; anyone else is sent to `/dashboard`. The API uses `agentAccess()`.
- **Three ready answers** (`lib/ask/cards.ts`):
  - **Did anyone reply?** Inbox threads with a reply in the last 14 days (`listConversations`, which now has `repliedAt`).
  - **Who should I email today?** Lead Finder leads that are `ready`, best score first.
  - **Why am I not on Google?** Pages in the sitemap vs pages that showed up in a Google search in the last 28 days. The Search Console API has no "indexed" count, so it says "showed up in a search".
- Every answer has one shape (`lib/ask/types.ts`): a sentence (`**bold**`), one picture (list / bars / tiles / line, `components/ask/AskPicture.tsx`), up to 3 findings, one blue next step, two quiet ones, the source.
- **Sentences are written in code from the numbers, not by AI**, so they're free and can't misstate a number.
- **Saved per brand** in `signal_snapshots` `ask:cards` (`:demo` in demo mode). Filled by `/api/cron/ask` at 04:45 for early-access brands, and again when the page is opened and they're older than 20 h. "Check again" refills them.
- **Next steps link to existing pages:** `/leads?lead=<id>` now opens that lead, and `/gmail-hub?tab=inbox` opens the Inbox.
- Checked with made-up data in the preview harness (desktop, phone, dark). **Not run against real Search Console, sitemaps or lead data yet.**
- Next: phase 2, your own questions (see the plan).

## 4g-2. Ask, phase 2: your own questions (5 Nov)

- **Typed questions are answered live** by Claude Sonnet 5.5 (`claude-sonnet-5-5`, effort `medium`) in `lib/ask/engine.ts`.
- **Streaming:** `POST /api/ask/question` streams progress as one JSON line per event (`AskEvent`: understand / look / check / answer / card / ask_back / left / error). The page shows those as Understand / Look / Check / Answer lines.
- **Tools:** the read-only MCP tools (`READ_TOOLS`) plus four Ask tools:
  - `ready_answers`: this morning's cards
  - `outreach`: leads and email threads
  - `understood`: the one line on what it took the question to mean
  - `open_ready_answer`: the question is a card, so the card opens for free
  - `ask_back`: one question with 2–4 buttons, when a missing detail would change the answer
  - The answer is always the `give_answer` form (strict schema), the same shape as a card.
- **Next step:** the model picks an action id (`ACTIONS`: leads, inbox, campaigns, search_agent, analytics, social, roadmap, reminders, settings, search_console), never a URL.
- **Number check** (`uncheckedNumbers`): every number above 10 in the sentence and findings must appear (within 1%) in the data fetched. Percentages, years and small counts are skipped.
  - If one doesn't match, Claude is asked once to fix it.
  - Anything still unmatched shows under "How I got this" as not checked.
- **Caps per question:** 8 turns, 60 s, $0.25 AI, $0.10 DataForSEO. Near a cap it's told to answer; further lookups are turned away (the tool list never changes, so the cache holds).
- **Daily limit:** 20 typed questions per brand (`ASK_DAILY_LIMIT`), kept in `signal_snapshots` `ask:usage`. Opening a card, asking back and failures don't count.
- **No server-side refusal fallback:** SDK 0.104.1 only types the list form of `fallbacks`, and Sonnet 5.5 needs `"default"`. A refusal shows "Ask couldn't answer this one."
- `dispatch()` moved from `app/api/mcp/route.ts` to `lib/mcp/dispatch.ts` (the MCP server and Ask share it). Sonnet 5 prices ($2 / $10) are in `lib/ai/pricing.ts`; usage shows as "Ask: your own questions".
- **Tested** with a scripted Claude (normal answer, wrong number and retry, asking back, a card question, a text-only reply, a refusal, the turn cap) and the page with a faked stream (desktop, phone).
- **Not run against the real API yet:** the strict tool schemas haven't been sent to Anthropic, so check one real question first. Full build passes.
- Still to do from phase 2: the other cards (post, talk, keys, track). **Done 5 Nov, see 4g-3.**

## 4g-3. Ask: four more ready answers (5 Nov)

Seven cards now (`CARD_IDS` in `lib/ask/types.ts`, the order they show in). The four new ones are pure functions in `lib/ask/cards.ts`, so the preview harness can run them on made-up data:
- **What should I write this week?** (`postCard`): the Search Agent's open topics, drafted ones first, then by searches a month. Next step: check the draft or write it, on `/agents/search`.
- **Where should I talk about {brand}?** (`talkCard`): Lead Finder's Reddit / Hacker News posts that are `ready`, best score first, with the subreddit. Next step opens that post (`/leads?lead=<id>`).
- **Which search words can I win?** (`keysCard`): the Search Agent's keyword ideas marked picked or fit, difficulty 1–29, by searches a month (bars). Next step: `/agents/search?tab=rank` (the Search Agent page now opens a tab from `?tab=`).
- **Am I on track?** (`trackCard` + `trackFetch`): Search Console impressions and clicks for the last 7 days vs the 7 before, both ending 2 days ago (it runs behind), plus emails sent and replies in the last 7 days. Down week on week → next step is the Google answer. Without Search Console it shows emails only, with the Google tile marked missing.
- `open_ready_answer` in the engine knows all seven, so typed questions like "am I on track" open the card for free.
- On the home page an odd last card takes the whole row; "Ask next" shows the next three cards.
- Checked in the preview harness (full, week down, empty). Full build passes. Not run on real data yet.


## 4g-4. Ask, phase 3: the work in a panel (5 Nov)

An answer's blue button can open the work in a panel on the right of the Ask page (full screen on phones) instead of going to another page. `NextStep.panel` (`Panel` in `lib/ask/types.ts`), drawn by `components/ask/AskPanel.tsx`, `ask-sheet` / `ask-mail` / `ask-brief` CSS.
- **No new API:** each panel calls what the tool's own page calls, so it saves exactly the same.
  - **Lead** (`{ kind: 'lead', id, lane }`, from "Who should I email today?" and "Where should I talk about…?"):
    - Reads `/api/agents/lead` and writes the email (op `email`) or the reply / page message (op `reply`) on open, as Lead Finder does.
    - Approve and send (op `approve`, with the edited subject and body) or Skip (op `skip`).
    - Posts and seller pages instead get Copy, Open the post / their page, and "I posted it" / "I sent it" (op `save` then `posted`).
    - Finishing one opens the next in that lane, best score first; when none are left it says "All caught up".
  - **Reply** (`{ kind: 'reply', threadId }`, from "Did anyone reply?"):
    - The last 3 messages from `/api/gmail/conversations/[threadId]`.
    - Your answer goes out through `/api/gmail/send-email` in the same thread (`threadId`, "Re:" subject).
    - A Lead Finder reply is then marked answered (op `handled`). "No reply needed" does the same without sending. Open in Gmail is there too.
    - The queue is the replies of the last 14 days.
  - **Brief** (`{ kind: 'brief', … }`, from "Why am I not on Google?"): a fix written in code from the card's data, with Copy the fix and Open Search Console:
    - hide a big section's pages with noindex (when one section holds most of the missing pages)
    - otherwise, link to the missing pages and request indexing (lists up to 12 of them)
    - or, with no sitemap, add one
- Closing a panel after doing something refreshes the cards. Esc and the dimmed page close it.
- Typed answers (the engine) don't open panels; their next step is still a link.
- Checked with faked APIs in the preview harness: write, approve, next, skip, all caught up, copy, posted, reply sent in-thread and marked handled, phone width. Full build passes. **Not tried with real Gmail or leads yet.**
- Next: phase 4, follow-ups and pins (see the plan). **Done 6 Nov, see 4g-5.**

## 4g-5. Ask, phase 4: follow-ups and pins (6 Nov)

- **Conversations** (`lib/ask/engine.ts`): every typed question is a turn in a thread, saved in `signal_snapshots` `ask:threads` (`:demo` in demo mode).
  - The last 5 threads are kept, 6 turns each.
  - Each turn keeps the answer, its lookups (`Lookup`: tool + input) and the data fetched (up to 8,000 characters).
- **Follow-ups:**
  - `POST /api/ask/question` takes `threadId`. The stream starts with `{ t: 'thread', id }`.
  - A follow-up's prompt gets the earlier questions, what each was taken to mean, the answers and findings, plus up to 16,000 characters of their data, with "reuse it instead of looking it up again".
  - That data is passed to `answerLoop` as `known`, so its numbers pass the number check.
  - Follow-ups count toward the 20 a day.
- **The answer form** has a headline `number` / `number_label` (empty when there's no single number), used on a pinned card.
- **Pins** (`lib/ask/pins.ts`, `signal_snapshots` `ask:pins`, up to 5):
  - "Pin to home" (`POST /api/ask/pins { threadId }`) pins the newest answer with the question, what it meant, and every lookup in the conversation, so a follow-up that reused earlier data still has something to fetch.
  - A pinned follow-up is titled with what it meant ("Sign-ups the week of the drop", not "Did it hurt sign-ups?").
  - `DELETE { id }` unpins.
- **Pin refresh** (`refreshPins`):
  - It repeats the saved lookups (`repeatLookups`), then one `answerLoop` with that data as `known` and no further lookups, to write today's answer.
  - When: in `/api/cron/ask` after the cards; on page open when a pin is older than 20 h (`/api/ask/cards` GET); and on "Check again" (all pins).
  - It doesn't count toward the daily limit. A failed refresh keeps the old answer.
- **Page:**
  - Earlier turns show short above the newest answer (`ask-earlier`).
  - Under a typed answer: "Pin to home", then "Ask a follow-up…" and a "New question" link. "Try again" on a failed follow-up retries it as a follow-up.
  - Pinned cards come first on the home page (blue border, "Pinned", their number or their sentence) and open at `/ask?pin=<id>` with "Unpin".
- Tested: the loop with a scripted Claude (reusing earlier data, a retry without it, lookups returned), and the page with faked APIs (follow-up sends the thread id, pin, pinned card, pin view, unpin). Full build passes. **Not run against the real API yet.**
- Next: phase 5, `/ask` becomes home (new onboarding; Today and Growth Path go behind it). **Done 6 Nov, see 4g-6.**

## 4g-6. Ask, phase 5: Ask is home; Today and Growth Path hidden (6 Nov)

The owner's call: remove Today and Growth Path, "if needed we can always add it back". Nothing was deleted; one switch hides them.
- **The switch:** `askIsHome(earlyAccess)` in `lib/features.ts`. It's on for early-access users, the same people who can open `/ask`. **`NEXT_PUBLIC_ASK_HOME=off` brings Today and Growth Path back for everyone.**
- **When it's on:**
  - `/start` (where login, the auth callback and the root `/` land) sends people to `/ask`. Onboarding and sign-up now go to `/start` (they went to `/dashboard`), so new users land on Ask too.
  - `/today`, `/dashboard` and `/dashboard/[moduleId]` call `sendToAskIfHome()` (`lib/ask/home.ts`) first and redirect to `/ask`. So the many old links to `/dashboard` (back buttons, ProGate, settings logo…) now lead to Ask. `/dashboard/meta-ads` and `/dashboard/keywords` are tools and still work.
  - Sidebar (`AppSidebar.tsx`): "Ask" first (icon `ask` in `ToolIcon.tsx`), then the tool groups; Today and Growth Path hidden; the logo goes to `/ask`.
  - Ask's top-right link is "Tools →" (`/tools`), no longer "GrowJin →" to Growth Path. On the very first visit (no cards yet) the line under the title says "Taking a first look at {site}. This takes about a minute."
  - Typed answers can no longer point to "your roadmap" (the `roadmap` action was removed from `ACTIONS` in the engine).
- **Everyone else** (not early access) sees the app as before.
- **Not done from the plan:** onboarding's step 2 (the prefilled brand form) is unchanged; it already reads as "what we learned" and saves the profile every answer depends on. The roadmap modules are no longer analysed from a page visit, since nobody opens Growth Path; the agents and Ask don't depend on them.
- Checked: the sidebar in the preview harness with Ask on and off. The redirects need a login and the database, so they're untested here. Full build passes.



## 4g-7. Ask: GrowJin logo, showing what's happening, related next questions (6 Nov)

The owner asked for these after trying Ask.
- **Logo:** Ask's header shows the GrowJin logo (`/growjinlogo.svg`) and "GrowJin" instead of its own "Ask" mark; clicking it goes to Ask's home.
- **Card progress:**
  - `/api/ask/cards?stream=1` (GET or POST) answers one JSON line per event (`FillEvent`): each step as it starts and ends, with a short result, then `{ t: 'done', data }`.
  - The steps are "Reading your emails, leads and research", one per card (`STEP_TEXT` in `cards.ts`, run side by side via `fillCards(brandId, onStep)`) and one per pinned question being updated (`refreshPins(…, { onStep })`).
  - The page shows them in a box (`FillProgress`, `ask-fill` / `ask-fs`): a spinner, then a tick or red ring per step, with a running timer and "N of M done". It's used on the first look, "Check again" and a card opened before it's ready.
  - Without `?stream=1` the route still answers plain JSON (the cron doesn't use it).
- **Typed question progress:**
  - The engine sends `{ t: 'think', text }` before each Claude turn: "Working out what you're asking and what to look up", "Reading what came back", "Fixing numbers that didn't match the data" or "Writing the answer with what was found".
  - The page shows it as the last "Thinking" line (replaced by the next one), above a "Working on it · N s" timer, which adds "bigger questions take up to a minute" after 25 s.
  - Look lines add the period when the lookup has one (" · last 7 days").
- **Related next questions** (`Answer.suggested`):
  - Typed answers: `give_answer` has `follow_ups`, 2–3 questions about that answer. Clicking one asks it as a follow-up in the same conversation.
  - Cards: `related()` in `cards.ts` picks 2–3 questions from the card and its state (for example, a down week suggests "Which pages lost visitors this week?").
  - Clicking a suggestion that is a card's question opens that card (free); anything else is asked as a typed question.
  - "Ask next" under a card now shows these; the old "next three cards" is only the fallback.
- Checked in the preview harness with slow streaming stand-ins for both routes (steps and ticks, thinking line and timer, suggestions, follow-up sends the thread id). Full build passes. Not run against real data yet.

## 4g-8. Ask: "What's my Google and AI visibility score?" card (6 Nov)

A ready answer (`seen`, second on the home page) that scores how findable the site is, out of 100, from the SEO playbook checks. Code: `lib/ask/visibility.ts` (`visibilityChecks`, `visibilityAnswer`); URL helpers moved to `lib/ask/urls.ts`.
- **Nine checks, two groups**, each good (1) / needs work (0.5) / fix this (0) / not known (left out), weighted:
  - Google: pages Google shows (3), thin auto-made pages (2), leaks such as search or filter pages in the sitemap (1), sitemap (1), home page title / H1 / description (2), searches by people who don't know you yet (2), sites linking to you (2).
  - AI answers: named in AI answers (3), helpful replies on Reddit / HN (1).
- Data: the Google card's data (fetched once, with `fetchGscTopQueries` 250 rows), the home page read with cheerio (`readHomepageCheck`), DataForSEO referring domains (`linkingSites`, cached weekly in `ask:links`, Usage as "Ask"), Search Agent AI answers, Lead Finder posts.
- **Picture** `checks`: grouped list, each line opens to "why it matters". Sentence names the score, the Google and AI parts, and what to fix first. Next step is the fix for the worst weighted check (brief panel, or the Search Agent / another card).
- Without Search Console and AI answers, it says there isn't enough to score yet and asks to connect Search Console.
- Checked in the preview harness (full and empty). Full build passes. Not run on real data yet.

## 4g-9. Ask: "Why am I not on Google?" knows why, page by page, and keeps track (6 Nov)

The owner's ask: not just counts, but *why* each page is missing (a new site may just need time), and a way to ask Google to index a page, press Done, and have it tracked.
- **`lib/ask/indexing.ts`:**
  - `indexInfo()` fetches and caches in `ask:index`:
    - Google's own verdict per missing page: URL Inspection, up to 20 per fill, each kept 3 days, pages you asked about checked first.
    - The site's first day in a search: Search Console by date over 16 months, weekly.
    - The submitted sitemaps.
  - `sortPages()` (pure) puts each missing page in one group:
    - **todo**: unknown to Google, discovered but not visited, or just not in.
    - **improve**: Google read it and left it out, or it's still out 21+ days after you asked.
    - **blocked**: noindex, robots, redirect, 404, a copy of another page…
    - **wait**: added under 14 days ago (sitemap `lastmod`), or asked under 21 days ago.
    - **indexed**: Google has it, nobody searched for it yet.
- **New site:** first in a search under 90 days ago. The sentence leads with "Your site is new to Google (first in a search N days ago), so part of this is just time." The visibility score's "Pages on Google" check is "needs work" rather than "fix this".
- **Card:**
  - The sentence splits the rest: need a nudge / new or waiting / on Google but not searched / blocked.
  - Bars show the same split.
  - Findings, most important first: the new site, thin sections, asked pages now in, sitemap not submitted, left out, blocked.
  - Next step opens the new **index panel** (`Panel kind 'index'`, `IndexPanel` in `AskPanel.tsx`, `ask-ix-*` CSS):
    - Groups Ask Google / Improve first / Blocked / Give it time / On Google, not searched.
    - Each row: the page, why in plain words, **Open in Search Console** (its URL Inspection page), and **Done, I asked Google**.
    - "N asked today · Google allows about 10 a day".
  - The thin-section "hide these pages" fix still comes first when it applies.
  - Falls back to the old brief if URL Inspection didn't answer.
- **Tracking:** `/api/ask/indexing` GET / POST `{ url, asked }` saves the asks in `ask:index-asks` (`:demo` in demo mode). The next morning's fill:
  - inspects those pages first;
  - says "N pages you asked Google for are on Google now";
  - moves pages still out after 21 days to Improve first.
- Uses the `webmasters.readonly` key already connected (URL Inspection works with read-only). Checked with made-up data in the preview harness: an old site with every group, a new site, Done / Undo, phone width. Full build passes. **Not run against a real Search Console property yet.**

## 4g-10. Ask runs on the MCP tools; Leads, Email and Write inside Ask (11 Nov)

The owner's call: "forget the old pages exist, everything comes here", and build Ask by asking the MCP tools for everything (plus Claude), so there's one place to manage. `dev` was merged into this branch first (the lead / email / goal tools only lived there; `dispatch` stays in `lib/mcp/dispatch.ts`, dev's new cases moved there).
- **Two new MCP tools** (`lib/mcp/tools/inbox.ts`, in `tool-registry.ts`, `dispatch.ts`, Settings' tool list):
  - **`list_leads`**: Lead Finder's board, best first: status (to_do / queued / sent / replied / posted / skipped / closed / all), lane (email / talk), search, one lead in full (`lead_id`), drafts (`include_text`), `needs_email`, counts by status, last search.
  - **`list_replies`**: replies to emails GrowJin sent (`show: replies`, last `days`), follow-ups due (`show: due`, with `reminder_id`), or all threads; `thread_id` reads that thread's last messages with each `message_id`, so `send_email` can answer in it (`thread_id` + `in_reply_to`). `listConversations` now also gives `reminderId`.
- **`dispatch(name, args, brandId, { via: 'ask' })`**: `send_email` / `gmail_status` from Ask skip the "Let Claude send email" switch (the person pressed Send) and use Lead Finder's daily limit; rows saved with `source: 'ask'`.
- **`lib/ask/tools.ts`**: `askTool(brandId, name, args)` (server) and `UI_TOOLS`, the tools the page may call through **`POST /api/ask/tool`** `{ name, args }`.
- **Cards** read through the tools: `list_replies`, `list_leads` (to_do email / talk), `get_search_agent` (topics, keywords, ai_answers), `get_daily_numbers` (Am I on track: it now also returns `impressions_last_7d` / `impressions_previous_7d`), `dataforseo` `backlinks/summary/live` for the visibility score's linking sites (an exact count now, cached weekly). Card functions take the tools' shapes (`ToolLead`, `ToolThread`, `LeadList`, `ThreadList`, `TopicsResult`, `KeywordsResult`, `AiRow`). **Exception:** the Google and visibility cards still read the sitemap, Search Console's page check (URL Inspection) and the home page directly: no tool does that yet.
- **Typed questions** can use `list_leads`, `list_replies`, `get_lead_settings`, `check_contacts`, `gmail_status`, `get_search_agent`, `get_daily_numbers`, `get_goal_progress`, `get_weekly_review`, `list_work`; the engine's own `outreach` tool is gone (old pins that repeat it run `list_leads` + `list_replies`). Its next-step actions (leads, inbox, campaigns, search_agent) open workspaces.
- **Claude writes** (`lib/ask/write.ts`, **`POST /api/ask/write`**, Sonnet 5.5, Usage "Ask: writing emails and replies"): `{ lead_id }` the first email or page / forum message (Lead Finder's rules), `{ thread_id }` an answer to a reply or, when the last message is yours, a follow-up nudge, `{ list_about }` one email for a list with `{first name}` / `{company}`, `{ topic }` a blog post for a Search Agent topic. Reads only through the tools; nothing is saved until sent.
- **Workspaces** (`components/ask/Workspaces.tsx`, `Panel` kinds `leads` / `email` / `write`, `ask-tabs` / `ask-start` / `ask-row` / `ask-do` CSS): chips under the ask box (Leads · N ready, Email · N replies, Write · N to write); the ask box opens them for jobs ("find me leads", "email my list", "write a post": `jobOf` in `AskPage.tsx`); card and typed-answer buttons open them too.
  - **Leads**: Contact directly / Join conversations, Start here, rows; opening one is the lead panel (now `list_leads` + Claude + `send_email`); Find new leads runs the Lead Engine (`/api/leads/engine`, itself Claude + the MCP tools) with its log; Sent or skipped.
  - **Email**: Gmail line (`gmail_status`), Replies and Follow-ups (the reply panel, now `list_replies` + Claude + `send_email` in the thread; a sent follow-up closes its reminder and sets a new one in 5 days), Send to a list (paste → `check_contacts` → Claude writes one email → `send_email` in batches of 20, follow-up reminder in 4 days).
  - **Write**: the Search Agent's open topics; a drafted one via `get_blog_post`, "I published it" → `mark_blog_published`; otherwise Claude writes it (not saved: copy it).
- **Still not through a tool** (no MCP tool changes these yet): Skip a lead, "I posted it", marking a reply answered (Lead Finder's `/api/agents/lead`), closing a follow-up reminder (`/api/reminders/[id]/done`), starting a lead search (`/api/leads/engine`), lead settings, connecting Gmail / Search Console. The header's "Tools →" became "Settings".
- Checked in the preview harness with the tools and writer faked: every workspace, send, next, follow-up, list send, draft / publish, job phrases, card → workspace, phone. Full build passes. **Not run against real data, Gmail or Claude yet.**

## 4g-11. Ask only by its sidebar item or URL; the app back as before (11 Nov)

The owner's call: keep the app as it was, with Ask reachable on its own.
- `askIsHome` (`lib/features.ts`) is now off unless `NEXT_PUBLIC_ASK_HOME=on`: `/start` lands where it did, `/today` and `/dashboard` don't redirect, the sidebar shows Today and Growth Path.
- The sidebar has an **Ask** item first for everyone (`AppSidebar.tsx`).
- `/ask` (`app/ask/page.tsx`) no longer checks early access; `/api/ask/*` use the new `askAccess()` in `lib/agents/access.ts` (signed in, a brand, Pro when billing is on). The Ask header shows "Back to the app →" (`/dashboard`) when Ask isn't home, else "Settings".
- Not changed: Lead Finder, the Lead Engine, Lead Finder's skip / posted ops and reminders keep their own rules (`agentAccess`, early access), so for users without early access the Leads workspace stays empty and "Find new leads" says AI Agents are coming soon. `/api/cron/ask` still fills cards each morning only for early-access brands; others get them when they open Ask.

## 4g-12. Ask does what you ask: Claude starts jobs and proposes emails (11 Nov)

The owner's call: Ask should behave like Claude with every tool, not fixed rules. Approved preview: `design-previews/seo-ask/ask-agent.html` (with "Download (CSV)" on the results).
- **No fixed rules:** `jobOf` (the "find leads" keyword rule) is gone from `AskPage.tsx`; everything typed goes to the question engine (`lib/ask/engine.ts`), whose prompt now also covers jobs.
- **Two new moves for Claude** (Ask tools, not MCP tools):
  - `start_lead_search { brief, how_many }`: starts the Lead Engine with **this search's own brief** (`startEngine(brandId, { brief, leadCount, hold: true, ask })` in `lib/leads/engine.ts`; the saved brief only fills gaps, and no saved brief is needed). Refused in demo mode, and while another search runs. Emits `{ t: 'task' }`.
  - `propose_emails { title, why, emails[] }`: emails it wrote (answers in a thread carry `thread_id` / `in_reply_to`), shown for approval. Emits `{ t: 'proposal' }` (`Proposal` in `lib/ask/types.ts`). Nothing is sent by Claude.
- **Held results:** a search started from Ask keeps its Neutral-or-better leads in the job (`EngineJob.hold / found / foundAdded / summary`, in `statusOf`) instead of saving them. `addFoundLeads(brandId, picks)` saves the picked ones through `addEngineLeads` (`foundVia` "Found with Ask").
- **`/api/ask/task`** (`askAccess`): GET status (advances a stalled search with `after()`, like `/api/leads/engine`), POST `{ op: 'stop' }`, `{ op: 'add', picks }`.
- **Page** (`components/ask/TaskView.tsx`, `ask-task` / `ask-lead` / `ask-approve` CSS): `TaskView` polls every 3 s and shows the search's steps and cost, then the found leads with ticks: **Add N and write the emails** (adds, then `/api/ask/write` per lead with an email, then the emails for approval), **Just add them**, **Download (CSV)** (company, website, contact, email, socials, rating, why). `ProposalView`: edit each email, **Send N emails** (`send_email` as Ask) or Not now.
- Lead Finder's own page still shows the latest search; a held Ask search shows there as done with nothing added.
- Checked in the preview harness with Claude's stream, the task and sending stood in for: running, found, untick, CSV, add + write + send, a proposal from a typed request, phone. Full build passes. **Not run against the real API yet**: check that Claude picks `start_lead_search` for lead requests and that the Lead Engine follows a brief like "from X" (it can run any Apify actor by its full name).

## 4g. Foundation: Google Business Profile check (4 Nov)

- New check `google-business-profile` (weight 3) in Foundation under "Online Presence" (was "Social Media Presence") → "Google Business Profile".
- **Shown for every brand** (owner's call, 4 Nov; it was local / agency only at first). Checks can still carry `relevantFor` (website types) to limit them; `defForBrand(def, websiteType)` in `lib/modules/types.ts` drops checks that don't apply; used when seeding (onboarding, analyze route, admin add-missing-modules) and on the Growth Path / admin views. If a brand's type changes, the next analysis removes checks that no longer apply.
- **How it checks** (`lib/modules/foundation/google-profile.ts`, no AI): DataForSEO Business Listings (`businessListings` in `dataforseo.ts`, by website domain, then by exact name; ~$0.01, shows in Usage as Foundation · "Google Business Profiles"), else a link on the site to the profile, a review link or an embedded Google map (`googleProfileLink` in the fetcher). Fails when not found or the listing isn't claimed; passes with a note to get more reviews under 5. "Check again" on the item uses the same lookup.
- Not tried against the real Business Listings API yet (filter field names `domain` / `title`).

## 4h. Work log MCP tools (6 Nov)

The owner does growth work outside GrowJin (blogs that need indexing, community notes, leads emailed) and wants it kept somewhere to ask for later. **Backend + MCP only, no UI, and nothing else in the app reads it** (not Today, the agents, dedupe or scores). Claude logs only when the owner tells it to.
- **Table** `work_log` (`web/drizzle/work_log.sql`, **run it in Supabase**; until then the tools answer "The work log table is missing…"): kind (blog / community / outreach / listing / social / other, free word allowed), title, url, done_on, how, status (done / waiting / follow_up), next_check, notes.
- **Tools** (`lib/mcp/tools/work_log.ts`, in `tool-registry.ts` and `app/api/mcp/route.ts`): `log_work` (one entry or `entries`, up to 100; a url already logged isn't added again, returned as `already_logged`), `list_work` (kind, status, from / to, search, `due`, limit ≤ 500; counts by kind and status), `update_work` (only the fields given; `add_note` appends a dated line), `delete_work`.
- Tested against a local Postgres (adding, batch dedupe, filters, due, updates, brand separation, missing table). Not tried through a live MCP client yet.

## 4i. MCP: leads and Gmail tools (6 Nov)

So lead-finding can be done in a Claude conversation with the raw `dataforseo` / `hunter` / `apify` tools, and the results land in the app.
- **`get_lead_settings`** (`lib/mcp/tools/leads.ts`): brand + competitors, the Lead Finder brief and filters, the ideal-customer card, sending settings, lead counts by status, `already_known` domains, last search. `include_playbook: true` adds `ENGINE_PROMPT`.
- **`check_contacts`**: per email / domain: new, already_a_lead (any status), emailed / scheduled (`outreach_emails`, 2 years), opted_out / bounced (`email_suppressions`). Up to 200 each.
- **`save_leads`**: the Lead Engine's answer format, through `addEngineLeads` in `lib/leads/engine.ts` (split out of `saveAnswer`, same dedupe, rating, facts; `foundVia` "Found with Claude"; doesn't touch Last search). Returns added / kept_aside / skipped. All three respect the brand's demo switch.
- **`gmail_status`** / **`send_email`** (`lib/mcp/tools/gmail.ts`): sends only when Gmail is connected with send scope **and** the user switched on "Let Claude send email" (Settings → Connect Claude, `ClaudeSendEmail` in `SettingsPage.tsx`, `/api/mcp/gmail-send`, snapshot `mcp:gmail-send` in `lib/mcp/gmail-permission.ts`, off by default, daily limit 10 / 25 / 50, counted from `outreach_emails` rows with `source: 'claude'` since 00:00 UTC). Up to 20 per call; suppressed addresses refused. A first email to a lead on the board marks that lead sent (opt-out line added, `sentLog`, `nextFollowUpAt`) so the Lead Agent's follow-ups and reply check take over; otherwise `follow_up_days` adds a reminder. The tool description tells Claude to show each email and get a yes first.
- Tested against a local Postgres with Gmail mocked (dedupe, verdicts, permission off/on, suppression, lead marked sent, limit count). Not tried through a live MCP client or real Gmail yet. The Settings switch wasn't checked in the browser.

## 4j. MCP: Search Console, competitors and PostHog fixed (7 Nov)

From a check run through Claude: GSC empty, competitors empty, PostHog half working.
- **`get_gsc_data`**: lists the service account's properties and picks the one covering the site (`pickProperty` from `gsc-indexing.ts`, tried on the site URL with and without www / https), so domain properties (`sc-domain:`) work. It used to query only the raw website URL and turned every Google error into empty lists. Now returns `property`, `totals`, top queries (operator searches dropped) and pages, a window ending 2 days ago, and Google's message as `error` (with `properties_it_can_see` when none matches).
- **`get_competitors`**: adds the module-setup competitors (`moduleCompetitors` in `lib/agents/context.ts`, now shared with `loadBrandContext`: `competitor_urls` + `achievable_competitors` of Competitor Analysis and GEO) after the `competitors` table rows, one per domain.
- **PostHog tools** (`posthog-common.ts`, shared): emails read as `coalesce` of the chosen email property, `email`, `$email`, or an email-like distinct id (only `person.properties.email` before); every query has a time window (churned / pro: last 90 days, segments' new users from `persons.created_at`, churned 15-60 days; the old all-history `NOT IN` subqueries timed out); 45 s timeout (was 15); PostHog's error comes back as `error` / `errors` instead of empty or null. Counts (DAU/WAU/MAU, segments) follow the app's "Count unique users only" setting (`buildPostHogFilter`). Used by the daily diagnosis and the Lead Agent's paying-user lookalikes too.
- Tested with mocked Google / PostHog against a local Postgres. **Not run against the real APIs**, so the HogQL hasn't been checked by PostHog yet.

## 4k. MCP: Search Agent tool and no false passes (10 Nov)

The owner ran 100 growth questions through the MCP (`Growjin_MCP_dry_run_Frekto.xlsx`, 6 Nov): 12 fully answered. GSC and competitors were already fixed in 4j; the other two cheap fixes:
- **New `get_search_agent`** (`lib/mcp/tools/search_agent.ts`): read-only, sections overview / ai_answers / keywords / topics / tasks / links, respects demo, runs `tidySearchFor` first. `get_module_detail("search…")` hints at it.
- **False passes:** old audits saved Core Web Vitals as `info` (= passed) when Lighthouse never ran, and `seo-audit.ts` still saved "Cannot check…" findings as `info`. Those findings are now `skip` ("Couldn't check…"), and `isNotChecked` (`lib/modules/types.ts`) also matches the old wording, so the score leaves them out. MCP `get_module_detail` gives each item a `status` (passed / failed / not_checked / …) and recomputes the score; `get_growth_overview` recomputes every module's score from items. The saved `modules.score` only changes at the next tick or analysis.
- Tested with stubbed Search Agent data. Not tried against the live MCP yet: rerun the spreadsheet after deploying.

## 4k. PostHog segments on one basis (10 Nov)

Live check after the 7 Nov fixes: GSC (`sc-domain:frekto.ai`), competitors and PostHog lists work. Segments mixed bases (churned / power counted every PostHog person, active counted unique emails: 134 churned vs 27 active, churn risk 496%). Now every segment counts `filter.eventDistinctCol` (the app's "Count unique users only" setting); new users = first seen that week within 180 days (was `persons.created_at`, gave 0 last week); churn risk = churned / everyone active 15-60 days ago; `definitions.counted` says what's counted. Competitors only show GEO's 3 for Frekto: Competitor Analysis saves its suggested list (`competitor_urls`) only on runs since that code; re-run it.

## 4l. MCP: goal, daily numbers, weekly review; daily history fixed (10 Nov)

"Piece 1" of the plan in `md_files/MCP_PARTIAL_ANSWERS.md` (the 46 half-answered questions from the Frekto dry run): questions 1-5, 95, 96.
- **Daily history was empty** ("No history yet" for Frekto). The nightly `daily-signals` cron writes `brand_history` (`lib/history/index.ts`); most likely `drizzle/tracking.sql` was never run, and every failure was hidden. Now: the table is created on first use if missing (same SQL, `withTable`); `ensureRecentHistory` saves yesterday when it's missing and reports days saved, first / last day and a plain `problem` (table can't be read, cron stopped since X, nothing saved before); a failing ticked-items count no longer loses the day; the cron logs failures (`[history]`). `get_growth_history` returns `history` with that status.
- **Goal** (`lib/goal/progress.ts` pure maths, `lib/mcp/tools/goal.ts`): snapshot `goal` in `signal_snapshots` (no new table): `target` (default 500), `counts` (`signed_up` = PostHog persons with the app's unique-users setting, as Road to 500; `active_weekly`; `paying` = person property `planProperty` = `planValue`), `deadline`, `readings` (one count per day, kept 400 days). Tools **`set_goal`** (only when the user says so) and **`get_goal_progress`**: current, percent, Road to 500 stage (signed_up only), per week over the last 4 full weeks vs the 4 before → speeding up / steady / slowing down (±15%), date the target is reached at that pace, with a deadline weeks left / needed per week / `on_track`, 13 weeks of totals, new in the last 24 h. Weekly sign-ups = people first seen that week (180-day lookback, same as `get_posthog_segments`); `persons.created_at` gave 0 for Frekto. Paying has no history in PostHog, so its trend builds from the daily readings. Unset goal → a note telling Claude to confirm and save it.
- **`get_daily_numbers`** (`lib/goal/daily.ts` maths, `lib/mcp/tools/daily_numbers.ts`): 40 days by day from GA4 (sessions, new users, per channel; landing pages starting `/admin` or `/wp-admin` excluded and counted in `left_out`), Search Console (clicks, impressions, date dimension, compared on its latest day since it lags 2-3 days; property picked by `connectGsc`, now exported from `get_gsc_data.ts`) and PostHog (first-seen sign-ups, daily active). Yesterday vs 7- / 30-day averages, today so far, last 14 days, last 7 vs previous 7, channels `moved_most` / `went_quiet` (3+ before and halved), `unusual` (last 3 days vs the 28 before: 2.5 SD and 5+ and 50%+ off; needs 7 non-zero days). Missing sources go to `not_available` with the reason.
- **`get_weekly_review`** (`lib/mcp/tools/weekly_review.ts`): goal pace (this week so far, last full week), the daily numbers' week totals and channels, unusual days, work log entries of the last 7 days, emails sent by source (`outreach_emails`), checklist items / Today tasks ticked (history), Search & AI tests running (`changes`), module score changes; `how_to_read` asks Claude to judge and say when numbers are too small.
- Tested against a local Postgres with GA4 / Search Console / PostHog faked (missing table created, stale history reported, goal defaults / validation / deadline / all three counts, spike flagged, quiet channel, internal visits). **Not run against the real APIs**; the HogQL `toStartOfWeek` / `toDate` queries and the GA4 `landingPage` filter haven't been checked live.

## 5. What we are doing right now: making the tools calm

**Problem.** In a demo, people were confused about what to do. The tool pages are too noisy:

- many green buttons at once
- colour everywhere (red badges, orange source pills, green fit badges, chips)
- three levels of navigation (tabs, then a filter, then section labels)
- a lot to read before the first lead
- cards that repeat themselves

**Agreed rules, to apply to every tool and Today:**

1. **One green button per screen**: the next thing to do. It sits in a "Start here" panel at the top, for example "3 emails ready for your OK. Start with Bloom Salon → Review the email". Every other item is a quiet row: a name and one line on why, opening on click.
2. **Colour means one thing each.** Green is the next step. Red (or a light red panel) means someone replied. Everything else is grey. No source pills, fit badges, status chips or tag pills.
3. **One level of tabs.** In the Lead Agent: Email / Community. Sent and done live behind one small link ("2 sent or skipped").
4. **A quiet top:** title, then one grey line ("Last search 2 h ago · Settings · Find new leads").
   - Gmail status, Demo mode and the sources move **inside Settings**. They appear on the page only when something is wrong.
   - The intro strip shows only on the first visit.
5. **Short rows.** Details (website, date, quote) show only when you open an item.
6. **After finishing an item, open the next one automatically.** When nothing is left: "All caught up", with one button.
7. **Search box only when a list is longer than 8.**

**Preview of these rules:** the Lead Agent, built as a clickable HTML page.

- File: `design-previews/tools-cleanup/lead-agent-calm.html`
- Published: https://claude.ai/artifact/VBumsgS9fSHqmntQyJMSBq (private to the owner; share from the page)
- The owner is showing it to the people from the demo.

**Today is done (sketch E, "Open & close").** Preview: `design-previews/tools-cleanup/today-calm.html` (https://claude.ai/artifact/L6h5DFDAEBKYmZPK5zrEiC). The real page (`TodayDashboard.tsx`) is five sections that open and close, in this order: How it's going, To do today, Blog and posts, Social accounts, Done. Each closed section shows a one-line summary. How it's going and To do start open; open state is kept in `localStorage` (`today-folds-v2`).
- To do: one Start here panel (the page's only green), then quiet rows with a faint icon per task type. List text is `data.finding` without the "Overdue: waiting N days." lead-in (the opened task, daily email and MCP keep it). Finishing a task opens the next. A ring shows done today / today's total.
- How it's going: Road to 500, What happened (visitors and signups have a 14-day line from `trend` in `/api/today/activity`), What's working.
- Type: 400 reading, 500 names/labels/numbers, 600 only the title and the green button (scoped block at the end of Today's styles).
- Settings holds the daily email switch and "check again". Not yet calmed: the insides of the blog and social stats blocks.

**Next steps:**

1. Wait for the owner's feedback on the calm preview, then change it if needed.
2. Build the calm version into the real Lead Agent (`LeadAgentPage.tsx` + `tool-ui.tsx` + CSS). Keep the current data and API; this is a UI change.
3. Apply the same rules to Competitor Leads, Email Outreach, Search Agent and Today, one at a time, checking each in the preview harness at desktop and phone width.
4. Push to `dev`. Push to `main` only when the owner asks.

## 6. Known open items

- **Not tested against real services:** none of the recent work has been tried with real Gmail, DataForSEO, Hunter or Claude. Test on a test account before relying on it.
- **"Credits used up" is per brand:** all brands share one Hunter key, but each brand's note only shows once its own run hits the limit.
- **DataForSEO ideas, not built** (agreed with the owner, nothing started): a spending cap per brand; queued instead of live calls for the daily run (about a third of the price); caching keyword data for 30 days; replacing SerpAPI, Serper and DuckDuckGo scraping in the SEO, Outreach Targets and Community Finder modules; real competitors and a keyword gap from DataForSEO Labs; Google reviews as a Competitor Leads source; Search Agent rank drops and wrong AI descriptions as Today tasks; LLM Mentions to bring back the "how often AI names you" chart.
- **Unused code:** `/api/gmail/set-followup` and some old `gh-*` CSS are no longer used (the old full-mailbox `inbox`, `thread` and `summarize-thread` routes were deleted). The new Inbox reuses the `gh-thread-*` / `gh-msg-*` styles.
- **Inbox isn't "calm" yet:** it still uses coloured tags and avatars. Apply section 5's rules when Email Outreach gets its pass.
- **Possibly lost feature:** the Search Agent's old "how often AI names you vs competitors" bar chart was dropped. Ask the owner whether they want it back.
- **Unconfirmed vendor links:** some directory sign-up links in `web/lib/agents/task-kinds.ts` weren't confirmed. Unknown ones open the site's home page.
- **Older design previews:** in `design-previews/tools-cleanup/`. `tool-pages.html` is the earlier approved layout, which the calm preview replaces for the tools.

## 7. How the owner likes to work

- Keep answers **short and plain**. When they say "don't code, just analyse", only analyse.
- For UI ideas, they like a **clickable HTML preview first**, then the real build after they approve it.
- They demo to colleagues and care most that a first-time user knows **what to do next**.
