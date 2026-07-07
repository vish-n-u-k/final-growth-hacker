import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { brandName, websiteUrl, keywords, industry, targetAudience, usp, brandVoice } = await request.json()
  if (!brandName?.trim() || !websiteUrl?.trim()) {
    return NextResponse.json({ error: 'Brand name and website URL are required' }, { status: 400 })
  }

  const url = websiteUrl.trim().startsWith('http') ? websiteUrl.trim() : `https://${websiteUrl.trim()}`

  const [updated] = await db
    .update(brands)
    .set({
      name: brandName.trim(),
      websiteUrl: url,
      keywords: keywords?.trim() || null,
      industry: industry?.trim() || null,
      targetAudience: targetAudience?.trim() || null,
      usp: usp?.trim() || null,
      brandVoice: brandVoice?.trim() || null,
    })
    .where(eq(brands.userId, user.id))
    .returning()

  if (!updated) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
