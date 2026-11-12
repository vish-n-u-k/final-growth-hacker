import { NextRequest, NextResponse } from 'next/server'
import { askAccess } from '@/lib/agents/access'
import { createClient } from '@/lib/supabase/server'
import { enqueue, modeFor } from '@/lib/ask/queue'
import { withAIContext } from '@/lib/ai/client'
import { addRule, answerOffer, editItem, importRules, offerOf, readMemory, refreshNoticed, removeItem, type Memory } from '@/lib/ask/memory'

// What Ask remembers (lib/ask/memory.ts):
//   GET                                  → { memory, offer } (offer: a noticed pattern to suggest as a rule)
//   POST { op: 'add', text }             → a rule of their own
//   POST { op: 'edit', id, text } | { op: 'delete', id }
//   POST { op: 'import', text }          → paste another Claude chat's memory, one rule per line
//   POST { op: 'offer', id, yes }        → make a noticed pattern a rule, or don't suggest it again
//   POST { op: 'notice' }                → look at what they've done again now
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const out = (m: Memory, extra: Record<string, unknown> = {}) => NextResponse.json({ memory: m, offer: offerOf(m), ...extra })

export async function GET() {
  const a = await askAccess()
  if (a.error) return a.error
  return out(await readMemory(a.brandId))
}

export async function POST(req: NextRequest) {
  const a = await askAccess()
  if (a.error) return a.error
  const b = await req.json().catch(() => ({})) as { op?: string; id?: string; text?: string; yes?: boolean }
  const id = typeof b.id === 'string' ? b.id : ''
  switch (b.op) {
    case 'add': {
      const item = await addRule(a.brandId, String(b.text ?? ''), 'you')
      if (!item) return NextResponse.json({ error: 'Write a rule first.' }, { status: 400 })
      return out(await readMemory(a.brandId))
    }
    case 'edit': return out(await editItem(a.brandId, id, String(b.text ?? '')))
    case 'delete': return out(await removeItem(a.brandId, id))
    case 'import': {
      const r = await importRules(a.brandId, String(b.text ?? '').slice(0, 20_000))
      return out(r.memory, { added: r.added })
    }
    case 'offer': return out(await answerOffer(a.brandId, id, b.yes === true))
    case 'notice': {
      const { data: { user } } = await (await createClient()).auth.getUser()
      if (await modeFor(user?.email) === 'queue') {
        await enqueue(a.brandId, { id: user?.id ?? '', email: user?.email ?? '' }, { kind: 'notice', question: 'Look again at what I’ve done' })
        return out(await readMemory(a.brandId), { queued: true })
      }
      return out(await withAIContext({ brandId: a.brandId, moduleType: 'ask-memory' }, () => refreshNoticed(a.brandId, true)))
    }
    default: return NextResponse.json({ error: 'Unknown op' }, { status: 400 })
  }
}
