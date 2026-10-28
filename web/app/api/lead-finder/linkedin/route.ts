import { NextRequest, NextResponse } from 'next/server'
import { requirePro } from '@/lib/billing/guard'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { searchLeads, DEFAULT_LEADS_PER_SEARCH } from '@/lib/leads/linkedin-leads'
import { scoreLeads } from '@/lib/leads/fit-score'

export const maxDuration = 180

// Free text from the form ("CEO, Founder") → a short, clean list
function list(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  return raw
    .map((v) => String(v).trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 10)
}

export async function POST(req: NextRequest) {
  const proBlock = await requirePro()
  if (proBlock) return proBlock
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  if (!process.env.APIFY_API_TOKEN?.trim()) {
    return NextResponse.json({ error: 'LinkedIn lead search is not switched on yet.' }, { status: 503 })
  }

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* handled below */ }

  const jobTitles = list(body.jobTitles)
  const locations = list(body.locations)
  const industries = list(body.industries)
  const keywords = list(body.keywords)
  if (jobTitles.length + industries.length + keywords.length === 0) {
    return NextResponse.json({ error: 'Add at least a job title, an industry or a keyword to search for.' }, { status: 400 })
  }

  const count = Number(body.count) || DEFAULT_LEADS_PER_SEARCH
  const result = await searchLeads({ jobTitles, locations, industries, keywords, count })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 })

  const leads = await scoreLeads(brand.id, result.leads)
  return NextResponse.json({ leads, total: leads.length })
}
