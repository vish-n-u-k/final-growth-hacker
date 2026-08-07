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
      'Returns all checklist items for a specific module, grouped by category. Each item includes AI findings (detail, narrative, action) and completion status.',
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
      'Returns all incomplete checklist items — not yet verified by AI and not manually checked. Sorted by priority (critical first). If module_type is provided, scoped to that module only. If omitted, returns pending items across all non-locked modules.',
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
      'Returns live Google Analytics (GA4) data — sessions, users, traffic channels, top landing pages, and top pages. If GA4 is not connected, returns a message explaining how to connect it.',
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
      'Returns live Google Search Console data — top search queries with clicks, impressions, CTR, and position, plus top-performing pages. If GSC is not connected, returns a message explaining how to connect it.',
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
      'Returns live PostHog product analytics — DAU, WAU, MAU, and top custom events. Filters out internal PostHog events (prefixed with $). If PostHog is not connected, returns a message explaining how to connect it.',
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
      'Returns GA4 conversion data broken down three ways: by page (which pages drive conversions + conversion rate), by event name (which conversion events fire most), and by traffic channel (which channels convert best). If GA4 is not connected, returns a message explaining how to connect it.',
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
