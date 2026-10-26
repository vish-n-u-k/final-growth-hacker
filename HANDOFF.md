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
  - `main` was last brought up to `dev` on 26 Oct 2026, with Lead Finder (`/leads`). `main` and `dev` are the same.
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
