import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { AsyncLocalStorage } from 'node:async_hooks'
import { db } from '@/lib/db'
import { aiUsageLogs } from '@/lib/db/schema'

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

// ─────────────────────────────────────────────────────────────────────────────

interface CallAIOptions {
  system: string
  prompt: string
  maxTokens: number
  model?: string
  /** Shared prefix to cache across parallel calls. Passed as a separate cached content block before `prompt`. Anthropic only — ignored by Gemini/CLI providers. */
  cachePrefix?: string
}

const useGemini = process.env.USE_GEMINI === 'true'
const useClaudeCLI = process.env.USE_CLAUDE_CLI === 'true'

const CLI_TIMEOUT_MS = 600_000 // 10 minutes — sonnet + large prompts can be slow

async function callViaCLI(system: string, prompt: string, model: string): Promise<string> {
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
    const child = spawn('claude', args, {
      env: cliEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
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
        // Haiku 4.5 rates: $0.80/MTok in · $4/MTok out
        // Sonnet 4.6 rates: $3/MTok in · $15/MTok out
        const isHaiku = cliModel === 'haiku'
        const inRate = isHaiku ? 0.80 : 3.00
        const outRate = isHaiku ? 4.00 : 15.00
        const estimatedCost = (inTok / 1_000_000) * inRate + (outTok / 1_000_000) * outRate
        console.log(`│  input_tokens : ${inTok.toLocaleString()}`)
        console.log(`│  output_tokens: ${outTok.toLocaleString()}`)
        console.log(`│  cost (calc)  : $${estimatedCost.toFixed(6)}`)
      }
      if (costUsd !== undefined) {
        console.log(`│  cost_usd (CLI reported): $${costUsd.toFixed(6)}`)
      }
      console.log('└─────────────────────────────────────────────────────────')
      // ─────────────────────────────────────────────────────────────────────

      // Save to DB if brand/module context is set
      const _ctx = aiContextStore.getStore()
      if (_ctx) {
        const inTok = inputTok ?? 0
        const outTok = outputTok ?? 0
        const isHaikuDb = cliModel === 'haiku'
        const inRateDb = isHaikuDb ? 0.80 : 3.00
        const outRateDb = isHaikuDb ? 4.00 : 15.00
        const calcCost = costUsd ?? ((inTok > 0 || outTok > 0) ? (inTok / 1_000_000) * inRateDb + (outTok / 1_000_000) * outRateDb : null)
        db.insert(aiUsageLogs).values({
          brandId: _ctx.brandId,
          moduleType: _ctx.moduleType,
          websiteUrl: _ctx.websiteUrl,
          model: cliModel,
          provider: 'cli',
          inputTokens: inTok || null,
          outputTokens: outTok || null,
          costUsd: calcCost != null ? calcCost.toFixed(8) : null,
        }).catch(e => console.error('[USAGE] DB insert failed:', e))
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

export async function callAI({ system, prompt, maxTokens, model = 'claude-sonnet-4-6', cachePrefix }: CallAIOptions): Promise<string> {
  console.log('\n' + '═'.repeat(80))
  console.log(`[AI] model=${model}  maxTokens=${maxTokens}  provider=${useClaudeCLI ? 'cli' : useGemini ? 'gemini' : 'anthropic'}`)
  console.log('─── SYSTEM ───────────────────────────────────────────────────────────────────')
  console.log(system)
  console.log('─── PROMPT ───────────────────────────────────────────────────────────────────')
  console.log(prompt)
  console.log('─── SENDING... ───────────────────────────────────────────────────────────────')

  let response: string

  if (useClaudeCLI) {
    response = await callViaCLI(system, cachePrefix ? `${cachePrefix}\n\n${prompt}` : prompt, model)
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
    const _gCtx = aiContextStore.getStore()
    if (_gCtx) {
      db.insert(aiUsageLogs).values({
        brandId: _gCtx.brandId,
        moduleType: _gCtx.moduleType,
        websiteUrl: _gCtx.websiteUrl,
        model: 'gemini-2.0-flash',
        provider: 'gemini',
        inputTokens: gUsage?.promptTokenCount ?? null,
        outputTokens: gUsage?.candidatesTokenCount ?? null,
        costUsd: null, // Gemini pricing varies, skip for now
      }).catch(e => console.error('[USAGE] DB insert failed:', e))
    }
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
    const isHaiku = model.includes('haiku')
    const inRate = isHaiku ? 0.80 : 3.00
    const outRate = isHaiku ? 4.00 : 15.00
    const cost = (u.input_tokens / 1_000_000) * inRate + (u.output_tokens / 1_000_000) * outRate
    console.log('┌─ [USAGE:SDK] ───────────────────────────────────────────')
    console.log(`│  model        : ${model}`)
    console.log(`│  input_tokens : ${u.input_tokens.toLocaleString()}`)
    console.log(`│  output_tokens: ${u.output_tokens.toLocaleString()}`)
    console.log(`│  cost (calc)  : $${cost.toFixed(6)}`)
    console.log('└─────────────────────────────────────────────────────────')
    const _sdkCtx = aiContextStore.getStore()
    if (_sdkCtx) {
      db.insert(aiUsageLogs).values({
        brandId: _sdkCtx.brandId,
        moduleType: _sdkCtx.moduleType,
        websiteUrl: _sdkCtx.websiteUrl,
        model,
        provider: 'sdk',
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        costUsd: cost.toFixed(8),
      }).catch(e => console.error('[USAGE] DB insert failed:', e))
    }
  }

  console.log('─── RESPONSE ─────────────────────────────────────────────────────────────────')
  console.log(response)
  console.log('═'.repeat(80) + '\n')

  return response
}

// ── Vision calls (screenshot review) ────────────────────────────────────────
// Only the direct Anthropic SDK path supports image content blocks today.
// CLI/Gemini providers return null so callers can degrade gracefully — this
// is the only provider branch that supports vision input in this app.

export interface VisionImage {
  label: string
  base64: string
  mediaType: 'image/jpeg' | 'image/png'
}

interface CallAIVisionOptions {
  system: string
  prompt: string
  images: VisionImage[]
  maxTokens: number
  model?: string
}

export async function callAIVision({ system, prompt, images, maxTokens, model = 'claude-sonnet-4-6' }: CallAIVisionOptions): Promise<string | null> {
  if (useClaudeCLI || useGemini) {
    console.warn('[AI:vision] skipped — vision calls are only supported via the direct Anthropic SDK provider in this app')
    return null
  }
  if (images.length === 0) return null

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const content: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png'; data: string } }
    > = []
    for (const img of images) {
      content.push({ type: 'text', text: `--- ${img.label} ---` })
      content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } })
    }
    content.push({ type: 'text', text: prompt })

    console.log('\n' + '═'.repeat(80))
    console.log(`[AI:vision] model=${model} maxTokens=${maxTokens} images=${images.map((i) => i.label).join(', ')}`)

    const message = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content }],
    })
    const response = message.content[0].type === 'text' ? message.content[0].text : null

    const u = message.usage
    const isHaiku = model.includes('haiku')
    const inRate = isHaiku ? 0.80 : 3.00
    const outRate = isHaiku ? 4.00 : 15.00
    const cost = (u.input_tokens / 1_000_000) * inRate + (u.output_tokens / 1_000_000) * outRate
    console.log(`[AI:vision] input_tokens=${u.input_tokens} output_tokens=${u.output_tokens} cost=$${cost.toFixed(6)}`)
    console.log('═'.repeat(80) + '\n')

    const _ctx = aiContextStore.getStore()
    if (_ctx) {
      db.insert(aiUsageLogs).values({
        brandId: _ctx.brandId,
        moduleType: _ctx.moduleType,
        websiteUrl: _ctx.websiteUrl,
        model,
        provider: 'sdk-vision',
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        costUsd: cost.toFixed(8),
      }).catch((e) => console.error('[USAGE] DB insert failed:', e))
    }

    return response
  } catch (err) {
    console.error('[AI:vision] call failed:', err)
    return null
  }
}
