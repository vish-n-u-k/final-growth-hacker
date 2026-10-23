# GrowJin: handoff for the next session

Last updated 23 Oct 2026 (later the same day: Competitor Leads made calm). Read this first. It covers what the app is, how the code is laid out, what was built recently, and what we are in the middle of.

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
| **Lead Agent** | Two jobs, shown as two tabs. **Email**: finds businesses on Google Maps through DataForSEO, finds their email through Hunter, writes an email and you approve it. Follow-ups go out by themselves and stop when they reply. **Community**: finds Reddit and Hacker News posts asking for a tool like yours, writes a reply, and you post it yourself. It does **not** read competitor reviews any more; that is Competitor Leads' job. |
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
| Modules | `web/components/AllModulesDashboard.tsx`, `web/lib/modules/registry.ts` |

### Outside services and keys

| Service | Used for | Key |
|---|---|---|
| DataForSEO | Google Maps businesses, search data, rankings, AI answers | `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` |
| Hunter | Emails | `HUNTER_API_KEY` |
| Gmail | Sending, through OAuth per brand | (per-brand OAuth) |
| Claude | Scoring and writing, through `web/lib/ai/client.ts` | — |

- **Demo mode** is a per-brand switch on the agent pages. Businesses, results and emails are made up, and nothing is sent.
- Demo mode is **forced on until the DataForSEO keys are set**.

## 3. Branch and working rules

- **Work and push on `dev`.** Push to **`main` only when the owner says so.**
  - `main` was last brought up to `dev` at commit `b7d84b7`. Everything after that is on `dev` only.
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
   - Emails come from Hunter only (no scraping websites).
   - Email / Community tabs, each with a To do / Waiting / Done filter.
4. **Demo mode switch** per brand. Demo data is stored apart from real data.
5. **Paging:** every list longer than 8 pages at 8. Tables and short lists use "Show all".
6. **Search Agent "other things to do"** are actionable:
   - Fix-it wording
   - Directory listing + review request
   - Article sites turned into pitches
   - Reddit
7. **Look matched to the module pages:**
   - Breadcrumb, 32px serif title, 14px line under it.
   - Module page width.
   - Eyebrow section labels, 14px card corners.
   - Applies to every tool and Today.

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

**Preview of all tools and Today calm:** `design-previews/tools-cleanup/all-tools-calm.html`, published at https://claude.ai/artifact/NgrFCxQwAwnNaZDBRsXbXC.

**Built so far:** Competitor Leads (`LeadFinder.tsx`, `lead-finder/ReachOut.tsx`). It uses the shared calm parts in `tool-ui.tsx` (`CalmHead`, `StartHere`, `QuietRow`, `AllCaughtUp`) and the `ca-*` CSS at the end of `globals.css`. Reuse these for the other tools.

- After sending or skipping on a reviewer's page, the next good fit opens by itself. The `?done=sent|skipped&id=&name=` query shows the toast (with Undo for a skip) on the page that opens.

**Next steps:**

1. Build the calm version of the Lead Agent, Email Outreach, Search Agent and Today the same way, one at a time, checking each in the preview harness at desktop and phone width. Keep the current data and API; this is a UI change.
2. The owner liked the Competitor Leads preview. Ask about the open questions in the all-tools preview (merging Follow-ups and Inbox replies in Email Outreach, the AI-names-you chart, the streak moving to Settings).
4. Push to `dev`. Push to `main` only when the owner asks.

## 6. Known open items

- **Not tested against real services:** none of the recent work has been tried with real Gmail, DataForSEO, Hunter or Claude. Test on a test account before relying on it.
- **Unused code:** `/api/gmail/set-followup` and some old `gh-*` CSS are no longer used (the old full-mailbox `inbox`, `thread` and `summarize-thread` routes were deleted). The new Inbox reuses the `gh-thread-*` / `gh-msg-*` styles.
- **Inbox isn't "calm" yet:** it still uses coloured tags and avatars. Apply section 5's rules when Email Outreach gets its pass.
- **Possibly lost feature:** the Search Agent's old "how often AI names you vs competitors" bar chart was dropped. Ask the owner whether they want it back.
- **Unconfirmed vendor links:** some directory sign-up links in `web/lib/agents/task-kinds.ts` weren't confirmed. Unknown ones open the site's home page.
- **Older design previews:** in `design-previews/tools-cleanup/`. `tool-pages.html` is the earlier approved layout, which the calm preview replaces for the tools.

## 7. How the owner likes to work

- Keep answers **short and plain**. When they say "don't code, just analyse", only analyse.
- For UI ideas, they like a **clickable HTML preview first**, then the real build after they approve it.
- They demo to colleagues and care most that a first-time user knows **what to do next**.
