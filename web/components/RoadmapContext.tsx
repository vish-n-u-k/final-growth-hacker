'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

// Lets the sidebar roadmap and the Growth Path page agree without a server round trip:
// the page publishes which module is selected and its live scores; the sidebar asks the page to switch.
// locked: module types the page currently treats as locked (same rule as its own lock icons).
type Live = { selectedType: string | null; scores: Record<string, number>; locked?: string[] }
type Pick = { type: string; n: number } | null

type Ctx = {
  live: Live
  setLive: (next: Live) => void
  pick: Pick
  pickModule: (type: string) => void
}

const RoadmapCtx = createContext<Ctx>({ live: { selectedType: null, scores: {} }, setLive: () => {}, pick: null, pickModule: () => {} })

export function RoadmapProvider({ children }: { children: ReactNode }) {
  const [live, setLiveState] = useState<Live>({ selectedType: null, scores: {} })
  const [pick, setPick] = useState<Pick>(null)
  const setLive = useCallback((next: Live) => {
    setLiveState(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
  }, [])
  const pickModule = useCallback((type: string) => setPick(prev => ({ type, n: (prev?.n ?? 0) + 1 })), [])
  const value = useMemo(() => ({ live, setLive, pick, pickModule }), [live, setLive, pick, pickModule])
  return <RoadmapCtx.Provider value={value}>{children}</RoadmapCtx.Provider>
}

export const useRoadmap = () => useContext(RoadmapCtx)
