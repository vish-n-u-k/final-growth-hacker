import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import GmailHub from '@/components/GmailHub'
import { checkGmail } from '@/lib/gmail/token'

export default async function GmailHubPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) redirect('/onboarding')

  const [integration] = await db
    .select({
      status:      brandIntegrations.status,
      metadata:    brandIntegrations.metadata,
    })
    .from(brandIntegrations)
    .where(
      and(
        eq(brandIntegrations.brandId, brand.id),
        eq(brandIntegrations.provider, 'gmail'),
      )
    )
    .limit(1)

  // Ask Google, not just our row: a revoked or expired login is marked expired by checkGmail.
  // A network hiccup doesn't count as broken.
  const check = integration?.status === 'connected' ? await checkGmail(brand.id).catch(() => null) : null
  const expired = integration?.status === 'expired' || (!!check && !check.ok && /stopped accepting/.test(check.detail))
  const isConnected  = integration?.status === 'connected' && !expired
  const gmailAddress = (integration?.metadata as { gmail_address?: string } | null)?.gmail_address ?? null

  return (
    <GmailHub
      brandName={brand.name}
      initialConnected={isConnected}
      gmailAddress={gmailAddress}
      needsReconnect={expired}
    />
  )
}
