import { NextRequest, NextResponse } from 'next/server'
import * as cheerio from 'cheerio'
import { callAI } from '@/lib/ai/client'

function normalizeUrl(url: string): string {
  return url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`
}

async function fetchWebsiteText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (BusinessAnalyzerBot/1.0)', Accept: 'text/html' },
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) throw new Error(`Failed to fetch site: ${res.status}`)

    const html = await res.text()
    const $ = cheerio.load(html)
    $('script, style, noscript, svg, iframe, footer, nav').remove()

    const parts: string[] = []

    const title = $('title').first().text().trim()
    if (title) parts.push(`TITLE: ${title}`)

    const metaDesc =
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') || ''
    if (metaDesc) parts.push(`META DESCRIPTION: ${metaDesc}`)

    const ogTitle = $('meta[property="og:title"]').attr('content') || ''
    if (ogTitle) parts.push(`OG TITLE: ${ogTitle}`)

    $('h1, h2, h3').each((_, el) => {
      const text = $(el).text().trim()
      if (text.length > 3) parts.push(`HEADING: ${text}`)
    })

    $('button, a').each((_, el) => {
      const text = $(el).text().trim()
      if (text.length > 3 && text.length < 80) parts.push(`CTA: ${text}`)
    })

    $('p').each((_, el) => {
      const text = $(el).text().trim()
      if (text.length > 40) parts.push(text)
    })

    const unique = [...new Set(parts)]
    return unique.join('\n').replace(/\s+/g, ' ').replace(/\n+/g, '\n').trim().slice(0, 15000)
  } catch (err) {
    console.error('fetchWebsiteText error:', err instanceof Error ? err.message : err)
    return ''
  }
}

const SYSTEM_PROMPT = `You are a business analyst API. Given a website URL and extracted text, infer the business details.

Return ONLY a valid JSON object with exactly these keys:
- "brandName": the name of the business or product — under 60 chars
- "industry": the industry/category (e.g. "SaaS", "E-commerce", "Healthcare", "FinTech", "Agency") — under 80 chars
- "targetAudience": who the product/service is for (e.g. "Small business owners", "Marketing managers at B2B SaaS") — under 150 chars
- "usp": the main unique selling proposition or value proposition — under 150 chars
- "brandVoice": the tone and style of the brand (e.g. "Professional and friendly", "Bold and direct") — under 80 chars
- "keywords": 3-5 key topics/areas the brand focuses on, comma-separated (e.g. "AI, automation, social media") — under 100 chars

Rules:
- Base answers on the extracted text where possible
- If a field is unclear or undetectable, return an empty string "" for that field
- keywords should reflect the core products/services and market positioning
- Return ONLY valid JSON. No markdown fences, no extra text.`

export async function POST(request: NextRequest) {
  const { websiteUrl } = await request.json()
  if (!websiteUrl?.trim()) {
    return NextResponse.json({ error: 'websiteUrl required' }, { status: 400 })
  }

  const url = normalizeUrl(websiteUrl.trim())
  const siteText = await fetchWebsiteText(url)

  const userPrompt =
    siteText.length > 20
      ? `Website URL: ${url}\n\nEXTRACTED WEBSITE TEXT:\n${siteText}`
      : `Website URL: ${url}\n\nNo readable text was extracted. Infer details from the URL only.`

  try {
    const raw = await callAI({
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      maxTokens: 400,
    })

    const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '')
    const parsed = JSON.parse(cleaned) as Record<string, string>

    return NextResponse.json({
      brandName: parsed.brandName ?? '',
      industry: parsed.industry ?? '',
      keywords: parsed.keywords ?? '',
      targetAudience: parsed.targetAudience ?? '',
      usp: parsed.usp ?? '',
      brandVoice: parsed.brandVoice ?? '',
    })
  } catch (err) {
    console.error('prefill AI error:', err)
    return NextResponse.json({ brandName: '', industry: '', keywords: '', targetAudience: '', usp: '', brandVoice: '' })
  }
}
