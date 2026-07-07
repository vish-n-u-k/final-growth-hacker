import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { callAI } from '@/lib/ai/client'

interface Msg { from: string; time: string; body: string; isSelf: boolean }

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { subject, messages } = await req.json() as { subject: string; messages: Msg[] }
  if (!messages?.length) return NextResponse.json({ error: 'No messages' }, { status: 400 })

  const transcript = messages
    .map(m => `[${m.isSelf ? 'You' : m.from}] ${m.time}\n${m.body}`)
    .join('\n\n---\n\n')

  const raw = await callAI({
    system: 'You are a sharp business analyst. Be concise and specific. Return only valid JSON.',
    prompt: `Email thread subject: "${subject}"

Transcript:
${transcript.slice(0, 3000)}

Return ONLY this JSON:
{
  "summary": "2–3 sentence summary of what this thread is about, who it's from, and what action is needed",
  "draft": "A concise, human reply to this email thread. Plain text only. If no reply is needed (e.g. automated email, invoice, newsletter), return an empty string."
}`,
    maxTokens: 600,
    model: 'claude-haiku-4-5-20251001',
  })

  try {
    const start  = raw.indexOf('{')
    const end    = raw.lastIndexOf('}')
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { summary: string; draft: string }
    return NextResponse.json({ summary: parsed.summary ?? '', draft: parsed.draft ?? '' })
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
  }
}
