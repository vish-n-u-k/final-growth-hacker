import { resolveBrandFromToken } from '@/lib/mcp/auth'
import { TOOLS } from '@/lib/mcp/tool-registry'
import { getGrowthOverview } from '@/lib/mcp/tools/get_growth_overview'
import { getModuleDetail } from '@/lib/mcp/tools/get_module_detail'
import { analyzeModule } from '@/lib/mcp/tools/analyze_module'
import { toggleItem } from '@/lib/mcp/tools/toggle_item'
import { skipItem } from '@/lib/mcp/tools/skip_item'
import { getBrandInfo } from '@/lib/mcp/tools/get_brand_info'
import { getPendingItems } from '@/lib/mcp/tools/get_pending_items'
import { getGaAnalytics } from '@/lib/mcp/tools/get_ga_analytics'
import { getGscData } from '@/lib/mcp/tools/get_gsc_data'
import { getPosthogAnalytics } from '@/lib/mcp/tools/get_posthog_analytics'
import { getCompetitors } from '@/lib/mcp/tools/get_competitors'
import { getGaConversions } from '@/lib/mcp/tools/get_ga_conversions'
import { getPosthogSegments } from '@/lib/mcp/tools/get_posthog_segments'
import { getKeywordTrends } from '@/lib/mcp/tools/get_keyword_trends'
import { getPosthogUsers } from '@/lib/mcp/tools/get_posthog_users'
import { getPosthogPowerUsers } from '@/lib/mcp/tools/get_posthog_power_users'
import { getPosthogChurnedUsers } from '@/lib/mcp/tools/get_posthog_churned_users'
import { getPosthogProUsers } from '@/lib/mcp/tools/get_posthog_pro_users'
import { getTodayTasks, buildTodayPrompt } from '@/lib/daily/today-tasks'
import { resolveSignal } from '@/lib/signals'
import { createSocialPost, getSocialPostStatus, scheduleSocialPost } from '@/lib/frekto/posts'

export const maxDuration = 300

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'MCP-Protocol-Version': '2024-11-05',
}

const INITIALIZE_RESPONSE = {
  protocolVersion: '2024-11-05',
  capabilities: { tools: {}, prompts: {} },
  serverInfo: { name: 'growjin', version: '1.0.0' },
}

const DAILY_PROMPT = {
  name: 'daily_growth_tasks',
  description: "Work through today's GrowJin growth tasks (code fixes, content, manual steps).",
  arguments: [],
}

function rpcResult(id: unknown, result: unknown) {
  return Response.json(
    { jsonrpc: '2.0', id, result },
    { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
  )
}

function rpcError(id: unknown, code: number, message: string, httpStatus = 200) {
  return Response.json(
    { jsonrpc: '2.0', id, error: { code, message } },
    { status: httpStatus, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
  )
}

async function dispatch(
  name: string,
  args: Record<string, unknown>,
  brandId: string,
): Promise<unknown> {
  switch (name) {
    case 'get_growth_overview':
      return getGrowthOverview(brandId)

    case 'get_module_detail':
      return getModuleDetail(brandId, String(args['module_type'] ?? ''))

    case 'analyze_module':
      return analyzeModule(brandId, String(args['module_type'] ?? ''))

    case 'toggle_item':
      return toggleItem(brandId, String(args['item_id'] ?? ''), Boolean(args['checked']))

    case 'skip_item':
      return skipItem(brandId, String(args['item_id'] ?? ''), args['reason'] ? String(args['reason']) : undefined)

    case 'get_brand_info':
      return getBrandInfo(brandId)

    case 'get_today_tasks': {
      const limit = Math.min(Math.max(parseInt(String(args['limit'] ?? '3'), 10) || 3, 1), 10)
      const today = await getTodayTasks(brandId, limit)
      if (!today) return { error: 'Brand not found.' }
      if (today.tasks.length === 0) return { ...today, message: 'Nothing pending today. Suggest re-running analyze_module on SEO or GEO to find new work.' }
      return today
    }

    case 'create_social_post':
      return createSocialPost(brandId, {
        topic: args['topic'] ? String(args['topic']) : undefined,
        platform: args['platform'] ? String(args['platform']).toLowerCase() : undefined,
        postType: args['post_type'] ? String(args['post_type']).toLowerCase() : undefined,
      })

    case 'get_social_post_status':
      return getSocialPostStatus(brandId, String(args['job_id'] ?? ''))

    case 'schedule_social_post':
      return scheduleSocialPost(brandId, {
        jobId: String(args['job_id'] ?? ''),
        topic: args['topic'] ? String(args['topic']) : undefined,
        platform: args['platform'] ? String(args['platform']).toLowerCase() : undefined,
        postType: args['post_type'] ? String(args['post_type']).toLowerCase() : undefined,
        postNow: args['post_now'] === true || args['post_now'] === 'true',
        startDate: args['start_date'] ? String(args['start_date']) : undefined,
        time: args['time'] ? String(args['time']) : undefined,
        timezone: args['timezone'] ? String(args['timezone']) : undefined,
        allowRegenerate: args['allow_regenerate'] === true || args['allow_regenerate'] === 'true',
      })

    case 'resolve_signal':
      return resolveSignal(
        brandId,
        String(args['signal_id'] ?? ''),
        args['status'] === 'dismissed' ? 'dismissed' : 'done',
      )

    case 'get_pending_items':
      return getPendingItems(brandId, args['module_type'] ? String(args['module_type']) : undefined)

    case 'get_ga_analytics':
      return getGaAnalytics(brandId, args['period'] ? String(args['period']) : '30d')

    case 'get_gsc_data':
      return getGscData(
        brandId,
        args['days'] ? parseInt(String(args['days']), 10) : 28,
        args['limit'] ? parseInt(String(args['limit']), 10) : 20,
      )

    case 'get_posthog_analytics':
      return getPosthogAnalytics(brandId, args['days'] ? parseInt(String(args['days']), 10) : 30)

    case 'get_posthog_users':
      return getPosthogUsers(
        brandId,
        args['days'] ? parseInt(String(args['days']), 10) : 1,
        args['limit'] ? parseInt(String(args['limit']), 10) : 100,
      )

    case 'get_posthog_segments':
      return getPosthogSegments(brandId)

    case 'get_keyword_trends':
      return getKeywordTrends(brandId)

    case 'get_competitors':
      return getCompetitors(brandId)

    case 'get_ga_conversions':
      return getGaConversions(brandId, args['period'] ? String(args['period']) : '30d')

    case 'get_posthog_power_users':
      return getPosthogPowerUsers(
        brandId,
        args['limit'] ? parseInt(String(args['limit']), 10) : 100,
      )

    case 'get_posthog_churned_users':
      return getPosthogChurnedUsers(
        brandId,
        args['inactive_days'] ? parseInt(String(args['inactive_days']), 10) : 14,
        args['limit'] ? parseInt(String(args['limit']), 10) : 100,
      )

    case 'get_posthog_pro_users':
      return getPosthogProUsers(
        brandId,
        args['plan_property'] ? String(args['plan_property']) : 'plan',
        args['plan_value'] ? String(args['plan_value']) : 'pro',
        args['limit'] ? parseInt(String(args['limit']), 10) : 100,
      )

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request: Request) {
  // Auth
  const auth = await resolveBrandFromToken(request)
  if ('error' in auth) {
    return rpcError(null, -32001, auth.error, auth.status)
  }
  const { brandId } = auth

  // Parse JSON-RPC body
  let body: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> }
  try {
    body = await request.json()
  } catch {
    return rpcError(null, -32700, 'Parse error')
  }

  const { id = null, method, params = {} } = body

  if (!method) return rpcError(id, -32600, 'Invalid request — missing method')

  // Route by method
  if (method === 'initialize') {
    return rpcResult(id, INITIALIZE_RESPONSE)
  }

  if (method === 'tools/list') {
    return rpcResult(id, { tools: TOOLS })
  }

  if (method === 'prompts/list') {
    return rpcResult(id, { prompts: [DAILY_PROMPT] })
  }

  if (method === 'prompts/get') {
    if (params['name'] !== DAILY_PROMPT.name) return rpcError(id, -32602, `Unknown prompt: ${String(params['name'])}`)
    const today = await getTodayTasks(brandId)
    if (!today) return rpcError(id, -32603, 'Brand not found')
    return rpcResult(id, {
      description: DAILY_PROMPT.description,
      messages: [{ role: 'user', content: { type: 'text', text: buildTodayPrompt(today) } }],
    })
  }

  if (method === 'tools/call') {
    const toolName = String(params['name'] ?? '')
    const toolArgs = (params['arguments'] ?? {}) as Record<string, unknown>

    let result: unknown
    try {
      result = await dispatch(toolName, toolArgs, brandId)
    } catch (err) {
      return rpcError(id, -32603, err instanceof Error ? err.message : 'Internal error')
    }

    // Tools may attach an inline preview image as _image; send it as MCP image content
    const content: Record<string, unknown>[] = []
    if (result && typeof result === 'object' && '_image' in result) {
      const { _image, ...rest } = result as { _image?: { data: string; mimeType: string } }
      result = rest
      if (_image) content.push({ type: 'image', data: _image.data, mimeType: _image.mimeType })
    }
    content.unshift({ type: 'text', text: JSON.stringify(result, null, 2) })

    return rpcResult(id, { content })
  }

  return rpcError(id, -32601, `Method not found: ${method}`)
}
