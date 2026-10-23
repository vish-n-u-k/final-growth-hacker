import { NextRequest, NextResponse } from 'next/server'
import { requirePro } from '@/lib/billing/guard'
import { createClient } from '@/lib/supabase/server'
import { MAX_FILE_BYTES, FileContactsError, contactsFromFile } from '@/lib/outreach/file-contacts'

export const maxDuration = 30

// Email Outreach: reads the emails (and names / websites when the file has those columns) out of
// an uploaded CSV, Excel, PDF, Word, text or contact-card file. The file itself isn't stored.
export async function POST(req: NextRequest) {
  const proBlock = await requirePro()
  if (proBlock) return proBlock
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: 'That file is over 5 MB' }, { status: 413 })

  try {
    const contacts = await contactsFromFile(file.name, Buffer.from(await file.arrayBuffer()))
    const stamp = Date.now()
    return NextResponse.json({ prospects: contacts.map((c, i) => ({ id: `file-${stamp}-${i}`, ...c })) })
  } catch (e) {
    if (e instanceof FileContactsError) return NextResponse.json({ error: e.message }, { status: 400 })
    console.error('[parse-file]', file.name, e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Could not read that file. Is it damaged or password-protected?' }, { status: 422 })
  }
}
