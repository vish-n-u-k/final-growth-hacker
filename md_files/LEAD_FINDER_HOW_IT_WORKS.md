# GrowJin Lead Finder: how it works now

This document describes the lead logic as it runs today. It is written so another person or AI can review it and say whether it is going in the right direction. It covers:

- what Lead Finder is for
- each step of a search, and which outside service does what
- the limits and numbers it uses
- what the user sees
- how long a search takes and what it costs (estimates)
- what is weak or untested

**State as of 3 Nov 2026.** This replaces `LEAD_AGENT_HOW_IT_WORKS.md` (27 Oct), which describes the older pipeline.

**Code:**

| Part | File |
|---|---|
| The search's instructions | `web/lib/leads/engine-prompt.ts` |
| The loop that runs them | `web/lib/leads/engine.ts` |
| The API | `web/app/api/leads/engine/route.ts` |
| The page | `web/components/leads/LeadFinderPage.tsx` |
| The tools | `web/lib/mcp/tools/{dataforseo,hunter,apify}.ts` |

---

## 1. What it is for

GrowJin helps small businesses grow. **Lead Finder** (`/leads`) finds companies that would plausibly buy the user's product, plus the right person to contact at each one. It writes the first email, and the user approves it before anything is sent.

- **The user** is a small business owner or solo founder. They are not a salesperson and not technical.
- **The test brand** is Frekto, an AI tool that writes, designs and schedules social media posts.
- **The rule that matters most:** fit first, contacts second. Ten well-matched companies with only a shared inbox beat fifty random companies with checked emails.

## 2. The big decision (30 Oct): an AI agent instead of a fixed pipeline

Until 30 Oct, the search was a fixed pipeline written in code:

1. Search phrases.
2. DataForSEO results.
3. Read each site.
4. A yes/no AI check.
5. A score.
6. Hunter for the email.

It kept finding the wrong companies (agencies, articles, rival tools), and every fix meant more code.

**Now the logic is a prompt.** One Claude model (`claude-opus-5-5`, adaptive thinking, default effort) gets the owner's "Lead Engine" prompt and three data tools. It decides on its own which searches to run, which leads to drop, and when to stop. The code only does four things:

- runs the loop
- enforces the spending caps
- removes repeats
- saves the answer

To change how leads are found, change `engine-prompt.ts`, not code.

## 3. What the user fills in (Settings)

| Field | Example |
|---|---|
| **Brief** (free text, the most important) | "Small SaaS with a real product, not test apps. Ideally they already post on social but it isn't working. Skip founders juggling many projects." |
| Industry | small SaaS / app companies |
| Location | UK, Ireland, Netherlands |
| Company size | 1–10, early stage |
| Who to contact | Founder / CEO |
| Leads per search | 10 (1–50) |

The search also gets:

- the brand's name, website, description, offer and competitors
- `already_known`: up to 300 domains already in the list, so it doesn't pay for them again
- today's date

If the brief and the filters disagree, the brief wins on intent and the filters win on scope, and the clash is listed in the output.

## 4. The search, step by step (what the prompt tells Claude to do)

**Step 0: lead profile (no tool calls).** From the brief and brand, Claude writes:

- what the user sells
- must-haves
- strong-fit signals
- disqualifiers
- competitors to exclude
- which extra checks this user needs (for example social activity or app-store presence; only the checks that matter)
- the pitch angle

The page shows this profile afterwards, so the user can see how the brief was understood.

**Stage 1: discover.** Find 2–3× the number of leads asked for:

- narrow Google searches through DataForSEO, phrased the way the target companies' own customers would search
- Google Maps for place-based businesses
- Product Hunt (Apify) for new tech products

It skips directories, review sites and big brands, and records where each candidate came from.

**Stage 2: is it real?** It drops any candidate that:

- has a dead or parked site (checked with DataForSEO `instant_pages`)
- is a placeholder or test product
- is a different company using the same name
- is a competitor
- is outside the filters

Signs of a real business: a company registration number, app-store listings, reviews, a pricing page, recent posts.

**Stage 3: profile-specific checks.** Only the checks the profile asked for, cheapest first:

1. the company's own pages
2. one Google search of the company name
3. the dedicated tool (for example Apify Instagram)

It only says "not found" after all three. "Not checked" and "not found" are kept apart.

**Stage 4: find the contact.** In this order:

1. Hunter `domain-search` (limit 2)
2. a Google search for `site:linkedin.com "<Company>" founder`, or Companies House
3. Apify `linkedin_people`
4. Hunter `email-finder` once a name is known

If no person is found, it gives the best shared inbox (hello@, partnerships@) and says so. It doesn't spend credits on leads rated below Neutral.

**Stage 5: rate and explain.** Each lead gets a rating on a 9-step scale: Very Likely · Likely · Leaning Likely · Uncertain (High) · Neutral · Uncertain (Low) · Leaning Unlikely · Unlikely · Very Unlikely. It also gets one line on why (15 words at most). The rating comes from the profile, not from how much contact data was found. The search stops at the number of leads asked for, Neutral or better, or when the budget runs out. It never pads the list.

**Honesty rules.**
- Nothing is invented, and every fact comes from a tool result.
- Guesses are labelled: an email built from the company's pattern, a social handle matched by name only.
- Data from the `b2b_database` tool is treated as stale until a live check confirms it.
- Failed tools are reported.

**Output.** One JSON object with:
- `profile`
- `leads[]`: company, what it does, site, location, size, contact, email + `email_status` (verified / found / guessed / generic / none), LinkedIn, socials with activity, up to 3 signals, rating, why, sources, not_checked
- `dropped[]` with reasons
- `tool_issues`
- `summary`

Every lead field has a word limit, because users complained about too much text.

## 5. The tools Claude can call

| Tool | What it's used for | Rough price |
|---|---|---|
| `dataforseo` (any v3 endpoint, one task per call) | Google search (`serp/google/organic/live/regular`), Google Maps, `on_page/instant_pages` (is the site alive), `on_page/content_parsing/live` (a page's text, links and emails) | ~$0.002–0.004 a search, `site:` searches ~$0.01–0.02 |
| `hunter` | `domain-search`, `email-finder`, `email-verifier` | Free plan: 50 credits a month, 1 per email returned |
| `apify` (aliases) | `instagram`, `facebook`, `linkedin_company`, `linkedin_people`, `meta_ads`, `producthunt`, `b2b_database` | Cents per run; each run's cost is capped; waits up to 45 s, otherwise returns a `run_id` to collect later |

These are the same functions as GrowJin's MCP server, with the same descriptions.

## 6. How the code runs it (`engine.ts`)

- **A manual tool loop.**
  - Each turn sends the conversation to Claude.
  - Any tool calls in the reply run **in parallel**, and their results are added back.
  - The conversation is never edited, only appended to.
- **Prompt caching.** The system prompt, the tool list and the latest message are cached each turn, so the growing conversation is mostly read from cache.
- **Tool results are shrunk** before Claude sees them: empty and layout fields are dropped, then the text is cut to 6,000 characters with a note.
- **Runs longer than one request.**
  - A server request may last 300 s, so a search is a saved job (`signal_snapshots` key `agent:lead-engine`) advanced in stretches of about 230 s.
  - While a search runs, the page asks for its status every 4 s, and each check starts the next stretch.
  - **If nobody has the page open, the search pauses** until the page is opened again.
- **Caps, enforced in code.** When one is hit, Claude gets one last turn with tools switched off and is told to answer with what it has. "Stop and keep what's found" does the same.

  | Cap | Default | Setting |
  |---|---|---|
  | Tools | $0.10 per lead asked for, at least $1 | `LEAD_ENGINE_TOOL_CAP_USD` |
  | AI | $3 | `LEAD_ENGINE_AI_CAP_USD` |
  | Hunter | 2 credits per lead, at least 10 | `LEAD_ENGINE_HUNTER_CAP` |
  | Steps | 40 turns | |
  | Time | 30 minutes | |

- **Errors.** A refusal fails the search. So does a 4xx error from the AI (except 429), or a third AI error in a row.
- **Saving the answer.**
  - Repeats, and people already emailed or opted out, are removed.
  - Leads rated Neutral or better go to the list; the rest, and `dropped`, go to "Checked but not kept".
  - Each lead is saved with its rating (as a 10…2 score), one-line why, four short facts (Sells, Size, Where, Social) and extras.
  - How sure the email is: Checked email / Found, not checked / Guessed / Shared inbox.
  - With no email, the lead becomes "Needs an email", or a message on their Instagram or Facebook page if one was found.

## 7. After the search: what the user does

1. **The page shows** one green "Start here" panel, then cards (name, rating, one line on why, Skip / Review email).
2. **Opening a lead:**
   - Left: a short profile (the facts, the rest behind "More details").
   - Right: the email.
   - The email is **written when the lead is opened**, by a separate, cheaper call (Sonnet). It is under 60 words: a greeting, one specific thing noticed, one sentence on how the product helps, one small ask.
3. **Approve and send** goes out from the user's Gmail. Finishing one lead opens the next.
4. **Follow-ups** (default after 3 and 7 days) go out in the daily run at 04:00 UTC and stop when the person replies. Replies show as a red line at the top of the page.
5. **Other actions:**
   - "Download leads" saves the list as a CSV in the owner's lead-list format.
   - The second tab, **Join conversations**, still uses the older code: Reddit and Hacker News posts asking for a tool like yours. You copy the reply and post it yourself.

## 8. How long a search takes (estimate, not yet measured)

A search has never been run against the real APIs, so these figures are worked out from typical speeds.

**Per turn (one Claude reply plus its tool calls, run in parallel):**

| Part | Typical time |
|---|---|
| Claude thinking and replying | 10–30 s (longer as the conversation grows) |
| DataForSEO Google search / Maps | 3–10 s |
| DataForSEO site check / page read | 2–10 s |
| Hunter | 1–3 s |
| Apify Instagram / LinkedIn / Facebook | 20–45 s (a slow run costs an extra turn to collect) |
| Apify Product Hunt | several minutes (started early, collected later) |
| The final answer (a long JSON of all leads) | 60–90 s |

**Turns per search:** about 15–25 for 10 leads:
- discovery: 4–6
- real-or-not checks: 3–5
- profile checks: 3–6
- contacts: 3–5
- the answer: 1

| Leads asked for | Expected time | Notes |
|---|---|---|
| 3 | **4–8 min** | Good size for a first live test |
| 10 | **8–18 min** | Turns with an Apify call are the slow ones |
| 25+ | **20–30 min** | Likely to hit the 40-turn or 30-minute cap and return fewer leads |

Writing each email when a lead is opened takes another **5–10 s** per lead.

**Cost of a 10-lead search (estimate):**
- **AI:** ~$1–2. Each turn costs ~$0.05–0.10 (Opus $4 / $20 per million tokens in / out, most input read from cache).
- **Tools:** ~$0.20–0.80.
- **Total:** ~**$1.50–3**, plus up to ~20 Hunter credits.

The $3 AI cap may cut a 25-lead search short.

## 9. Weak spots and open questions (for the reviewer)

1. **Never run live.** It was tested with a mocked Claude and mocked tools (loop, caching, caps, saving, repeats). Real speed, cost and lead quality are unknown.
2. **It pauses when the tab is closed.** There is no background worker yet. A search lasting 10+ minutes needs the page open.
3. **Speed vs. cost.** Opus on every turn is the slowest and most expensive part. Options:
   - a cheaper model for discovery and checks, with Opus only for rating
   - lower effort
   - fewer, bigger tool calls per turn
4. **Hunter's free plan** (50 credits a month) runs out after 2–3 searches. Many small companies aren't in Hunter at all, so shared inboxes will be common.
5. **Apify:**
   - `linkedin_company` needs a one-time permission approval in Apify Console.
   - `linkedin_people` was blocked by the account's monthly limit.
   - `producthunt` is slow.
6. **One prompt does everything.** That makes it easy to change, but quality depends on the model following a long prompt. Nothing in code checks the facts it reports.
7. **The daily run doesn't search** with this engine. Searches start only from "Find new leads"; the daily run only sends follow-ups and queued emails.
8. **Questions worth an opinion:**
   - Is "AI agent with tools + caps" the right structure, or should discovery be a fixed, cheap step and only checking and rating be done by the agent?
   - Is 10 leads in ~10–15 min for ~$2 acceptable for the users we have?
   - Should a search run in the background (a queue or cron) so the user can leave the page?
