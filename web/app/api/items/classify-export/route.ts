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
    system: 'You classify marketing audit findings by how they can be fixed. Be precise. Output only valid JSON.',
    prompt: `Brand: ${brand.name}
Website: ${brand.websiteUrl ?? ''}

For each failing item below, classify it as exactly one of:
- "auto": Claude Code can implement this entirely from code with no content decisions — inserting HTML tags, fixing attributes, adding structured data markup, removing directives
- "needs_choice": The exact value/wording must come from the user — title tag copy, meta description text, H1 headline, CTA button label, hero text, alt text, brand description, any copy or content that only the brand owner can decide
- "skip": Cannot be done in code at all — requires creating external accounts (Google Search Console, Google Analytics, social profiles), DNS registrar changes, Wikipedia submissions, third-party service registrations

For "needs_choice" items only: return exactly 3 specific ready-to-use options the user can choose from. Make them concrete and specific to ${brand.name} — never generic placeholders.

Items to classify:
${itemList}

Return ONLY a valid JSON array, no markdown:
[{"slug": "...", "exportType": "auto|needs_choice|skip", "choiceOptions": ["...", "...", "..."]}]`,
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
        choiceOptions: r.exportType === 'needs_choice' ? (r.choiceOptions ?? []) : undefined,
      }))
    return NextResponse.json({ classifications })
  } catch {
    return NextResponse.json({ classifications: [] })
  }
}
