import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'

interface CallAIOptions {
  system: string
  prompt: string
  maxTokens: number
  model?: string
}

const useGemini = process.env.USE_GEMINI === 'true'

export async function callAI({ system, prompt, maxTokens, model = 'claude-sonnet-4-6' }: CallAIOptions): Promise<string> {
  if (useGemini) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: system,
      generationConfig: { maxOutputTokens: maxTokens },
    })
    const result = await model.generateContent(prompt)
    return result.response.text()
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: prompt }],
  })
  return message.content[0].type === 'text' ? message.content[0].text : '[]'
}
