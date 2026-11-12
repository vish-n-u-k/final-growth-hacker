import { dispatch } from '@/lib/mcp/dispatch'

// Ask reads and does everything through the MCP tools (lib/mcp/tool-registry.ts), the same ones
// Claude uses in a conversation. One way in, so a fix to a tool fixes Ask too.

/** Tools the Ask page may call from the browser (POST /api/ask/tool). Everything else stays server-side. */
export const UI_TOOLS = [
  'list_leads', 'list_replies', 'get_lead_settings', 'check_contacts', 'save_leads',
  'gmail_status', 'send_email', 'get_search_agent', 'get_blog_post', 'mark_blog_published',
  'list_work', 'log_work', 'update_work', 'get_brand_info',
] as const

/** Runs one tool for the brand, as Ask (a send is the person's own click). Errors come back as { error }. */
export async function askTool<T = Record<string, unknown>>(brandId: string, name: string, args: Record<string, unknown> = {}): Promise<T & { error?: string }> {
  try {
    return (await dispatch(name, args, brandId, { via: 'ask' })) as T & { error?: string }
  } catch (e) {
    console.error(`[ask] tool ${name} failed`, e)
    return { error: e instanceof Error ? e.message : 'That didn’t work.' } as T & { error?: string }
  }
}
