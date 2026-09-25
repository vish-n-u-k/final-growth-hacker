import { NextRequest, NextResponse } from 'next/server'
import { scanColorContrast, type ColorContrastScanResult } from '@/lib/color-contrast-scan'

// A mobile PageSpeed Insights run often takes 20–40s+
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const { websiteUrl, fresh } = await request.json() as { websiteUrl: string; fresh?: boolean }
  if (!websiteUrl) return NextResponse.json({ error: 'Missing URL' }, { status: 400 })

  const url = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`
  const result = await scanColorContrast(url, !!fresh)

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 502 })
  }

  return NextResponse.json(result satisfies ColorContrastScanResult)
}
