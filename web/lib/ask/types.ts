// Ask (md_files/ASK_PLAN.md): every answer, ready-made or typed, has this one shape.
// The page draws it (components/ask), so all answers look the same.

export type CardId = 'replies' | 'email' | 'google'

/** One picture per answer, from a small set. */
export type Picture =
  | { kind: 'list'; rows: { name: string; note: string }[] }
  | { kind: 'bars'; rows: { label: string; value: number; strong?: boolean }[] }
  | { kind: 'tiles'; items: { value: string; label: string; missing?: boolean }[] }
  | { kind: 'line'; points: { label: string; value: number }[] }

export interface NextStep {
  title: string
  why: string
  label: string        // the button
  href: string
  external?: boolean   // opens another site (Search Console)
}

export interface Answer {
  id: CardId
  question: string
  // The card on the home page: a big number and a short label
  number: string
  numberLabel: string
  // 'ok' has something to show; 'empty' is nothing to do; 'connect' needs a connection first
  state: 'ok' | 'empty' | 'connect'
  /** One sentence. **double stars** mark the words to bold. */
  say: string
  picture: Picture | null
  pictureTitle: string
  finds: string[]      // up to 3
  next: NextStep | null
  then: { title: string; why: string }[]   // up to 2 quiet steps after the main one
  source: string
  at: string           // when it was worked out (ISO)
}

export interface AskCards {
  at: string
  cards: Answer[]
}
