import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getBrandForUser } from '@/lib/server-session'
import { SHOT_BUCKET, shotKey } from '@/lib/audit/screenshot'

// The brand's latest Website Audit page screenshot (private bucket; owner, or an admin with ?brandId=).
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admins = (process.env.ADMIN_EMAILS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const asked = request.nextUrl.searchParams.get('brandId')
  const brandId = asked && admins.includes(user.email ?? '') ? asked : (await getBrandForUser(user.id))?.id
  if (!brandId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Reading the private bucket needs the service-role key; say so plainly when it's missing
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[screenshot] SUPABASE_SERVICE_ROLE_KEY is not set')
    return NextResponse.json({ error: 'Screenshot storage is not configured (SUPABASE_SERVICE_ROLE_KEY missing)' }, { status: 500 })
  }
  const name = request.nextUrl.searchParams.get('name') === 'seo' ? 'seo' : 'website'
  const { data, error } = await createAdminClient().storage.from(SHOT_BUCKET).download(shotKey(brandId, name))
  if (error || !data) {
    console.error('[screenshot] download failed:', error?.message ?? 'no data', brandId)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return new NextResponse(data, {
    headers: {
      'Content-Type': data.type || 'image/webp',
      // The URL carries ?v=<analysis time>, so a new analysis is a new URL
      'Cache-Control': 'private, max-age=86400',
    },
  })
}
