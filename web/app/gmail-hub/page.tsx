import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import GmailHub from '@/components/GmailHub'

export default async function GmailHubPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user
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

  const isConnected  = integration?.status === 'connected'
  const gmailAddress = (integration?.metadata as { gmail_address?: string } | null)?.gmail_address ?? null

  return (
    <GmailHub
      brandName={brand.name}
      initialConnected={isConnected}
      gmailAddress={gmailAddress}
    />
  )
}
