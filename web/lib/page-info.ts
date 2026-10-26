import { TOOL_INTROS, type ToolIntroId } from '@/lib/tool-intros'

// The short cards about each page, shown in two places (components/ui/loading.tsx):
//  - "While you wait": under a long loader (agent runs, module analysis, reading reviews…)
//  - "About this page": the link in a tool's grey top line
// Change the words here; nothing else needs to change. Every fact names where it comes from,
// so keep to things anyone can check. A page with no entry just shows no cards.

export type PageInfoKind = 'what' | 'why' | 'fact' | 'tip'

export interface PageInfoCard {
  kind: PageInfoKind
  text: string
  source?: string // for facts: who says so
}

export type PageInfoId = ToolIntroId | 'modules' | 'onboarding'

export const PAGE_INFO_LABEL: Record<PageInfoKind, string> = {
  what: 'What this does',
  why: 'Why it matters',
  fact: 'Fun fact',
  tip: 'Tip',
}

const PAGE_INFO: Record<PageInfoId, { title: string; cards: PageInfoCard[] }> = {
  today: {
    title: 'Today',
    cards: [
      { kind: 'why', text: 'Growth comes from small things done often. One short list a day is easier to keep up than a big plan once a month.' },
      { kind: 'tip', text: 'Do the first task before opening anything else. It is picked as the most useful one for today.' },
      { kind: 'fact', text: 'Google Analytics started as Urchin, a web stats company Google bought in 2005.', source: 'Google' },
    ],
  },
  modules: {
    title: 'Your roadmap',
    cards: [
      { kind: 'what', text: 'Each module checks one part of your business, such as your website or your brand, and turns it into a short checklist.' },
      { kind: 'why', text: 'Fixing the basics first makes everything after it work better: ads, emails and posts all send people to your website.' },
      { kind: 'fact', text: 'More than half of all web visits now come from phones, so the phone version of your site is the one most people see.', source: 'StatCounter' },
      { kind: 'tip', text: 'Start with the items marked most important. A few big fixes beat many small ones.' },
    ],
  },
  onboarding: {
    title: 'Getting started',
    cards: [
      { kind: 'what', text: 'GrowJin is reading your website to fill in your brand details, so you don’t have to type them.' },
      { kind: 'tip', text: 'Check what it found and fix anything that’s off. Everything GrowJin writes for you starts from these details.' },
      { kind: 'fact', text: 'The first website went live in 1991, at CERN. It explained what the World Wide Web was.', source: 'CERN' },
    ],
  },
  leadAgent: {
    title: 'Lead Agent',
    cards: [
      { kind: 'why', text: 'Early customers usually come from talking to people directly. Ads work better once you know who buys and why.' },
      { kind: 'fact', text: 'Google says more than 200 million businesses and places are on Google Maps. That is where these leads come from.', source: 'Google' },
      { kind: 'tip', text: 'Short emails that end with one easy question get more replies than long ones with a list of features.' },
      { kind: 'fact', text: 'Reddit has more than 100,000 active communities, so someone may be asking for a tool like yours today.', source: 'Reddit' },
    ],
  },
  competitorLeads: {
    title: 'Competitor Leads',
    cards: [
      { kind: 'why', text: 'Someone who just left a bad review is already looking for something better. That makes them easier to help than a stranger.' },
      { kind: 'tip', text: 'Lead with their problem, not your product. Quote what they said so they know you read it.' },
      { kind: 'fact', text: 'Trustpilot was founded in Denmark in 2007.', source: 'Trustpilot' },
    ],
  },
  emailOutreach: {
    title: 'Email Outreach',
    cards: [
      { kind: 'why', text: 'Email from your own address reads like a note from a person, not an ad. Replies land straight in your inbox.' },
      { kind: 'tip', text: 'Many replies come after a follow-up, not the first email. Keep follow-ups short and in the same thread.' },
      { kind: 'fact', text: 'The first email between two computers was sent in 1971 by Ray Tomlinson, who also picked the @ sign.', source: 'Internet Hall of Fame' },
    ],
  },
  searchAgent: {
    title: 'Search Agent',
    cards: [
      { kind: 'why', text: 'People search before they buy. Showing up there brings visitors every day without paying for each one.' },
      { kind: 'fact', text: 'Google handles billions of searches every day, and about 15% of them have never been searched before.', source: 'Google' },
      { kind: 'tip', text: 'One helpful post that answers a real question beats five posts written only for keywords.' },
      { kind: 'tip', text: 'AI assistants learn about you from other sites. Listings and reviews on sites like G2 help them describe you correctly.' },
    ],
  },
  social: {
    title: 'Social Studio',
    cards: [
      { kind: 'why', text: 'Posting often keeps you in front of people who already follow you, so they think of you when they need you.' },
      { kind: 'tip', text: 'Show the product being used. A real example works better than a list of features.' },
      { kind: 'fact', text: 'Instagram launched in October 2010 as an iPhone app for sharing photos with filters.', source: 'Instagram' },
    ],
  },
  metaAds: {
    title: 'Meta Ads',
    cards: [
      { kind: 'why', text: 'Ads only learn who buys if your site tells Meta when someone signs up or buys. That is what the Pixel does.' },
      { kind: 'tip', text: 'Start with a small daily budget and one ad. Change one thing at a time so you can tell what worked.' },
      { kind: 'fact', text: 'The Meta Pixel was called the Facebook Pixel until Facebook renamed itself Meta in 2021.', source: 'Meta' },
    ],
  },
  reminders: {
    title: 'Reminders',
    cards: [
      { kind: 'why', text: 'Listings go out of date and emails go unanswered. A reminder catches them before a customer does.' },
      { kind: 'tip', text: 'Keep each check small enough to do in five minutes, so it actually gets done.' },
    ],
  },
  analytics: {
    title: 'Analytics',
    cards: [
      { kind: 'why', text: 'Knowing where sign-ups come from tells you where to spend your time next.' },
      { kind: 'tip', text: 'Look at the trend over a few weeks, not one day. Daily numbers jump around.' },
      { kind: 'fact', text: 'Google Analytics started as Urchin, a web stats company Google bought in 2005.', source: 'Google' },
    ],
  },
}

/** The page's title and cards, with "What this does" taken from the tool's intro when it has one.
 *  `withIntro: false` leaves that card out (the intro strip already says it on the page). */
export function pageInfo(id: PageInfoId, { withIntro = true } = {}): { title: string; cards: PageInfoCard[] } {
  const info = PAGE_INFO[id]
  const intro = (TOOL_INTROS as Record<string, { what: string }>)[id]
  const hasWhat = info.cards.some(c => c.kind === 'what')
  return { title: info.title, cards: intro && withIntro && !hasWhat ? [{ kind: 'what', text: intro.what }, ...info.cards] : info.cards }
}

export interface PageAbout {
  title: string
  what?: string                            // one plain sentence on what the page is for
  steps?: { title: string; body: string }[] // how it works, from the tool's intro
  note?: string                            // a reassurance, e.g. "Nothing is sent until you approve it."
  why: string[]
  tips: string[]
  facts: { text: string; source?: string }[]
}

/** Everything the "About this page" panel shows, grouped: what it does, how it works, why it
 *  matters, tips and facts. */
export function pageAbout(id: PageInfoId): PageAbout {
  const info = PAGE_INFO[id]
  const intro = (TOOL_INTROS as Record<string, { what: string; steps: PageAbout['steps']; note?: string }>)[id]
  const of = (k: PageInfoKind) => info.cards.filter(c => c.kind === k)
  return {
    title: info.title,
    what: of('what')[0]?.text ?? intro?.what,
    steps: intro?.steps,
    note: intro?.note,
    why: of('why').map(c => c.text),
    tips: of('tip').map(c => c.text),
    facts: of('fact').map(c => ({ text: c.text, source: c.source })),
  }
}
