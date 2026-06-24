import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { spawnSync } from 'child_process'

interface CallAIOptions {
  system: string
  prompt: string
  maxTokens: number
  model?: string
}

const useGemini = process.env.USE_GEMINI === 'true'
const useClaudeCLI = process.env.USE_CLAUDE_CLI === 'true' && !process.env.ANTHROPIC_API_KEY

function callViaCLI(system: string, prompt: string, model: string): string {
  // Map SDK model IDs to CLI aliases
  const cliModel = model.includes('haiku') ? 'haiku' : 'sonnet'

  const input = `SYSTEM:\n${system}\n\nUSER:\n${prompt}`

  const result = spawnSync(
    'claude',
    ['-p', '--output-format', 'json', '--no-session-persistence', '--model', cliModel],
    {
      input,
      encoding: 'utf8',
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, CLAUDECODE: undefined },
    },
  )

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`claude CLI exited ${result.status}: ${result.stderr?.slice(0, 300)}`)
  }

  const parsed = JSON.parse(result.stdout) as { result: string }
  return parsed.result
}

export async function callAI({ system, prompt, maxTokens, model = 'claude-sonnet-4-6' }: CallAIOptions): Promise<string> {
  console.log('\n' + '═'.repeat(80))
  console.log(`[AI] model=${model}  maxTokens=${maxTokens}  provider=${useClaudeCLI ? 'cli' : useGemini ? 'gemini' : 'anthropic'}`)
  console.log('─── SYSTEM ───────────────────────────────────────────────────────────────────')
  console.log(system)
  console.log('─── PROMPT ───────────────────────────────────────────────────────────────────')
  console.log(prompt)
  console.log('─── SENDING... ───────────────────────────────────────────────────────────────')

  let response: string

  if (useClaudeCLI) {
    response = callViaCLI(system, prompt, model)
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
    const message = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    })
    response = message.content[0].type === 'text' ? message.content[0].text : '[]'
  }

  console.log('─── RESPONSE ─────────────────────────────────────────────────────────────────')
  console.log(response)
  console.log('═'.repeat(80) + '\n')

  return response
}
