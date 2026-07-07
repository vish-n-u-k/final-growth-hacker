import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { callAI } from '@/lib/ai/client'
import type { PlaybookData } from '@/lib/playbook/fields'

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

  const playbook = brand.playbook as PlaybookData | null

  const toneReference = playbook?.coldEmailTemplates
    ? `BRAND EMAIL TEMPLATES — match this tone, voice, length, and style exactly:\n${playbook.coldEmailTemplates}`
    : null

  const brandContext = [
    `Company: ${brand.name}`,
    `Website: ${brand.websiteUrl}`,
    playbook?.executiveSummary ? `What we do:\n${playbook.executiveSummary}` : null,
    playbook?.icp             ? `Ideal customer profile:\n${playbook.icp}` : null,
    playbook?.buyerPersonas   ? `Buyer personas:\n${playbook.buyerPersonas}` : null,
  ].filter(Boolean).join('\n\n')

  const prompt = `Write a cold outreach email from ${brand.name} to the prospect below. Always write the email — never refuse, never evaluate ICP fit, never explain why the prospect may or may not match. Just write the best email possible.

${toneReference ? toneReference + '\n\n' : ''}BRAND CONTEXT:
${brandContext}

PROSPECT:
Name: ${prospectName}
Company: ${prospectCompany}
Title: ${prospectTitle}

Rules:
- ${toneReference ? 'Copy the exact tone, voice, sentence length, and style from the brand email templates above — this is non-negotiable' : 'Keep it short and direct'}
- Find the most relevant angle between the brand and this prospect's role
- One concrete sentence on how ${brand.name} solves it
- End with a low-friction CTA matching the brand's typical style (e.g. a short call or "reply with YES")
- No fluff, no "I hope this finds you well"
- Sign off as [Your name]

Return ONLY a valid JSON object:
{ "subject": "...", "body": "..." }`

  const raw = await callAI({
    system: 'You are an expert B2B cold email copywriter. Return only valid JSON, nothing else.',
    prompt,
    maxTokens: 500,
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
