import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules, reminders } from '@/lib/db/schema'
import { eq, and, ne } from 'drizzle-orm'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 30

const client = new Anthropic()

export interface ReminderSuggestion {
  title: string
  description: string
  category: 'marketplace' | 'content' | 'social' | 'seo' | 'outreach' | 'ads' | 'custom'
  intervalDays: number
  reason: string
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  // Fetch active modules
  const activeModules = await db.select({ type: modules.type, name: modules.name })
    .from(modules)
    .where(and(eq(modules.brandId, brand.id), ne(modules.status, 'not-applicable')))

  // Fetch existing reminder titles to avoid duplication
  const existing = await db.select({ title: reminders.title })
    .from(reminders)
    .where(eq(reminders.brandId, brand.id))

  const existingTitles = existing.map(r => r.title)

  // Build brand context
  const context = [
    `Brand name: ${brand.name}`,
    `Website: ${brand.websiteUrl}`,
    brand.websiteType ? `Business type: ${brand.websiteType}` : null,
    brand.industry ? `Industry: ${brand.industry}` : null,
    brand.targetAudience ? `Target audience: ${brand.targetAudience}` : null,
    brand.usp ? `Unique selling point: ${brand.usp}` : null,
    brand.brandVoice ? `Brand voice: ${brand.brandVoice}` : null,
    brand.keywords ? `Keywords/tags: ${brand.keywords}` : null,
    activeModules.length > 0 ? `Active growth modules: ${activeModules.map(m => m.name).join(', ')}` : null,
    existingTitles.length > 0 ? `Already has reminders for: ${existingTitles.slice(0, 12).join(', ')}` : null,
  ].filter(Boolean).join('\n')

  const prompt = `You are a growth marketing advisor. Based on the brand profile below, generate 7 highly specific, actionable recurring reminders for the founder/marketer.

Brand profile:
${context}

Rules:
- Be SPECIFIC to this brand — use their actual business type, audience, and channels
- Titles should be concrete tasks, not vague (bad: "Post on social", good: "Share a customer success story on LinkedIn")
- Vary the intervals: mix weekly (7d), bi-weekly (14d), monthly (30d), and quarterly (90d)
- Cover different categories: content, seo, social, marketplace, outreach, ads
- Do NOT suggest anything already in their existing reminders list
- Each reminder should have a short 1-sentence reason explaining why it matters
- Check the website URL for clues about the platform (e.g. `.myshopify.com` = Shopify, `bigcommerce.com` = BigCommerce, `wixsite.com`/`wix.com` = Wix, `etsy.com/shop/` = Etsy seller, `squarespace.com` = Squarespace). If a platform is detected, include 1–2 platform-specific reminders (e.g. "Refresh Shopify product listings every 30 days"). Otherwise, infer from business type and industry.

Respond with a JSON array only, no markdown:
[
  {
    "title": "...",
    "description": "...",
    "category": "content|seo|social|marketplace|outreach|ads|custom",
    "intervalDays": 14,
    "reason": "..."
  }
]`

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = (message.content[0] as { text: string }).text.trim()
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start < 0 || end < 0) throw new Error('No JSON array in response')

    const raw = JSON.parse(text.slice(start, end + 1)) as ReminderSuggestion[]
    const suggestions = raw.slice(0, 8).map(s => ({
      title: String(s.title ?? '').slice(0, 200),
      description: String(s.description ?? '').slice(0, 400),
      category: (['marketplace','content','social','seo','outreach','ads','custom'].includes(s.category) ? s.category : 'custom') as ReminderSuggestion['category'],
      intervalDays: Math.max(1, Math.min(365, parseInt(String(s.intervalDays), 10) || 30)),
      reason: String(s.reason ?? '').slice(0, 300),
    }))

    return NextResponse.json({ suggestions })
  } catch (e) {
    console.error('Suggest reminders error:', e)
    return NextResponse.json({ error: 'Failed to generate suggestions' }, { status: 500 })
  }
}
