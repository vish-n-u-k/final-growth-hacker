# GrowJin ideas backlog

Ideas collected in October 2026 while comparing GrowJin with existing agents and paid tools.
Nothing here is built yet. Prices come from review sites and forums that often disagree: check each
vendor's own page before building.

**Rule of thumb:** keep our checks, scoring and "what to do next" in-house (that's GrowJin's value);
use outside data only where it's truly better than what we can collect.

## Suggested order

1. Competitor watch: change alerts first (quickest, near-zero cost)
2. AI mention tracking (Otterly-style): biggest value
3. Reddit & community leads: brings back the parked Community Finder
4. Meta Ads alert rules
5. Warm-lead follow-up reminders
6. Keyword rank tracking
7. Then: blog SEO loop, launch plan, local business leads, free tool connections

---

## 1. Worth building in-house (~90% of the paid tools)

### 1.1 Competitor watch (extends Competitor Analysis)

Today Competitor Analysis is a one-time homepage comparison (pricing shown, free start, customer
proof, numbers, review links, case studies) plus ideas (stand apart, phrases, SWOT). Add a weekly
"Competitor watch" that lands on Today and in the daily email:

| Part | How | Matches | Example |
|---|---|---|---|
| Change alerts | Fetch pricing / home / features / careers pages weekly, diff the text, Claude summarises | ~95% of Visualping | "Later raised prices 20%" |
| Full pricing table | Read their pricing page into plans + prices next to yours | ~90% | Plan-by-plan comparison |
| New content | Read their sitemap / RSS weekly | ~95% | "Buffer published 'Buffer vs Later'" |
| Review complaints | Group G2 / Capterra / Trustpilot complaints (Lead Finder already collects reviews) | ~90% | "Their users hate X: lead with X" |
| News & funding | Weekly news search via Serper | ~85–90% | "Competitor raised $10M" |
| Battlecard | Claude writes "how we win vs X" from the above | ~90% of Klue | One page per competitor |

Cost: under $1 per brand per month. Skip: their ads (Meta ad library API only covers political/EU
ads) and their traffic (needs paid panel data).

### 1.2 AI mention tracking (like Otterly, in GEO Audit)

**What Otterly does:** keeps a list of buyer questions, asks them regularly in ChatGPT, Perplexity,
Gemini, Google AI Overviews and Copilot, and records: are you mentioned, in what position, how you're
described, which websites were cited, which competitors appear. Shows share of voice and trends.
From $29/month.

**In-house:**
1. Claude writes ~25 buyer questions per brand from Search Console queries, keywords, competitors
   (user can edit).
2. Weekly job asks each question to Gemini (with Google Search; ~5,000 free searches/month) and
   Perplexity Sonar (~half a cent each). Later: ChatGPT web search, Claude.
3. Claude Haiku extracts: mentioned, position, tone, competitors named, cited sources.
4. Store weekly results (encode in existing fields where possible, no migration).
5. Show in GEO Audit: mention rate, average position, share of voice vs competitors, top cited sources.

Cost ~$1–3 per brand per month. ~90% of Otterly; answers via API can differ slightly from the
consumer ChatGPT app. Needs Perplexity + Gemini API keys.

**Why it helps:** measures the result (not just "AI can read your site"); cited sources become
outreach/listing targets; questions where competitors appear and you don't become blog topics;
weekly trend shows whether work pays off. The Reminders "ai-answers" job already exists.

### 1.3 Meta Ads alert rules

Daily check through the existing Meta connection, e.g. "cost per sale above target for 3 days",
"ad fatigue". Shown as a Today card with a one-click pause (no auto-actions at first). Same as
Birch's rules (~$49/mo). $0. Leave bidding to Meta Advantage+ (free).

### 1.4 Follow-up reminders for warm leads (Gmail)

"No reply from Sarah in 5 days" with a drafted follow-up, via the existing Gmail connection.
~90% of follow-up tools. $0, 3–4 days.

## 2. Close (~80%), still worth building

### 2.1 Reddit & community leads (replaces the parked Community Finder)

Daily:
1. Search Google for recent Reddit posts via Serper (`site:reddit.com "looking for a tool to …"`,
   past week), plus Hacker News (free Algolia API) and Stack Exchange (free API).
2. Claude scores each post: 🔥 ready to buy / 🟡 has the problem / ⚪ just talking.
3. Claude drafts a helpful reply in the brand's voice. The founder posts it by hand (no auto-posting:
   Reddit bans that).
4. Show on Today and in the daily email: "3 people asked for something like Frekto yesterday".

Why Google, not Reddit's API: Reddit's API is paid for commercial use and needs a contract
(GummySearch shut down over this). Up to a day late vs real-time tools; fine for a daily digest.
Bonus: Reddit threads that rank on Google are often cited by ChatGPT / Perplexity.

Cost ~$0.50 per brand per month, ~1 week. Existing tools: F5Bot (free alerts), Redreach (~$19/mo),
Subreddit Signals (~$20–60), RedShip (~$29), Syften (~$30–120), ReplyGuy (~$10–39),
Octolens (~$119–319).

### 2.2 Keyword rank tracking

Own positions from Search Console (free), tracked keywords via Serper (code exists), demand from
Google Trends / autocomplete (already used) + Keyword Planner if the user has Google Ads.
~80%: no exact volumes without Google Ads spend.

## 3. Blog SEO loop (from the "Claude SEO harness" skill post)

A robot that writes blog posts for your site and learns from how they perform:
1. **Find a topic** from what people search on Google.
2. **Write and post it** to the website (WordPress).
3. **Check and learn:** which posts brought visitors; write more like those.

| Step | GrowJin today |
|---|---|
| Topic from Google data | ✅ `web/app/api/blogs/topics/route.ts` (Search Console near-misses; falls back to brand keywords) |
| Write the post | ✅ `web/app/api/blogs/generate/route.ts` |
| Put it on the site | 🟡 Handed to Claude / GitHub; we check it went live (`brand_blogs.verification_status`) |
| Visitors per page | 🟡 Content Audit reads Search Console clicks per page, flags decay → Refresh |
| Weekly rhythm | ✅ Reminders "blog-post" job, auto-ticked from the sitemap |

To build:
1. **"Beat the #1 result" brief:** search the keyword via Serper, read the top 3 results, Claude
   notes what they cover / length / what they miss, then writes a better post. ~1 cent per post,
   1–2 days.
2. **One-click publish to WordPress** (site URL + WordPress application password) as a **draft the
   user approves**. Webflow / Ghost / Shopify later. 2–3 days.
3. **Learning loop:** track GrowJin-written posts at 2, 4, 8 weeks (clicks, impressions, position);
   "Your posts" scorecard; feed what worked into topic picking and the prompt; posts stuck at
   positions 6–20 get a "refresh this" task. ~1 week.

Caution: never auto-publish. Google's "scaled content abuse" policy targets mass unreviewed AI posts.

## 4. Launch plan (from the "100+ places to share your product" repo post)

Lists like [awesome-producthunt-alternatives](https://github.com/DirectorySurf/awesome-producthunt-alternatives)
and [LaunchDB](https://www.producthunt.com/p/launchdb/launchdb-2) list launch sites (Product Hunt,
BetaList, Uneed, Peerlist, Indie Hackers), subreddits (r/SideProject, r/startups, r/SaaS), directories
(G2, AlternativeTo, SaaSHub) and newsletters. Advice: spread launches over several weeks.

Caveats: ~3–5 places bring most results; Product Hunt now features only ~10% of launches; Reddit
removes plain promotion (share a story/lesson instead). Bonus: directories give backlinks, which also
help AI visibility.

GrowJin today only mentions these (Audience Discovery, Brand Audit). To build a "Launch plan":
1. Curated 20–30 places picked by product type (SaaS / e-commerce / dev tool / local).
2. Spread over ~6 weeks (week 1 BetaList + Peerlist, week 2 Indie Hackers, week 3 Product Hunt,
   then a story post in r/SideProject, then directories), each week a Reminder + Today card.
3. Claude writes the tagline / description / Reddit post in each site's style.
4. Show what worked from GA4 / PostHog channels ("BetaList: 40 visitors, 3 signups").

Cost ~$0.

## 5. Local business leads (from the Google Maps scraper post)

[gosom/google-maps-scraper](https://github.com/gosom/google-maps-scraper): MIT, Docker, Claude Code
skill. "dentists in Dubai" → spreadsheet with name, phone, website, rating, reviews, hours (~33 data
points); emails optional (checks one page of each business's site). ~120 places/min is a best case.

Don't run it inside GrowJin: Google's terms forbid scraping Maps, it needs proxies at scale, and cold
emailing businesses can break EU rules (especially Germany).

Safe version: a "local businesses" mode in **Lead Finder** using the official **Google Places API**
(free monthly allowance, then cents per search) + our own website crawler for contact emails + need
signals ("rating under 4 stars", "no website"). Useful for users who sell to local businesses
(agencies, freelancers, tools for clinics/restaurants). ~1 week.

## 6. Free tools to connect or point to

| Tool | Example | Why |
|---|---|---|
| **Bing Webmaster Tools** (free) | "Copilot cited your page 120 times last month", "42 websites link to you" | Backlinks via its API; Copilot citations report (dashboard/CSV only, API planned). Add a Foundation check "Site added to Bing" |
| **Google Keyword Planner** (free, needs Google Ads account) | "'ai instagram caption generator': 1K–10K searches/month" | Search volumes for topic ideas |
| **Digital PR: Featured** (free plan, ~$49/mo paid) / **Qwoted** (~$99/mo) | "A Forbes writer wants founders using AI for marketing" | One quote = strong backlink + trust + AI citations. Add a weekly Reminder "Answer 3 journalist requests"; don't build |

Already covered: Screaming Frog-style crawl (our SEO Audit), Search Console, PageSpeed Insights.
Skip: Veritas (~$16/mo), Semrush, Peec AI (our own AI tracking instead).

## 7. Things only paid data can do (unrealistic to build)

| # | What | Example | Why we can't build it | Paid tool |
|---|---|---|---|---|
| 1 | Competitor keywords & traffic | "Buffer gets ~40K visits/month from 'free instagram scheduler', ranks #2" | Needs a copy of billions of pages + clickstream data | Semrush ~$140/mo (API ~$500), Ahrefs ~$129+ |
| 2 | Full backlink database | "300 sites link to Buffer and Later but not you" | Must crawl the whole web; free Common Crawl is 3 months old, sites only | Ahrefs / Semrush / Moz ~$99–200 |
| 3 | Competitor traffic sources | "Buffer: ~2M visits, 40% Google, 25% direct" | Panel data from millions of browsers | Similarweb ~$125+ |
| 4 | Journalist network | "Forbes writer needs a quote by tomorrow" | Journalists are on their platform | Featured, Qwoted |
| 5 | Exact search volumes | "4,400/month" vs "1K–10K" | Google gives exact numbers only to accounts running ads | Google Ads spend, or Semrush |
| 6 | AI answers at full scale | "Real ChatGPT app, 6 engines, 500 questions: 31%" | Reading consumer apps at scale breaks their terms | Profound ~$399+, Peec ~€85+ |
| 7 | Verified contact emails | "sarah@acme.com (verified)" | Huge, constantly checked contact databases; our guesses work ~40–50% | Clay ~$185, Apollo, Hunter (25 free/mo) |
| 8 | All competitor ads | "Buffer runs 14 Instagram ads; this one for 90 days" | Meta ad library API only covers political/EU ads | Foreplay, Madgicx ~$45+ |

Later option: let users connect their own Semrush / Ahrefs / Hunter key (we don't pay).

## 8. If we get DataForSEO (+ Google Ads)

DataForSEO (pay-as-you-go) solves about 4 of the 8 fully and 2 partly:

| # | Problem | Result |
|---|---|---|
| 1 | Competitor keywords & traffic | ✅ Labs data (ranked keywords, estimated Google traffic) |
| 2 | Backlink database | ✅ Backlinks API: un-parks the Backlinks module |
| 5 | Exact search volumes | ✅ Resells Google Ads volumes, no ad spend needed |
| 6 | AI answers at scale | ✅ Mostly: AI Overview + AI answer data |
| 3 | Competitor traffic sources | 🟡 Google traffic only |
| 8 | Competitor ads | 🟡 Possibly Google's ad library (to confirm); not Meta |
| 4 | Journalists | ❌ Still Featured / Qwoted |
| 7 | Verified emails | ❌ Still Hunter / Apollo / Treg |

Also improves: rank tracking, "beat the #1 result" brief and Reddit search (one provider instead of
Serper), keyword difficulty, Trustpilot / Google reviews for competitor complaints.

Google Ads on top adds little data (DataForSEO already has volumes); only worth it for a Google Ads
audit/launch tool like the Meta Ads one.

Still needed afterwards: Featured/Qwoted (user signs up), Hunter/Apollo or Treg (per lookup).
Optional: Similarweb (skip). Free stack stays: Search Console, PageSpeed, GA4, PostHog, Bing
Webmaster, Claude. Estimated a few dollars per brand per month: test on one brand first.

## 9. Treg (Clay-adjacent, by the Superdesign team)

One key that unlocks ~2,600 paid data endpoints from ~47 providers (e.g. Hunter, DataForSEO), billed
per call from one prepaid balance. Open source (Apache 2.0), self-hostable; fine for internal and
commercial use, but not to resell as a competing hosted registry. Launched ~September 2026.

Not a Clay replacement: no "try provider A, then B" waterfall, no spreadsheet UI. It replaces
Clay's data access only.

Useful for us: **Lead Finder verified emails** (Hunter per lookup), possibly DataForSEO without a
separate account. Cautions: very young project; per-call prices/markup not published; doesn't help
panel/network data (Similarweb, Featured). Worth a small test later.

## 10. Not worth building

- **Competitor backlink gap without paid data** (~70%): Common Crawl only, 3 months old.
- **Lead Finder email lookup without paid data** (~40–50%).
- **Cold email at volume** (Instantly / Smartlead): needs warm-up networks and many inboxes; sending
  cold mail from a user's Gmail could get it flagged. Do warm-lead follow-ups instead (1.4).
- **Full AI sales agents** (11x, Artisan): $1k+/mo, too pricey for our users.
