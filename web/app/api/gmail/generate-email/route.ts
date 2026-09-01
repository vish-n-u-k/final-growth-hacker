import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brainContext } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { callAI } from '@/lib/ai/client'

interface EmailCopy {
  subject: string
  hero: string
  intro: string        // opening paragraph — wrap boldPhrase in <strong> inline
  boldPhrase: string   // exact phrase from intro to bold
  bulletIntro: string  // lead-in sentence before the bullet list
  bullets: string[]    // 4–6 concise bullets
  closing: string      // 1–2 sentence wrap-up before signature
  ctaText: string
}

function buildEmailHTML(copy: EmailCopy, brandName: string, websiteUrl: string): string {
  const domain = (() => {
    try { return new URL(websiteUrl).hostname.replace('www.', '') } catch { return websiteUrl }
  })()

  const p = (text: string, extra = '') =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.75;color:#1a2e20;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;${extra}">${text}</p>`

  const introHtml = copy.boldPhrase && copy.intro.includes(copy.boldPhrase)
    ? copy.intro.replace(copy.boldPhrase, `<strong style="font-weight:700;color:#1a2e20;">${copy.boldPhrase}</strong>`)
    : copy.intro

  const bulletsHtml = copy.bullets.map(b =>
    `<li style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#1a2e20;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${b}</li>`
  ).join('\n          ')

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;padding:32px 16px 40px;background:#f2f4f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <tr><td align="center">

    <!-- Brand mark above card -->
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;margin-bottom:14px;">
      <tr>
        <td style="padding:0 4px;">
          <span style="font-size:18px;font-weight:700;color:#2fbf71;letter-spacing:-0.4px;">&#9889; ${brandName}</span>
        </td>
      </tr>
    </table>

    <!-- Main card -->
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e0e8e3;border-radius:8px;overflow:hidden;">

      <!-- Content -->
      <tr>
        <td style="padding:36px 40px 32px;">

          <!-- Hero -->
          <h1 style="margin:0 0 24px;font-size:26px;font-weight:700;color:#0d1f14;line-height:1.25;letter-spacing:-0.5px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${copy.hero}</h1>

          <!-- Greeting -->
          ${p('Hi there,')}

          <!-- Intro -->
          ${p(introHtml)}

          <!-- Bullet intro -->
          ${p(copy.bulletIntro)}

          <!-- Bullets -->
          <ul style="margin:0 0 20px;padding-left:22px;">
            ${bulletsHtml}
          </ul>

          <!-- Closing -->
          ${p(copy.closing)}

          <!-- Signature -->
          ${p(`&#8212; The ${brandName} Team`)}

          <!-- CTA button -->
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 20px;">
            <tr>
              <td>
                <a href="${websiteUrl}" style="display:inline-block;padding:12px 28px;background:#1a1a1a;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:7px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${copy.ctaText}</a>
              </td>
            </tr>
          </table>

          <!-- Fallback link -->
          <p style="margin:0;font-size:12px;color:#8a9e90;line-height:1.5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
            If the button does not work, paste this link into your browser:<br/>
            <a href="${websiteUrl}" style="color:#2fbf71;text-decoration:underline;">${websiteUrl}</a>
          </p>

        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="padding:18px 40px;background:#f7f9f7;border-top:1px solid #e0e8e3;text-align:center;">
          <p style="margin:0 0 4px;font-size:12px;color:#8a9e90;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
            This is an outreach email from <a href="${websiteUrl}" style="color:#2fbf71;text-decoration:none;">${brandName}</a>.
            Need help? Contact <a href="mailto:hello@${domain}" style="color:#2fbf71;text-decoration:none;">hello@${domain}</a>
          </p>
          <p style="margin:0;font-size:11px;color:#aab8b0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
            You received this email because you match the profile we reach out to. We respect your inbox.
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>`
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { prospectName, prospectCompany, prospectTitle, prospectContext } =
    await req.json() as {
      prospectName: string
      prospectEmail: string
      prospectCompany: string
      prospectTitle: string
      prospectContext?: string
    }

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  const [brain] = await db.select().from(brainContext).where(eq(brainContext.brandId, brand.id))
  const brainSummary = brain?.summary ?? null
  const brainFacts = brain?.facts as Record<string, Record<string, unknown>> | null

  const brandContext = [
    `Company: ${brand.name}`,
    `Website: ${brand.websiteUrl}`,
    brainSummary ? `Brand overview:\n${brainSummary}` : null,
    brainFacts ? `Key brand facts:\n${JSON.stringify(brainFacts, null, 2).slice(0, 1500)}` : null,
  ].filter(Boolean).join('\n\n')

  const prompt = `Write cold outreach email copy from ${brand.name} to the prospect below.

BRAND CONTEXT:
${brandContext}

PROSPECT:
Name: ${prospectName}
Company: ${prospectCompany}
Title: ${prospectTitle}${prospectContext ? `\nContext: ${prospectContext}` : ''}

Rules:
- Always write the email — never refuse, never evaluate ICP fit
- Conversational, direct — real person voice, no corporate filler
- hero: one punchy headline specific to this prospect's pain point (max 10 words)
- intro: 1–2 sentences with a sharp angle on how ${brand.name} helps this specific prospect. Natural, no fluff.
- boldPhrase: pick 2–4 words from intro that are the key value phrase — must exist verbatim in intro
- bulletIntro: a natural lead-in like "Here's what ${brand.name} can help you with:" (vary the wording)
- bullets: 4–5 concise benefit bullets, specific to this prospect's role
- closing: 1 sentence — low-friction CTA ("Worth a quick look?" style)
- ctaText: 3–5 word button label

Return ONLY this JSON (no markdown, no code fences, no extra text):
{
  "subject": "plain text subject line",
  "hero": "punchy headline for this prospect",
  "intro": "opening 1-2 sentences with key value angle",
  "boldPhrase": "exact key phrase from intro",
  "bulletIntro": "lead-in sentence before the list",
  "bullets": ["benefit one", "benefit two", "benefit three", "benefit four"],
  "closing": "one low-friction closing sentence",
  "ctaText": "button label"
}`

  const raw = await callAI({
    system: 'You are a cold email copywriter. Return only a raw JSON object — no markdown, no code blocks, no extra text.',
    prompt,
    maxTokens: 700,
    model: 'claude-haiku-4-5-20251001',
  })

  try {
    const start = raw.indexOf('{')
    const end   = raw.lastIndexOf('}')
    const copy  = JSON.parse(raw.slice(start, end + 1)) as EmailCopy
    const body  = buildEmailHTML(copy, brand.name, brand.websiteUrl ?? '')
    return NextResponse.json({ subject: copy.subject, body })
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
  }
}
