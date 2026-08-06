import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function getBrandInfo(brandId: string) {
  const [brand] = await db
    .select()
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1)

  if (!brand) return { error: 'Brand not found.' }

  const playbook = brand.playbook as Record<string, string> | null
  return {
    name: brand.name,
    websiteUrl: brand.websiteUrl,
    industry: brand.industry ?? null,
    targetAudience: brand.targetAudience ?? null,
    usp: brand.usp ?? null,
    executiveSummary: playbook?.executiveSummary ?? null,
  }
}
