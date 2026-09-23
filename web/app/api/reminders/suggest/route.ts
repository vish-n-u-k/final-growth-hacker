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
  category: 'marketplace' | 'app-store' | 'directory' | 'profile' | 'custom'
  intervalDays: number
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  // Fetch active modules (non-fatal — degrade gracefully if query fails)
  let activeModules: { type: string; name: string }[] = []
  try {
    activeModules = await db.select({ type: modules.type, name: modules.name })
      .from(modules)
      .where(and(eq(modules.brandId, brand.id), ne(modules.status, 'not-applicable')))
  } catch (e) {
    console.warn('Suggest: modules query failed (non-fatal):', e)
  }

  // Fetch existing reminder titles to avoid duplication (non-fatal)
  let existingTitles: string[] = []
  try {
    const existing = await db.select({ title: reminders.title })
      .from(reminders)
      .where(eq(reminders.brandId, brand.id))
    existingTitles = existing.map(r => r.title)
  } catch (e) {
    console.warn('Suggest: reminders query failed (non-fatal):', e)
  }

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

  const prompt = `You are a business operations advisor. Your job: remind business owners to keep their platform listings and profiles up-to-date.

Brand profile:
${context}

Generate 7 platform/listing update reminders for this specific business. Focus ONLY on places where this business needs to periodically refresh their presence — product listings, app store pages, business directories, marketplace profiles, review platforms, etc.

Rules:
- Only suggest platforms relevant to this business type and industry
- Check the URL for platform clues: '.myshopify.com' = Shopify, 'etsy.com/shop/' = Etsy, 'apps.apple.com' or 'play.google.com' in their niche = App Store/Play Store, 'bigcommerce.com' = BigCommerce, 'wixsite.com' = Wix, 'squarespace.com' = Squarespace — and include platform-specific reminders
- Titles must be short (max 7 words) and action-first: "Refresh Shopify product photos", "Update App Store screenshots", "Refresh Google Business hours"
- Intervals: monthly (30d), bi-monthly (60d), or quarterly (90d) — no weekly tasks
- Do NOT suggest content creation, social posting, SEO, backlinks, email campaigns, or outreach
- Do NOT suggest anything already in their existing list

Respond with JSON only, no markdown:
[
  {
    "title": "...",
    "category": "marketplace|app-store|directory|profile|custom",
    "intervalDays": 30
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
      category: (['marketplace','app-store','directory','profile','custom'].includes(s.category) ? s.category : 'custom') as ReminderSuggestion['category'],
      intervalDays: Math.max(1, Math.min(365, parseInt(String(s.intervalDays), 10) || 30)),
    }))

    return NextResponse.json({ suggestions })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('Suggest reminders error:', msg, e)
    return NextResponse.json({ error: 'Failed to generate suggestions', detail: msg }, { status: 500 })
  }
}
