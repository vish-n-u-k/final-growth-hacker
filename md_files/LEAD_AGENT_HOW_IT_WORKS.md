# GrowJin Lead Agent: how it works

A complete description of the Lead Agent in GrowJin, written to be read by a person or another AI reviewing it. It covers what the agent is for, every step it takes, which outside service does what, the rules and numbers it uses, what the user sees, and the weak spots we already know about.

State as of 27 Oct 2026. The code lives in `web/lib/agents/lead-agent.ts` (the run), `web/lib/agents/dataforseo.ts`, `web/lib/agents/hunter.ts`, `web/lib/agents/own-list.ts`, `web/app/api/agents/lead/route.ts` (the API) and `web/components/agents/LeadAgentPage.tsx` (the page).

---

## 1. What it is for

GrowJin helps small businesses grow. The Lead Agent finds people who might buy the user's product, writes the first message for them, and follows up until they reply.

- **The user** is a small business owner or solo founder: not a salesperson, not technical.
- **The test brand** is Frekto, an AI tool that writes, designs and schedules social media posts. Its buyers are small business owners, solo founders, Etsy and online store owners, and small agencies.
- **The goal for the user:** open the page, see a short list of real people worth contacting, check each email, press send. Replies come back to the same place.

**Golden rule:** nothing is sent without the user's OK. The only exceptions are follow-ups to an email the user already approved, and an opt-in "auto mode" (section 8).

---

## 2. The two jobs (two tabs on the page)

| Tab | What it finds | What the user does |
|---|---|---|
| **Email** | Businesses and companies, plus people from the user's own lists | Approves an email that GrowJin sends from the user's Gmail. Follow-ups go out by themselves. |
| **Community** | Reddit and Hacker News posts where someone asks for a tool like this | Reads a drafted reply, then copies and posts it themselves. GrowJin never posts on forums. |

Inside each tab, a filter shows **To do / Waiting / Done**.

---

## 3. Settings (what the user can control)

Settings are filled in from the brand when the agent is first used. The user can change any of them.

| Setting | Meaning | Default |
|---|---|---|
| Who is your customer | Plain words, e.g. "Etsy store owners and solo founders who want to automate social media" | The brand's target audience |
| Where to look | Switches for the sources: Companies like your customers, Google Maps, Reddit & Hacker News | Picked by Claude from the brand ("Pick for me") |
| Who to look for (companies) | Plain words, e.g. "small etsy businesses and small online brands, 1-50 people" | Written by Claude |
| Google Maps search | e.g. "cafés in Pune" | Written by Claude when Maps fits |
| Search every morning | Run the search automatically each day | Off |
| Country | One country, or **Anywhere** | Guessed from the website ending (.in = India, anything unknown = US) |
| Most new emails a day | Daily sending limit for first emails | 15 |
| Follow-up days | Days after the first email | 3 and 7 |
| Don't cold-email the EU | Skips emailing when the country is in the EU | On |
| Auto mode | "Send on its own after I've approved 20" | Off |

**"Pick for me":** Claude reads the brand and turns on the one or two sources that fit the buyers best. It writes the who-to-look-for line for each, plus one sentence on why. This also runs on the first visit.

---

## 4. One run, step by step

A run starts when the user clicks **Find new leads**, or from the daily job at 04:00 UTC. A run that searches has a 4-minute budget. The page shows live progress.

### Step 1: Check emails already sent (Gmail)
- For each sent email, GrowJin reads the Gmail thread.
- A **reply** marks the lead "Replied" (shown first, in red). Claude tags the reply as meeting, interested, question, objection, later or other.
- **"No" / unsubscribe** wording marks it opted out. A **bounce** marks it bounced. Both addresses are added to a never-email-again list (`email_suppressions`) that every send checks.
- If no one has replied and a follow-up is due (3 or 7 days after the first email), a short follow-up goes out **in the same thread**. The texts are fixed:
  - 1st: "Just bringing this back to the top of your inbox in case it got buried. Would it be worth a quick look?"
  - 2nd: "Last note from me. If [brand] isn't a fit right now, no problem at all…"

### Step 2: Send emails the user already approved
Approved emails waiting for the daily limit go out, up to the limit. This includes the user's own lists, which go out over several days.

If daily search is **off**, the daily job still does steps 1 and 2 for brands with emails waiting or in progress. It just doesn't look for new people.

### Step 3: Find new people (each source that is switched on)

#### 3a. Community: Reddit and Hacker News
1. **Claude** writes 6 short phrases a buyer would type when asking for help, e.g. "any app that makes Instagram posts". These are saved and reused.
2. **DataForSEO** runs a Google search for `site:reddit.com <phrase>`, limited to the last month. One phrase a day while testing, rotating through the list.
   - Retries once if DataForSEO has a temporary error.
   - Retries once with a shorter, plain phrase if Google rejects the first one.
3. **Hacker News**, through its free public search: stories from the last 30 days matching the phrase.
4. Output for each post: title, snippet, link and subreddit.

#### 3b. Email: companies like your customers
This is the part we have changed most and are least sure about.
1. **Claude** turns "Who to look for" into search terms, saved until the wording changes:
   - **8 trade words** (what the companies make or sell, e.g. "etsy", "handmade jewelry", "candles"). It is told never to use describing words like "boutique" or "creative", or words like PR, B2B, enterprise or consulting.
   - **Store platforms**, if online stores fit: Shopify, WooCommerce, Wix or Squarespace (or none).
2. **DataForSEO finds the websites**, from its technology index (a crawl that records which technologies each site runs, plus its title, description, listed emails and social links).
   - The request: sites running the picked platforms (partial name match), whose title or description contains one of the trade words, in the chosen country (or anywhere). 50 results, newest-crawled first, a different page each day, wrapping back to the start at the end.
   - If no site matches the trade words, it asks for the platforms alone.
   - Sites ranked 400+ (on DataForSEO's 0–1000 rank) are dropped as too big. Most small shops have no rank and are kept.
   - Output for each site: domain, title, description, any listed emails, social links.
3. **GrowJin checks each website itself** (free):
   - Reads the home page: title, description, visible text, and links to Instagram, Facebook, TikTok, LinkedIn, Pinterest or YouTube.
   - Drops big or B2B firms by wording: PR, public relations, B2B, enterprise, consulting, "award-winning", staffing, recruitment…
   - **Trade check:** keeps a company only if its own name, description or page text contains one of the trade words. Plain words (shop, online, brand, agency…) and describing words (boutique, creative, premium…) don't count on their own.
   - Up to 10 companies go on to scoring.
4. Output for each company: name, website, a short line (social links first, then its own description), and any email the site lists.

*History:* Hunter's company search (Hunter Discover) was used here before. It was removed because its keyword matches brought back law firms and estate agents for "etsy shop".

#### 3c. Email: businesses on Google Maps
- **DataForSEO** searches Google Maps for the Maps search, e.g. "cafés in Pune", 12 results while testing.
- Keeps businesses that show a need: no website, a rating under 4.2, or fewer than 30 reviews.
- Output for each business: name, website, phone, rating and review count.

#### 3d. Limits on finds
- At most 3 new finds per source per run while testing (10 when switched to normal size). Companies are the exception: up to 10 are checked.
- Anything seen before is skipped, including finds scored too low, which are remembered so they are never paid for twice.
- At most 12 new leads are kept per run.

### Step 4: Score everything (Claude, one call)
Each find gets a score from 1 to 10 and one plain sentence on why. The rules given to Claude:
- **Reddit / forum:** 8–10 only if they ask for a tool or help the brand gives. 1–4 for news, rants, promotions or launches.
- **Google Maps business:** fits the ideal customer and shows a need.
- **Company:** first check its trade against "Companies we look for". A different trade (e.g. real estate when we want Etsy sellers) scores 1–3. Then 8–10 for a small business that fits and clearly posts, or should post, on social media. 4–6 for small but unclear. 1–3 for big or B2B firms, PR, consulting, software, directories, marketplaces, or no description.

Kept: **7 or more**, or **6 or more for companies** (they have already passed the free checks).

### Step 5: Find one email (Hunter)
- Only for kept businesses and companies with no email yet. Forum posts don't need one.
- Hunter is asked for **one** address per company: first a named person if known, then an owner, manager or marketing person, then anyone.
- Costs 1 Hunter credit per email found (a miss is free). The free plan has 50 credits a month.
- At most 3 lookups per run while testing.
- If Hunter's credits run out, the run stops asking and the page says so.
- EU businesses are not emailed when that setting is on.
- No email found means the lead shows "Needs an email" and the user can paste one.

### Step 6: Write the message (Claude)
- **Email:** subject of 3–6 words; body under 90 words. "Hi <first name>," if known, else "Hi,". The first line is the specific thing noticed, then one sentence on how the brand helps with exactly that, then one small ask ("Want me to make 3 free examples for you?"). No links, no em dashes. An opt-out line is added automatically: "If this isn't relevant, just reply "no" and I won't email again."
- **Forum reply:** under 120 words. Answers the question helpfully first, with advice that works without any product. Then mentions the brand honestly as one option and says the writer works on it.

### Step 7: Save and show
- New leads go to **To do**. Today's page gets a card: "N leads ready for your OK".
- The page's top line summarises the run, e.g. "Last search just now · 2 new leads · Companies: 10 checked, 2 good fits, 1 with an email".
- Problems show in a note, in plain words where possible. Examples:
  - "Companies: DataForSEO found no Shopify / WooCommerce sites in US…"
  - "Google didn't answer (a hiccup on DataForSEO's side, nothing to fix)."
- Company leads still waiting in To do that no longer match the current "Who to look for" are moved to Skipped. The user can bring them back.

---

## 5. What the user does with a lead

**Email lead:** two short steps.
1. **Where should it go?** Shows the found email; the user can change it.
2. **Check the email, then send it.** The user can edit the subject and body, then sends from their own Gmail.

When finished, the next lead opens. "Approve all N" sends every ready email at once, within the daily limit; over the limit, they queue for the next days.

**Forum lead:** check or edit the reply → copy it → open the post → mark "I've posted it".

**Reply received:** the lead shows in red. "Open the thread in Gmail", answer there, then mark "I've answered".

**Skip** moves a lead to Done, with Undo.

---

## 6. "Add your own emails" (Email tab)

For people the user already knows. Three steps:
1. **Who gets it:** paste emails, or upload a CSV, Excel, PDF, Word, text or contact-card file (emails are read directly, no AI).
   - Skipped: repeats, anyone already in the Lead Agent, anyone already emailed from GrowJin, anyone who opted out.
   - Up to 100 people per list.
2. **The email:** the user writes one line on what it's about, and Claude writes **one** email for everyone with `{first name}` and `{company}` gaps.
   - First name comes from the file, else from the address (anna@… = Anna). Generic addresses like hello@ or info@ get "Hi,".
   - Company comes from the email domain. Personal mailboxes (gmail.com, email.com and about 50 more) get "your business".
   - One box with **Edit** and **Preview as <person>** tabs, with "Next person" to step through everyone.
3. **Review & approve all:** a summary (how many go out a day, the follow-ups, that it stops on reply). The user can open anyone to edit or remove them, then clicks **Approve all N**.

Each person becomes a normal email lead, queued. Today's share goes out at once and the rest go out day by day within the limit, with the same follow-ups and reply handling.

---

## 7. Who does what

| Service | Job in the Lead Agent | Cost |
|---|---|---|
| **Claude** | Search phrases; company search terms; picking sources; scoring; writing emails, forum replies and the own-list email; tagging replies | A few cents per run. A fast model for scoring and small tasks, a stronger one for writing. |
| **DataForSEO** | Google search (Reddit), Google Maps businesses, company websites (technology index) | Pay as you go: fractions of a cent to about 2 cents per request. Shown in Settings → Usage & costs. |
| **Hacker News (Algolia)** | Forum posts | Free |
| **Hunter** | One email per good company or business | 1 credit per email found; 50 free a month |
| **Gmail** (the user's own, via OAuth) | Sending, follow-ups, reading replies | Free |

---

## 8. Sending rules and safety

- **Approval:** every first email needs the user's OK, except in auto mode.
- **Auto mode:** opt-in, off by default. After the user has approved 20 emails, new leads scoring 8+ are sent without asking, still within the daily limit.
- **Daily limit:** at most N first emails a day (default 15). Follow-ups don't count towards it.
- **Opt-out line** in every email. Replies saying no, and bounces, go on a never-email-again list that every send checks.
- **Follow-ups** stop on any reply, opt-out or bounce.
- **EU:** not cold-emailed when that setting is on, unless the country is "Anywhere", where the company's country isn't known.
- **Demo mode:** a per-brand switch. Every source returns made-up data, nothing is sent, and demo data is stored apart from real data.

---

## 9. Where data lives

- Each brand has one JSON document (`signal_snapshots`, key `agent:lead`) holding settings, leads (up to about 300), the send log, own lists, saved search terms and the last run's summary or error.
- Every lead is also saved as its own row in `tool_suggestions`.
- Costs per month: `agent:usage`.
- Sent emails go through the same Gmail sender as the rest of GrowJin; opt-outs and bounces go to `email_suppressions`.

---

## 10. What we know is weak or untested

1. **Etsy sellers are hard to reach by email.** Most sell only on etsy.com, with no own website or public email. We can only reach those who also run their own site, and Etsy only allows contact through its own messages.
2. **The DataForSEO company search is new and only lightly tested.**
   - Early runs returned zero sites, because of a rank filter (now removed) and a paging bug (fixed).
   - It is unproven whether its keyword match on title and description finds enough real small shops.
3. **Scoring is a single AI call with fixed rules.** It can be too strict (good agencies scored 5–6) or too generous (it passed an estate agent "because it links to Instagram" before the trade rule was added).
4. **The trade check is a word match.** A page mentioning a trade word in passing passes. A real fit that describes itself differently fails.
5. **Reddit** gives few buyers: most posts are discussions or other founders promoting tools, and they score 1–4.
6. **Follow-up texts are fixed**, not personal.
7. **One country at a time, or Anywhere.** There's no way to pick a few countries.
8. **Small testing limits:** 3 finds per source and 3 Hunter emails per run. Fine for testing, too slow for real use.
9. **Not yet tested end to end** with real Gmail sending and replies.
10. **Page design:** the Lead Agent page still has many coloured badges, three levels of navigation and many green buttons. A calmer design is agreed but not built yet.

---

## 11. Questions for a reviewer

1. Is "website from DataForSEO → home page checks → AI score → email from Hunter → user approves" the right shape for finding small online-business buyers? What would you add or remove?
2. Better sources for small online sellers (Etsy, Shopify, Instagram-first brands) that can be reached by email, legally and cheaply?
3. Are the score thresholds (7, or 6 for companies) and the scoring rules sensible? Should scoring see more of the page?
4. Is the first-email format (noticed detail → how we help → one small ask, under 90 words) right? Should follow-ups be personal?
5. What is missing for deliverability and compliance (sending limits, warm-up, opt-out wording, CAN-SPAM / GDPR for "Anywhere")?
6. How should a first-time, non-technical user be guided so they know what to do next?
