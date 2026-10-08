import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { buildTodayPrompt } from '@/lib/daily/today-tasks'
import { isValidClickSig, logActivity } from '@/lib/activity'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// "Do it in Claude" button in the daily email: count the click, then open Claude
// with today's prompt. Public (no login) — the link is signed per brand.
export async function GET(req: NextRequest) {
  const brandId = req.nextUrl.searchParams.get('b') ?? ''
  const sig = req.nextUrl.searchParams.get('s') ?? ''
  if (!UUID.test(brandId) || !isValidClickSig(brandId, sig)) {
    return NextResponse.redirect('https://claude.ai/new')
  }

  const [brand] = await db.select({ name: brands.name, websiteUrl: brands.websiteUrl })
    .from(brands).where(eq(brands.id, brandId)).limit(1)
  if (!brand) return NextResponse.redirect('https://claude.ai/new')

  const [github] = await db.select({ metadata: brandIntegrations.metadata })
    .from(brandIntegrations)
    .where(and(
      eq(brandIntegrations.brandId, brandId),
      eq(brandIntegrations.provider, 'github'),
      eq(brandIntegrations.status, 'connected'),
    ))
    .limit(1)

  await logActivity(brandId, 'email_claude_click')

  const prompt = buildTodayPrompt({
    brandName: brand.name,
    websiteUrl: brand.websiteUrl ?? null,
    githubRepo: (github?.metadata as Record<string, string> | null)?.repo_url ?? null,
  })
  return NextResponse.redirect(`https://claude.ai/new?q=${encodeURIComponent(prompt)}`)
}
