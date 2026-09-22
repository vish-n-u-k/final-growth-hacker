import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brainContext } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { callAI } from '@/lib/ai/client'

// ── Types ─────────────────────────────────────────────────────────────────────

interface EmailCopy {
  subject: string
  hero: string
  intro: string
  boldPhrase: string
  bulletIntro: string
  bullets: string[]
  closing: string
  ctaText: string
}

// ── HTML email builder ────────────────────────────────────────────────────────

function buildEmailHTML(copy: EmailCopy, brandName: string, websiteUrl: string): string {
  const domain = (() => {
    try { return new URL(websiteUrl).hostname.replace('www.', '') } catch { return websiteUrl }
  })()

  const p = (text: string) =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.75;color:#1a2e20;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${text}</p>`

  const introHtml = copy.boldPhrase && copy.intro.includes(copy.boldPhrase)
    ? copy.intro.replace(copy.boldPhrase, `<strong style="font-weight:700;color:#1a2e20;">${copy.boldPhrase}</strong>`)
    : copy.intro

  const bulletsHtml = copy.bullets.map(b =>
    `<li style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#1a2e20;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${b}</li>`
  ).join('\n          ')

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;padding:32px 16px 40px;background:#f2f4f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <tr><td align="center">

    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;margin-bottom:14px;">
      <tr><td style="padding:0 4px;">
        <span style="font-size:18px;font-weight:700;color:#2fbf71;letter-spacing:-0.4px;">&#9889; ${brandName}</span>
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
        ${p(`&#8212; The ${brandName} Team`)}

        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 20px;">
          <tr><td>
            <a href="${websiteUrl}" style="display:inline-block;padding:12px 28px;background:#1a1a1a;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:7px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${copy.ctaText}</a>
          </td></tr>
        </table>

        <p style="margin:0;font-size:12px;color:#8a9e90;line-height:1.5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
          If the button does not work, paste this link into your browser:<br/>
          <a href="${websiteUrl}" style="color:#2fbf71;text-decoration:underline;">${websiteUrl}</a>
        </p>

      </td></tr>

      <tr><td style="padding:18px 40px;background:#f7f9f7;border-top:1px solid #e0e8e3;text-align:center;">
        <p style="margin:0 0 4px;font-size:12px;color:#8a9e90;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
          This is an outreach email from <a href="${websiteUrl}" style="color:#2fbf71;text-decoration:none;">${brandName}</a>.
          Need help? Contact <a href="mailto:hello@${domain}" style="color:#2fbf71;text-decoration:none;">hello@${domain}</a>
        </p>
        <p style="margin:0;font-size:11px;color:#aab8b0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
          You received this email because you match the profile we reach out to. We respect your inbox.
        </p>
      </td></tr>
    </table>

  </td></tr>
</table>`
}

// ── Company scraper ───────────────────────────────────────────────────────────

async function scrapeCompany(domain: string): Promise<string> {
  try {
    const url = domain.startsWith('http') ? domain : `https://${domain}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrowJin/1.0; +https://growjin.com)' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return ''
    const html = await res.text()
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 6000)
    return text
  } catch {
    return ''
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { email, name, domain, instruction } = await req.json() as {
    email: string
    name?: string
    domain?: string
    instruction: string
  }

  if (!email || !instruction) {
    return NextResponse.json({ error: 'email and instruction are required' }, { status: 400 })
  }

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  const [brain] = await db.select().from(brainContext).where(eq(brainContext.brandId, brand.id))
  const brainSummary = brain?.summary ?? null

  // Scrape prospect's company homepage if domain provided
  // Also scrape brand's own site if brain context is empty (fallback)
  const [companyText, brandSiteText] = await Promise.all([
    domain ? scrapeCompany(domain) : Promise.resolve(''),
    !brainSummary && brand.websiteUrl ? scrapeCompany(brand.websiteUrl) : Promise.resolve(''),
  ])

  const brandContext = [
    `Company: ${brand.name}`,
    `Website: ${brand.websiteUrl}`,
    brainSummary
      ? `Brand overview:\n${brainSummary}`
      : brandSiteText
        ? `Brand website content (use this to understand what the brand does and offers):\n${brandSiteText}`
        : null,
  ].filter(Boolean).join('\n\n')

  const prospectContext = [
    `Email: ${email}`,
    name ? `Name: ${name}` : null,
    domain ? `Company domain: ${domain}` : null,
    companyText ? `What their company website says (use this to personalize):\n${companyText}` : null,
  ].filter(Boolean).join('\n')

  const prompt = `Write a personalized cold outreach email from ${brand.name} to the prospect below.

CAMPAIGN GOAL / INSTRUCTION:
${instruction}

SENDER (your brand):
${brandContext}

RECIPIENT:
${prospectContext}

Rules:
- Always write the email — never refuse
- Conversational and direct — real person voice, no corporate filler
- Use the campaign instruction to set the angle and value prop
- If company website text is provided, weave in specifics about what they do to show this is genuinely personalized — not a blast
- If a name is provided, use their first name in the opening
- hero: one punchy headline tied to the campaign goal (max 10 words)
- intro: 1–2 sharp sentences connecting their specific context to your value prop
- boldPhrase: pick 2–4 words from intro that are the key value phrase — must exist verbatim in intro
- bulletIntro: natural lead-in before the list (vary the wording)
- bullets: 4–5 concise benefit bullets specific to the campaign goal
- closing: 1 low-friction sentence ("Worth a quick look?" style)
- ctaText: 3–5 word button label

Return ONLY this JSON (no markdown, no code fences, no extra text):
{
  "subject": "plain text subject line",
  "hero": "punchy headline",
  "intro": "opening 1-2 sentences",
  "boldPhrase": "exact key phrase from intro",
  "bulletIntro": "lead-in sentence before the list",
  "bullets": ["benefit one", "benefit two", "benefit three", "benefit four"],
  "closing": "one low-friction closing sentence",
  "ctaText": "button label"
}`

  const raw = await callAI({
    system: 'You are a cold email copywriter. Return only a raw JSON object — no markdown, no code blocks, no extra text.',
    prompt,
    maxTokens: 750,
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
