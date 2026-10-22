// Live progress of an agent run, for the "what the agent is doing" popup. The run writes each
// step's state as it goes (one small JSON document per brand and agent); the page polls it.

import { getSnapshot, saveSnapshot } from '@/lib/signals'

// warn: the step worked and found a problem the user should look at
export type StepStatus = 'pending' | 'running' | 'done' | 'warn' | 'skipped' | 'error'
export interface ProgressStep { key: string; label: string; status: StepStatus; detail?: string }
export interface RunProgress { runId: string; startedAt: string; finishedAt?: string; title: string; steps: ProgressStep[]; summary?: string }

const keyOf = (agent: 'lead' | 'search') => `agent:progress:${agent}`

export class Progress {
  private doc: RunProgress
  private saving: Promise<void> = Promise.resolve()

  constructor(private brandId: string, private agent: 'lead' | 'search', title: string, steps: { key: string; label: string }[]) {
    this.doc = { runId: `${Date.now()}`, startedAt: new Date().toISOString(), title, steps: steps.map(s => ({ ...s, status: 'pending' })) }
    this.save()
  }

  // Writes one after another, so a later state never lands before an earlier one
  private save() {
    const snapshot = JSON.parse(JSON.stringify(this.doc))
    this.saving = this.saving.then(() => saveSnapshot(this.brandId, keyOf(this.agent), snapshot)).catch(() => {})
  }

  set(key: string, status: StepStatus, detail?: string) {
    const s = this.doc.steps.find(x => x.key === key)
    if (!s) return
    s.status = status
    if (detail !== undefined) s.detail = detail
    this.save()
  }

  /** Marks the step running, runs `fn`, then done (with the detail it returns) or error. */
  async step<T>(key: string, fn: () => Promise<T>, detail?: (r: T) => string | undefined): Promise<T> {
    this.set(key, 'running')
    try {
      const r = await fn()
      this.set(key, 'done', detail?.(r))
      return r
    } catch (e) {
      this.set(key, 'error', e instanceof Error ? e.message : 'failed')
      throw e
    }
  }

  /** Ends the run. `failed`: the step that was running when it stopped is marked as the problem. */
  async finish(summary?: string, failed = false) {
    for (const s of this.doc.steps) if (s.status === 'pending' || s.status === 'running') s.status = failed && s.status === 'running' ? 'error' : 'skipped'
    this.doc.finishedAt = new Date().toISOString()
    this.doc.summary = summary
    this.save()
    await this.saving
  }
}

export async function readProgress(brandId: string, agent: 'lead' | 'search'): Promise<RunProgress | null> {
  return getSnapshot<RunProgress>(brandId, keyOf(agent))
}
