import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import SettingsPage from '@/components/SettingsPage'
import { INTEGRATION_MAP, INTEGRATION_REGISTRY } from '@/lib/integrations/registry'

const VALID_TABS = ['brand', 'playbook', 'integrations', 'claude-code', 'account'] as const
type Tab = typeof VALID_TABS[number]

// Matches metadata keys that hold a secret even when a provider's own field
// definitions don't cover them (e.g. an OAuth-flow token stored server-side).
const SENSITIVE_METADATA_KEY = /token|secret|key|password|credential/i

// Never send real credentials to the browser. Password-type fields (API keys, access
// tokens, OAuth tokens, private keys, client secrets) come back blanked — '' means
// "a value is set but hidden", null means "nothing stored". Non-secret fields (IDs,
// URLs, usernames) pass through unchanged so the UI can keep displaying them.
function maskSecrets(
  provider: string,
  apiKey: string | null,
  accessToken: string | null,
  metadata: Record<string, string> | null,
) {
  const def = INTEGRATION_MAP[provider]
  const maskedMetadata = metadata
    ? Object.fromEntries(
        Object.entries(metadata).map(([key, value]) => {
          const fieldDef = def?.fields.find((f) => f.key === key)
          const isSensitive = fieldDef ? fieldDef.inputType === 'password' : SENSITIVE_METADATA_KEY.test(key)
          return [key, isSensitive ? '' : value]
        }),
      )
    : null

  return {
    apiKey: apiKey != null ? '' : null,
    accessToken: accessToken != null ? '' : null,
    metadata: maskedMetadata,
  }
}

export default async function Settings({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const params = await searchParams
  const initialTab = VALID_TABS.includes(params.tab as Tab) ? (params.tab as Tab) : undefined
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user
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
      ...maskSecrets(row.provider, row.apiKey, row.accessToken, (row.metadata as Record<string, string>) ?? null),
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
      dailyEmailEnabled={brand.dailyEmailEnabled ?? false}
      frektoAutoPostEnabled={brand.frektoAutoPostEnabled ?? false}
      initialTab={initialTab}
    />
  )
}
