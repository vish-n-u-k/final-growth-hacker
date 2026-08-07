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
]
