import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'

// Every PSI caller in the app should prefer the brand's own connected
// Google PageSpeed Insights key (Settings → Integrations → google_psi) over
// any shared GOOGLE_PSI_API_KEY env var — that's how this app models
// per-brand API keys everywhere else (SerpAPI, GSC, etc).
export async function getBrandPsiApiKey(brandId?: string): Promise<string | undefined> {
  if (!brandId) return undefined
  const [row] = await db
    .select()
    .from(brandIntegrations)
    .where(and(
      eq(brandIntegrations.brandId, brandId),
      eq(brandIntegrations.provider, 'google_psi'),
      eq(brandIntegrations.status, 'connected'),
    ))
    .limit(1)
  return row?.apiKey ?? undefined
}
