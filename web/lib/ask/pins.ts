// Ask, phase 4 (md_files/ASK_PLAN.md): a typed question pinned to the home page. The pin keeps the
// question, what it was taken to mean, and the lookups that answered it. Each morning (and when the
// page is opened and the pin is older than STALE_MS) the same lookups run again and Claude writes the
// answer from the fresh data, so the card shows today's number. Refreshes don't count toward the
// daily limit of typed questions.

import Anthropic from '@anthropic-ai/sdk'
import { getSnapshot, saveSnapshot } from '@/lib/signals'
import { agentsDemo, withDemo } from '@/lib/agents/demo'
import { readDemoSwitch } from '@/lib/agents/store'
import { withAIContext } from '@/lib/ai/client'
import { STALE_MS, type OnStep } from './cards'
import { answerLoop, brandIntro, readThread, repeatLookups, type Lookup } from './engine'
import type { Answer } from './types'

const KEY = 'ask:pins'
const key = () => (agentsDemo() ? `${KEY}:demo` : KEY)
export const MAX_PINS = 5

export interface Pin {
  id: string
  question: string
  understood: string
  lookups: Lookup[]
  answer: Answer          // id 'pin:<id>'
  at: string              // when the answer was last worked out
  createdAt: string
  error?: string          // the last refresh failed; the older answer is kept
}

const read = async (brandId: string) => (await getSnapshot<{ pins: Pin[] }>(brandId, key()))?.pins ?? []
const save = (brandId: string, pins: Pin[]) => saveSnapshot(brandId, key(), { pins })

/** The pins' answers, as cards for the home page (newest pin first). */
export async function pinnedAnswers(brandId: string): Promise<Answer[]> {
  return withDemo(await readDemoSwitch(brandId), async () => (await read(brandId)).map(p => ({ ...p.answer, at: p.at })))
}

/** Pins the newest answer of a thread. */
export async function addPin(brandId: string, threadId: string): Promise<{ ok: boolean; error?: string; pins: Answer[] }> {
  return withDemo(await readDemoSwitch(brandId), async () => {
    const pins = await read(brandId)
    const t = await readThread(brandId, threadId)
    const turn = t?.turns[t.turns.length - 1]
    if (!turn) return { ok: false, error: 'That answer has expired. Ask it again, then pin it.', pins: pins.map(p => p.answer) }
    const id = crypto.randomUUID().slice(0, 8)
    // A follow-up ("did it hurt sign-ups?") only makes sense with what it was taken to mean
    const understood = turn.answer.how?.understood ?? ''
    // Every lookup in the conversation: a follow-up often reuses the earlier answers' data instead of fetching
    const seen = new Set<string>()
    const lookups = t!.turns.flatMap(x => x.lookups).filter(l => { const k = JSON.stringify(l); return seen.has(k) ? false : (seen.add(k), true) }).slice(-8)
    // A pinned follow-up is titled with what it meant, so the card makes sense on its own
    const title = t!.turns.length > 1 && understood ? understood.charAt(0).toUpperCase() + understood.slice(1) : turn.question
    if (pins.some(p => p.question.toLowerCase() === title.toLowerCase())) return { ok: true, pins: pins.map(p => ({ ...p.answer, at: p.at })) }
    if (pins.length >= MAX_PINS) return { ok: false, error: `You can pin up to ${MAX_PINS} questions. Unpin one first.`, pins: pins.map(p => p.answer) }
    const pin: Pin = {
      id, question: title, understood, lookups,
      answer: { ...turn.answer, id: `pin:${id}`, question: title }, at: turn.at, createdAt: new Date().toISOString(),
    }
    const next = [pin, ...pins]
    await save(brandId, next)
    return { ok: true, pins: next.map(p => ({ ...p.answer, at: p.at })) }
  })
}

export async function removePin(brandId: string, id: string): Promise<Answer[]> {
  return withDemo(await readDemoSwitch(brandId), async () => {
    const next = (await read(brandId)).filter(p => p.id !== id)
    await save(brandId, next)
    return next.map(p => ({ ...p.answer, at: p.at }))
  })
}

/** Works out each pin's answer again from fresh data (those older than STALE_MS, or all when `force`). */
export async function refreshPins(brandId: string, opts: { force?: boolean; onStep?: OnStep } = {}): Promise<Answer[]> {
  return withDemo(await readDemoSwitch(brandId), () => withAIContext({ brandId, moduleType: 'ask' }, async () => {
    const pins = await read(brandId)
    const due = pins.filter(p => opts.force || Date.now() - Date.parse(p.at) >= STALE_MS)
    if (!due.length) return pins.map(p => ({ ...p.answer, at: p.at }))
    const intro = await brandIntro(brandId)
    for (const p of due) {
      const text = `Updating your pinned question: “${p.question}”`
      opts.onStep?.({ id: `pin:${p.id}`, text, state: 'on' })
      try {
        const data = await repeatLookups(brandId, p.lookups)
        const out = await answerLoop({
          question: p.question, clarified: true, brandId, known: data,
          intro: [
            intro, '',
            `This is a question the owner pinned, answered again each morning: “${p.question}”${p.understood ? ` (taken to mean: ${p.understood})` : ''}.`,
            'The data below was just fetched with the same lookups as last time. Answer from it, in the same shape; look up more only if something is clearly missing.',
            data || '(The lookups returned nothing this time.)',
          ].join('\n'),
          emit: () => {}, refund: async () => {},
          create: q => new Anthropic().messages.create(q),
          runTool: async () => ({ result: { note: 'Use the data already given.' }, usd: 0 }),
        })
        if (out) { p.answer = { ...out.answer, id: `pin:${p.id}`, question: p.question }; p.at = new Date().toISOString(); delete p.error }
        else p.error = 'Couldn’t update this morning'
        opts.onStep?.({ id: `pin:${p.id}`, text, state: out ? 'done' : 'failed', result: out ? (out.answer.number ? `${out.answer.number} ${out.answer.numberLabel}` : 'updated') : 'kept yesterday’s answer' })
      } catch (e) {
        console.error('[ask] pin refresh', p.id, e)
        p.error = 'Couldn’t update this morning'
        opts.onStep?.({ id: `pin:${p.id}`, text, state: 'failed', result: 'kept yesterday’s answer' })
      }
    }
    await save(brandId, pins)
    return pins.map(p => ({ ...p.answer, at: p.at }))
  }))
}
