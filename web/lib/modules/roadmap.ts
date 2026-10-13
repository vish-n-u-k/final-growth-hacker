// Display-only roadmap: the module chain grouped into stages for the sidebar. Locking and scoring
// stay where they are (lock-state.ts, AllModulesDashboard); this only groups and counts what they say.

export const ROADMAP_DONE_AT = 80

// Grouping of the module chain (by registry `order`).
export const GROWTH_PHASES = [
  { maxOrder: 3,        name: 'Get set up',    blurb: 'Foundation, website, SEO' },
  { maxOrder: 7,        name: 'Get found',     blurb: 'AI search, social, brand' },
  { maxOrder: 11,       name: 'Win attention', blurb: 'Content, competitors, outreach, ads' },
  { maxOrder: Infinity, name: 'Scale',         blurb: 'Analytics, email, audience' },
]

// One colour scale for progress everywhere (module rings, sidebar dots and bars):
// red, orange, yellow, then green as the score climbs.
export function progressColor(score: number): string {
  if (score >= 85) return 'var(--progress-good)'  // dark green on light, bright green on dark
  if (score >= 65) return '#fbbf24'
  if (score >= 35) return '#fb923c'
  return '#f43f5e'
}

export type RoadmapModule = {
  id: string
  type: string
  name: string
  order: number
  score: number        // last stored score; the dashboard overrides it with its live score
  analysed: boolean
  comingSoon: boolean
  locked: boolean      // previous module is under 80% (production only)
  planLocked: boolean  // needs GrowJin Pro
}

export type RoadmapPhase = {
  name: string
  blurb: string
  mods: RoadmapModule[]
  total: number
  done: number
  pct: number      // average score of the stage's modules
  locked: boolean
  pro: boolean
}

export type RoadmapState = { done: boolean; locked: boolean; soon: boolean; pro: boolean; score: number }

export function roadmapState(m: RoadmapModule, live: Record<string, number>): RoadmapState {
  const score = live[m.type] ?? m.score
  return {
    score,
    soon: m.comingSoon,
    pro: m.planLocked,
    locked: m.locked,
    done: !m.locked && !m.comingSoon && score >= ROADMAP_DONE_AT,
  }
}

export function buildRoadmapPhases(mods: RoadmapModule[], live: Record<string, number>): RoadmapPhase[] {
  return GROWTH_PHASES.map((p, i) => {
    const inPhase = mods.filter(m => GROWTH_PHASES.findIndex(g => m.order <= g.maxOrder) === i)
    const active = inPhase.filter(m => !m.comingSoon)
    return {
      name: p.name,
      blurb: p.blurb,
      mods: inPhase,
      total: active.length,
      done: active.filter(m => roadmapState(m, live).done).length,
      pct: active.length ? Math.round(active.reduce((sum, m) => sum + Math.min(roadmapState(m, live).score, 100), 0) / active.length) : 0,
      locked: active.length > 0 && active.every(m => m.locked),
      pro: active.length > 0 && active.every(m => m.planLocked),
    }
  }).filter(p => p.mods.length > 0)
}

// The module to work on next: the first unlocked one still under 80%.
export function currentRoadmapType(mods: RoadmapModule[], live: Record<string, number>): string | null {
  const next = mods.find(m => !m.comingSoon && !m.locked && roadmapState(m, live).score < ROADMAP_DONE_AT)
  return (next ?? mods.filter(m => !m.comingSoon).at(-1) ?? mods[0])?.type ?? null
}
