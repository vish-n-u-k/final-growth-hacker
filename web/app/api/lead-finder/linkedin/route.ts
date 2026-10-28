import { NextRequest, NextResponse } from 'next/server'
import { requirePro } from '@/lib/billing/guard'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { searchLeads, DEFAULT_LEADS_PER_SEARCH } from '@/lib/leads/linkedin-leads'
import { scoreLeads } from '@/lib/leads/fit-score'
import { readLinkedIn, saveLinkedIn } from '@/lib/leads/linkedin-saved'

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
  const countries = list(body.countries)
  const industries = list(body.industries)
  const keywords = list(body.keywords)
  const technologies = list(body.technologies)
  const sizes = list(body.sizes)
  if (jobTitles.length + industries.length + keywords.length + technologies.length === 0) {
    return NextResponse.json({ error: 'Add at least a job title, an industry, a technology or a keyword to search for.' }, { status: 400 })
  }

  const count = Number(body.count) || DEFAULT_LEADS_PER_SEARCH
  const result = await searchLeads({ jobTitles, countries, industries, keywords, technologies, sizes, count })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 })

  const leads = await scoreLeads(brand.id, result.leads)
  // Keep the form and the results, so the page shows them again without searching (and paying) again
  const str = (v: unknown) => (Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : '').slice(0, 300)
  const before = await readLinkedIn(brand.id)
  await saveLinkedIn(brand.id, {
    filters: {
      titles: str(body.jobTitles), industries: str(body.industries), keywords: str(body.keywords),
      technologies: str(body.technologies), countries: str(body.countries),
      sizes: sizes.filter(x => /^[0-9+-]+$/.test(x)), count, why: typeof body.why === 'string' ? body.why.slice(0, 220) : before?.filters?.why ?? '',
    },
    leads,
    searchedAt: new Date().toISOString(),
  }).catch(e => console.error('[linkedin-leads] could not save the search:', e))
  return NextResponse.json({ leads, total: leads.length })
}
