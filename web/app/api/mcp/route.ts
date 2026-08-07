import { resolveBrandFromToken } from '@/lib/mcp/auth'
import { TOOLS } from '@/lib/mcp/tool-registry'
import { getGrowthOverview } from '@/lib/mcp/tools/get_growth_overview'
import { getModuleDetail } from '@/lib/mcp/tools/get_module_detail'
import { analyzeModule } from '@/lib/mcp/tools/analyze_module'
import { toggleItem } from '@/lib/mcp/tools/toggle_item'
import { getBrandInfo } from '@/lib/mcp/tools/get_brand_info'
import { getPendingItems } from '@/lib/mcp/tools/get_pending_items'
import { getGaAnalytics } from '@/lib/mcp/tools/get_ga_analytics'
import { getGscData } from '@/lib/mcp/tools/get_gsc_data'
import { getPosthogAnalytics } from '@/lib/mcp/tools/get_posthog_analytics'
import { getCompetitors } from '@/lib/mcp/tools/get_competitors'
import { getGaConversions } from '@/lib/mcp/tools/get_ga_conversions'
import { getPosthogSegments } from '@/lib/mcp/tools/get_posthog_segments'
import { getKeywordTrends } from '@/lib/mcp/tools/get_keyword_trends'

export const maxDuration = 300

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'MCP-Protocol-Version': '2024-11-05',
}

const INITIALIZE_RESPONSE = {
  protocolVersion: '2024-11-05',
  capabilities: { tools: {} },
  serverInfo: { name: 'growjin', version: '1.0.0' },
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

    case 'get_brand_info':
      return getBrandInfo(brandId)

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

    case 'get_posthog_segments':
      return getPosthogSegments(brandId)

    case 'get_keyword_trends':
      return getKeywordTrends(brandId)

    case 'get_competitors':
      return getCompetitors(brandId)

    case 'get_ga_conversions':
      return getGaConversions(brandId, args['period'] ? String(args['period']) : '30d')

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

  if (method === 'tools/call') {
    const toolName = String(params['name'] ?? '')
    const toolArgs = (params['arguments'] ?? {}) as Record<string, unknown>

    let result: unknown
    try {
      result = await dispatch(toolName, toolArgs, brandId)
    } catch (err) {
      return rpcError(id, -32603, err instanceof Error ? err.message : 'Internal error')
    }

    return rpcResult(id, {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    })
  }

  return rpcError(id, -32601, `Method not found: ${method}`)
}
