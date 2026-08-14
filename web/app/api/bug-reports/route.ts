import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { db } from '@/lib/db'
import { bugReports } from '@/lib/db/schema'
import { desc } from 'drizzle-orm'

const BUCKET = 'bug-reports'

function isAdmin(email: string | undefined): boolean {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map(s => s.trim())
    .includes(email ?? '')
}

function storageUrl(key: string) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${key}`
}

async function uploadImage(base64: string, key: string): Promise<string | null> {
  if (!base64.startsWith('data:image/')) return null
  const data = base64.split(',')[1]
  const bytes = Buffer.from(data, 'base64')
  const supabase = createAdminClient()
  const { error } = await supabase.storage.from(BUCKET).upload(key, bytes, {
    contentType: 'image/jpeg',
    upsert: true,
  })
  if (error) { console.error('[bug-reports] storage upload error:', error.message); return null }
  return key
}

// POST — submit a bug report (any authenticated user)
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const {
    remarks,
    severity = 'bug',
    tags = [],
    page_url,
    page_title,
    user_id,
    user_name,
    user_email,
    device_info,
    screenshot,
    extra_images = [],
  } = body

  if (!remarks) return NextResponse.json({ error: 'remarks required' }, { status: 400 })

  const id = crypto.randomUUID()

  const screenshotKey = screenshot
    ? await uploadImage(screenshot, `${id}/screenshot.jpg`)
    : null

  const extraKeys: string[] = []
  for (let i = 0; i < extra_images.length; i++) {
    const key = await uploadImage(extra_images[i], `${id}/extra-${i + 1}.jpg`)
    if (key) extraKeys.push(key)
  }

  await db.insert(bugReports).values({
    id,
    userId: user_id ?? user.id,
    userName: user_name ?? null,
    userEmail: user_email ?? user.email ?? null,
    pageUrl: page_url ?? null,
    pageTitle: page_title ?? null,
    remarks,
    severity,
    tags: Array.isArray(tags) && tags.length ? tags : null,
    deviceInfo: device_info ?? null,
    screenshotKey,
    extraScreenshotKeys: extraKeys.length ? extraKeys : null,
  })

  return NextResponse.json({ id, success: true })
}

// GET — list all reports (admin only)
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rows = await db.select().from(bugReports).orderBy(desc(bugReports.createdAt))

  const items = rows.map(r => ({
    ...r,
    screenshot_url: r.screenshotKey ? storageUrl(r.screenshotKey) : null,
    extra_screenshot_urls: (r.extraScreenshotKeys ?? []).map(storageUrl),
  }))

  return NextResponse.json({ items })
}
