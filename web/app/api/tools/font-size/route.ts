import { NextRequest, NextResponse } from 'next/server'
import { scanFontSize, type FontSizeScanResult } from '@/lib/font-size-scan'

export const maxDuration = 30

export async function POST(request: NextRequest) {
  const { websiteUrl } = await request.json() as { websiteUrl: string }
  if (!websiteUrl) return NextResponse.json({ error: 'Missing URL' }, { status: 400 })

  const url = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`
  const result = await scanFontSize(url)

  if (!result) {
    return NextResponse.json({ error: 'Could not analyze this page right now — try again in a moment.' }, { status: 502 })
  }

  return NextResponse.json(result satisfies FontSizeScanResult)
}
