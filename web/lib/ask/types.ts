// Ask (md_files/ASK_PLAN.md): every answer, ready-made or typed, has this one shape.
// The page draws it (components/ask), so all answers look the same.

/** The ready answers, in the order they show on the home page. */
export const CARD_IDS = ['replies', 'seen', 'email', 'google', 'post', 'talk', 'keys', 'track'] as const
export type CardId = (typeof CARD_IDS)[number]

/** One picture per answer, from a small set. */
export type Picture =
  | { kind: 'list'; rows: { name: string; note: string }[] }
  | { kind: 'bars'; rows: { label: string; value: number; strong?: boolean }[] }
  | { kind: 'tiles'; items: { value: string; label: string; missing?: boolean }[] }
  | { kind: 'line'; points: { label: string; value: number }[] }
  // A checklist (the visibility score): each check with its number, how it's doing, and why it matters
  | { kind: 'checks'; rows: { group: string; label: string; value: string; state: 'good' | 'warn' | 'bad' | 'unknown'; why: string }[] }

/** Work that opens in a panel on the Ask page instead of another page (phase 3). */
export type Panel =
  | { kind: 'lead'; id: string; lane: 'email' | 'talk' }   // a lead's email, or a post's reply / a page's message
  | { kind: 'reply'; threadId: string }                     // someone replied: read it and answer
  | { kind: 'brief'; title: string; intro: string; steps: string[]; code?: string; link?: { label: string; href: string } }
  // Workspaces: the tools themselves, inside Ask (no other pages)
  | { kind: 'leads'; lane?: 'email' | 'talk'; find?: boolean }
  | { kind: 'email'; tab?: 'replies' | 'due' | 'list' }
  | { kind: 'write'; topic?: string }
  | { kind: 'review' }                                               // Re-analyse website: Claude's review of the site
  | { kind: 'memory' }                                               // what Ask remembers: rules and noticed patterns
  // Pages not on Google yet, one by one: ask Google to index each, then mark it done (tracked)
  | { kind: 'index'; property: string; lede: string; rows: IndexRow[] }

/** One sitemap page that hasn't shown up in a search, and what to do with it. */
export interface IndexRow {
  url: string
  path: string
  // todo: ask Google · improve: add to it first · blocked: something tells Google to skip it
  // wait: new, or already asked (give it time) · indexed: Google has it, nobody searched for it yet
  group: 'todo' | 'improve' | 'blocked' | 'wait' | 'indexed'
  note: string
  askedAt?: string
}

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
  id: CardId | 'live' | `pin:${string}`
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
  suggested?: string[] // questions to ask next, about this answer (a card's question opens that card)
}

export interface AskCards {
  at: string
  cards: Answer[]
  pins?: Answer[]      // pinned questions of your own (phase 4), refreshed each morning
}

/** What the page hears while a typed question is answered (one JSON object per line). */
export type AskEvent =
  | { t: 'understand'; text: string }
  | { t: 'look'; text: string }
  | { t: 'check'; text: string }
  | { t: 'think'; text: string }                      // what Claude is doing between lookups (replaces the last one)
  | { t: 'answer'; answer: Answer }
  | { t: 'card'; id: CardId }                       // the question is one of the ready answers
  | { t: 'ask_back'; question: string; options: string[] }
  | { t: 'left'; left: number }                      // typed questions left today
  | { t: 'thread'; id: string }                      // the conversation this answer belongs to (for follow-ups and pins)
  | { t: 'memory'; items: string[] }                                // what Ask remembers and is using for this one
  | { t: 'remembered'; id: string; text: string }                   // it saved a rule just now (the page offers Undo)
  | { t: 'task'; kind: 'leads'; brief: string; error?: string }   // a job started in the background (the page polls /api/ask/task)
  | { t: 'proposal'; proposal: Proposal }                         // something to send, waiting for the owner's OK
  | { t: 'queued'; id: string; text: string }                      // runs go to the admin queue: the team runs it, the answer shows on home
  | { t: 'error'; text: string }

/** Emails Claude wrote, to send only when the owner approves them on the page (send_email). */
export interface Proposal {
  kind: 'send_emails'
  title: string
  why: string
  emails: { to: string; subject: string; body: string; thread_id?: string; in_reply_to?: string }[]
}

/** Progress while the ready answers are worked out (one JSON object per line, ?stream=1). */
export type FillEvent =
  | { t: 'step'; id: string; text: string; state: 'on' | 'done' | 'failed'; result?: string }
  | { t: 'done'; data: AskCards }
  | { t: 'error'; text: string }

/** The admin queue's module name for an Ask website review (analysis_requests.module_id is then the brand id). */
export const REVIEW_REQUEST_NAME = 'Website review (Ask)'
/** The admin queue's module name for Ask's queued questions and searches (module_id is then the brand id). */
export const ASK_REQUEST_NAME = 'Ask (questions and searches)'

/** One piece of Ask work waiting for the team, or done (lib/ask/queue.ts). */
export interface QueuedJob {
  id: string
  kind: 'question' | 'leads' | 'notice'
  question: string                 // what they typed, or what the job is ("Find new leads")
  threadId?: string                // a follow-up's conversation
  clarify?: { asked: string; chosen: string }
  at: string
  status: 'waiting' | 'done' | 'failed'
  doneAt?: string
  events?: AskEvent[]              // a question's answer, as the page would have streamed it
  note?: string                    // a search or a pattern check: what happened
  seen?: boolean
}
