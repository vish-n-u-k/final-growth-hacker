// Today → "Create a post": render a social post with Frekto for the user to review.
// Same flow as the GrowJin MCP tools (lib/frekto/posts.ts): create a preview (nothing is
// posted), check on it while it renders, then the user posts or schedules it (./schedule).
import { NextRequest, NextResponse } from 'next/server'
import { brandForRequest } from '@/lib/social/brand-for-request'
import { createSocialPost, getSocialPostStatus, type PostPreview } from '@/lib/frekto/posts'

export const maxDuration = 60

// The inline image and Claude-facing instructions aren't needed in the browser
const forBrowser = (p: PostPreview | { error: string }) => {
  if ('error' in p && !('job_id' in p)) return p
  const { _image, next_step, ...rest } = p as PostPreview
  void _image; void next_step
  return rest
}

export async function POST(request: NextRequest) {
  const brandId = await brandForRequest()
  if (typeof brandId !== 'string') return brandId
  const body = (await request.json().catch(() => ({}))) as { topic?: string; platform?: string; postType?: string }
  const result = await createSocialPost(brandId, { topic: body.topic, platform: body.platform, postType: body.postType })
  return NextResponse.json(forBrowser(result), { status: 'error' in result && !('job_id' in result) ? 400 : 200 })
}

export async function GET(request: NextRequest) {
  const brandId = await brandForRequest()
  if (typeof brandId !== 'string') return brandId
  const result = await getSocialPostStatus(brandId, request.nextUrl.searchParams.get('jobId') ?? '')
  return NextResponse.json(forBrowser(result), { status: 'error' in result && !('job_id' in result) ? 400 : 200 })
}
