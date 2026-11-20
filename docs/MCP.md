# GrowJin MCP server: how to connect

This page is for anyone building an app, agent or tool that wants to talk to GrowJin through MCP (Model Context Protocol). It covers the address, how to sign in, what the server speaks, every tool, and the rules a client should follow.

Source of truth in the code: `web/app/api/mcp/route.ts` (the server), `web/lib/mcp/tool-registry.ts` (tool names, descriptions, inputs), `web/lib/mcp/dispatch.ts` (what each tool runs), `web/lib/mcp/auth.ts` (tokens). If this page and `tools/list` ever disagree, `tools/list` wins.

---

## 1. At a glance

| | |
|---|---|
| Server URL | `https://app.growjin.com/api/mcp` |
| Transport | HTTP POST, one JSON-RPC 2.0 message per request, plain JSON reply (no SSE stream, no GET) |
| Protocol version | `2024-11-05` |
| Server name | `growjin` (version `1.0.0`) |
| Capabilities | `tools`, `prompts` |
| Auth | `Authorization: Bearer <token>`: an API key or an OAuth access token |
| One token = | one brand (a GrowJin account's business). Every tool works on that brand only |
| Longest call | 300 s (`analyze_module` can take up to 5 minutes) |
| CORS | open (`Access-Control-Allow-Origin: *`), so browser apps can call it |

---

## 2. Signing in

There are two ways. Both end with a bearer token that you send on every request.

### Option A: API key (scripts, servers, Claude Code, Cursor and other desktop tools)

1. The GrowJin user opens **Settings → Connect Claude** and presses **Generate API key** (or **Regenerate**).
2. They copy the 40-character key into your app.
3. Send it on every request:

```
Authorization: Bearer <api key>
```

A key can also be passed as `?token=<api key>` on the URL for clients that can't set headers. Prefer the header: URLs end up in logs.

Example config for clients that read the common `mcpServers` format:

```json
{
  "mcpServers": {
    "growjin": {
      "type": "http",
      "url": "https://app.growjin.com/api/mcp",
      "headers": { "Authorization": "Bearer <api key>" }
    }
  }
}
```

**Each brand has one key.** Generating a new key replaces the old one, so every app using the old key stops working.

### Option B: OAuth (web apps where the user clicks "Connect")

GrowJin runs a small OAuth 2.1 server: authorization code flow, PKCE (S256), public clients (no client secret), and dynamic client registration.

Discovery:

```
GET https://app.growjin.com/.well-known/oauth-authorization-server
```

```json
{
  "issuer": "https://app.growjin.com",
  "authorization_endpoint": "https://app.growjin.com/oauth/authorize",
  "token_endpoint": "https://app.growjin.com/api/oauth/token",
  "registration_endpoint": "https://app.growjin.com/api/oauth/register",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"],
  "scopes_supported": ["read", "write"]
}
```

Steps:

1. **Register** (optional, any body works):
   ```
   POST /api/oauth/register
   { "client_name": "My App", "redirect_uris": ["https://myapp.com/callback"] }
   ```
   You get back a `client_id`. Clients aren't stored, so this is only for clients that insist on registering.
2. **Send the user to authorize:**
   ```
   https://app.growjin.com/oauth/authorize
     ?response_type=code
     &client_id=<client_id>
     &redirect_uri=https://myapp.com/callback
     &code_challenge=<base64url(sha256(verifier))>
     &code_challenge_method=S256
     &state=<random>
   ```
   If they aren't signed in to GrowJin they're asked to log in first. There is no consent screen: a signed-in user is sent straight back to `redirect_uri` with `?code=…&state=…`. A user without a brand is sent to onboarding instead.
3. **Swap the code for a token** (within 10 minutes, once only):
   ```
   POST /api/oauth/token
   Content-Type: application/x-www-form-urlencoded

   grant_type=authorization_code&code=<code>&redirect_uri=https://myapp.com/callback&code_verifier=<verifier>
   ```
   JSON bodies work too. Answer:
   ```json
   { "access_token": "…", "token_type": "bearer", "expires_in": 31536000 }
   ```
4. Use `access_token` as the bearer token.

Things to know about OAuth here:

- **Tokens last one year.** There is no refresh token. When it stops working (401), run the flow again.
- **One OAuth token per brand.** A new OAuth connection replaces the last one's token, so two OAuth apps on the same brand knock each other out. The API key is separate and keeps working.
- **Scopes aren't enforced.** `read` / `write` are listed, but every token can call every tool.
- The server doesn't send a `WWW-Authenticate` header or `/.well-known/oauth-protected-resource`. Clients that discover the auth server that way should use the `oauth-authorization-server` address above directly.

### When sign-in fails

No token, a wrong token or a disconnected one gets HTTP 401 with:

```json
{ "jsonrpc": "2.0", "id": null, "error": { "code": -32001, "message": "Unauthorized" } }
```

---

## 3. Talking to the server

Every request is a `POST` to `/api/mcp` with `Content-Type: application/json` and one JSON-RPC message. Batches (arrays) aren't supported. There are no sessions: no `Mcp-Session-Id`, every request stands alone, so you can skip `initialize` if your client allows.

### Methods

| Method | What it does |
|---|---|
| `initialize` | Returns protocol version, capabilities and server info |
| `tools/list` | Every tool with its description and input schema (all at once, no paging) |
| `tools/call` | Runs a tool: `{ "name": "...", "arguments": { ... } }` |
| `prompts/list` | One prompt: `daily_growth_tasks` |
| `prompts/get` | `{ "name": "daily_growth_tasks" }` returns a ready user message with today's growth tasks |

Anything else (including `ping` and `notifications/initialized`) gets a JSON-RPC error `-32601 Method not found` with HTTP 200. Clients should ignore that for notifications.

### Examples

```bash
curl -s https://app.growjin.com/api/mcp \
  -H "Authorization: Bearer $GROWJIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

```bash
curl -s https://app.growjin.com/api/mcp \
  -H "Authorization: Bearer $GROWJIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_today_tasks","arguments":{"limit":"3"}}}'
```

### What a tool call returns

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      { "type": "text", "text": "{\n  \"tasks\": [ ... ]\n}" }
    ]
  }
}
```

- The first content item is always `text`, holding the tool's answer as **pretty-printed JSON**. Parse it.
- `create_social_post` and `get_social_post_status` add a second item, `{ "type": "image", "data": "<base64>", "mimeType": "image/…" }`, with the post preview.

### Errors: two kinds

1. **The tool ran but something was wrong** (bad input, the outside API refused, a limit reached): a normal result whose JSON has an `error` field, often with a plain-language fix. `isError` is not set, so **check for `error` in the parsed JSON.** A service that simply isn't connected usually comes back with a `message` saying where to connect it instead:
   ```json
   { "connected": false, "message": "Google Analytics (GA4 API) is not connected. Go to Settings → Integrations → …" }
   ```
   The passthrough tools (`dataforseo`, `hunter`, `apify`) return `{ "error", "http_status", "response" }` with the outside API's own message.
2. **The call itself failed** (unknown tool name, a crash): a JSON-RPC error, code `-32603`, with the message.

Bad JSON gets `-32700`; a missing `method` gets `-32600`.

### Input types

Inputs are mostly simple. Note that many older tools take numbers **as strings** (`"limit": "20"`, `"days": "28"`); newer tools take real numbers. Follow the type in `tools/list`. Required fields are listed in each schema's `required`.

---

## 4. The tools

51 tools. The full description of each (when to use it, every field, what comes back) is in `tools/list`; it's written for an AI model to read, so you can pass it straight to yours.

Key: **R** reads only · **W** changes something in GrowJin · **$** spends money or credits on GrowJin's accounts · **✉** sends real email.

### Growth overview and checklist

| Tool | | What it does | Inputs |
|---|---|---|---|
| `get_growth_overview` | R | Every growth module with status, score and last analysis, plus the overall score | — |
| `get_module_detail` | R | One module's checklist items with findings and the suggested fix or copy | `module_type`* (`foundation`, `seo`, `social-media`, `brand-audit`, `competitor-analysis`…) |
| `get_pending_items` | R | Unfinished checklist items, most important first | `module_type` |
| `analyze_module` | W $ | Re-runs a module's analysis (AI); waits up to 5 minutes | `module_type`* |
| `toggle_item` | W | Marks a checklist item done / not done, with an optional proof link and note | `item_id`*, `checked`*, `link`, `note` |
| `skip_item` | W | Drops a checklist item the user won't do | `item_id`*, `reason` |
| `get_growth_history` | R | One snapshot per day (scores, stage, traffic, tasks done) | `days` |

### Today's tasks

| Tool | | What it does | Inputs |
|---|---|---|---|
| `get_today_tasks` | R | Today's top tasks (same as the daily email) and the current bottleneck | `limit` |
| `resolve_signal` | W | Closes an alert or play task as done or dismissed | `signal_id`*, `status`, `link`, `note` |

Also available as the prompt `daily_growth_tasks`.

### Goal and numbers

| Tool | | What it does | Inputs |
|---|---|---|---|
| `get_goal_progress` | R | Where the user stands on their goal (default 500 sign-ups), pace, forecast | — |
| `set_goal` | W | Saves the goal (only when the user says so) | `target`, `counts`, `deadline`, `plan_property`, `plan_value` |
| `get_daily_numbers` | R | Day-by-day visits, Google clicks, sign-ups; yesterday vs averages; unusual days | — |
| `get_weekly_review` | R | The week in one answer: pace, channels, work done, tests running | — |

### Brand and competitors

| Tool | | What it does | Inputs |
|---|---|---|---|
| `get_brand_info` | R | Brand profile: name, site, industry, audience, USP, summary | — |
| `get_competitors` | R | Known competitors and what they do better | — |

### Website analytics and search

| Tool | | What it does | Inputs |
|---|---|---|---|
| `get_ga_analytics` | R | GA4 sessions, users, channels, top pages | `period` (`7d` / `30d` / `90d`) |
| `get_ga_conversions` | R | GA4 conversions by page, event and channel | `period` |
| `ga4` | R | Any GA4 Data API report, realtime report or the metadata list | `action`, `request`, `limit`, `search` |
| `get_gsc_data` | R | Search Console totals, top searches and pages | `days`, `limit` |
| `gsc` | R | Any Search Console query, URL inspection, sitemaps, sites | `action`, `request`, `url`, `limit` |
| `get_keyword_trends` | R | Tracked keywords: position now vs start, wins and drops | — |
| `get_search_agent` | R | The Search Agent's saved research: AI answers, keywords, topics, to-dos, link pitches | `section`, `limit` |
| `blog_keywords` | R $ | Weekly blog keyword routine: `weekly` / `track` (free), `discover` / `evaluate` / `plan` (DataForSEO), `history` | `action`, `seeds`, `keywords`, `competitors`, `keyword`, `url`, `country`, `fresh` |
| `customer_language` | R $ | The words buyers use for their problems: `listen`, `reviews` (Apify), `history` | `action`, `topics`, `pasted`, `review_urls`, `country`, `fresh` |

### App users (PostHog)

| Tool | | What it does | Inputs |
|---|---|---|---|
| `get_posthog_analytics` | R | DAU / WAU / MAU and top product events | `days` |
| `get_posthog_segments` | R | New, churned and power users, growth and churn risk | — |
| `get_posthog_users` | R | Emails of users active in the last N days | `days`, `limit` |
| `get_posthog_power_users` | R | Users active 5+ days of the last 7 | `limit` |
| `get_posthog_churned_users` | R | Users gone quiet for N days | `inactive_days`, `limit` |
| `get_posthog_pro_users` | R | Users on a plan (default `plan = pro`) | `plan_property`, `plan_value`, `limit` |

### Content and social

| Tool | | What it does | Inputs |
|---|---|---|---|
| `get_blog_post` | R | A blog post written in GrowJin, as markdown, ready to publish | `blog_id` |
| `mark_blog_published` | W | Tells GrowJin the post is live, so it's tracked | `blog_id`*, `live_url` |
| `create_social_post` | W $ | Makes a post preview with Frekto (nothing is published); returns an image | `topic`, `platform`, `post_type` |
| `get_social_post_status` | R | Checks a preview that was still rendering | `job_id`* |
| `schedule_social_post` | W | Publishes or schedules an approved post through Frekto | `job_id`*, `post_now`, `start_date`, `time`, `timezone`, … |

### Leads and email

| Tool | | What it does | Inputs |
|---|---|---|---|
| `get_lead_settings` | R | Who the user wants as leads, domains already known, optional search playbook | `include_playbook` |
| `check_contacts` | R | Per email / domain: new, already a lead, emailed, opted out, bounced | `emails`, `domains` |
| `save_leads` | W | Adds found leads to the Lead Finder board (up to 50 a call) | `leads`*, `dropped` |
| `list_leads` | R | Leads on the board, best first, with drafts | `status`, `lane`, `search`, `lead_id`, `include_text`, `limit` |
| `list_replies` | R | Replies to emails GrowJin sent, follow-ups due, or one thread's messages | `show`, `days`, `include_answered`, `thread_id`, `messages`, `limit` |
| `gmail_status` | R | Whether Gmail is connected and sending is allowed, and what's left today | — |
| `send_email` | W ✉ | Sends from the user's Gmail (one, or up to 20) | `to`, `subject`, `body`, `thread_id`, `in_reply_to`, `follow_up_days`, `emails` |

### Raw data sources (paid)

| Tool | | What it does | Inputs |
|---|---|---|---|
| `dataforseo` | R $ | Any DataForSEO v3 endpoint; raw JSON back | `endpoint`*, `payload`*, `limit` |
| `hunter` | R $ | Hunter domain search, email finder, email verifier; raw JSON back | `action`*, `params`*, `limit` |
| `apify` | R $ | An Apify actor by alias (`contacts`, `x`, `reddit`, `instagram`, `linkedin_people`, `meta_ads`, `producthunt`…) or ID; raw items back | `actor`, `input`, `limit`, `run_id` |

`limit` on these three defaults to 10 and is capped at 50.

### Work log

| Tool | | What it does | Inputs |
|---|---|---|---|
| `log_work` | W | Saves growth work done outside GrowJin (one entry or up to 100) | `entries` or `kind`, `title`, `url`, `done_on`, `how`, `status`, `next_check`, `notes` |
| `list_work` | R | Lists the work log with filters | `kind`, `status`, `from`, `to`, `search`, `due`, `limit` |
| `update_work` | W | Changes one entry | `id`*, any field, `add_note` |
| `delete_work` | W | Removes one entry | `id`* |

`*` = required.

---

## 5. Rules for clients

These are what the tool descriptions already tell an AI model. If your app calls tools from its own code rather than through a model, follow them yourself.

1. **Ask before changing anything.** Tools marked W, $ or ✉ should run only after the user agreed in your app. In particular:
   - `send_email`: show the exact recipient, subject and body and get a yes first. Run `check_contacts` on new people first.
   - `schedule_social_post`: only after the user approved the preview from `create_social_post`.
   - `set_goal`, `skip_item`, `save_leads`, `delete_work`, `log_work`: only when the user asks.
2. **Sending email needs the user's switch.** `send_email` only sends when `gmail_status` says `ready_to_send`: Gmail is connected with send permission **and** the user turned on "Let Claude send email" in GrowJin Settings → Connect Claude. There's a daily limit (10, 25 or 50, set by the user). Opted-out and bounced addresses are always refused.
3. **Mind the money.** `dataforseo`, `hunter`, `apify`, the paid actions of `blog_keywords` / `customer_language`, `analyze_module` and `create_social_post` spend from GrowJin's accounts. Start with small limits. Answers include `cost_usd` where known. Spend shows in the user's Settings → Usage as "Claude (MCP)".
4. **Long jobs.**
   - `apify` waits about 45 s. If the actor isn't done you get `{ run_id, status: "RUNNING" }`: call `apify` again with only `{ run_id }` later.
   - `create_social_post` may answer `status: "rendering"`: call `get_social_post_status` after about 20 s.
   - `analyze_module` can take up to 5 minutes. Set your HTTP timeout to at least 300 s.
5. **Things that aren't connected** come back as a message, not a crash. Show it to the user; it says where to connect the service in GrowJin.
6. **Demo mode.** If the user has GrowJin's demo mode on, the lead tools read and write the demo copy of their data.

---

## 6. Privacy and logging

- A token only ever sees its own brand.
- GrowJin logs which tool was called and whether it worked, for the user's activity view. It does **not** log arguments or results.
- `list_replies` only reads email threads GrowJin itself sent; the rest of the user's mailbox is never read.
- The user can cut access any time by generating a new key in Settings (for the API key) or connecting again (for OAuth).

---

## 7. Quick checklist for a new integration

1. Get a key from Settings → Connect Claude (or run the OAuth flow).
2. `POST` `tools/list` with the bearer token. You should get 51 tools.
3. Call `get_brand_info` to check you're on the right brand.
4. Parse each tool answer's `content[0].text` as JSON and check for an `error` (or a not-connected `message`).
5. Ask the user before any W, $ or ✉ tool.
