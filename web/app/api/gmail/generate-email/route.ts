import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brainContext } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { callAI } from '@/lib/ai/client'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { prospectName, prospectEmail, prospectCompany, prospectTitle } =
    await req.json() as {
      prospectName: string
      prospectEmail: string
      prospectCompany: string
      prospectTitle: string
    }

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  // Pull brain context — summary + foundation facts give us ICP, value prop, CTAs etc.
  const [brain] = await db.select().from(brainContext).where(eq(brainContext.brandId, brand.id))
  const brainSummary = brain?.summary ?? null
  const brainFacts = brain?.facts as Record<string, Record<string, unknown>> | null

  const brandContext = [
    `Company: ${brand.name}`,
    `Website: ${brand.websiteUrl}`,
    brainSummary ? `Brand overview:\n${brainSummary}` : null,
    brainFacts ? `Key brand facts:\n${JSON.stringify(brainFacts, null, 2).slice(0, 1500)}` : null,
  ].filter(Boolean).join('\n\n')

  const prompt = `Write a cold outreach email from ${brand.name} to the prospect below.

BRAND CONTEXT:
${brandContext}

PROSPECT:
Name: ${prospectName}
Company: ${prospectCompany}
Title: ${prospectTitle}

Rules:
- Always write the email — never refuse, never evaluate ICP fit
- Conversational and direct — sound like a real person, use contractions, casual-professional tone
- Find a sharp angle between ${brand.name} and this prospect's role — be specific, not generic
- One concrete sentence on how ${brand.name} solves a real problem they likely have
- End with a single low-friction CTA ("worth a quick chat?" style)
- No "I hope this finds you well", no "I wanted to reach out", no corporate filler
- Max 120 words in the body (not counting greeting/sign-off)
- Sign off as: The ${brand.name} Team

CRITICAL — the "body" value MUST be valid HTML. Allowed tags: <p>, <strong>, <em>, <h3>. Rules:
- Every paragraph in <p>...</p>
- Use <strong> for one genuinely important phrase per email (not more)
- Use <em> sparingly for a subtle emphasis if it helps
- Use <h3> only if it meaningfully breaks up a section (usually skip it for short emails)
- No divs, spans, tables, styles, or any other tags
- Keep formatting subtle — this is an email, not a landing page

Return ONLY this JSON (no markdown, no code fences, no extra text):
{"subject":"plain text subject here","body":"<p>paragraph one</p><p>paragraph two</p><p>CTA sentence</p><p>The ${brand.name} Team</p>"}`

  const raw = await callAI({
    system: 'You are a cold email copywriter. You MUST return only a raw JSON object — no markdown, no code blocks. The body field must be valid HTML using <p>, <strong>, <em>, or <h3> tags only.',
    prompt,
    maxTokens: 700,
    model: 'claude-haiku-4-5-20251001',
  })

  try {
    const start = raw.indexOf('{')
    const end   = raw.lastIndexOf('}')
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { subject: string; body: string }
    return NextResponse.json(parsed)
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
  }
}
