import { resolveBrandFromToken } from '@/lib/mcp/auth'
import { TOOLS } from '@/lib/mcp/tool-registry'
import { getTodayTasks, buildTodayPrompt } from '@/lib/daily/today-tasks'
import { logActivity, touchMcp } from '@/lib/activity'
import { dispatch } from '@/lib/mcp/dispatch'

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


// Usage tracking: which tools Claude calls, and tasks completed from Claude.
// Logs the tool name only — never arguments or results.
async function logToolCall(brandId: string, tool: string, args: Record<string, unknown>, result: unknown) {
  const ok = !(result && typeof result === 'object' && 'error' in result)
  const writes: Promise<unknown>[] = [logActivity(brandId, 'mcp_call', { tool, ok }), touchMcp(brandId)]
  if (ok) {
    const completed =
      tool === 'toggle_item' && Boolean(args['checked']) ? { kind: 'item', status: 'done' } :
      tool === 'skip_item' ? { kind: 'item', status: 'dismissed' } :
      tool === 'resolve_signal' ? { kind: 'signal', status: args['status'] === 'dismissed' ? 'dismissed' : 'done' } :
      null
    if (completed) writes.push(logActivity(brandId, 'task_completed', { ...completed, via: 'claude' }))
  }
  await Promise.all(writes)
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
    await Promise.all([logActivity(brandId, 'mcp_session'), touchMcp(brandId)])
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
    await logToolCall(brandId, toolName, toolArgs, result)

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
