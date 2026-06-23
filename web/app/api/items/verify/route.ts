import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules, moduleItems } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import Anthropic from '@anthropic-ai/sdk'
import { getAllItems } from '@/lib/modules/types'
import { FOUNDATION_MODULE } from '@/lib/modules/foundation/definition'
import { fetchFoundationData } from '@/lib/modules/foundation/fetcher'

export const maxDuration = 30

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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

  // Only Foundation (static) items can be individually verified
  // Dynamic module items require a full re-analysis
  if (mod.type !== 'foundation') {
    return NextResponse.json({ canVerify: false, reason: 'Re-analyse the module to verify dynamic items' })
  }

  // Find this item's prompt from the Foundation definition
  const allItems = getAllItems(FOUNDATION_MODULE)
  const itemDef = allItems.find((i) => i.slug === item.slug)
  if (!itemDef) {
    return NextResponse.json({ canVerify: false, reason: 'Item definition not found' })
  }

  // Re-fetch the site
  const requirements = (mod.requirements as Record<string, string>) ?? {}
  const data = await fetchFoundationData(requirements)
  if (!data.extracted) {
    return NextResponse.json({ canVerify: false, reason: 'Could not reach the site' })
  }

  // Run a targeted single-item Claude check
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system: FOUNDATION_MODULE.systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Re-check this single item for the website at ${data.url}.

=== Extracted site data ===
${JSON.stringify(data.extracted, null, 2)}

=== Check ===
slug: "${itemDef.slug}"
prompt: ${itemDef.prompt}

Return ONLY a JSON object with:
- "detail": string — one sentence with exact values found
- "verified": boolean — true if clearly passes now, false if still failing

No markdown, no extra text.`,
      },
    ],
  })

  const raw = message.content[0].type === 'text' ? message.content[0].text : '{}'
  const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()

  let result: { detail: string; verified: boolean }
  try {
    result = JSON.parse(clean)
  } catch {
    return NextResponse.json({ canVerify: false, reason: 'Verification returned invalid response' })
  }

  // Update the item in DB
  await db
    .update(moduleItems)
    .set({
      aiDetail: result.detail,
      aiVerified: result.verified,
      aiVerifiedAt: result.verified ? new Date() : null,
      completedBy: result.verified ? 'ai' : item.userChecked ? 'user' : null,
      updatedAt: new Date(),
    })
    .where(eq(moduleItems.id, itemId))

  return NextResponse.json({ canVerify: true, aiVerified: result.verified, detail: result.detail })
}
