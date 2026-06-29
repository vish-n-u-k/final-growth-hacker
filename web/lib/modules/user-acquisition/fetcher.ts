import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UserAcquisitionFetchResult {
  brandName: string
  websiteUrl: string
  industry: string | null
  targetAudience: string | null
  usp: string | null
  brandVoice: string | null
  userCount: number
  posthogConnected: boolean
  countSource: 'posthog' | 'manual' | 'unknown'
  phase: 1 | 2 | 3 | 4 | 5
  phaseLabel: string
  nextPhaseLabel: string
  usersToNextPhase: number | null // null if already at Phase 5
}

// ── Phase detection ───────────────────────────────────────────────────────────

interface PhaseInfo {
  phase: 1 | 2 | 3 | 4 | 5
  label: string
  nextLabel: string
  nextThreshold: number | null
}

function detectPhase(count: number): PhaseInfo {
  if (count <= 10)  return { phase: 1, label: 'Phase 1 — Zero to First Users (0–10)',  nextLabel: 'Phase 2 — Early Adopters (11–50)',            nextThreshold: 11 }
  if (count <= 50)  return { phase: 2, label: 'Phase 2 — Early Adopters (11–50)',       nextLabel: 'Phase 3 — Organic Traction (51–200)',         nextThreshold: 51 }
  if (count <= 200) return { phase: 3, label: 'Phase 3 — Organic Traction (51–200)',    nextLabel: 'Phase 4 — Scaling Acquisition (201–500)',     nextThreshold: 201 }
  if (count <= 500) return { phase: 4, label: 'Phase 4 — Scaling Acquisition (201–500)', nextLabel: 'Phase 5 — Growth Infrastructure (500+)',     nextThreshold: 501 }
  return { phase: 5, label: 'Phase 5 — Growth Infrastructure (500+)', nextLabel: 'Sustaining growth at scale', nextThreshold: null }
}

// ── PostHog user count ────────────────────────────────────────────────────────

async function fetchPosthogCount(brandId: string): Promise<{ count: number; connected: boolean }> {
  const [integration] = await db
    .select()
    .from(brandIntegrations)
    .where(and(
      eq(brandIntegrations.brandId, brandId),
      eq(brandIntegrations.provider, 'posthog'),
      eq(brandIntegrations.status, 'connected'),
    ))
    .limit(1)

  if (!integration?.apiKey) return { count: 0, connected: false }

  const meta = (integration.metadata as Record<string, string> | null) ?? {}
  const projectId = meta['project_id']
  const host = meta['posthog_host']?.replace(/\/$/, '') || 'https://us.posthog.com'

  if (!projectId) return { count: 0, connected: true }

  try {
    const res = await fetch(`${host}/api/projects/${projectId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${integration.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query: 'SELECT count() FROM persons' } }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return { count: 0, connected: true }
    const data = await res.json() as { results?: number[][] }
    return { count: data.results?.[0]?.[0] ?? 0, connected: true }
  } catch {
    return { count: 0, connected: true }
  }
}

// ── Main fetcher ──────────────────────────────────────────────────────────────

export async function fetchUserAcquisitionData(
  requirements: Record<string, string>,
): Promise<UserAcquisitionFetchResult> {
  const brandId        = requirements['brand_id'] ?? ''
  const brandName      = requirements['brand_name'] ?? ''
  const websiteUrl     = requirements['website_url'] ?? ''
  const industry       = requirements['industry'] || null
  const targetAudience = requirements['target_audience'] || null
  const usp            = requirements['usp'] || null
  const brandVoice     = requirements['brand_voice'] || null

  // Manual override in requirements takes priority over PostHog
  const manualRaw = requirements['user_count']?.trim()
  const manualCount = manualRaw ? parseInt(manualRaw, 10) : NaN

  let userCount = 0
  let posthogConnected = false
  let countSource: UserAcquisitionFetchResult['countSource'] = 'unknown'

  if (!isNaN(manualCount) && manualCount >= 0) {
    userCount = manualCount
    countSource = 'manual'
  } else if (brandId) {
    const ph = await fetchPosthogCount(brandId)
    userCount = ph.count
    posthogConnected = ph.connected
    countSource = ph.connected ? 'posthog' : 'unknown'
  }

  const { phase, label: phaseLabel, nextLabel: nextPhaseLabel, nextThreshold } = detectPhase(userCount)
  const usersToNextPhase = nextThreshold !== null ? Math.max(0, nextThreshold - userCount) : null

  return {
    brandName,
    websiteUrl,
    industry,
    targetAudience,
    usp,
    brandVoice,
    userCount,
    posthogConnected,
    countSource,
    phase,
    phaseLabel,
    nextPhaseLabel,
    usersToNextPhase,
  }
}
