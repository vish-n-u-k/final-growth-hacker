import { db } from '@/lib/db'
import { adminSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

// How Growth Path modules run when a user clicks Run.
// 'direct': the analysis runs straight away through the AI API (the default).
// 'queue':  the old manual flow: the request lands in the admin queue and the admin runs it.
// Foundation always runs directly. The admin page flips this, so it can go back to the queue
// (e.g. if API costs spike) without a deploy.
export type AnalysisMode = 'direct' | 'queue'

const KEY = 'module_analysis_mode'

export async function getAnalysisMode(): Promise<AnalysisMode> {
  try {
    const [row] = await db.select().from(adminSettings).where(eq(adminSettings.key, KEY))
    return row?.value === 'queue' ? 'queue' : 'direct'
  } catch (err) {
    console.error('[analysis-mode] read failed, running directly:', err)
    return 'direct'
  }
}

export async function setAnalysisMode(mode: AnalysisMode): Promise<void> {
  await db
    .insert(adminSettings)
    .values({ key: KEY, value: mode, updatedAt: new Date() })
    .onConflictDoUpdate({ target: adminSettings.key, set: { value: mode, updatedAt: new Date() } })
}

// Ask's own switch (admin page): the same two choices for Ask's AI work (questions, lead searches,
// website reviews, pattern checks). Separate from module runs. Writing emails always runs.
const ASK_KEY = 'ask_analysis_mode'

export async function getAskMode(): Promise<AnalysisMode> {
  try {
    const [row] = await db.select().from(adminSettings).where(eq(adminSettings.key, ASK_KEY))
    return row?.value === 'queue' ? 'queue' : 'direct'
  } catch (err) {
    console.error('[analysis-mode] ask read failed, running directly:', err)
    return 'direct'
  }
}

export async function setAskMode(mode: AnalysisMode): Promise<void> {
  await db
    .insert(adminSettings)
    .values({ key: ASK_KEY, value: mode, updatedAt: new Date() })
    .onConflictDoUpdate({ target: adminSettings.key, set: { value: mode, updatedAt: new Date() } })
}
