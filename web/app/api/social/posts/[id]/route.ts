import { NextRequest, NextResponse } from 'next/server'
import { approvePost, cancelPost, refreshPostById, reschedulePost, toClientPost, type When } from '@/lib/frekto/drafts'
import { socialBrand } from '@/lib/frekto/route-auth'

export const maxDuration = 60

// GET — re-check a preview that was still rendering
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await socialBrand()
  if ('response' in auth) return auth.response
  const { id } = await params
  const result = await refreshPostById(auth.brandId, id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status ?? 500 })
  return NextResponse.json({ post: toClientPost(result.post) })
}

// POST { action: 'approve' | 'reschedule' | 'cancel', when?: When, regenerate?: boolean }
//   approve    — schedule the previewed draft (post now, or at a date/time)
//   reschedule — move an already scheduled post
//   cancel     — discard a draft, or take a scheduled post off Frekto's calendar
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await socialBrand()
  if ('response' in auth) return auth.response
  const { id } = await params
  const body = await request.json() as { action?: string; when?: When; regenerate?: boolean }

  const result =
    body.action === 'approve' ? (body.when ? await approvePost(auth.brandId, id, body.when, { regenerate: body.regenerate }) : null)
    : body.action === 'reschedule' ? (body.when ? await reschedulePost(auth.brandId, id, body.when) : null)
    : body.action === 'cancel' ? await cancelPost(auth.brandId, id)
    : null
  if (!result) return NextResponse.json({ error: 'Unknown action or missing "when"' }, { status: 400 })
  if (!result.ok) return NextResponse.json({ error: result.error, canRegenerate: result.canRegenerate ?? false }, { status: result.status ?? 500 })
  return NextResponse.json({ post: toClientPost(result.post) })
}
