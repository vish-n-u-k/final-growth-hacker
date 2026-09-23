import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brainContext } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { callAI } from '@/lib/ai/client'

interface EmailCopy {
  subject: string
  hero: string
  intro: string
  boldPhrase: string
  bulletIntro: string
  bullets: string[]
  closing: string
  ctaText: string
  ctaUrl?: string   // optional: overrides brand websiteUrl (e.g. with UTM params)
}

function buildEmailHTML(copy: EmailCopy, brandName: string, websiteUrl: string, logoUrl?: string | null, themeColor?: string | null): string {
  const ctaUrl = copy.ctaUrl || websiteUrl
  const domain = (() => {
    try { return new URL(websiteUrl).hostname.replace('www.', '') } catch { return websiteUrl }
  })()
  const color = themeColor ?? '#2fbf71'

  const p = (text: string) =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.75;color:#1a2e20;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${text}</p>`

  const introHtml = copy.boldPhrase && copy.intro.includes(copy.boldPhrase)
    ? copy.intro.replace(copy.boldPhrase, `<strong style="font-weight:700;color:#1a2e20;">${copy.boldPhrase}</strong>`)
    : copy.intro

  const bulletsHtml = copy.bullets.map(b =>
    `<li style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#1a2e20;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${b}</li>`
  ).join('\n          ')

  const brandMark = logoUrl
    ? `<span style="display:inline-flex;align-items:center;gap:10px;"><img src="${logoUrl}" alt="${brandName}" style="height:32px;max-width:140px;object-fit:contain;display:block;"><span style="font-size:17px;font-weight:700;color:${color};letter-spacing:-0.3px;">${brandName}</span></span>`
    : `<span style="font-size:18px;font-weight:700;color:${color};letter-spacing:-0.4px;">&#9889; ${brandName}</span>`

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;padding:32px 16px 40px;background:#f2f4f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <tr><td align="center">

    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;margin-bottom:14px;">
      <tr><td style="padding:0 4px;">
        ${brandMark}
      </td></tr>
    </table>

    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e0e8e3;border-radius:8px;overflow:hidden;">
      <tr><td style="padding:36px 40px 32px;">

        <h1 style="margin:0 0 24px;font-size:26px;font-weight:700;color:#0d1f14;line-height:1.25;letter-spacing:-0.5px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${copy.hero}</h1>

        ${p('Hi there,')}
        ${p(introHtml)}
        ${p(copy.bulletIntro)}

        <ul style="margin:0 0 20px;padding-left:22px;">
          ${bulletsHtml}
        </ul>

        ${p(copy.closing)}
        ${p(`The ${brandName} Team`)}

        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 20px;">
          <tr><td>
            <a href="${ctaUrl}" style="display:inline-block;padding:12px 28px;background:${color};color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:7px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${copy.ctaText}</a>
          </td></tr>
        </table>

        <p style="margin:0;font-size:12px;color:#8a9e90;line-height:1.5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
          If the button does not work, paste this link into your browser:<br/>
          <a href="${ctaUrl}" style="color:${color};text-decoration:underline;">${ctaUrl}</a>
        </p>

      </td></tr>

      <tr><td style="padding:18px 40px;background:#f7f9f7;border-top:1px solid #e0e8e3;text-align:center;">
        <p style="margin:0 0 4px;font-size:12px;color:#8a9e90;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
          This is an outreach email from <a href="${websiteUrl}" style="color:${color};text-decoration:none;">${brandName}</a>.
          Need help? Contact <a href="mailto:hello@${domain}" style="color:${color};text-decoration:none;">hello@${domain}</a>
        </p>
        <p style="margin:0;font-size:11px;color:#aab8b0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
          You received this email because you match the profile we reach out to. We respect your inbox.
        </p>
      </td></tr>
    </table>

  </td></tr>
</table>`
}

const noEmDash = (s: string) => s.replace(/—/g, '').replace(/\s{2,}/g, ' ').trim()

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  const [brain] = await db.select().from(brainContext).where(eq(brainContext.brandId, brand.id))
  const playbook = brand.playbook as Record<string, string> | null

  const { emails, instruction } = await req.json() as {
    emails: { id: string; prospectName?: string; prospectEmail: string; prospectDomain?: string; currentSubject: string; currentBody: string }[]
    instruction: string
  }

  if (!instruction?.trim()) return NextResponse.json({ error: 'instruction required' }, { status: 400 })
  if (!Array.isArray(emails) || emails.length === 0) return NextResponse.json({ error: 'emails required' }, { status: 400 })

  const brandContext = [
    `Company: ${brand.name}`,
    `Website: ${brand.websiteUrl}`,
    brand.usp          ? `Value proposition: ${brand.usp}` : null,
    brand.brandVoice   ? `Tone: ${brand.brandVoice}` : null,
    brand.targetAudience ? `Target audience: ${brand.targetAudience}` : null,
    playbook?.executiveSummary ? `Brand summary:\n${playbook.executiveSummary}` : (brain?.summary ? `Brand overview:\n${brain.summary}` : null),
    playbook?.keyOneLiners ? `Key selling points:\n${playbook.keyOneLiners}` : null,
  ].filter(Boolean).join('\n')

  const results: { id: string; subject?: string; body?: string; error?: string }[] = []

  for (const email of emails) {
    try {
      // Strip HTML tags to give Claude readable plain text context
      const plainText = email.currentBody
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .slice(0, 1500)

      const baseUrl = brand.websiteUrl ?? ''

      const prompt = `You wrote a cold outreach email to a prospect. Apply the following edit instruction to produce an improved version.

EDIT INSTRUCTION:
${instruction}

CURRENT EMAIL:
Subject: ${email.currentSubject}
Body (plain text):
${plainText}

RECIPIENT:
${email.prospectName ? `Name: ${email.prospectName}` : ''}
Email: ${email.prospectEmail}
${email.prospectDomain ? `Company domain: ${email.prospectDomain}` : ''}

BRAND CONTEXT:
${brandContext}
Brand base URL: ${baseUrl}

Rules:
- Apply the edit instruction faithfully to ALL parts of the email
- Keep personalization specific to this recipient
- No em dashes
- ctaUrl: if the instruction involves UTM parameters, tracking links, or custom URLs, set this to the full URL (build it from the brand base URL above). Otherwise omit it.
- Return ONLY this JSON (no markdown, no code fences):
{
  "subject": "...",
  "hero": "punchy headline",
  "intro": "opening 1-2 sentences",
  "boldPhrase": "key phrase that exists verbatim in intro",
  "bulletIntro": "lead-in sentence before the list",
  "bullets": ["...", "...", "...", "..."],
  "closing": "one low-friction closing sentence",
  "ctaText": "button label",
  "ctaUrl": "full URL with UTM params if requested, otherwise omit this field"
}`

      const raw = await callAI({
        system: 'You are a cold email copywriter. Apply the edit and return only a raw JSON object — no markdown, no code blocks.',
        prompt,
        maxTokens: 1000,
        model: 'claude-haiku-4-5-20251001',
      })

      const stripped = raw.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '')
      const start = stripped.indexOf('{')
      const end   = stripped.lastIndexOf('}')
      if (start === -1 || end === -1) throw new Error('No JSON in response')
      const copy = JSON.parse(stripped.slice(start, end + 1)) as EmailCopy
      if (!copy.subject || !copy.hero || !copy.bullets?.length) throw new Error('Missing required fields')

      copy.hero        = noEmDash(copy.hero)
      copy.intro       = noEmDash(copy.intro)
      copy.boldPhrase  = noEmDash(copy.boldPhrase)
      copy.bulletIntro = noEmDash(copy.bulletIntro)
      copy.bullets     = copy.bullets.map(noEmDash)
      copy.closing     = noEmDash(copy.closing)

      const body = buildEmailHTML(copy, brand.name, brand.websiteUrl ?? '', brand.logoUrl, brand.themeColor)
      results.push({ id: email.id, subject: copy.subject, body })
    } catch (e) {
      console.error('[campaign/refine] error for', email.id, e instanceof Error ? e.message : e)
      results.push({ id: email.id, error: 'Failed to refine this email' })
    }
  }

  return NextResponse.json({ results })
}
