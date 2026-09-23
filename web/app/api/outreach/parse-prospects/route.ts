import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { callAI } from '@/lib/ai/client'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { text } = await req.json() as { text: string }
  if (!text?.trim()) return NextResponse.json({ error: 'text required' }, { status: 400 })

  const prompt = `Extract all contact/person entries from the text below. For each person found, return their email, name, and company domain.

Rules:
- If domain is missing, infer it from the email address (part after @)
- If name is missing, leave it as an empty string
- Only include entries that have a valid email address
- Return an empty array if no valid contacts found
- Do not invent data — only extract what's actually in the text

Text:
${text.slice(0, 8000)}

Return ONLY a JSON array (no markdown, no code fences):
[{"email":"...","name":"...","domain":"..."}]`

  const raw = await callAI({
    system: 'You extract contact information from unstructured text. Return only a raw JSON array.',
    prompt,
    maxTokens: 1000,
    model: 'claude-haiku-4-5-20251001',
  })

  try {
    const start = raw.indexOf('[')
    const end   = raw.lastIndexOf(']')
    if (start === -1 || end === -1) throw new Error('No JSON array in response')
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { email?: string; name?: string; domain?: string }[]
    const prospects = parsed
      .filter(p => p.email?.includes('@'))
      .map((p, i) => ({
        id:     `ai-${Date.now()}-${i}`,
        email:  p.email!.trim(),
        name:   p.name?.trim() ?? '',
        domain: p.domain?.trim() ?? p.email!.split('@')[1] ?? '',
      }))
    return NextResponse.json({ prospects })
  } catch (e) {
    console.error('[parse-prospects] parse error:', e, 'raw:', raw.slice(0, 300))
    return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
  }
}
