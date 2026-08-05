import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const client = new Anthropic()

interface AiCache {
  ts: number
  data: AiInsights
}
const cache = new Map<string, AiCache>()
const TTL = 60 * 60 * 1000 // 1 hour

interface AiInsights {
  headline: string
  insights: { text: string; impact: 'high' | 'medium' | 'low' }[]
  actions: { text: string; impact: 'high' | 'medium' | 'low' }[]
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { brandId, period, summary } = body as {
      brandId: string
      period: string
      summary: object
    }

    if (!brandId || !period || !summary) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const cacheKey = `${brandId}:${period}`
    const cached = cache.get(cacheKey)
    if (cached && Date.now() - cached.ts < TTL) {
      return NextResponse.json(cached.data)
    }

    const prompt = `You are a senior growth analyst. Analyze this website traffic data and provide concise, actionable insights.

Traffic data (${period}):
${JSON.stringify(summary, null, 2)}

Return ONLY valid JSON with this exact structure:
{
  "headline": "one sentence overall assessment of traffic health and key opportunity",
  "insights": [
    { "text": "specific observation about the data", "impact": "high" }
  ],
  "actions": [
    { "text": "specific actionable recommendation", "impact": "high" }
  ]
}

Rules:
- Max 5 insights, max 5 actions
- impact must be exactly "high", "medium", or "low"
- Be specific with numbers from the data
- Focus on what matters most for growth
- No generic advice — tie every point to the actual numbers`

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 700,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = message.content[0]?.type === 'text' ? message.content[0].text : ''

    // Extract JSON
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end === -1) throw new Error('No JSON in response')

    const parsed = JSON.parse(text.slice(start, end + 1)) as AiInsights

    // Validate shape
    if (!parsed.headline || !Array.isArray(parsed.insights) || !Array.isArray(parsed.actions)) {
      throw new Error('Invalid response shape')
    }

    // Clamp to 5 items each
    parsed.insights = parsed.insights.slice(0, 5)
    parsed.actions = parsed.actions.slice(0, 5)

    cache.set(cacheKey, { ts: Date.now(), data: parsed })
    return NextResponse.json(parsed)
  } catch (e) {
    console.error('[ga4-insights-ai]', e)
    return NextResponse.json({ error: 'AI analysis failed' }, { status: 500 })
  }
}
