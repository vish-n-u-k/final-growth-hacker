export interface MCPTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, { type: string; description: string; items?: { type: string } }>
    required?: string[]
  }
}

export const TOOLS: MCPTool[] = [
  {
    name: 'get_growth_overview',
    description:
      'Returns all growth modules for this brand with their status, score, and last analysis date. Also returns an overall score averaged across non-locked modules.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_module_detail',
    description:
      'Use this when a user asks for specific recommendations or advice about their website or marketing — e.g. "what should my H1 say?", "what should I write for my meta description?", "what CTA should I use?", "how should I structure my homepage?", "what should my page title be?", "give me a suggestion for my about page". Returns all checklist items for a module, grouped by category. Each item includes AI-generated findings (aiDetail), a plain-English explanation (aiNarrative), and a specific recommended action or copy suggestion (aiAction). Use module_type="seo" for on-page SEO questions (H1, meta description, title tags, headings, URLs), module_type="foundation" for core brand/website questions, module_type="social-media" for social content questions.',
    inputSchema: {
      type: 'object',
      properties: {
        module_type: {
          type: 'string',
          description:
            'The module type slug, e.g. "foundation", "seo", "social-media", "brand-audit", "competitor-analysis".',
        },
      },
      required: ['module_type'],
    },
  },
  {
    name: 'analyze_module',
    description:
      'Triggers a full re-analysis of a module. Awaits completion and returns the new score and number of items updated. May take up to 5 minutes.',
    inputSchema: {
      type: 'object',
      properties: {
        module_type: {
          type: 'string',
          description: 'The module type slug to re-analyze.',
        },
      },
      required: ['module_type'],
    },
  },
  {
    name: 'toggle_item',
    description:
      'Marks a checklist item as checked or unchecked (user self-reported completion). Does not affect AI verification. When you did the work, pass link (the pull request, changed page or published post) and note (what you changed) so the user can see the result in GrowJin.',
    inputSchema: {
      type: 'object',
      properties: {
        item_id: {
          type: 'string',
          description: 'The UUID of the module item to toggle.',
        },
        checked: {
          type: 'boolean',
          description: 'true to mark as done, false to unmark.',
        },
        link: {
          type: 'string',
          description: 'When marking done: a link that shows the result, e.g. the pull request, the changed page on the live site, or the published post. Shown to the user next to the finished task.',
        },
        note: {
          type: 'string',
          description: 'When marking done: one or two sentences on what you changed. Shown to the user next to the finished task.',
        },
      },
      required: ['item_id', 'checked'],
    },
  },
  {
    name: 'get_blog_post',
    description:
      'Returns a blog post written in GrowJin (title, slug, meta title/description, target keyword and the full article as markdown) so you can add it to the user\'s website. Without blog_id it returns the newest unpublished post. After the post is live, call mark_blog_published.',
    inputSchema: {
      type: 'object',
      properties: {
        blog_id: { type: 'string', description: 'UUID of the blog post. Omit for the newest unpublished post.' },
      },
    },
  },
  {
    name: 'mark_blog_published',
    description:
      'Marks a GrowJin blog post as published once it is live on the user\'s website, so GrowJin tracks it (and checks it is live and indexed).',
    inputSchema: {
      type: 'object',
      properties: {
        blog_id: { type: 'string', description: 'UUID of the blog post (from get_blog_post).' },
        live_url: { type: 'string', description: 'Full URL where the post is live, e.g. https://example.com/blog/my-post.' },
      },
      required: ['blog_id'],
    },
  },
  {
    name: 'skip_item',
    description:
      'Drops a checklist item (a kind="item" task from get_today_tasks) that the user says does not apply or will not do. It leaves today\'s list and the pending list. Only call after the user agrees to drop it.',
    inputSchema: {
      type: 'object',
      properties: {
        item_id: {
          type: 'string',
          description: 'The UUID of the module item to skip.',
        },
        reason: {
          type: 'string',
          description: 'Optional. Why the user dropped it, in their words.',
        },
      },
      required: ['item_id'],
    },
  },
  {
    name: 'get_growth_history',
    description:
      'Use this for progress-over-time questions — e.g. "how have I improved?", "what changed this month?", "is my score going up?", "am I still stuck on traffic?". Returns one snapshot per day (overall score, each module score, growth bottleneck stage, traffic and app-user numbers, tasks completed) plus a first-vs-latest summary of what changed. History starts from when daily snapshots began, so early on there may be only a few days.',
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: 'string',
          description: 'How many days back to look. Defaults to "30", max 365.',
        },
      },
    },
  },
  {
    name: 'get_brand_info',
    description:
      'Returns the brand profile including name, website URL, industry, target audience, USP, and the executive summary from the sales playbook.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_today_tasks',
    description:
      "Use this when the user asks what to do today, says \"do today's tasks\", or arrives from the GrowJin daily email. Returns today's top growth tasks (same list as the daily email). Each task has an id, label, priority, route (\"code\" = change the website codebase, \"content\" = create posts/blog content, \"manual\" = the user must do it themselves), the AI finding, and a recommended action. Also returns focus: the current growth bottleneck (awareness = not enough traffic, conversion = visitors don't act, retention = users go quiet, growth = healthy) with a one-line summary based on live analytics. Task kinds: \"alert\" = something broke or changed (DNS record missing, ads underperforming); \"play\" = the action that best fixes the bottleneck; \"item\" = a checklist fix. finding explains why the task was picked, with numbers. Present only these tasks; do not mention other pending items. needsUserInput=true means ask the user for real data instead of inventing it. daysPending = days since the task was first shown; overdue=true means it has waited 2+ days (its priority is already raised one level): do overdue tasks first and say how long they have waited. askToDrop=true (5+ days) means ask the user to do it now or drop it; to drop, call skip_item for kind=\"item\" or resolve_signal with status=\"dismissed\" for kind=\"alert\"/\"play\". After completing a task: for kind=\"item\" call toggle_item with its id and checked=true; for kind=\"alert\" or \"play\" call resolve_signal with its id.",
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'string',
          description: 'Max number of tasks to return. Defaults to "3", max 10.',
        },
      },
    },
  },
  {
    name: 'create_social_post',
    description:
      "Use when the user asks to create, make or draft a social media post (or to do today's \"Post on social media\" task). Generates the post image/video with Frekto using the brand's stored Frekto brand profile, as a PREVIEW only — nothing is published. Returns job_id, preview_url (and slide_urls for carousels) and an inline preview image. Show the preview to the user and ask whether to post now, schedule it for a date, or make a different one. Never schedule without the user's explicit approval. If status is \"rendering\", call get_social_post_status with the job_id after ~20 seconds. Requires Frekto connected in GrowJin.",
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'What the post is about (max 300 chars). Leave empty to let Frekto pick a fitting topic from the brand profile. Only ask the user for specifics Frekto cannot know (a launch date, a new feature, an event).',
        },
        platform: {
          type: 'string',
          description: 'linkedin, instagram, facebook, pinterest or youtube. Defaults to the brand\'s main Frekto platform.',
        },
        post_type: {
          type: 'string',
          description: 'Instagram/Facebook only: "feed" (default), "story" or "reel" (video).',
        },
      },
    },
  },
  {
    name: 'get_social_post_status',
    description:
      'Checks a post created with create_social_post that was still rendering. Returns the preview when done. Then show it to the user and ask before scheduling.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: {
          type: 'string',
          description: 'The job_id returned by create_social_post.',
        },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'schedule_social_post',
    description:
      'Publishes or schedules a post the user has APPROVED (from create_social_post), through Frekto. Call only after the user explicitly says to post or schedule it. Use post_now=true to publish within about a minute, or start_date (+ optional time and timezone) to schedule. Frekto writes the caption and hashtags. GrowJin records the post and closes today\'s "Post on social media" task automatically. If scheduling the approved render fails, ask the user before retrying with allow_regenerate=true (that schedules a new render on the same topic, which may look different).',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'The job_id of the approved post.' },
        topic: { type: 'string', description: 'The post topic (for GrowJin\'s record).' },
        platform: { type: 'string', description: 'linkedin, instagram, facebook, pinterest or youtube. Defaults to the brand\'s main Frekto platform.' },
        post_type: { type: 'string', description: 'Instagram/Facebook only: "feed" (default), "story" or "reel".' },
        post_now: { type: 'boolean', description: 'true to publish as soon as possible (within about a minute).' },
        start_date: { type: 'string', description: 'Date to publish, YYYY-MM-DD. Required unless post_now is true.' },
        time: { type: 'string', description: 'Time of day, HH:MM 24h. Defaults to 09:00.' },
        timezone: { type: 'string', description: 'IANA timezone, e.g. "Asia/Kolkata". Defaults to the brand\'s Frekto timezone.' },
        allow_regenerate: { type: 'boolean', description: 'Only after the user agrees: if the approved render cannot be scheduled, schedule a fresh render on the same topic instead.' },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'resolve_signal',
    description:
      'Closes an alert or play (a kind="alert" or kind="play" task from get_today_tasks) once it has been handled. Use status="done" when the issue was fixed, or "dismissed" when the user says it does not apply. A closed signal will not be raised again for 7 days. When status is "done", pass link (the pull request, changed page or published post) and note (what you changed) so the user can see the result in GrowJin.',
    inputSchema: {
      type: 'object',
      properties: {
        signal_id: {
          type: 'string',
          description: 'The id of the signal task.',
        },
        status: {
          type: 'string',
          description: '"done" (default) or "dismissed".',
        },
        link: {
          type: 'string',
          description: 'When marking done: a link that shows the result, e.g. the pull request, the changed page on the live site, or the published post. Shown to the user next to the finished task.',
        },
        note: {
          type: 'string',
          description: 'When marking done: one or two sentences on what you changed. Shown to the user next to the finished task.',
        },
      },
      required: ['signal_id'],
    },
  },
  {
    name: 'get_pending_items',
    description:
      'Use this when a user asks what to work on, fix, or prioritise next — e.g. "what should I do next?", "what is broken on my site?", "what are my biggest issues?", "what should I fix first?", "what is holding back my SEO?". Returns all incomplete checklist items — not yet verified by AI and not manually checked — sorted by priority (critical first). Each item includes a label, weight, and AI action suggestion. If module_type is provided, scoped to that module only. If omitted, returns pending items across all non-locked modules.',
    inputSchema: {
      type: 'object',
      properties: {
        module_type: {
          type: 'string',
          description:
            'Optional. The module type slug, e.g. "seo", "foundation", "brand-audit". Omit to get pending items across all modules.',
        },
      },
    },
  },
  {
    name: 'get_ga_analytics',
    description:
      'Use this for WEBSITE traffic and marketing analytics questions — e.g. "how much traffic do I get?", "where are my visitors coming from?", "which pages get the most sessions?". Returns GA4 data: sessions, active users, new users, traffic channels (organic/paid/direct/social), top landing pages, and top pages by views. Do NOT use this for app user counts or product usage — use get_posthog_analytics for that. If GA4 is not connected, returns a message explaining how to connect it.',
    inputSchema: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          description: 'Date range: "7d", "30d", or "90d". Defaults to "30d".',
        },
      },
    },
  },
  {
    name: 'get_gsc_data',
    description:
      'Use this for SEARCH ENGINE and SEO questions — e.g. "what keywords am I ranking for?", "what is my average position?", "which queries have high impressions but low CTR?", "what pages get the most clicks from Google?". Returns Google Search Console data: top queries with clicks, impressions, CTR, and position, plus top pages by search clicks. Do NOT use this for website traffic or app usage — use get_ga_analytics or get_posthog_analytics for those. If GSC is not connected, returns a message explaining how to connect it.',
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: 'string',
          description: 'Number of days to look back: "7", "28", or "90". Defaults to "28".',
        },
        limit: {
          type: 'string',
          description: 'Max number of queries/pages to return. Defaults to "20".',
        },
      },
    },
  },
  {
    name: 'get_posthog_analytics',
    description:
      'Use this for APP and PRODUCT questions — e.g. "how many users do I have?", "what is my DAU/MAU?", "what features are people using?", "how many signups today?", "what events are firing most?". Returns PostHog data: DAU (daily active users), WAU (weekly), MAU (monthly), and top custom product events. Filters out internal PostHog system events (prefixed with $). This tracks real app users and in-app behaviour — NOT website visitors. Do NOT use this for website traffic or search rankings. If PostHog is not connected, returns a message explaining how to connect it.',
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: 'string',
          description: 'Number of days to look back for top events. Defaults to "30".',
        },
      },
    },
  },
  {
    name: 'get_posthog_users',
    description:
      'Returns a list of user emails who were active in the app within the specified number of days — e.g. "who are my daily active users?", "show me emails of users active today", "who signed up this week?". Returns email + last seen timestamp, sorted most recent first. Capped at 200 users. Use days=1 for daily users, days=7 for weekly, etc. Requires PostHog to be capturing user email as a person property.',
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: 'string',
          description: 'How far back to look in days. "1" = today, "7" = last 7 days. Defaults to "1".',
        },
        limit: {
          type: 'string',
          description: 'Max number of users to return. Defaults to "100", max 200.',
        },
      },
    },
  },
  {
    name: 'get_posthog_segments',
    description:
      'Use this for user growth and retention questions — e.g. "am I growing?", "how many new users did I get this week?", "what is my churn?", "how does this week compare to last week?", "how many power users do I have?". Returns: new users this week vs last week, week-over-week growth %, churned users (inactive 14+ days), power users (active 5+ days in last 7), total active last 30 days, growth trend label, and churn risk %. If PostHog is not connected, returns a message explaining how to connect it.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_keyword_trends',
    description:
      'Use this for SEO progress and keyword ranking questions — e.g. "are my keywords improving?", "which keywords moved up?", "what is my biggest ranking win?", "which keywords dropped?". Returns all tracked and implemented keywords with: current position, start position, position delta (positive = improved), trend label (improving/declining/stable), impressions, clicks, and a summary of wins vs drops. If no keywords are tracked yet, returns a message to set them up in the Keywords section.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_competitors',
    description:
      'Returns all known competitors for this brand — URL, name, type (direct/indirect/aspirational), market position, and primary strength. Also returns AI findings from the Competitor Analysis and Competitor Audit modules about what competitors are doing better. If no competitors exist yet, returns a message to run the Competitor Analysis module first.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_ga_conversions',
    description:
      'Use this for WEBSITE conversion questions — e.g. "which pages convert best?", "what channel drives the most conversions?", "what is my conversion rate?". Returns GA4 conversion data broken down by page (conversions + rate), by event name, and by traffic channel. For in-app conversion funnels or feature adoption, use get_posthog_analytics instead. If GA4 is not connected, returns a message explaining how to connect it.',
    inputSchema: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          description: 'Date range: "7d", "30d", or "90d". Defaults to "30d".',
        },
      },
    },
  },
  {
    name: 'get_posthog_power_users',
    description:
      'Use this when asked who the most engaged or most active users are — e.g. "who are my power users?", "who uses the app every day?", "show me my most active users". Returns emails of users who were active on 5 or more distinct days in the last 7 days, along with their active day count and last seen timestamp.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'string',
          description: 'Max number of users to return. Defaults to "100", max 200.',
        },
      },
    },
  },
  {
    name: 'get_posthog_churned_users',
    description:
      'Use this when asked who has stopped using the app — e.g. "who churned?", "who has gone quiet?", "show me inactive users", "who haven\'t I seen in 2 weeks?". Returns emails of users whose last activity was before the inactiveDays threshold, sorted by most recently churned first.',
    inputSchema: {
      type: 'object',
      properties: {
        inactive_days: {
          type: 'string',
          description: 'Number of days of inactivity to define churn. Defaults to "14".',
        },
        limit: {
          type: 'string',
          description: 'Max number of users to return. Defaults to "100", max 200.',
        },
      },
    },
  },
  {
    name: 'get_posthog_pro_users',
    description:
      'Use this when asked about paid, pro, or plan-based users — e.g. "who are my pro users?", "show me paid users", "how many users are on the pro plan?", "who upgraded?". Looks up users by a PostHog person property (default: plan=pro). You can specify a different property name and value to match any plan tier.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_property: {
          type: 'string',
          description: 'The PostHog person property name to filter on. Defaults to "plan".',
        },
        plan_value: {
          type: 'string',
          description: 'The value to match. Defaults to "pro". Use "free", "enterprise", etc. for other tiers.',
        },
        limit: {
          type: 'string',
          description: 'Max number of users to return. Defaults to "100", max 200.',
        },
      },
    },
  },
  {
    name: 'dataforseo',
    description:
      'Calls any DataForSEO v3 endpoint with GrowJin\'s account and returns DataForSEO\'s raw JSON response (no filtering). COSTS MONEY: every call is billed by DataForSEO (usually $0.002-$0.05 per task; the response\'s cost_usd says what it cost), so start with a small limit. Use only "live" endpoints if you want the results in the same call. Inputs: endpoint (the v3 path without /v3, e.g. "serp/google/organic/live/advanced", "serp/google/maps/live/advanced", "dataforseo_labs/google/competitors_domain/live", "dataforseo_labs/google/ranked_keywords/live", "domain_analytics/technologies/domain_technologies/live", "backlinks/backlinks/live"); payload (the task object as in the DataForSEO docs, e.g. { "keyword": "soy candles", "location_code": 2840, "language_code": "en" }, or an array of up to 10 tasks); limit (default 10, max 50; applied as "depth" on SERP endpoints and as "limit" on Labs, Backlinks, Domain Analytics and Business Listings endpoints, capping any value in the payload). Results are under response.tasks[].result. On failure returns error with DataForSEO\'s status message.',
    inputSchema: {
      type: 'object',
      properties: {
        endpoint: { type: 'string', description: 'DataForSEO v3 path, e.g. "serp/google/organic/live/advanced".' },
        payload: { type: 'object', description: 'The task object for that endpoint (or an array of up to 10 tasks), exactly as the DataForSEO API docs describe.' },
        limit: { type: 'number', description: 'Max results per task. Default 10, hard max 50.' },
      },
      required: ['endpoint', 'payload'],
    },
  },
  {
    name: 'hunter',
    description:
      'Calls Hunter.io with GrowJin\'s key and returns Hunter\'s raw JSON response. COSTS CREDITS (the account has few): domain-search costs 1 credit per email returned, email-finder 1 credit when it finds an email (a miss is free), email-verifier uses verification credits. Start with a small limit. Actions and params: "domain-search" { domain, optional: department (executive, it, finance, management, sales, legal, support, hr, marketing, communication, education, design, health, operations), seniority (junior, senior, executive), type (personal, generic), offset }: people and emails at a company, plus its email pattern and organization; "email-finder" { domain, first_name, last_name } (or full_name): one person\'s email with a confidence score; "email-verifier" { email }: whether the address is deliverable (status valid / invalid / accept_all / webmail / disposable / unknown). limit (default 10, max 50) sets domain-search\'s limit. On failure returns error with Hunter\'s message (HTTP 429 = credits used up).',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: '"domain-search", "email-finder" or "email-verifier".' },
        params: { type: 'object', description: 'Hunter query parameters for that action, e.g. { "domain": "example.com" } or { "domain": "example.com", "first_name": "Jane", "last_name": "Doe" } or { "email": "jane@example.com" }.' },
        limit: { type: 'number', description: 'domain-search only: max emails to return. Default 10, hard max 50.' },
      },
      required: ['action', 'params'],
    },
  },
  {
    name: 'apify',
    description: [
      'Runs an Apify actor with GrowJin\'s account and returns its raw dataset items (no filtering). COSTS MONEY: actors bill per result or per run (cost_usd in the answer shows what it cost; cost_cap_usd is the most this run may charge, set from limit and the actor\'s price), so start with limit 3-5.',
      'actor: one of the aliases below, or any Apify actor ID ("username~actor-name"). input: the actor\'s own input object (the field names below are the real ones from each actor\'s input schema). limit (default 10, max 50) is set as the actor\'s max-results field and as Apify\'s maxItems; for actors whose input is a URL list, the list is also cut to limit.',
      'Aliases:',
      '- "b2b_database": Pre-built B2B contact database (NOT live LinkedIn). Data may be years out of date; verify against live sources. People with title, company, website, LinkedIn URL and work email. Input e.g. { "personTitleIncludes": ["Founder"], "companyIndustryIncludes": ["Internet"], "personLocationCountryIncludes": ["United States"], "companySizeIncludes": ["1-10"] }. ("linkedin" still works as a deprecated name for this alias.)',
      '- "linkedin_company": live LinkedIn company pages: employee count, founded year, industry, website, HQ, followers. Input { "profileUrls": ["https://www.linkedin.com/company/stripe"] }.',
      '- "linkedin_people": people at a company matching a job title (name, headline, location, LinkedIn URL), found through Google results, never logs into LinkedIn. Input { "companyName": "Coacha", "jobTitle": "founder" } (maxResults is set from limit; Google SERP proxy is used by default).',
      '- "instagram": Instagram profiles (bio, followers, external link, latest posts). Input { "usernames": ["natgeo"] }.',
      '- "facebook": posts from Facebook pages. Input { "startUrls": [{ "url": "https://www.facebook.com/somepage" }] }.',
      '- "meta_ads": ads a business runs on Facebook / Instagram, from the Meta Ad Library. Input { "urls": [{ "url": "https://www.facebook.com/somepage" }] } (Facebook page URLs or Ad Library search URLs; plain strings are fine), optional "scrapePageAds.activeStatus": "all" | "active" | "inactive", "scrapePageAds.period": "last24h" | "last7d" | "last14d" | "last30d", "scrapePageAds.countryCode": "US". If this actor fails, apify~facebook-ads-scraper runs instead (actor_used and fallback_from say so).',
      '- "producthunt": Product Hunt launches from leaderboards, topic / category pages or Product Hunt URLs, with product name, description, website, makers (name + links) and public emails where available. Third-party scraper, for evaluation. Move to the official Product Hunt API once commercial permission is granted. Main use, launches for a date or period: { "target": "daily", "startDate": "2026-10-28" } (add "endDate" for a range; or "target": "weekly" with "startWeek": "2026-43", "monthly" with "startMonth": "2026-10"). Or a topic: { "target": "topic", "topicSlugs": ["productivity"] } (one target per run: dates and topics can\'t be combined). Optional: "minUpvotes": 10, "sortBy": "ranking" | "newest" | "votes". Public emails are looked for by default (costs extra per product with an email); set "shouldCollectProductDetailsAndEmails": false to skip them. Only if that run fails, runtime~producthunt-scraper runs instead (actor_used says so): daily leaderboards only, with makers, hunters, websites, social links, upvotes, rankings and lead signals.',
      'Waits up to about 45 seconds: if the run finished it returns { run_id, status: "SUCCEEDED", actor_used, cost_usd, total, items }; if not it returns { run_id, status: "RUNNING" } — call this tool again with only { run_id } to get the results. On failure returns error with Apify\'s message.',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        actor: { type: 'string', description: 'An alias ("b2b_database", "linkedin_company", "linkedin_people", "instagram", "facebook", "meta_ads", "producthunt") or an Apify actor ID such as "apify~google-search-scraper". Not needed when passing run_id.' },
        input: { type: 'object', description: 'The actor\'s input object, with the field names shown for each alias in this tool\'s description.' },
        limit: { type: 'number', description: 'Max results. Default 10, hard max 50.' },
        run_id: { type: 'string', description: 'To fetch an earlier run that was still RUNNING: its run_id. Leave actor and input out.' },
      },
    },
  },
  {
    name: 'get_lead_settings',
    description:
      'Who the user wants as leads, as saved in GrowJin\'s Lead Finder: brand (name, website, what it sells, competitors to never contact), the Lead Finder brief and filters (industry, location, company size, who to contact, leads per search), the ideal-customer card (kind of business, who, how they market, kinds of business to search, good fit / not a fit, example customers), sending settings, how many leads are on the board by status, already_known (domains already on the board, so you don\'t spend on them again) and the last search. Call this FIRST when the user asks you to find leads, then search with dataforseo / hunter / apify, check people with check_contacts, and add the good ones with save_leads. include_playbook: true also returns GrowJin\'s Lead Engine instructions (the step-by-step method and rating scale the app\'s own search follows); use them when finding leads so results match the app.',
    inputSchema: {
      type: 'object',
      properties: {
        include_playbook: { type: 'boolean', description: 'true to also get the Lead Engine instructions (long). Use when you are about to search for leads.' },
      },
    },
  },
  {
    name: 'check_contacts',
    description:
      'Checks people or companies against GrowJin before you contact or save them: for each email or domain says new, already_a_lead (on the Lead Finder board, any status, including ones the user skipped), emailed / scheduled (GrowJin sent or will send them an email in the last 2 years: when and the subject), opted_out (asked not to be emailed) or bounced. A domain matches any address at that domain. Only contact or save "new" ones unless the user says otherwise. Up to 200 emails and 200 domains per call. Free.',
    inputSchema: {
      type: 'object',
      properties: {
        emails: { type: 'array', items: { type: 'string' }, description: 'Email addresses to check.' },
        domains: { type: 'array', items: { type: 'string' }, description: 'Company domains or website URLs to check, e.g. "bloomsalon.com".' },
      },
    },
  },
  {
    name: 'save_leads',
    description:
      'Adds leads you found to the user\'s Lead Finder board in GrowJin (Contact directly tab), where they open each one, GrowJin writes the email (or an Instagram / Facebook message when there is no email), and once they approve it GrowJin sends it from their Gmail within the daily limit, with follow-ups that stop when they reply. Repeats, people already emailed and opted out are left out (returned under skipped). Leads rated below Neutral go to "Checked but not kept" (kept_aside). Up to 50 per call. Each lead: company, website, what_it_does (≤ 6 words), location, company_size (≤ 4 words), contact_name, contact_title, email, email_status (verified, found, guessed, generic or none), linkedin, socials ([{ platform, url, activity }], activity ≤ 6 words, e.g. "last post 3 months ago"), signals (object, up to 3 short facts), rating (Very Likely, Likely, Leaning Likely, Uncertain (High), Neutral, Uncertain (Low), Leaning Unlikely, Unlikely, Very Unlikely), why (≤ 15 words, why they would buy), sources ({ discovered_via: "how you found them, a few words" }), not_checked (short nouns). Keep the text short: users find long lead text hard to read. Do not draft the email here; GrowJin writes it when the user opens the lead. Only save when the user asks you to (e.g. "add them to GrowJin").',
    inputSchema: {
      type: 'object',
      properties: {
        leads: { type: 'array', items: { type: 'object' }, description: 'The leads, in the format above.' },
        dropped: { type: 'array', items: { type: 'object' }, description: 'Optional. Companies you checked and rejected: [{ company, reason }]. Shown under "Checked but not kept".' },
      },
      required: ['leads'],
    },
  },
  {
    name: 'gmail_status',
    description:
      'Whether the user\'s Gmail is connected to GrowJin and Claude may send from it: connected, address (the Gmail address emails go from), can_send (connected with send permission), sending_allowed (the user switched on "Let Claude send email" in GrowJin Settings → Connect Claude), daily_limit, sent_today, left_today, ready_to_send, and problem (what to tell the user when something is missing). Call before send_email, and when the user asks whether email is set up.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'send_email',
    description:
      'Sends email from the user\'s connected Gmail through GrowJin. Works only when gmail_status says ready_to_send (Gmail connected with send permission AND the user switched on "Let Claude send email" in GrowJin Settings); otherwise nothing is sent and the answer says what is missing. ALWAYS show the user the exact recipient, subject and body first and send only after they say yes in this conversation. Never send to addresses check_contacts reports as opted_out or bounced (GrowJin refuses those anyway); check new people with check_contacts first. One email (to, subject, body) or several with emails (up to 20; within the daily limit). body: plain text (blank line = new paragraph) or simple HTML. To reply in a thread give thread_id (and in_reply_to, the Message-ID header) and the same subject. follow_up_days (optional) adds a follow-up reminder in GrowJin. A first email to someone already on the Lead Finder board is sent as that lead (an opt-out line is added; its automatic follow-ups and reply check take over). Sent emails show in Email Outreach and count as contacted. Returns per email sent / not_sent with the reason, and thread_id.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient: "jane@example.com" or "Jane Doe <jane@example.com>".' },
        subject: { type: 'string', description: 'Subject line.' },
        body: { type: 'string', description: 'The email: plain text or simple HTML.' },
        thread_id: { type: 'string', description: 'Optional. Gmail thread id, to reply in that thread.' },
        in_reply_to: { type: 'string', description: 'Optional. The Message-ID header of the email being replied to.' },
        follow_up_days: { type: 'number', description: 'Optional. Add a GrowJin reminder to follow up after this many days.' },
        emails: { type: 'array', items: { type: 'object' }, description: 'Optional. Several emails at once, each { to, subject, body, thread_id?, in_reply_to?, follow_up_days? } (up to 20). Leave the top-level fields out when using this.' },
      },
    },
  },
  {
    name: 'log_work',
    description:
      'Saves growth work the user did OUTSIDE GrowJin (blogs published, posts that need indexing, community posts and replies, leads or people emailed, directory listings, social posts…) to their work log, so they can ask for it later. Call it when the user tells you they did something and wants it kept ("log this", "save that I posted…", "I sent these leads"); do not log on your own. Log one entry with the fields directly, or many at once with entries (up to 100, e.g. a list of blog URLs). Each entry: kind (blog, community, outreach, listing, social or other; another short word is fine), title (what was done, e.g. "Published: 10 Instagram caption ideas for bakeries", "Replied on r/smallbusiness about scheduling posts", "Emailed Bloom Salon"), url (the blog post, the thread, the person\'s site or email), done_on (YYYY-MM-DD, default today), how (one line on how it was done, e.g. "wrote by hand, posted from Webflow", "sent from my Gmail"), status (done, waiting or follow_up; default done), next_check (YYYY-MM-DD to check on it again, e.g. indexing or a follow-up), notes. Ask for a missing title only if there is no url either; fill the rest from what the user said and leave unknown fields out. An entry whose url is already logged is not added again (returned under already_logged). Returns the saved entries with their ids. Confirm briefly what was saved.',
    inputSchema: {
      type: 'object',
      properties: {
        entries: { type: 'array', description: 'Several entries at once, each an object with the fields below. Leave out to log one entry from the top-level fields.' },
        kind: { type: 'string', description: 'blog, community, outreach, listing, social or other.' },
        title: { type: 'string', description: 'What was done, in a few words.' },
        url: { type: 'string', description: 'Optional. Link to the result, or the person\'s email / site for outreach.' },
        done_on: { type: 'string', description: 'Optional. YYYY-MM-DD. Defaults to today.' },
        how: { type: 'string', description: 'Optional. One line on how it was done.' },
        status: { type: 'string', description: 'Optional. done (default), waiting (e.g. waiting to be indexed or for a reply) or follow_up.' },
        next_check: { type: 'string', description: 'Optional. YYYY-MM-DD to check on it again.' },
        notes: { type: 'string', description: 'Optional. Anything else worth keeping.' },
      },
    },
  },
  {
    name: 'list_work',
    description:
      'Shows the user\'s work log: growth work they did outside GrowJin and asked you to save with log_work. Use when they ask what they did ("what blogs did I publish this month?", "which posts still need indexing?", "who did I email last week?", "what is due for a follow-up?"). Filters: kind, status, from / to (YYYY-MM-DD on done_on), search (text in title, url, how or notes), due=true (not done and next_check is today or earlier). Returns total, counts by kind and status, and the entries newest first (limit default 50, max 500). To check whether logged blog posts are indexed, list them and then use get_gsc_data.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'Optional. blog, community, outreach, listing, social or other.' },
        status: { type: 'string', description: 'Optional. done, waiting or follow_up.' },
        from: { type: 'string', description: 'Optional. YYYY-MM-DD, earliest done_on.' },
        to: { type: 'string', description: 'Optional. YYYY-MM-DD, latest done_on.' },
        search: { type: 'string', description: 'Optional. Text to look for in title, url, how or notes.' },
        due: { type: 'boolean', description: 'Optional. true = only entries not done whose next_check is today or earlier.' },
        limit: { type: 'number', description: 'Optional. Max entries. Default 50, max 500.' },
      },
    },
  },
  {
    name: 'update_work',
    description:
      'Changes one entry in the user\'s work log (from list_work or log_work), e.g. mark a blog post as indexed (status done, add_note "indexed"), record a reply, or set a new next_check. Pass only the fields to change; add_note adds a dated line to the notes instead of replacing them. Pass url, how, next_check or notes as an empty string to clear them.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The entry id.' },
        kind: { type: 'string', description: 'Optional. New kind.' },
        title: { type: 'string', description: 'Optional. New title.' },
        url: { type: 'string', description: 'Optional. New url.' },
        done_on: { type: 'string', description: 'Optional. YYYY-MM-DD.' },
        how: { type: 'string', description: 'Optional. New how line.' },
        status: { type: 'string', description: 'Optional. done, waiting or follow_up.' },
        next_check: { type: 'string', description: 'Optional. YYYY-MM-DD, or empty to clear.' },
        notes: { type: 'string', description: 'Optional. Replaces the notes.' },
        add_note: { type: 'string', description: 'Optional. Adds a dated line to the notes.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_work',
    description: 'Removes one entry from the user\'s work log, e.g. one logged by mistake. Only when the user asks.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The entry id.' },
      },
      required: ['id'],
    },
  },
]
