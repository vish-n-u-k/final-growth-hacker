export interface Level {
  id: number
  name: string
  range: string
  focus: string
  gate: string
  tasks: string[]
}

export const LEVELS: Level[] = [
  {
    id: 0,
    name: 'Foundation',
    range: 'No users yet · fix the funnel first',
    focus: "Make sure a stranger doesn't bounce before they arrive.",
    gate: 'a brand-new visitor reaches a generated post unaided.',
    tasks: [
      'Move off .pages.dev to a custom domain',
      'Build a landing page that sells the outcome',
      'Fix first-run "wow" — generated post in seconds',
      'Install analytics (signup → activation → retention)',
    ],
  },
  {
    id: 1,
    name: 'Learn',
    range: "1 → 10 users · do things that don't scale",
    focus: 'Watch real people use it. Fix what breaks. Find the spark.',
    gate: 'you can name the "oh, I need this" moment.',
    tasks: [
      'Personally recruit your first 10 solopreneurs',
      'Watch them use it (calls / screen shares)',
      'Give white-glove support, over-serve them',
      'Ask each: "what almost made you quit / what clicked?"',
    ],
  },
  {
    id: 2,
    name: 'Find the hook',
    range: '10 → 50 users · find the repeatable hook',
    focus: 'Turn what you learned into content that converts strangers.',
    gate: 'one hook reliably brings signups, not just views.',
    tasks: [
      'Post short-form video daily (demo the product)',
      'Share results in r/solopreneur & Indie Hackers',
      'Build in public on X / LinkedIn',
      'Test hooks — track which one drives signups',
    ],
  },
  {
    id: 3,
    name: 'Turn on loops',
    range: '50 → 100 users · make growth compound',
    focus: 'Shift from pushing every user to the product pulling them in.',
    gate: 'users arrive without you personally pushing each one.',
    tasks: [
      'Build an in-product share loop ("made with AIFeed")',
      'Launch on Product Hunt',
      'List on directories (TAAFT, Futurepedia, AlternativeTo)',
      'Set up email lifecycle (welcome + activation + win-back)',
    ],
  },
  {
    id: 4,
    name: 'Amplify',
    range: '100 → 500 users · spend behind what works',
    focus: 'Only now do you put money in — behind a proven hook.',
    gate: 'a dollar of spend reliably returns signups.',
    tasks: [
      'Put ~$500/mo behind your proven hook (optimize signups)',
      'Seed 5–10 solopreneur micro-influencers',
      'Double down on your best channel, cut the rest',
      'Keep publishing SEO articles for durable signups',
    ],
  },
]

export const LEVEL_DESCS: string[] = [
  'Set up your foundation before acquiring any users.',
  "Do things that don't scale — talk to real users and find the spark.",
  "You're finding your repeatable hook. Keep testing short-form video until one reliably drives signups — then you've earned Level 3.",
  "Build compounding loops so growth doesn't require your constant push.",
  "Put money behind what's already working — not before.",
]
