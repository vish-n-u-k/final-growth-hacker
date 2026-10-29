# GrowJin: handoff for the next session

Last updated 26 Oct 2026. Read this first. It covers what the app is, how the code is laid out, what was built recently, and what we are in the middle of.

## 1. What the app is

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
  - `main` was last brought up to `dev` on 29 Oct 2026 (Lead Finder page and one funnel, MCP `producthunt` alias). `main` and `dev` are the same.
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
- `limit`: default 10, hard max 50 (`lib/mcp/tools/limit.ts`). DataForSEO dollars and Hunter credits show in Settings → Usage as "Claude (MCP)".
- Checked against mocked APIs, and (29 Oct) live through the deployed tool with the inputs the new code builds: `meta_ads` primary + fallback and `b2b_database` worked. **Blocked:** `linkedin_company` (approve its permissions in Apify Console), `linkedin_people` (Apify 402: the account had $0.21 of monthly usage left; the new limit-sized caps should get small runs through, else upgrade the plan), `producthunt` (the old deployed tool waited 60 s and the MCP client timed out; the new 45 s wait fixes that). Re-test those after deploying. `dataforseo` / `hunter` still untested live.

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
- **Stale backlinks message:** `web/lib/agents/link-opportunities.ts` (~line 242) still says backlinks need DataForSEO's subscription. That's no longer true; reword it.
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
