import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules, moduleItems } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

interface CalendarEntry {
  date: string
  topic: string
  category: string
  format: string
  priority: string
  stage: string
}

// ── CSV helpers ───────────────────────────────────────────────────────────────

function escapeCell(value: unknown): string {
  const str = value == null ? '' : String(value)
  // Wrap in quotes if contains comma, quote, or newline
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function toCSV(entries: CalendarEntry[]): string {
  const headers = ['Date', 'Topic', 'Category', 'Format', 'Priority', 'Stage']
  const rows = entries.map(e => [
    escapeCell(e.date),
    escapeCell(e.topic),
    escapeCell(e.category),
    escapeCell(e.format),
    escapeCell(e.priority),
    escapeCell(e.stage),
  ].join(','))

  return [headers.join(','), ...rows].join('\r\n')
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ moduleId: string }> },
) {
  const { moduleId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify ownership
  const [mod] = await db.select().from(modules).where(eq(modules.id, moduleId))
  if (!mod) return NextResponse.json({ error: 'Module not found' }, { status: 404 })

  if (mod.type !== 'content-audit') {
    return NextResponse.json({ error: 'Calendar only available for content audit modules' }, { status: 400 })
  }

  const [brand] = await db.select().from(brands).where(eq(brands.id, mod.brandId))
  if (!brand || brand.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Find the calendar item
  const items = await db.select().from(moduleItems).where(eq(moduleItems.moduleId, moduleId))
  const calendarItem = items.find(i => i.slug === 'content-calendar-30-day')

  if (!calendarItem?.aiData) {
    return NextResponse.json(
      { error: 'Calendar not yet generated. Run the Content Audit analysis first.' },
      { status: 404 },
    )
  }

  // Parse and validate calendar entries
  let entries: CalendarEntry[]
  try {
    const raw = calendarItem.aiData as CalendarEntry[]
    if (!Array.isArray(raw) || raw.length === 0) throw new Error('Empty calendar data')
    entries = raw.filter(e => e.date && e.topic)
  } catch {
    return NextResponse.json({ error: 'Calendar data is malformed. Re-run the analysis.' }, { status: 500 })
  }

  const csv = toCSV(entries)
  const filename = `content-calendar-${brand.name.toLowerCase().replace(/\s+/g, '-')}.csv`

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
