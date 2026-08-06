import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import SettingsPage from '@/components/SettingsPage'
import { INTEGRATION_REGISTRY } from '@/lib/integrations/registry'

export default async function Settings() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) redirect('/onboarding')

  const integrations = await db
    .select()
    .from(brandIntegrations)
    .where(eq(brandIntegrations.brandId, brand.id))

  const connectedMap: Record<string, {
    status: string
    apiKey: string | null
    accessToken: string | null
    metadata: Record<string, string> | null
  }> = {}

  for (const row of integrations) {
    connectedMap[row.provider] = {
      status: row.status,
      apiKey: row.apiKey,
      accessToken: row.accessToken,
      metadata: (row.metadata as Record<string, string>) ?? null,
    }
  }

  const mcpRow = integrations.find((r) => r.provider === 'mcp')
  const mcpKeyPrefix = mcpRow?.apiKey ? mcpRow.apiKey.slice(0, 8) : null

  return (
    <SettingsPage
      brand={{
        name: brand.name,
        websiteUrl: brand.websiteUrl,
        keywords: brand.keywords ?? '',
        industry: brand.industry ?? '',
        targetAudience: brand.targetAudience ?? '',
        usp: brand.usp ?? '',
        brandVoice: brand.brandVoice ?? '',
      }}
      playbook={(brand.playbook as Record<string, string> | null) ?? null}
      userEmail={user.email ?? ''}
      integrationRegistry={INTEGRATION_REGISTRY}
      connectedIntegrations={connectedMap}
      mcpKeyPrefix={mcpKeyPrefix}
    />
  )
}
