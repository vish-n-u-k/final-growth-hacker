import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'

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

      let parsed: { result?: string; is_error?: boolean }
      try {
        parsed = JSON.parse(stdout) as { result?: string; is_error?: boolean }
      } catch {
        reject(new Error(`claude CLI stdout is not valid JSON (exit ${code}): ${stdout.slice(0, 300)}`))
        return
      }

      console.log('[CLI] parsed keys:', Object.keys(parsed))
      console.log('[CLI] parsed.is_error:', parsed.is_error)
      console.log('[CLI] parsed.result preview:', String(parsed.result ?? '').slice(0, 200))

      if (parsed.is_error) {
        reject(new Error(`claude CLI error: ${parsed.result ?? 'unknown error'}`))
        return
      }

      if (code !== 0) {
        reject(new Error(`claude CLI exited ${code}: ${stderr.slice(0, 300)}`))
        return
      }

      if (typeof parsed.result !== 'string') {
        reject(new Error(`claude CLI JSON missing "result" field. Full output: ${stdout.slice(0, 500)}`))
        return
      }

      resolve(parsed.result)
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
  }

  console.log('─── RESPONSE ─────────────────────────────────────────────────────────────────')
  console.log(response)
  console.log('═'.repeat(80) + '\n')

  return response
}
