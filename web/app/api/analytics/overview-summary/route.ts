import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { callAI } from '@/lib/ai/client'

export const maxDuration = 30

const SYSTEM_PROMPT = `You are the narrative engine for Frekto's "Overview" dashboard. Your job is to turn structured audit, module, and analytics data into a single short paragraph under the heading "Summary — in plain terms."

STYLE RULES
- One paragraph, 80–130 words. No bullet points, no headers inside the output.
- Plain English. No jargon, no marketing language, no exclamation points.
- Bold the specific numbers and named entities that matter most, using **double asterisks**.
- If a named entity carries a severity flag (e.g. "critical"), wrap it in a chip instead of bold: {{chip:Entity Name}}. Only chip the single most severe item in the whole summary.
- Order of information, always:
  1. Overall position toward the current goal (e.g. users toward next milestone)
  2. What's fully complete
  3. What's close to complete
  4. The single biggest open gap — name the specific sub-item causing it, not just the score
  5. Product/technical health (e.g. page speed, errors)
- Output ONLY the paragraph text. Do not include the heading "Summary — in plain terms."`

interface ModuleHealth {
  name: string
  score: number
  source: string
  locked: boolean
  insight: string | null
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    brandName: string
    modules: ModuleHealth[]
    posthog: { posthogConnected: boolean; dau: number; mau: number; signups24h: number; signins24h: number } | null
    gsc: { connected: boolean; clicks7d: number | null; impressions7d: number | null; avgPosition7d: number | null } | null
    ga4: { connected: boolean; sessions7d: number | null; newUsers7d: number | null } | null
  }

  const { brandName, modules, posthog, gsc, ga4 } = body

  const activeModules = (modules ?? []).filter(m => !m.locked)
  const avgScore = activeModules.length > 0
    ? Math.round(activeModules.reduce((s, m) => s + m.score, 0) / activeModules.length)
    : 0
  const complete = activeModules.filter(m => m.score >= 90)
  const close    = activeModules.filter(m => m.score >= 60 && m.score < 90)
  const worst    = [...activeModules].sort((a, b) => a.score - b.score)[0]

  const lines: string[] = [
    `Brand: ${brandName}`,
    `Active modules: ${activeModules.length}, avg health score ${avgScore}%`,
    complete.length
      ? `Modules fully complete (≥90%): ${complete.map(m => `${m.name} (${m.score}%)`).join(', ')}`
      : 'No modules fully complete yet',
    close.length
      ? `Modules close to complete (60–89%): ${close.map(m => `${m.name} (${m.score}%)`).join(', ')}`
      : '',
    worst
      ? `Lowest-scoring module: ${worst.name} (${worst.score}%)${worst.insight ? ` — key issue: "${worst.insight}"` : ''}`
      : '',
    '',
    posthog?.posthogConnected
      ? `User activity: DAU ${posthog.dau}, MAU ${posthog.mau} | Last 24h: ${posthog.signups24h} new signups, ${posthog.signins24h} sign-ins`
      : 'PostHog: not connected',
    gsc?.connected
      ? `Search (7d): ${gsc.clicks7d ?? '—'} organic clicks, ${gsc.impressions7d ?? '—'} impressions, avg position ${gsc.avgPosition7d ?? '—'}`
      : 'Google Search Console: not connected',
    ga4?.connected
      ? `Site traffic (7d): ${ga4.sessions7d ?? '—'} sessions, ${ga4.newUsers7d ?? '—'} new users`
      : 'Google Analytics 4: not connected',
  ].filter(Boolean)

  try {
    const text = await callAI({
      model: 'claude-haiku-4-5-20251001',
      system: SYSTEM_PROMPT,
      prompt: lines.join('\n'),
      maxTokens: 300,
    })
    return NextResponse.json({ summary: text.trim() })
  } catch {
    return NextResponse.json({ summary: null })
  }
}
