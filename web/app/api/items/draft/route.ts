import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules, moduleItems } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { callAI } from '@/lib/ai/client'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { itemId } = await request.json()

  const [item] = await db.select().from(moduleItems).where(eq(moduleItems.id, itemId))
  if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

  const [mod] = await db.select().from(modules).where(eq(modules.id, item.moduleId))
  if (!mod) return NextResponse.json({ error: 'Module not found' }, { status: 404 })

  const [brand] = await db.select().from(brands).where(eq(brands.id, mod.brandId))
  if (!brand || brand.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const brandContext = [
    `Brand: ${brand.name}`,
    `Website: ${brand.websiteUrl}`,
    brand.industry ? `Industry: ${brand.industry}` : null,
    brand.targetAudience ? `Target audience: ${brand.targetAudience}` : null,
    brand.usp ? `USP: ${brand.usp}` : null,
    brand.brandVoice ? `Brand voice: ${brand.brandVoice}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const prompt = `=== Brand context ===
${brandContext}

=== Audit finding ===
Issue: ${item.label}
Detail: ${item.aiDetail ?? ''}
Why it matters: ${item.aiNarrative ?? ''}
Recommended action: ${item.aiAction ?? ''}

=== Your task ===
Generate a ready-to-use draft that directly resolves this finding. Output only the draft — no preamble, no "here is your draft", no meta-commentary.

Choose the appropriate format:
- Copy issue (H1, headline, tagline, meta description, positioning statement, hero text, USP, bio) → 3 numbered alternatives, each 1–2 sentences max, specific to this brand
- Content structure (comparison page, blog post, landing page, FAQ) → full outline with H2 headings and bullet points, branded to this company
- Template (email, social bio, testimonial request, outreach message) → complete ready-to-send text with [placeholders] for any unknowns
- Technical setup (pixel, schema, sitemap, Wikidata) → numbered step-by-step checklist with exact actions and where to find each thing
- Strategic gap (missing platform, positioning, differentiation) → a concrete 5-step action plan with specific first steps

Use the brand name, industry, audience, and USP to make every output specific. Never use generic placeholders like [Company Name] — use the actual brand name.`

  const draft = await callAI({
    system:
      'You are an expert copywriter and growth consultant. Generate specific, immediately usable drafts tailored to the exact brand provided. No generic advice — every output must be ready to copy and use.',
    prompt,
    maxTokens: 2000,
  })

  const trimmed = draft.trim()

  await db
    .update(moduleItems)
    .set({ aiDraft: trimmed, updatedAt: new Date() })
    .where(eq(moduleItems.id, itemId))

  return NextResponse.json({ draft: trimmed })
}
