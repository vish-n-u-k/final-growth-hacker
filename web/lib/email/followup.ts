import { callAI } from '@/lib/ai/client'

// Follow-up emails use the same branded shell as campaign emails (logo header,
// white card, footer) but a lighter body: greeting, 2-3 short paragraphs, optional button.

export interface FollowupCopy {
  subject: string
  greeting: string
  paragraphs: string[]
  ctaText?: string
  ctaUrl?: string
}

export interface FollowupBrand {
  name: string
  websiteUrl: string | null
  logoUrl?: string | null
  themeColor?: string | null
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const noEmDash = (s: string) => s.replace(/—/g, ',').replace(/\s{2,}/g, ' ').trim()

export function buildFollowupHTML(copy: FollowupCopy, brand: FollowupBrand): string {
  const websiteUrl = brand.websiteUrl ?? ''
  const color = brand.themeColor ?? '#2fbf71'
  const ctaUrl = copy.ctaUrl || websiteUrl
  const name = esc(brand.name)

  const p = (html: string) =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.75;color:#1a2e20;font-family:${FONT};">${html}</p>`

  const brandMark = brand.logoUrl
    ? `<span style="display:inline-flex;align-items:center;gap:10px;"><img src="${esc(brand.logoUrl)}" alt="${name}" style="height:32px;max-width:140px;object-fit:contain;display:block;"><span style="font-size:17px;font-weight:700;color:${color};letter-spacing:-0.3px;">${name}</span></span>`
    : `<span style="font-size:18px;font-weight:700;color:${color};letter-spacing:-0.4px;">&#9889; ${name}</span>`

  const cta = copy.ctaText && ctaUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;">
          <tr><td>
            <a href="${esc(ctaUrl)}" style="display:inline-block;padding:11px 24px;background:${color};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:7px;font-family:${FONT};">${esc(copy.ctaText)}</a>
          </td></tr>
        </table>`
    : ''

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;padding:32px 16px 40px;background:#f2f4f3;font-family:${FONT};">
  <tr><td align="center">

    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;margin-bottom:14px;">
      <tr><td style="padding:0 4px;">
        ${brandMark}
      </td></tr>
    </table>

    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e0e8e3;border-radius:8px;overflow:hidden;">
      <tr><td style="padding:32px 40px 28px;">

        ${p(esc(copy.greeting))}
        ${copy.paragraphs.map(t => p(esc(t))).join('\n        ')}
        ${cta}
        ${p(`The ${name} Team`)}

      </td></tr>

      <tr><td style="padding:16px 40px;background:#f7f9f7;border-top:1px solid #e0e8e3;text-align:center;">
        <p style="margin:0;font-size:12px;color:#8a9e90;font-family:${FONT};">
          Following up on an earlier email from <a href="${esc(websiteUrl)}" style="color:${color};text-decoration:none;">${name}</a>.
        </p>
      </td></tr>
    </table>

  </td></tr>
</table>`
}

/** HTML -> readable plain text, for feeding an existing email back to the model. */
export function htmlToText(html: string, max = 1500): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(p|li|h\d|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
    .slice(0, max)
}

export function firstName(nameOrEmail: string): string | null {
  const s = nameOrEmail.trim()
  if (!s || s.includes('@')) return null
  const first = s.split(/\s+/)[0].replace(/[^\p{L}'-]/gu, '')
  return first ? first[0].toUpperCase() + first.slice(1) : null
}

function parseCopy(raw: string): FollowupCopy {
  const stripped = raw.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '')
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('No JSON in AI response')
  const copy = JSON.parse(stripped.slice(start, end + 1)) as FollowupCopy
  if (!copy.greeting || !Array.isArray(copy.paragraphs) || copy.paragraphs.length === 0) {
    throw new Error('Missing fields in AI response')
  }
  return {
    subject:    noEmDash(copy.subject ?? ''),
    greeting:   noEmDash(copy.greeting),
    paragraphs: copy.paragraphs.map(noEmDash).filter(Boolean).slice(0, 4),
    ctaText:    copy.ctaText ? noEmDash(copy.ctaText) : undefined,
    ctaUrl:     copy.ctaUrl?.startsWith('http') ? copy.ctaUrl : undefined,
  }
}

const JSON_SHAPE = `{
  "greeting": "Hi Sarah," (use their first name if known, otherwise "Hi there,"),
  "paragraphs": ["2-3 short paragraphs, 1-2 sentences each"],
  "ctaText": "optional 2-4 word button label, omit if a button would feel pushy",
  "ctaUrl": "only if the instruction asks for a specific link or UTM parameters, built from the brand base URL; otherwise omit"
}`

/** Writes a fresh follow-up for an email that got no reply. */
export async function writeFollowupCopy(opts: {
  brandContext: string
  brandUrl: string
  recipientName: string | null
  subject: string
  daysSince: number
  threadContext: string
}): Promise<FollowupCopy> {
  const prompt = `You sent an outreach email ${opts.daysSince} day${opts.daysSince !== 1 ? 's' : ''} ago about "${opts.subject || 'your product/service'}". The recipient has not replied.

Write a short, human follow-up. Reference the original briefly, add one new reason to reply (a useful detail, a quick win, or a simple question), and end with a low-friction ask. Light "circling back" tone, never pushy or guilt-trippy.
${opts.recipientName ? `Recipient first name: ${opts.recipientName}` : 'Recipient name unknown.'}
${opts.threadContext ? `\nOriginal thread:\n${opts.threadContext}\n` : ''}
Brand context:
${opts.brandContext}
Brand base URL: ${opts.brandUrl}

Rules: no em dashes, no signature (it is added automatically), no subject line.
Return ONLY this JSON (no markdown):
${JSON_SHAPE}`

  const raw = await callAI({
    system: 'You write short follow-up emails. Return only a raw JSON object, no markdown, no code fences.',
    prompt,
    maxTokens: 500,
    model: 'claude-haiku-4-5-20251001',
  })
  return parseCopy(raw)
}

/** Applies an edit instruction to an existing follow-up. */
export async function refineFollowupCopy(opts: {
  brandContext: string
  brandUrl: string
  recipientName: string | null
  instruction: string
  currentText: string
}): Promise<FollowupCopy> {
  const prompt = `Here is a follow-up email you drafted. Apply the edit instruction to produce an improved version.

EDIT INSTRUCTION:
${opts.instruction}

CURRENT FOLLOW-UP (plain text):
${opts.currentText}

${opts.recipientName ? `Recipient first name: ${opts.recipientName}` : 'Recipient name unknown.'}
Brand context:
${opts.brandContext}
Brand base URL: ${opts.brandUrl}

Rules: apply the instruction faithfully, keep it short, no em dashes, no signature, no subject line.
Return ONLY this JSON (no markdown):
${JSON_SHAPE}`

  const raw = await callAI({
    system: 'You edit short follow-up emails. Return only a raw JSON object, no markdown, no code fences.',
    prompt,
    maxTokens: 500,
    model: 'claude-haiku-4-5-20251001',
  })
  return parseCopy(raw)
}

export function brandContextFor(brand: {
  name: string; usp?: string | null; targetAudience?: string | null; brandVoice?: string | null; playbook?: unknown
}, brainSummary?: string | null): string {
  const playbook = brand.playbook as Record<string, string> | null
  return [
    `Company: ${brand.name}`,
    brand.usp            ? `Value proposition: ${brand.usp}` : null,
    brand.targetAudience ? `Target audience: ${brand.targetAudience}` : null,
    brand.brandVoice     ? `Tone: ${brand.brandVoice}` : null,
    playbook?.keyOneLiners
      ? `Key selling points: ${playbook.keyOneLiners}`
      : brainSummary ? `Brand overview: ${brainSummary.slice(0, 400)}` : null,
  ].filter(Boolean).join('\n')
}
