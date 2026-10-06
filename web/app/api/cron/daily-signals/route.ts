import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations, modules } from '@/lib/db/schema'
import { and, eq, ne, isNotNull } from 'drizzle-orm'
import { detectEmailDns, detectMetaAds } from '@/lib/signals/detectors'
import { runDiagnosis } from '@/lib/daily/diagnosis'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Runs before /api/cron/daily-email so new signals land in that day's email

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true // dev: allow if not set
  return req.headers.get('authorization') === `Bearer ${secret}`
}

type Job = { brandId: string; source: string; run: () => Promise<unknown> }

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const started = Date.now()
  const jobs: Job[] = []

  // Email deliverability: brands with an applicable Email Marketing module
  const emailBrands = await db
    .select({ brandId: brands.id, websiteUrl: brands.websiteUrl })
    .from(brands)
    .innerJoin(modules, eq(modules.brandId, brands.id))
    .where(and(eq(modules.type, 'email-marketing'), ne(modules.status, 'not-applicable')))
  for (const b of emailBrands) {
    if (b.websiteUrl) jobs.push({ brandId: b.brandId, source: 'email-marketing', run: () => detectEmailDns(b.brandId, b.websiteUrl!) })
  }

  // Meta Ads: brands with a connected Meta Ads integration
  const metaInts = await db
    .select({ brandId: brandIntegrations.brandId, accessToken: brandIntegrations.accessToken, metadata: brandIntegrations.metadata })
    .from(brandIntegrations)
    .where(and(eq(brandIntegrations.provider, 'meta_ads'), eq(brandIntegrations.status, 'connected')))
  for (const m of metaInts) {
    const accountId = (m.metadata as Record<string, string> | null)?.['ad_account_id'] ?? ''
    if (m.accessToken && accountId) jobs.push({ brandId: m.brandId, source: 'meta-ads', run: () => detectMetaAds(m.brandId, m.accessToken!, accountId) })
  }

  // Growth diagnosis (bottleneck + plays) for every brand with an analysed module.
  // Brands skipped here get diagnosed on demand when they call get_today_tasks.
  const activeBrands = await db
    .selectDistinct({ brandId: modules.brandId })
    .from(modules)
    .where(isNotNull(modules.lastAnalyzedAt))
  for (const b of activeBrands) {
    jobs.push({ brandId: b.brandId, source: 'diagnosis', run: () => runDiagnosis(b.brandId).then((d) => ({ stage: d.stage })) })
  }

  // Run in small parallel batches; stop starting new work near the time limit
  const results: { brandId: string; source: string; result?: unknown; error?: string }[] = []
  const BATCH = 5
  for (let i = 0; i < jobs.length; i += BATCH) {
    if (Date.now() - started > 45_000) {
      results.push(...jobs.slice(i).map((j) => ({ brandId: j.brandId, source: j.source, error: 'skipped: time limit' })))
      break
    }
    const batch = jobs.slice(i, i + BATCH)
    const settled = await Promise.allSettled(batch.map((j) => j.run()))
    settled.forEach((s, k) => {
      const j = batch[k]
      results.push(s.status === 'fulfilled'
        ? { brandId: j.brandId, source: j.source, result: s.value }
        : { brandId: j.brandId, source: j.source, error: String(s.reason) })
    })
  }

  return NextResponse.json({ ok: true, jobs: jobs.length, results })
}
