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
    name: 'get_brand_info',
    description:
      'Returns the brand profile including name, website URL, industry, target audience, USP, and the executive summary from the sales playbook.',
    inputSchema: {
      type: 'object',
      properties: {},
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
]
