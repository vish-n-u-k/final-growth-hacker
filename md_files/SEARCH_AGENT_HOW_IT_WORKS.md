# GrowJin Search Agent: how it works

A complete description of the Search Agent in GrowJin, written to be read by a person or another AI reviewing it. It covers what the agent is for, every step it takes, which outside service does what, the rules and numbers it uses, what the user sees, and the weak spots we already know about.

State as of 27 Oct 2026. The code is in `web/lib/agents/`:
- `search-agent.ts`: research and writing
- `link-opportunities.ts`: sites to pitch
- `task-help.ts` and `task-kinds.ts`: turning to-dos into actions

The API is `web/app/api/agents/search/route.ts` and the page is `web/components/agents/SearchAgentPage.tsx`.

---

## 1. What it is for

GrowJin helps small businesses grow. The Search Agent helps a small business **get found**, on Google and in AI assistants (ChatGPT, Perplexity, Gemini). Each week it works out what to do, and then does most of the work.

- **The user** is a small business owner or solo founder: not an SEO expert, not technical.
- **The test brand** is Frekto, an AI tool that writes, designs and schedules social media posts.
- **What the user should get:** a short to-do list that says exactly what to do this week. Most items come half-done:
  - a blog post already written
  - a pitch email already drafted
  - new website wording already written

**Golden rule:** nothing is published or sent without the user. Blog posts are saved as drafts, and pitch emails go out only when the user clicks send. The one exception is a single follow-up to a pitch the user already sent.

---

## 2. What the page shows (four tabs)

| Tab | What's in it |
|---|---|
| **To do** | Everything to act on, in three groups: **posts to write** (drafted for you), **sites to pitch** (each with an email ready), and **other things to do** (fix how AI describes you, get listed on G2 and similar, pitch article sites, Reddit threads) |
| **Done** | Finished, skipped and sent items |
| **Rankings** | The searches the site shows up for on Google, and what moved since last week |
| **AI answers** | For each buyer question, whether ChatGPT, Perplexity and Gemini name the brand, which rivals they name and which sites they cite |

---

## 3. Settings

| Setting | Meaning | Default |
|---|---|---|
| Switched on | Run on its own on a schedule | Off |
| Country | Which country's Google and keyword data to use | Guessed from the website ending |
| Starting keywords (seeds) | 5 short searches people type to find this kind of product | Written by Claude from the brand, never the brand name |
| Buyer questions | 10 questions a buyer would ask an AI assistant, e.g. "What's the best tool for …?" | Written by Claude from the brand, never naming any brand |

Competitors come from the brand's own settings in GrowJin, and up to 3 are used.

---

## 4. The schedule

The research is the expensive part, so the work is spread over the week. Only one heavy job runs per day. A daily job at 04:00 UTC runs for brands that have the agent switched on:

1. **Every day:** checks for replies to sent pitches, and sends the one follow-up when it's due (5 days after the pitch).
2. **Once a week:** **Research** (section 5).
3. **Once a week, on a later day:** **Sites to pitch** (section 7).
4. **Once a week, on another day:** **Write** the next blog post (section 6), if a topic is waiting.

The user can also start any of these by hand from the page. Each one shows live progress.

---

## 5. Research (weekly), step by step

### Step 1: Read the brand
On the first run, **Claude** writes the 5 starting keywords and the 10 buyer questions. They are saved, and the user can edit them.

### Step 2: These run at the same time

**a. Keyword ideas (DataForSEO Labs)**
- Up to 200 Google searches related to the starting keywords.
- For each one: searches a month, difficulty (0–100), cost per click on Google Ads, and what the searcher wants.

**b. Google rankings (DataForSEO Labs)**
- Up to 200 searches the brand's website already shows up for, with its position and the page that ranks.
- Compared with last week, any move of 3 places or more is noted.

**c. AI answers (DataForSEO's AI answer service)**
- Each buyer question (up to 10) is asked to **ChatGPT, Perplexity and Gemini**, so up to 30 answers a week.
- For each answer GrowJin notes:
  - whether the brand is named
  - where it's named (1st, 2nd…) among the tracked brands
  - which competitors are named
  - which websites the answer cites
- Names are found by searching the answer text for the brand's and competitors' names and domains.
- This is the costliest part of the research.

**d. How AI describes the brand**
- ChatGPT is asked "What is [brand] ([domain])? Answer in two sentences."
- **Claude** compares that answer with what the brand really is. It replies OK, or one sentence on what's wrong ("ChatGPT calls you a design tool, but you write and schedule posts.").
- If ChatGPT doesn't seem to know the brand at all, that's noted too.

**e. Google Ads waste** (only if the user connected Google Ads)
- Search terms with spend and zero conversions in the last 30 days, top 10 by cost.

### Step 3: Pick blog topics (up to 3 waiting at a time)

There are two kinds of candidates:
- **"Almost there" searches:** the site already ranks **#5 to #20**, with at least 30 searches a month. A better page could reach the top 3.
- **Winnable new searches:** 50 to 20,000 searches a month, with difficulty 40 or less.

Then:
- Branded searches are left out.
- Candidates are ranked by volume and difficulty, and the best 20 go to **Claude**. It keeps only searches where the searcher could become a customer, and drops those that are too broad or about something else, such as jobs or agencies.
- Topics too similar to one already picked are skipped.
- Each topic gets a one-line reason, e.g. "You already rank #12. A better page can reach the top 3", or "1,300 searches a month, easy (22), people comparing options".

### Step 4: Build the "other things to do" list

These come from fixed rules, most urgent first:

| To-do | When it appears | Limit |
|---|---|---|
| **Fix how AI describes you** | ChatGPT's description is wrong, vague or missing | 1 |
| **Refresh a page** | A page's search dropped 3+ places, or out of the top 100 | 3 |
| **Write a page answering "<question>"** | No AI engine names the brand for a buyer question, but they do name rivals | 3 |
| **Get mentioned on <site>** | A website was cited at least twice this week in AI answers that left the brand out (Reddit threads become "Join the Reddit threads AI answers cite") | 3 |

Separate tips about ads:
- **Try ads for "<search>":** hard to rank for (difficulty 60+), but cheap per click (under $3), with 100+ searches a month. Up to 2.
- **Money wasted:** "$X spent on searches that never converted. Add these as negative keywords: …"

### Step 5: Save and show
- The top 3 open to-dos become cards on the Today page.
- To-dos the user already finished stay finished.
- Open ones the new data no longer supports are removed.
- A weekly history of "named in N of M AI answers" is kept.
- A summary is shown, e.g. "2 new topics · named in 4 of 30 AI answers · 6 tasks · $0.41".

---

## 6. Write (weekly): a blog post for the next topic

1. **DataForSEO** fetches today's top Google results for the topic and keeps the top 3 that aren't the brand's own site.
2. **GrowJin reads each of those pages:** title, about how many words, the newest year mentioned (is it current?) and its section headings.
3. **Claude writes the post:**
   - A one-line note on what today's #1 result offers and lacks, and 3–4 points on how this post beats it.
   - A title, a meta title (50–60 characters) and a meta description (145–160 characters, with the search phrase).
   - The article in Markdown, following these rules:
     - 1,200–1,600 words, with H2/H3 headings
     - answers the search in the first paragraph
     - practical examples, a comparison table if it helps, an FAQ with 3–4 questions
     - mentions the brand honestly, at most 3 times, and ends with a short call to action
     - **no invented statistics, prices or quotes**
4. **Saved as a draft** in the brand's blog drafts, with a Today card: "Blog draft ready".
5. **The user** reads it and adds it to their site. They mark it approved, published or skipped. GrowJin doesn't publish it to the user's website.

---

## 7. Sites to pitch (weekly)

The aim is links and mentions from other websites, which help both Google and AI answers.

### Finding sites
1. **Competitor links (DataForSEO Backlinks):**
   - Sites linking to up to 3 competitors but not to the brand.
   - Spammy sites (spam score over 40) are skipped.
2. **"Best of" lists (DataForSEO Google results):**
   - Four searches: "best <keyword>" for 2 of the starting keywords, and "<competitor> alternatives" for 2 competitors.
   - Results whose title looks like a list or comparison (best, top, alternatives, vs, compared, reviews) are kept.
   - **GrowJin reads each page:** if it already mentions the brand it's dropped, and it notes which rivals it names.
3. **Always skipped:**
   - the brand, its competitors and sites already on the list
   - big platforms: Google, YouTube, the social networks, Reddit, Wikipedia, Medium, GitHub, Amazon and others

### Choosing and writing
- **Strongest first:** sites that name more competitors, list articles over plain links, then the site's authority.
- **Claude**, in one call for up to 14 sites:
  - decides whether each is realistic to pitch (major news, government, universities, a competitor's own site and spammy or unrelated sites are dropped)
  - writes one plain reason ("Their 'best scheduling tools' article lists RivalOne and RivalTwo but not you.")
  - writes a pitch: a subject under 60 characters and a body of 80–130 words that names the page, says why the brand helps their readers, makes one clear ask and offers help. No flattery, no invented facts.
- Up to 10 new sites a week.

### Contacts
- **Hunter** first, for up to 8 lookups, which can give a named person.
- Otherwise an email address linked on the site's own pages.

### Sending
- The user reads and edits the pitch, then sends it from their own Gmail.
- It ends with an opt-out line: "If this isn't a fit, just reply "no" and I won't email again."
- **One follow-up** after 5 days if there's no reply. It stops if they reply, opt out or the email bounces.
- Replies show in red on the page and as a Today card.

---

## 8. "Other things to do" made actionable

Each to-do opens into a short flow instead of being advice to read:

| To-do | What GrowJin does |
|---|---|
| **Fix how AI describes you** | **Claude** writes new wording three ways: a headline, a search description and an About paragraph. The user pastes them on their site ("New wording" → "Put it on your site"). |
| **Get listed on a review directory** (G2, Capterra, GetApp, Product Hunt, Trustpilot, AlternativeTo…) | Links to the directory's free vendor sign-up page, then helps ask customers for reviews ("Get listed" → "Ask for reviews"). |
| **Get mentioned on an article site** | Turns it into a pitch in "Sites to pitch": Claude drafts it and Hunter finds a contact. |
| **Reddit threads AI cites** | Opens the threads. Replies are drafted in the Lead Agent's Community tab, and the user posts them. |
| **Write a page answering a question** / **Refresh a page** | Shown as a task with the reason. There is no automatic draft yet for these. |

---

## 9. Who does what

| Service | Job in the Search Agent | Cost |
|---|---|---|
| **Claude** | Starting keywords and buyer questions; checking how AI describes the brand; picking relevant topics; writing blog posts; pitches; new site wording | Cents per step. Blog posts use a stronger writing model, small checks a fast one. |
| **DataForSEO Labs** | Keyword ideas; the site's Google rankings | Pay as you go, cents per request |
| **DataForSEO AI answers** | Asking ChatGPT, Perplexity and Gemini the buyer questions, and the "what is [brand]" check | The costliest part: up to 30 answers a week |
| **DataForSEO Google results** | Top results for a topic; "best of" list searches | Fractions of a cent per search |
| **DataForSEO Backlinks** | Sites linking to competitors and to the brand | Pay as you go |
| **Hunter** | One contact email per site to pitch | 1 credit per email found; 50 free a month, shared with the Lead Agent |
| **Gmail** (the user's own) | Sending pitches and the follow-up; reading replies | Free |
| **Google Ads** (optional, the user's own) | Wasted spend on search terms that never converted | Free |

Costs are recorded per tool and per service under Settings → Usage & costs.

---

## 10. Where data lives

- Each brand has one JSON document (`signal_snapshots`, key `agent:search`) holding:
  - settings
  - topics (up to 60)
  - rankings and rank changes
  - the latest AI answers and the weekly mention history (26 weeks)
  - ChatGPT's description of the brand
  - to-dos and ad tips
  - sites to pitch (up to 150)
  - when each step last ran
- Topics, sites and to-dos are also saved as their own rows in `tool_suggestions`.
- Blog drafts are saved in the brand's blog table (`brand_blogs`).
- Demo mode: a per-brand switch that uses made-up data, sends nothing and is stored apart from real data.

---

## 11. What we know is weak or untested

1. **Not tested end to end** with real DataForSEO, Gmail and Google Ads data. Most work was checked with demo data.
2. **The AI answers aren't exactly what users see.** DataForSEO asks each assistant through its API, using a small model with no chat history. The apps people use can answer differently. One run is a single sample, so the week-to-week numbers are noisy.
3. **Brand detection is a name search** in the answer text. It can miss spellings and match unrelated words (short or common brand names).
4. **The to-do rules are fixed** (cited twice, dropped 3 places…). Nobody has tuned them against real results.
5. **Topic picking** uses fixed volume and difficulty cut-offs (difficulty 40 or less, 50–20,000 searches). DataForSEO's difficulty can be unreliable for small niches.
6. **Blog posts aren't published for the user**, and GrowJin doesn't track whether a published post ranks afterwards. There's no loop from "we wrote this" to "it worked".
7. **"Write a page answering a question" and "Refresh a page" have no draft yet**; they're just tasks.
8. **Competitor links need competitors** in the brand's settings. Without them, only "best of" lists are found.
9. **Pitches go to whatever contact is found**, often a generic address, and editors get many such emails. Expect low reply rates.
10. **One country** at a time.
11. **A stale message:** one note still says backlinks need DataForSEO's monthly subscription, which is no longer true.
12. **A chart was removed:** an earlier "how often AI names you vs competitors" chart was dropped. Whether it should come back is still undecided.
13. **Page design:** the page still has many coloured badges and several levels of navigation. A calmer design is agreed but not built yet.

---

## 12. Questions for a reviewer

1. For a small business with little time, are these the right weekly outputs (blog post, pitches, fix your AI description, get listed)? What would you add or drop?
2. How should "does AI recommend us" be measured so it's reliable enough to act on (more samples, more questions, other engines)?
3. Are the topic rules ("almost there" #5–#20, or difficulty 40 or less) sensible for a new, small site? What would pick better topics?
4. Is the blog brief (beat the top 3 on coverage, currency and practicality, 1,200–1,600 words, no invented facts) the right way to write posts that rank and get cited by AI?
5. How can pitches to "best of" list owners get more replies? Is the 80–130 word format right, and who should they go to?
6. What should close the loop, so the agent learns which of its suggestions actually helped (rank changes after publishing, mentions gained after pitching)?
