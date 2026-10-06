// ── Minimal client for Frekto's MCP server ───────────────────────────────────
// Frekto's REST API can't schedule an already-rendered post; only its MCP server
// (schedule_post) can. This calls it server-side with the brand's Frekto API key.
// Frekto MCP access requires the Agency plan.

const FREKTO_MCP_URL = 'https://mcp.frekto.ai/mcp'

type McpResult = { ok: true; text: string } | { ok: false; status?: number; error: string }

// Streamable HTTP replies are either plain JSON or an SSE stream of "data:" lines
async function readRpc(res: Response, id: number): Promise<Record<string, unknown> | null> {
  const body = await res.text()
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    for (const line of body.split('\n')) {
      if (!line.startsWith('data:')) continue
      try {
        const msg = JSON.parse(line.slice(5).trim()) as Record<string, unknown>
        if (msg.id === id) return msg
      } catch { /* skip non-JSON lines */ }
    }
    return null
  }
  try { return JSON.parse(body) as Record<string, unknown> } catch { return null }
}

export async function callFrektoMcpTool(apiKey: string, name: string, args: Record<string, unknown>): Promise<McpResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${apiKey}`,
  }
  const post = (payload: unknown, extra: Record<string, string> = {}) =>
    fetch(FREKTO_MCP_URL, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) })

  try {
    const init = await post({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'growjin', version: '1.0.0' } },
    })
    if (!init.ok) {
      return { ok: false, status: init.status, error: init.status === 401 || init.status === 403
        ? 'Frekto refused the connection. Frekto MCP scheduling needs the Agency plan and a valid API key.'
        : `Frekto MCP returned ${init.status}` }
    }
    await readRpc(init, 1)
    const session = init.headers.get('mcp-session-id')
    const sessionHeader: Record<string, string> = session ? { 'Mcp-Session-Id': session } : {}

    await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, sessionHeader).catch(() => null)

    const call = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }, sessionHeader)
    if (!call.ok) return { ok: false, status: call.status, error: `Frekto MCP returned ${call.status}` }

    const msg = await readRpc(call, 2)
    if (!msg) return { ok: false, error: 'Frekto MCP sent an unreadable response' }
    if (msg.error) return { ok: false, error: (msg.error as { message?: string }).message ?? 'Frekto MCP error' }

    const result = msg.result as { content?: { type: string; text?: string }[]; isError?: boolean } | undefined
    const text = (result?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n')
    return result?.isError ? { ok: false, error: text || 'Frekto could not schedule the post' } : { ok: true, text }
  } catch (e) {
    return { ok: false, error: `Could not reach Frekto MCP: ${e instanceof Error ? e.message : String(e)}` }
  }
}
