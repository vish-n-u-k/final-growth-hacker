import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { AsyncLocalStorage } from 'node:async_hooks'
import { db } from '@/lib/db'
import { aiUsageLogs } from '@/lib/db/schema'
import { anthropicCostUsd, type TokenUsage } from './pricing'

// ── Per-request context (brand + module) threaded via AsyncLocalStorage ────────

interface AICallContext {
  brandId: string
  moduleType: string
  websiteUrl?: string
}

const aiContextStore = new AsyncLocalStorage<AICallContext>()

export function withAIContext<T>(ctx: AICallContext, fn: () => Promise<T>): Promise<T> {
  return aiContextStore.run(ctx, fn)
}

/**
 * Records one AI call in ai_usage_logs (the admin Costs tab). Brand/module come from withAIContext
 * when set; otherwise the call is filed under `feature` (e.g. 'blog-generate'). Never throws.
 */
export function logAIUsage(opts: {
  feature?: string
  brandId?: string | null
  model: string
  provider: 'sdk' | 'cli' | 'gemini'
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
}): void {
  const ctx = aiContextStore.getStore()
  db.insert(aiUsageLogs).values({
    brandId: ctx?.brandId ?? opts.brandId ?? null,
    moduleType: ctx?.moduleType ?? opts.feature ?? 'other',
    websiteUrl: ctx?.websiteUrl,
    model: opts.model,
    provider: opts.provider,
    inputTokens: opts.inputTokens,
    outputTokens: opts.outputTokens,
    costUsd: opts.costUsd != null ? opts.costUsd.toFixed(8) : null,
  }).catch(e => console.error('[USAGE] DB insert failed:', e))
}

/** logAIUsage for a direct Anthropic SDK call (callers that don't go through callAI). */
export function logAnthropicUsage(feature: string, message: { model: string; usage: TokenUsage }, brandId?: string | null): void {
  const u = message.usage
  logAIUsage({
    feature,
    brandId,
    model: message.model,
    provider: 'sdk',
    inputTokens: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    outputTokens: u.output_tokens,
    costUsd: anthropicCostUsd(message.model, u),
  })
}

// ─────────────────────────────────────────────────────────────────────────────

interface CallAIOptions {
  system: string
  prompt: string
  maxTokens: number
  model?: string
  /** Shared prefix to cache across parallel calls. Passed as a separate cached content block before `prompt`. Anthropic only — ignored by Gemini/CLI providers. */
  cachePrefix?: string
  /** Where the call comes from, for cost tracking when no withAIContext is set (e.g. 'blog-generate'). */
  feature?: string
}

const useGemini = process.env.USE_GEMINI === 'true'
const useClaudeCLI = process.env.USE_CLAUDE_CLI === 'true'

const CLI_TIMEOUT_MS = 600_000 // 10 minutes — sonnet + large prompts can be slow

async function callViaCLI(system: string, prompt: string, model: string, feature?: string): Promise<string> {
  const { spawn } = await import('child_process')
  const cliModel = model.includes('haiku') ? 'haiku' : 'sonnet'
  const input = `SYSTEM:\n${system}\n\nUSER:\n${prompt}`
  const args = ['-p', '--output-format', 'json', '--no-session-persistence', '--model', cliModel]

  console.log('[CLI] command: claude', args.join(' '))
  console.log('[CLI] input length:', input.length, 'chars')
  console.log('[CLI] stdin preview (first 300 chars):', input.slice(0, 300))

  // Strip ANTHROPIC_API_KEY so the CLI uses its own session auth, not an external key
  const { ANTHROPIC_API_KEY: _stripped, CLAUDECODE: _cc, ...cliEnv } = process.env

  return new Promise((resolve, reject) => {
    // On Windows the npm-installed CLI is a .cmd shim — spawn can't resolve it without a shell
    const isWin = process.platform === 'win32'
    const child = spawn(isWin ? 'claude.cmd' : 'claude', args, {
      env: cliEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: isWin,
    })

    let stdout = ''
    let stderr = ''

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`claude CLI timed out after ${CLI_TIMEOUT_MS / 1000}s (model=${cliModel}, input=${input.length} chars)`))
    }, CLI_TIMEOUT_MS)

    child.stdin.write(input, 'utf8')
    child.stdin.end()

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })

    child.on('close', (code) => {
      clearTimeout(timer)

      console.log('[CLI] exit status:', code)
      console.log('[CLI] stderr:', stderr ? stderr.slice(0, 500) : '(empty)')
      console.log('[CLI] stdout length:', stdout.length)
      console.log('[CLI] stdout raw (first 500 chars):', stdout.slice(0, 500))

      if (!stdout.trim()) {
        reject(new Error(`claude CLI returned empty stdout (exit ${code}). stderr: ${stderr.slice(0, 300)}`))
        return
      }

      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(stdout) as Record<string, unknown>
      } catch {
        reject(new Error(`claude CLI stdout is not valid JSON (exit ${code}): ${stdout.slice(0, 300)}`))
        return
      }

      console.log('[CLI] parsed keys:', Object.keys(parsed))
      console.log('[CLI] parsed.is_error:', parsed['is_error'])
      console.log('[CLI] parsed.result preview:', String(parsed['result'] ?? '').slice(0, 200))

      // ── Token / cost logging ──────────────────────────────────────────────
      const usage = parsed['usage'] as Record<string, number> | undefined
      const inputTok = ((usage?.['input_tokens'] ?? 0) + (usage?.['cache_creation_input_tokens'] ?? 0) + (usage?.['cache_read_input_tokens'] ?? 0)) || undefined
      const outputTok = (usage?.['output_tokens']) as number | undefined
      const costUsd = (parsed['total_cost_usd']) as number | undefined
      console.log('┌─ [USAGE:CLI] ───────────────────────────────────────────')
      console.log('│  All CLI fields:', JSON.stringify(parsed, (k, v) => k === 'result' ? '<truncated>' : v))
      if (inputTok !== undefined || outputTok !== undefined) {
        const inTok = inputTok ?? 0
        const outTok = outputTok ?? 0
        const estimatedCost = anthropicCostUsd(model, { input_tokens: usage?.['input_tokens'] ?? 0, output_tokens: outTok, cache_creation_input_tokens: usage?.['cache_creation_input_tokens'], cache_read_input_tokens: usage?.['cache_read_input_tokens'] })
        console.log(`│  input_tokens : ${inTok.toLocaleString()}`)
        console.log(`│  output_tokens: ${outTok.toLocaleString()}`)
        console.log(`│  cost (calc)  : $${estimatedCost.toFixed(6)}`)
      }
      if (costUsd !== undefined) {
        console.log(`│  cost_usd (CLI reported): $${costUsd.toFixed(6)}`)
      }
      console.log('└─────────────────────────────────────────────────────────')
      // ─────────────────────────────────────────────────────────────────────

      if (inputTok !== undefined || outputTok !== undefined || costUsd !== undefined) {
        const cliUsage = { input_tokens: usage?.['input_tokens'] ?? 0, output_tokens: outputTok ?? 0, cache_creation_input_tokens: usage?.['cache_creation_input_tokens'], cache_read_input_tokens: usage?.['cache_read_input_tokens'] }
        logAIUsage({
          feature,
          model: cliModel,
          provider: 'cli',
          inputTokens: inputTok ?? null,
          outputTokens: outputTok ?? null,
          costUsd: costUsd ?? anthropicCostUsd(model, cliUsage),
        })
      }

      if (parsed['is_error']) {
        reject(new Error(`claude CLI error: ${parsed['result'] ?? 'unknown error'}`))
        return
      }

      if (code !== 0) {
        reject(new Error(`claude CLI exited ${code}: ${stderr.slice(0, 300)}`))
        return
      }

      if (typeof parsed['result'] !== 'string') {
        reject(new Error(`claude CLI JSON missing "result" field. Full output: ${stdout.slice(0, 500)}`))
        return
      }

      resolve(parsed['result'] as string)
    })
  })
}

export async function callAI({ system, prompt, maxTokens, model = 'claude-sonnet-4-6', cachePrefix, feature }: CallAIOptions): Promise<string> {
  console.log('\n' + '═'.repeat(80))
  console.log(`[AI] model=${model}  maxTokens=${maxTokens}  provider=${useClaudeCLI ? 'cli' : useGemini ? 'gemini' : 'anthropic'}`)
  console.log('─── SYSTEM ───────────────────────────────────────────────────────────────────')
  console.log(system)
  console.log('─── PROMPT ───────────────────────────────────────────────────────────────────')
  console.log(prompt)
  console.log('─── SENDING... ───────────────────────────────────────────────────────────────')

  let response: string

  if (useClaudeCLI) {
    response = await callViaCLI(system, cachePrefix ? `${cachePrefix}\n\n${prompt}` : prompt, model, feature)
  } else if (useGemini) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const geminiModel = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: system,
      generationConfig: { maxOutputTokens: maxTokens },
    })
    const result = await geminiModel.generateContent(prompt)
    response = result.response.text()
    const gUsage = result.response.usageMetadata
    console.log('┌─ [USAGE:Gemini] ────────────────────────────────────────')
    console.log(`│  promptTokenCount    : ${gUsage?.promptTokenCount ?? 'n/a'}`)
    console.log(`│  candidatesTokenCount: ${gUsage?.candidatesTokenCount ?? 'n/a'}`)
    console.log(`│  totalTokenCount     : ${gUsage?.totalTokenCount ?? 'n/a'}`)
    console.log('└─────────────────────────────────────────────────────────')
    logAIUsage({
      feature,
      model: 'gemini-2.0-flash',
      provider: 'gemini',
      inputTokens: gUsage?.promptTokenCount ?? null,
      outputTokens: gUsage?.candidatesTokenCount ?? null,
      costUsd: null, // Gemini pricing varies, skip for now
    })
  } else {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const userContent = cachePrefix
      ? [
          { type: 'text' as const, text: cachePrefix, cache_control: { type: 'ephemeral' as const } },
          { type: 'text' as const, text: prompt },
        ]
      : prompt
    const message = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userContent }],
    })
    response = message.content[0].type === 'text' ? message.content[0].text : '[]'
    const u = message.usage
    const cost = anthropicCostUsd(model, u)
    console.log('┌─ [USAGE:SDK] ───────────────────────────────────────────')
    console.log(`│  model        : ${model}`)
    console.log(`│  input_tokens : ${u.input_tokens.toLocaleString()}`)
    console.log(`│  output_tokens: ${u.output_tokens.toLocaleString()}`)
    console.log(`│  cost (calc)  : $${cost.toFixed(6)}`)
    console.log('└─────────────────────────────────────────────────────────')
    logAIUsage({
      feature,
      model,
      provider: 'sdk',
      inputTokens: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      outputTokens: u.output_tokens,
      costUsd: cost,
    })
  }

  console.log('─── RESPONSE ─────────────────────────────────────────────────────────────────')
  console.log(response)
  console.log('═'.repeat(80) + '\n')

  return response
}
