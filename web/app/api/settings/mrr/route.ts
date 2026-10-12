import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBrandForUser } from '@/lib/server-session'
import { getMrrSettings, saveMrrSettings } from '@/lib/mrr'
import { parseMrrSettings } from '@/lib/mrr-shared'

async function currentBrand() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user ? getBrandForUser(user.id) : null
}

export async function GET() {
  const brand = await currentBrand()
  if (!brand) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ settings: await getMrrSettings(brand.id) })
}

export async function PUT(request: NextRequest) {
  const brand = await currentBrand()
  if (!brand) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const settings = body?.clear ? null : parseMrrSettings(body)
  if (!body?.clear && !settings) {
    return NextResponse.json({ error: 'Enter a monthly price above 0 and a paying share between 1 and 100%.' }, { status: 400 })
  }
  if (!(await saveMrrSettings(brand.id, settings))) {
    return NextResponse.json({ error: "Couldn't save your price right now. Please try again later." }, { status: 503 })
  }
  return NextResponse.json({ settings })
}
