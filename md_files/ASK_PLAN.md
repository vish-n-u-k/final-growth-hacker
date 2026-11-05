# Ask: plan

The approved preview is `design-previews/seo-ask/ask-app-flow-v2.html`. Earlier sketches are in the same folder.

## The idea

There's one page with an ask box and no menu. It answers two kinds of question:

- **Ready answers (cards):** a fixed set of questions, filled every morning and saved. Opening one is instant and costs nothing.
- **Your own question:** answered live by Claude using the tools we already have, then drawn in the same shape as a card.

Every answer has the same form:

- one sentence
- one picture (line, bars, comparison, tiles or list)
- up to 3 findings
- one next step
- where the data came from

The next step opens the work. In phase 1 it's a link to the existing page; from phase 3 it's a panel on the right that shows the existing screen at that one item.

## What already exists

| Ask needs | Already in the code |
|---|---|
| Data for answers | Search Console / GA / PostHog fetchers, Lead Finder and Search Agent data (`signal_snapshots`), `tool_suggestions`, reply tags in `reminders` |
| Tools for your own questions | 29 MCP tools (`lib/mcp/tool-registry.ts`), run by `dispatch()` in `app/api/mcp/route.ts` |
| Tool loop with caps, polled job | `lib/leads/engine.ts` (Lead Engine) |
| Morning run | `/api/cron/agents` at 04:00, `daily-signals`, `daily-email` |
| Ranking what matters | `getTodayTasks` (`lib/daily/today-tasks.ts`) |
| Screens to do the work | Lead Finder opened lead, Email Outreach reply thread, Search Agent write / fix |
| Progress steps | `LiveProgress`, `ui/loading.tsx` |
| Costs | `ai_usage_logs`, `agent:usage`, Settings → Usage |

Where each card's data comes from:

| Card | Source |
|---|---|
| Who should I email? | Lead Finder leads that are ready |
| Did anyone reply? | Reply check in `reminders` |
| Why am I not on Google? | Search Console pages vs the sitemap |
| What should I post? | Search Agent topics + Social Studio |
| Where should I talk? | Lead Finder "Join conversations" |
| Which words can I win? | Search Agent keyword ideas |
| Am I on track? | Search Console trend, backlinks, to-dos |

The Growth Path modules become sources (`get_module_detail`) and feed a "What should I fix first?" card.

## What's new

1. **Answer form and pictures:** one type plus 5 small chart components, used by both kinds of answer.
2. **Card fillers:** one function per card that works the numbers out in code. They're saved per brand in `signal_snapshots` `ask:cards`, filled by the morning run, and refilled when the page is opened and the saved copy is older than a day.
3. **Your own question engine** (`/api/ask`):
   - first, a cheap check of whether the question is one of the cards
   - otherwise, a Claude tool loop on the MCP tools (the Lead Engine pattern), ending in a `give_answer` tool that forces the answer form
   - it can ask one question back
   - a check that every number in the sentence comes from a fetched result
   - caps per question and per day
4. **Threads and pins:**
   - follow-ups reuse the earlier answer's data
   - a pin saves the question plus its lookups; the morning run repeats them and it becomes a card
5. **Side panel:** existing screens opened at one item. This is the biggest refactor, because those screens are whole pages today.
6. **Onboarding:** step 2's brand form becomes "First look" plus "what we learned".

Refactors:

- move `dispatch()` from the MCP route into `lib/`
- share the Lead Engine's loop and caps

## Build order

Everything is on `/ask`, not in the sidebar, for early-access users only.

1. **Cards only:** email, replies, Google. Answer form, pictures, saved per brand, next step links to the existing page.
2. **Your own questions:** the engine, "How I got this", asking back, missing data. Then the other cards.
3. **Side panel:** lead email, reply, fix brief.
4. **Follow-ups and pins.**
5. **`/ask` becomes home:** new onboarding; Today and Growth Path go behind it.

## Open decisions

1. Model for your own questions: Sonnet first, Opus 5.5 if answers are weak.
2. Daily limit on typed questions per brand.
3. Whether Today and Growth Path stay reachable once Ask is home.
4. Stripe as a source (sales questions).
5. Demo mode: should Ask show demo answers?

## Phase 1 notes

Phase 1 is built (5 Nov); see HANDOFF.md section 4g.

- The sentences are written in code from the numbers, not by AI. That makes them free, consistent, and impossible to get wrong about a number. AI wording can come with phase 2.
- **"Why am I not on Google?"** The Search Console API has no "pages indexed" count; that report exists only in the Search Console website. So the card counts **pages that showed up in a Google search in the last 28 days** (Search Console, `page` dimension) against **pages in your sitemap**. The answer says that in plain words.
