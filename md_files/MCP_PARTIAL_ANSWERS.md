# MCP dry run: the 46 "Partial" questions

Source: `Growjin_MCP_dry_run_Frekto.xlsx` (run 6 Nov 2026), reviewed 10 Nov against the code on `dev`.
Goal: a user asks Claude (with GrowJin connected) and gets the full answer from GrowJin's tools.

**Verdicts**
- **Done**: fixed since the dry run (7 / 10 Nov). Needs checking on the live app.
- **Yes**: we can answer it fully with data or APIs GrowJin already has. Only code is needed.
- **Setup**: we can answer it fully once the user sets something up or connects something. GrowJin should detect that and say how.
- **Partly**: we can get closer, but part of the answer has no source today.

## The list

| # | Question (short) | Verdict | How |
|---|---|---|---|
| 1 | Where do we stand vs 500, speeding up or flattening? | Yes | The app already has the user count (Road to 500, from PostHog) and a daily `brand_history` table. Add `get_goal_progress`: count, pace, run-rate needed, trend. Find out why history is empty (migration not run, or the nightly cron failing quietly). Let the user say what counts as a customer. |
| 2 | Today's sessions, new visitors, signups vs 7- and 30-day average | Yes | Add start/end dates and a daily series to the GA, GSC and PostHog tools. Count signups from a PostHog event (e.g. onboarding_completed) while GA has no key events. |
| 3 | Which channel moved most in 24 h, which went quiet | Yes | GA 1-day window plus a change vs the previous period per channel. Leave out internal visits (`/admin` landing pages). |
| 4 | Any spike or drop to look at today? | Yes | `get_anomalies` over the daily series (sessions, signups, clicks, positions). Needs about 14 days of history first. |
| 5 | Users now, and net new since yesterday | Setup | Users and new users: PostHog (fixed 7 Nov, check live). Paying customers need the brand's billing connected (Stripe). |
| 10 | New indexing problems, pages dropped from Google | Yes | `gsc-indexing.ts` already inspects URLs. Expose it over every sitemap URL, with a diff vs the last check. |
| 11 | Backlinks gained or lost this week, bad links | Yes | Wrap DataForSEO backlinks (new / lost, spam score). Store weekly. |
| 12 | Which competitor pages outrank us, and why | Yes | Search & AI already knows each page's target search. Add a tool comparing our page with the top 3 (length, headings, schema, freshness). |
| 13 | Keyword gaps vs competitors | Yes | Competitors now come through (7 Nov). Wrap DataForSEO `domain_intersection` and drop what GSC shows we already get. |
| 14 | Pages to refresh | Yes | GSC clicks per page, last 28 days vs the 28 days before. Search Agent rank drops already exist. |
| 15 | Two of our pages competing for one search | Yes | GSC search × page (`fetchGscQueryPages` exists): flag searches split across 2+ pages. |
| 18 | Are AI assistants naming us? | Done | `get_search_agent` (10 Nov). |
| 19 | Which AI answers name us, which name rivals | Done | `get_search_agent` section `ai_answers`. |
| 20 | Which sources AI pulls from | Done | `cited_sites` in `get_search_agent`. Small add: label each site as forum, review, vendor or our own. |
| 21 | Does AI describe us correctly? | Yes | "How AI describes you" is in `get_search_agent`. Add a check against the live pricing / home page. The brand profile itself is stale (old pricing), so re-read it from the site. |
| 24 | Which new questions should we test in AI? | Yes | Add a tool to read and add Search Agent questions. |
| 27 | "People also ask" questions, and do we answer them | Yes | DataForSEO SERP gives them. Search & AI already reads our pages, so check each page for a direct answer. |
| 30 | FAQ / how-to schema missing on busy pages | Yes | Search & AI reads up to 10 main pages. Add a schema check per page. |
| 34 | Which referral sites send engaged visitors | Yes | The Analytics page already gets visits by source. Expose it in the MCP with engagement. |
| 35 | New vs returning, is returning growing | Yes | The Analytics page already gets new vs returning. Expose it, with a trend from the daily series. |
| 36 | Top landing pages and what they lead to | Setup | Landing pages: yes. What they lead to needs GA4 key events (user setup) or a GA-to-PostHog link through UTM tags. |
| 38 | Effort per channel vs results | Partly | Auto-log what GrowJin makes (posts, blogs, emails) in the work log. Work done outside GrowJin still needs the user to log it. |
| 39 | Which experiments to try next | Yes | Search & AI already keeps tests with know-by dates. Expose them and allow other experiments in the work log. Ideas come from Claude. |
| 41 | Time on site, pages per visit, bounce by channel and page | Yes | Add those GA metrics per channel and per page. |
| 45 | Can people find things in our menu? | Setup | PostHog autocapture may already record menu clicks. If not, the site needs click tracking. |
| 49 | Biggest drop in signup flow, and why | Yes | PostHog funnel on unique users in order (HogQL). The "why" stays Claude's judgement from the steps. |
| 51 | Is our pricing competitive? | Setup | Competitors' pricing pages: yes (read on a schedule). Conversion side needs GA4 key events or PostHog. |
| 55 | Which content brings visits and signups | Setup | Visits per page from GSC + GA: yes. Signups need key events or PostHog. |
| 57 | What visitors keep asking that we don't cover | Partly | Search queries (GSC) and Reddit questions: yes. Support tickets need a help desk, or reading the Gmail inbox. |
| 60 | Which format works best (how-to, list, comparison) | Partly | Tag pages by format with AI and add up traffic. Frekto's traffic is too low to compare yet. |
| 62 | Which platform sends engaged visits (IG vs LinkedIn) | Yes | GA visits by source. Instagram already uses UTM tags. |
| 63 | Followers and engagement by platform, over time | Setup | Instagram / Facebook through Apify, stored weekly: yes. LinkedIn and X need the connections in GrowJin fixed. |
| 64 | Which post type or hook does best | Setup | Instagram / Facebook posts through Apify: yes. Other platforms need their connections. |
| 66 | Mentions and user posts about us | Partly | Web mentions through DataForSEO with a relevance filter: yes. Social mentions have no good source. |
| 70 | Which stage loses most users | Yes | Let the user set the stages as PostHog events (signup → onboarding → first post → paid), then run the funnel from 49. |
| 77 | Searches competitors newly rank for that we don't | Yes | Competitors now come through. Weekly DataForSEO ranked keywords per competitor, compared with last week. |
| 79 | Where competitors get links we don't | Done | `links` section of `get_search_agent`. A full backlink-gap tool is a later add. |
| 81 | Our share of voice vs rivals, growing or shrinking | Yes | Combine AI share (Search Agent), rankings and followers into one weekly number, stored in the daily history. |
| 83 | Our review rating and count, and trend | Partly | Trustpilot (DataForSEO, already used for competitors) and Google (Business Listings, used in Foundation): yes. G2 / Capterra need a scraper. |
| 86 | Sentiment of mentions this week | Partly | Filter out unrelated pages (the Czech / German word "frekto"), then judge. Too few mentions to mean much yet. |
| 89 | Core Web Vitals today, anything worse? | Yes | False pass fixed 10 Nov. Add `get_core_web_vitals` from PageSpeed Insights (the audit already calls it): short summary and history. |
| 90 | Crawl errors, broken links, 404s | Yes | DataForSEO on-page crawl of the whole site, summarised. |
| 91 | Uptime, speed, SSL | Yes | SSL expiry check in the nightly cron as a Today alert. A simple daily ping for uptime. Uptime during traffic spikes needs an outside monitor. |
| 92 | Duplicate content, redirect chains, canonicals | Yes | Same site crawl as 90. |
| 95 | What moved us toward 500 this week | Yes | `get_weekly_review`: goal progress, channel changes, work log, tests. Needs 1–4 first. |
| 96 | What to double down on, what to drop | Yes | Same weekly review. The call itself stays Claude's judgement, now backed by numbers. |

**Totals:** 4 done, 27 yes, 9 setup, 6 partly.

## How to build it: 7 pieces cover almost all of it

1. **Goal and history:** fix the empty daily history, `get_goal_progress`, daily series, anomalies, weekly review → 1, 2, 3, 4, 5, 95, 96
2. **More from GA and Search Console:** dates, by source, new vs returning, bounce, landing pages, per-page trends, search × page → 2, 3, 14, 15, 34, 35, 41, 55, 62
3. **Site health:** index coverage, site crawl, Core Web Vitals, SSL / uptime, schema per page → 10, 30, 89, 90, 91, 92
4. **Short DataForSEO tools:** backlink changes, SERP compare, keyword gap, people-also-ask, competitor rankings, share of voice → 11, 12, 13, 27, 77, 81
5. **PostHog funnel and stages** → 49, 70, plus the signup side of 36, 51, 55
6. **Search Agent extras:** add questions, check how AI describes you against the site, re-read the brand profile → 21, 24
7. **Social and reviews:** Instagram / Facebook stats through Apify, own Trustpilot + Google reviews, mention filter → 63, 64, 66, 83, 86

For every "Setup" row, the tool should say what's missing and how to fix it instead of returning empty (e.g. "GA4 has no key events: here's how to add a signup event").
