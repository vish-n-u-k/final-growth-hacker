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
  ctaUrl?: string
}

// ── HTML email builder ────────────────────────────────────────────────────────

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
  const playbook = brand.playbook as Record<string, string> | null

  // Only scrape prospect domain — never fall back to scraping own site when playbook/usp exist
  const hasRichContext = !!(playbook?.executiveSummary || brand.usp || brainSummary)
  const [companyText, brandSiteText] = await Promise.all([
    domain ? scrapeCompany(domain) : Promise.resolve(''),
    !hasRichContext && brand.websiteUrl ? scrapeCompany(brand.websiteUrl) : Promise.resolve(''),
  ])

  const brandContext = [
    `Company: ${brand.name}`,
    `Website: ${brand.websiteUrl}`,
    brand.industry        ? `Industry: ${brand.industry}` : null,
    brand.targetAudience  ? `Target audience: ${brand.targetAudience}` : null,
    brand.usp             ? `Unique value proposition: ${brand.usp}` : null,
    brand.brandVoice      ? `Brand voice / tone: ${brand.brandVoice}` : null,
    brand.keywords        ? `Core keywords / themes: ${brand.keywords}` : null,
    playbook?.executiveSummary ? `Brand summary:\n${playbook.executiveSummary}` : brainSummary ? `Brand overview:\n${brainSummary}` : brandSiteText ? `Brand website content:\n${brandSiteText}` : null,
    playbook?.icp          ? `Ideal customer profile:\n${playbook.icp}` : null,
    playbook?.keyOneLiners ? `Key selling points (use these verbatim or adapt them):\n${playbook.keyOneLiners}` : null,
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
- ctaUrl: if the campaign instruction mentions UTM parameters, tracking links, or a specific URL to link to, set this to the full URL built from the brand base URL (${brand.websiteUrl}). Otherwise omit it.

Return ONLY this JSON (no markdown, no code fences, no extra text):
{
  "subject": "plain text subject line",
  "hero": "punchy headline",
  "intro": "opening 1-2 sentences",
  "boldPhrase": "exact key phrase from intro",
  "bulletIntro": "lead-in sentence before the list",
  "bullets": ["benefit one", "benefit two", "benefit three", "benefit four"],
  "closing": "one low-friction closing sentence",
  "ctaText": "button label",
  "ctaUrl": "full URL if UTM/custom link requested, otherwise omit"
}`

  const raw = await callAI({
    system: 'You are a cold email copywriter. Return only a raw JSON object — no markdown, no code blocks, no extra text.',
    prompt,
    maxTokens: 1200,
    model: 'claude-haiku-4-5-20251001',
  })

  try {
    // Strip markdown fences if present, then extract the JSON object
    const stripped = raw.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '')
    const start = stripped.indexOf('{')
    const end   = stripped.lastIndexOf('}')
    if (start === -1 || end === -1) throw new Error(`No JSON object found in response: ${raw.slice(0, 200)}`)
    const copy  = JSON.parse(stripped.slice(start, end + 1)) as EmailCopy
    if (!copy.subject || !copy.hero || !copy.bullets?.length) throw new Error('Missing required fields in AI response')
    // Strip em dashes from all generated text fields
    const noEmDash = (s: string) => s.replace(/—/g, '').replace(/\s{2,}/g, ' ').trim()
    copy.hero        = noEmDash(copy.hero)
    copy.intro       = noEmDash(copy.intro)
    copy.boldPhrase  = noEmDash(copy.boldPhrase)
    copy.bulletIntro = noEmDash(copy.bulletIntro)
    copy.bullets     = copy.bullets.map(noEmDash)
    copy.closing     = noEmDash(copy.closing)
    const body  = buildEmailHTML(copy, brand.name, brand.websiteUrl ?? '', brand.logoUrl, brand.themeColor)
    return NextResponse.json({ subject: copy.subject, body })
  } catch (e) {
    console.error('[campaign/generate] parse error:', e instanceof Error ? e.message : e, '\nraw:', raw.slice(0, 500))
    return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
  }
}
