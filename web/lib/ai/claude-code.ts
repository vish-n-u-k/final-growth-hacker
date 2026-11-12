// Ask's AI through Claude Code instead of the API. Same switch as module runs: run the app with
// USE_CLAUDE_CLI=true (on a computer where the `claude` CLI is signed in) and the admin queue's Run
// uses your Claude Code plan, not API credit.
//
// Ask's questions, website reviews and lead searches are tool loops written against the Messages
// API (client.messages.create). claudeCodeCreate() stands in for one such call: it sends the system
// prompt, the conversation so far and the tool list to `claude -p` (its own tools switched off), asks
// for a JSON reply of { text, tool_calls } (checked with --json-schema), and turns that back into a
// Message with tool_use blocks. The loops then run the tools and carry on exactly as with the API,
// so their caps, number checks and saving don't change.

import Anthropic from '@anthropic-ai/sdk'
import { logAIUsage } from './client'

export const viaClaudeCode = () => process.env.USE_CLAUDE_CLI === 'true'

const TIMEOUT_MS = 600_000

type Params = Anthropic.MessageCreateParamsNonStreaming

/** client.messages.create, or Claude Code when USE_CLAUDE_CLI=true. */
export function createMessage(p: Params): Promise<Anthropic.Message> {
  return viaClaudeCode() ? claudeCodeCreate(p) : new Anthropic().messages.create(p)
}

const textOf = (c: string | Anthropic.ContentBlockParam[] | Anthropic.ToolResultBlockParam['content']): string => {
  if (typeof c === 'string') return c
  if (!Array.isArray(c)) return ''
  return c.map(b => ('text' in b && typeof b.text === 'string' ? b.text : '')).filter(Boolean).join('\n')
}

/** The conversation as text: what was said, which tools were called, what came back. */
function transcript(messages: Anthropic.MessageParam[]): string {
  const names = new Map<string, string>()
  const out: string[] = []
  for (const m of messages) {
    if (typeof m.content === 'string') { out.push(`${m.role === 'user' ? 'USER' : 'YOU'}:\n${m.content}`); continue }
    const parts: string[] = []
    for (const b of m.content) {
      if (b.type === 'text') parts.push(b.text)
      else if (b.type === 'tool_use') { names.set(b.id, b.name); parts.push(`[you called ${b.name} (id ${b.id}) with ${JSON.stringify(b.input)}]`) }
      else if (b.type === 'tool_result') parts.push(`[result of ${names.get(b.tool_use_id) ?? 'tool'} (id ${b.tool_use_id})${b.is_error ? ', an error' : ''}]:\n${textOf(b.content ?? '')}`)
    }
    if (parts.length) out.push(`${m.role === 'user' ? 'USER' : 'YOU'}:\n${parts.join('\n')}`)
  }
  return out.join('\n\n')
}

function systemText(s: Params['system']): string {
  if (!s) return ''
  return typeof s === 'string' ? s : s.map(b => b.text).join('\n\n')
}

/** One Messages API turn, answered by Claude Code. */
export async function claudeCodeCreate(p: Params): Promise<Anthropic.Message> {
  const tools = (p.tools ?? []).filter((t): t is Anthropic.Tool => 'input_schema' in t)
  const choice = p.tool_choice
  const forced = choice?.type === 'tool' ? choice.name : null
  const none = choice?.type === 'none' || !tools.length
  const names = forced ? [forced] : tools.map(t => t.name)

  const toolList = tools.map(t => `- ${t.name}: ${t.description ?? ''}\n  input schema: ${JSON.stringify(t.input_schema)}`).join('\n')
  const system = [
    systemText(p.system),
    '',
    '── How to reply in this session ──',
    'You cannot run tools yourself here. The app runs them for you and shows you the results in the next USER turn.',
    none
      ? 'No tools this turn: put your whole reply in "text" and leave "tool_calls" empty.'
      : `To use tools, list them in "tool_calls" (several at once is fine), each with "name" and an "input" that follows its schema. ${forced ? `This turn you must call ${forced}.` : 'Put any words for the user in "text".'}`,
    ...(none ? [] : ['', 'Tools:', toolList]),
  ].join('\n')

  const schema = {
    type: 'object',
    properties: {
      text: { type: 'string' },
      tool_calls: {
        type: 'array',
        ...(none ? { maxItems: 0 } : forced ? { minItems: 1 } : {}),
        items: { type: 'object', properties: { name: { type: 'string', enum: names.length ? names : ['none'] }, input: { type: 'object' } }, required: ['name', 'input'] },
      },
    },
    required: ['text', 'tool_calls'],
  }

  const model = p.model.includes('opus') ? 'opus' : p.model.includes('haiku') ? 'haiku' : 'sonnet'
  const out = await runCli(system, `${transcript(p.messages)}\n\nYour turn: reply as the JSON object.`, model, JSON.stringify(schema))
  const s = (out.structured ?? {}) as { text?: string; tool_calls?: { name?: string; input?: Record<string, unknown> }[] }
  const calls = (Array.isArray(s.tool_calls) ? s.tool_calls : []).filter(c => c?.name && names.includes(c.name) && !none)
  const content: Anthropic.ContentBlock[] = []
  if (s.text?.trim()) content.push({ type: 'text', text: s.text, citations: null } as Anthropic.TextBlock)
  for (const c of calls) content.push({ type: 'tool_use', id: `toolu_cc_${Math.random().toString(36).slice(2, 12)}`, name: c.name!, input: c.input ?? {} } as Anthropic.ToolUseBlock)

  // Usage is left at zero: Claude Code runs on the plan, so the loops' dollar caps shouldn't count it.
  // What Claude Code reports is logged on its own (provider 'cli').
  return {
    id: `msg_cc_${Date.now()}`, type: 'message', role: 'assistant', model: p.model, content,
    stop_reason: calls.length ? 'tool_use' : 'end_turn', stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Anthropic.Message
}

async function runCli(system: string, input: string, model: string, schema: string): Promise<{ structured: unknown }> {
  const { spawn } = await import('child_process')
  const { writeFile, rm, mkdtemp } = await import('fs/promises')
  const { tmpdir } = await import('os')
  const path = await import('path')
  // The system prompt goes in a file: long prompts don't fit on a Windows command line
  const dir = await mkdtemp(path.join(tmpdir(), 'growjin-cc-'))
  const sysFile = path.join(dir, 'system.txt')
  await writeFile(sysFile, system, 'utf8')
  const args = ['-p', '--output-format', 'json', '--no-session-persistence', '--model', model, '--tools', '', '--system-prompt-file', sysFile, '--json-schema', schema]
  // Without the API key the CLI uses its own sign-in (the Claude Code plan)
  const { ANTHROPIC_API_KEY: _k, CLAUDECODE: _cc, ...env } = process.env
  const isWin = process.platform === 'win32'

  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(isWin ? 'claude.cmd' : 'claude', isWin ? args.map(a => (a === '' ? '""' : /[\s"{}]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)) : args, { env, stdio: ['pipe', 'pipe', 'pipe'], shell: isWin })
      let stdout = '', stderr = ''
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`claude CLI timed out after ${TIMEOUT_MS / 1000}s`)) }, TIMEOUT_MS)
      child.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8') })
      child.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8') })
      child.on('error', e => { clearTimeout(timer); reject(e) })
      child.on('close', code => {
        clearTimeout(timer)
        let j: Record<string, unknown>
        try { j = JSON.parse(stdout) } catch { return reject(new Error(`claude CLI gave no JSON (exit ${code}): ${(stderr || stdout).slice(0, 300)}`)) }
        if (j.is_error) return reject(new Error(`claude CLI error: ${String(j.result ?? j.subtype).slice(0, 300)}`))
        const u = j.usage as Record<string, number> | undefined
        logAIUsage({
          model: `${model} (Claude Code)`, provider: 'cli',
          inputTokens: u ? (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) : null,
          outputTokens: u?.output_tokens ?? null, costUsd: typeof j.total_cost_usd === 'number' ? j.total_cost_usd : null,
        })
        let structured = j.structured_output
        if (structured == null && typeof j.result === 'string') { try { structured = JSON.parse(j.result) } catch { /* left empty */ } }
        resolve({ structured })
      })
      child.stdin.write(input, 'utf8')
      child.stdin.end()
    })
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
