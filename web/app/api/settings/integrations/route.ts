import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { INTEGRATION_MAP } from '@/lib/integrations/registry'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  const body = await request.json()
  const { provider, fields } = body as { provider: string; fields: Record<string, string> }

  const def = INTEGRATION_MAP[provider]
  if (!def) return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })

  // Separate top-level fields from metadata fields
  const metadataFields: Record<string, string> = {}
  let apiKey: string | undefined
  let accessToken: string | undefined

  for (const fieldDef of def.fields) {
    const value = fields[fieldDef.key]
    if (!value?.trim()) continue
    if (fieldDef.isMetadata) {
      // Sanitize private keys: strip surrounding quotes + normalize \n sequences
      let sanitized = value.trim()
      if (fieldDef.key === 'private_key') {
        sanitized = sanitized.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim()
      }
      metadataFields[fieldDef.key] = sanitized
    } else if (fieldDef.key === 'api_key') {
      apiKey = value.trim()
    } else if (fieldDef.key === 'access_token') {
      accessToken = value.trim()
    }
  }

  await db
    .insert(brandIntegrations)
    .values({
      brandId: brand.id,
      provider,
      type: def.type,
      status: 'connected',
      apiKey: apiKey ?? null,
      accessToken: accessToken ?? null,
      metadata: Object.keys(metadataFields).length > 0 ? metadataFields : null,
      connectedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [brandIntegrations.brandId, brandIntegrations.provider],
      set: {
        apiKey: apiKey ?? null,
        accessToken: accessToken ?? null,
        metadata: Object.keys(metadataFields).length > 0 ? metadataFields : null,
        status: 'connected',
        connectedAt: new Date(),
      },
    })

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  const { provider } = await request.json()

  await db
    .delete(brandIntegrations)
    .where(and(eq(brandIntegrations.brandId, brand.id), eq(brandIntegrations.provider, provider)))

  return NextResponse.json({ ok: true })
}
