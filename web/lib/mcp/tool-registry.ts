export interface MCPTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, { type: string; description: string }>
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
      'Marks a checklist item as checked or unchecked (user self-reported completion). Does not affect AI verification.',
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
      },
      required: ['item_id', 'checked'],
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
      'Closes an alert or play (a kind="alert" or kind="play" task from get_today_tasks) once it has been handled. Use status="done" when the issue was fixed, or "dismissed" when the user says it does not apply. A closed signal will not be raised again for 7 days.',
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
]
