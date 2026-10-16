// Post now or schedule the exact preview the user approved (see ../route.ts).
import { NextRequest, NextResponse } from 'next/server'
import { scheduleSocialPost } from '@/lib/frekto/posts'
import { brandForRequest } from '@/lib/social/brand-for-request'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const brandId = await brandForRequest()
  if (typeof brandId !== 'string') return brandId
  const b = (await request.json().catch(() => ({}))) as {
    jobId?: string; topic?: string; platform?: string; postType?: string
    postNow?: boolean; startDate?: string; time?: string; timezone?: string; allowRegenerate?: boolean
  }
  const result = await scheduleSocialPost(brandId, {
    jobId: b.jobId ?? '', topic: b.topic, platform: b.platform, postType: b.postType,
    postNow: !!b.postNow, startDate: b.startDate, time: b.time, timezone: b.timezone, allowRegenerate: !!b.allowRegenerate,
  })
  return NextResponse.json(result, { status: result.error ? 400 : 200 })
}
