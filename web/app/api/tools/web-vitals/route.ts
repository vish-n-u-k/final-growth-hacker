import { NextRequest, NextResponse } from 'next/server'
import { scanWebVitals, type WebVitalsScanResult } from '@/lib/web-vitals-scan'
import { getBrandPsiApiKey } from '@/lib/integrations/psi-key'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const { websiteUrl, brandId } = await request.json() as { websiteUrl: string; brandId?: string }
  if (!websiteUrl) return NextResponse.json({ error: 'Missing URL' }, { status: 400 })

  const url = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`
  const apiKey = await getBrandPsiApiKey(brandId)
  const result = await scanWebVitals(url, apiKey)

  if (!result) {
    return NextResponse.json({ error: 'Could not analyze this page right now — try again in a moment.' }, { status: 502 })
  }

  return NextResponse.json(result satisfies WebVitalsScanResult)
}
