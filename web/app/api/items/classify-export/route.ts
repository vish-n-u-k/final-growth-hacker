import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { callAI } from '@/lib/ai/client'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { moduleId, items } = await request.json() as {
    moduleId: string
    items: { slug: string; label: string; aiDetail: string | null; aiAction: string | null }[]
  }

  const [mod] = await db.select().from(modules).where(eq(modules.id, moduleId))
  if (!mod) return NextResponse.json({ error: 'Module not found' }, { status: 404 })

  const [brand] = await db.select().from(brands).where(eq(brands.id, mod.brandId))
  if (!brand || brand.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (items.length === 0) return NextResponse.json({ classifications: [] })

  const itemList = items
    .map((i, idx) => `${idx + 1}. [${i.slug}] ${i.label}\n   Finding: ${i.aiDetail || 'Not analyzed'}\n   Action: ${i.aiAction || 'No action'}`)
    .join('\n\n')

  const raw = await callAI({
    system: 'You classify marketing audit findings by how they can be fixed in a Claude Code session. Be precise. Output only valid JSON.',
    prompt: `Brand: ${brand.name}
Website: ${brand.websiteUrl ?? ''}

For each failing item below, classify it as exactly one of:

- "auto": Claude Code can implement this from the codebase alone, with no external data needed. This includes: schema markup, meta tags, canonical tags, FAQ sections with factual comparisons the brand can defend, internal landing pages, alt text, sitemap fixes, structured data, competitor comparison pages, robots.txt, heading structure, internal linking. Claude can write copy like titles, descriptions, and FAQ answers without needing external facts.

- "needs_choice": The fix requires a specific statistic, percentage, dollar figure, citation, testimonial, quote, or any claim attributed to a named real company, study, or report. Nothing in this category should ever be invented — the user must supply the real data. Examples: "saves X hours per week", "HubSpot reports Y%", "our customers see Z% improvement", a specific customer quote or review.

- "skip": Cannot be done in code at all — requires creating or claiming accounts on external platforms (Google Search Console, Google Analytics, Wikipedia, Crunchbase, G2, Capterra), DNS changes, PR/media outreach, securing press coverage, building external backlinks, posting on social media.

Items to classify:
${itemList}

Return ONLY a valid JSON array, no markdown:
[{"slug": "...", "exportType": "auto|needs_choice|skip"}]`,
    maxTokens: 4000,
    model: 'claude-haiku-4-5-20251001',
  })

  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end === -1) return NextResponse.json({ classifications: [] })

  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      slug: string
      exportType: string
      choiceOptions?: string[]
    }[]
    const classifications = parsed
      .filter(r => r.slug && (r.exportType === 'auto' || r.exportType === 'needs_choice' || r.exportType === 'skip'))
      .map(r => ({
        slug: r.slug,
        exportType: r.exportType as 'auto' | 'needs_choice' | 'skip',
      }))
    return NextResponse.json({ classifications })
  } catch {
    return NextResponse.json({ classifications: [] })
  }
}
