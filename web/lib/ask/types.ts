// Ask (md_files/ASK_PLAN.md): every answer, ready-made or typed, has this one shape.
// The page draws it (components/ask), so all answers look the same.

/** The ready answers, in the order they show on the home page. */
export const CARD_IDS = ['replies', 'email', 'google', 'post', 'talk', 'keys', 'track'] as const
export type CardId = (typeof CARD_IDS)[number]

/** One picture per answer, from a small set. */
export type Picture =
  | { kind: 'list'; rows: { name: string; note: string }[] }
  | { kind: 'bars'; rows: { label: string; value: number; strong?: boolean }[] }
  | { kind: 'tiles'; items: { value: string; label: string; missing?: boolean }[] }
  | { kind: 'line'; points: { label: string; value: number }[] }

/** Work that opens in a panel on the Ask page instead of another page (phase 3). */
export type Panel =
  | { kind: 'lead'; id: string; lane: 'email' | 'talk' }   // a lead's email, or a post's reply / a page's message
  | { kind: 'reply'; threadId: string }                     // someone replied: read it and answer
  | { kind: 'brief'; title: string; intro: string; steps: string[]; code?: string; link?: { label: string; href: string } }

export interface NextStep {
  title: string
  why: string
  label: string        // the button
  href: string         // where the work lives (used when there's no panel, and as "Open in …")
  external?: boolean   // opens another site (Search Console)
  panel?: Panel        // open the work here instead
}

/** How a typed question was answered (shown under "How I got this"). */
export interface AnswerHow {
  understood: string
  steps: string[]          // one line per lookup
  lookups: number
  seconds: number
  usd: number
  unchecked: string[]      // numbers in the answer that weren't found in the data fetched
}

export interface Answer {
  id: CardId | 'live'
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
  how?: AnswerHow      // typed questions only
}

export interface AskCards {
  at: string
  cards: Answer[]
}

/** What the page hears while a typed question is answered (one JSON object per line). */
export type AskEvent =
  | { t: 'understand'; text: string }
  | { t: 'look'; text: string }
  | { t: 'check'; text: string }
  | { t: 'answer'; answer: Answer }
  | { t: 'card'; id: CardId }                       // the question is one of the ready answers
  | { t: 'ask_back'; question: string; options: string[] }
  | { t: 'left'; left: number }                      // typed questions left today
  | { t: 'error'; text: string }
