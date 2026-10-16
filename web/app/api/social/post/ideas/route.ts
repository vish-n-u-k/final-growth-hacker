// Three ready post ideas for Today's "Create a post", when the Social Media audit hasn't
// suggested any yet. One small AI call from the brand's own details.
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { callAI } from '@/lib/ai/client'
import { parseClaudeJsonArray } from '@/lib/modules/parse-utils'
import { brandForRequest } from '@/lib/social/brand-for-request'

export const maxDuration = 30

const PLATFORMS = new Set(['linkedin', 'instagram', 'facebook', 'pinterest', 'youtube'])

export async function GET() {
  const brandId = await brandForRequest()
  if (typeof brandId !== 'string') return brandId
  const [b] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1)
  if (!b) return NextResponse.json({ ideas: [] })
  try {
    const raw = await callAI({
      system: 'You suggest social media posts for a business. Reply with JSON only.',
      prompt: `Business: ${b.name} (${b.websiteUrl ?? ''})
${b.industry ? `Industry: ${b.industry}\n` : ''}${b.targetAudience ? `Audience: ${b.targetAudience}\n` : ''}${b.usp ? `What makes it different: ${b.usp}\n` : ''}${b.keywords ? `Topics: ${b.keywords}\n` : ''}
Suggest 3 different posts this business could publish today. Each is about a real problem its customers have, in plain words, under 80 characters, no hashtags or emojis.
Pick the best platform for each from: linkedin, instagram, facebook, pinterest, youtube.
Return [{"topic": "...", "platform": "..."}]`,
      maxTokens: 400,
      model: 'claude-haiku-4-5-20251001',
    })
    const ideas = (parseClaudeJsonArray(raw) as { topic?: string; platform?: string }[])
      .filter(i => typeof i.topic === 'string' && i.topic.trim())
      .slice(0, 3)
      .map(i => ({ label: i.topic!.trim().slice(0, 200), platform: PLATFORMS.has(String(i.platform).toLowerCase()) ? String(i.platform).toLowerCase() : null, hook: null }))
    return NextResponse.json({ ideas })
  } catch {
    return NextResponse.json({ ideas: [] })
  }
}
