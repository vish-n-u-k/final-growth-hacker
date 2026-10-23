// The "What is this?" panel at the top of each tool (components/ToolIntro): one plain sentence on
// what the tool is for, then three titled steps on how it works. Written for someone who has never seen
// the tool: no jargon, no feature names.

export interface ToolIntroStep {
  title: string // two or three words
  body: string
}

export interface ToolIntroText {
  icon: string // components/ToolIcon, same as the tool's sidebar icon
  what: string
  steps: [ToolIntroStep, ToolIntroStep, ToolIntroStep]
  note?: string // a reassurance, e.g. "Nothing is sent until you approve it."
}

export const TOOL_INTROS = {
  today: {
    icon: 'sun',
    what: 'Your to-do list for growing the business, picked fresh each day from your website, search and social data.',
    steps: [
      { title: 'Catch up', body: 'See what changed since yesterday: visitors, sign-ups and where they came from.' },
      { title: 'Do the top tasks', body: 'Work through the action cards, most important first.' },
      { title: 'Tick them off', body: 'Tick each one off with Mark done. Tomorrow you get a new list.' },
    ],
  },
  reminders: {
    icon: 'bell',
    what: 'A to-do list that repeats, for jobs you need to redo every few weeks (like updating a listing) and emails nobody replied to.',
    steps: [
      { title: 'Add a check', body: 'Add a check, or pick a suggested one, and choose how often it repeats.' },
      { title: 'Get reminded', body: 'When it is due, it shows here, on Today and in your daily email.' },
      { title: 'Tick it off', body: 'Do it and tick it. The next one is scheduled for you.' },
    ],
    note: '"What changed" at the top lists drops GrowJin spotted in your Google and email data.',
  },
  social: {
    icon: 'image',
    what: 'Get social media posts made and published for you. GrowJin decides what to post; Frekto designs it and publishes it to your accounts.',
    steps: [
      { title: 'Pick an idea', body: 'GrowJin suggests a post idea from your audit, or you describe your own.' },
      { title: 'Get a preview', body: 'Frekto makes a preview: the image or video, caption and hashtags.' },
      { title: 'Approve & publish', body: 'You approve it and pick a time. Frekto publishes it.' },
    ],
    note: 'Nothing is posted until you approve it, unless you turn on "Post automatically".',
  },
  metaAds: {
    icon: 'megaphone',
    what: 'Get ready to run Facebook and Instagram ads: it checks your website is set up for ads and drafts your next campaign.',
    steps: [
      { title: 'Check your site', body: 'Check the Meta Pixel and the ad preview tags on your website.' },
      { title: 'Get a campaign', body: 'Run the audit to get a ready-made campaign: audience, budget, ad text and image.' },
      { title: 'Launch it', body: 'Review it, change anything you like, and launch it to your Meta Ads account.' },
    ],
  },
  leadAgent: {
    icon: 'bot',
    what: 'Finds people who need your product, writes the first message, and follows up until they reply.',
    steps: [
      { title: 'It searches', body: 'Reddit and Hacker News posts asking for a tool like yours, and businesses on Google Maps.' },
      { title: 'You approve', body: 'Every email and every forum reply is written for you to check.' },
      { title: 'It follows up', body: 'Follow-ups go out on their own and stop when someone replies.' },
    ],
    note: 'Nothing is sent until you approve it.',
  },

  competitorLeads: {
    icon: 'target',
    what: 'Finds unhappy customers of a competitor who your product could actually help.',
    steps: [
      { title: 'Pick a competitor', body: 'Their website, Trustpilot or Shopify App Store link.' },
      { title: 'See the good fits', body: 'GrowJin reads their newest reviews and keeps the people you could help.' },
      { title: 'Email them', body: 'A short, personal email from your Gmail.' },
    ],
  },

  emailOutreach: {
    icon: 'mail',
    what: 'Send personal emails to a list of prospects from your Gmail, and follow up with anyone who doesn’t reply.',
    steps: [
      { title: 'Connect Gmail', body: 'Emails go out from your own address, so replies land in your inbox.' },
      { title: 'Run a campaign', body: 'Paste a list and say what it’s about. An email is written for each person, and you check them before they go.' },
      { title: 'Follow up', body: "When someone doesn't reply, a follow-up is ready to send in the same thread. Replies close it by themselves." },
    ],
  },
  searchAgent: {
    icon: 'search',
    what: 'Gets you found on Google and in AI answers: what to write, sites to get listed on, and where you rank.',
    steps: [
      { title: 'It researches weekly', body: 'What people search, where you rank, and what AI assistants say.' },
      { title: 'You get a to-do list', body: 'Posts to write and sites to pitch, drafted for you.' },
      { title: 'It tracks results', body: 'Your Google rank and AI mentions, every week.' },
    ],
  },

  analytics: {
    icon: 'chart',
    what: 'Shows how many people visit your website and sign up, and where they come from.',
    steps: [
      { title: 'Connect', body: 'Connect Google Analytics or PostHog in Settings → Integrations.' },
      { title: 'See the numbers', body: 'See visitors, sign-ups and your top sources at a glance.' },
      { title: 'Dig deeper', body: 'Click any number to see the people and pages behind it.' },
    ],
  },
} satisfies Record<string, ToolIntroText>

export type ToolIntroId = keyof typeof TOOL_INTROS
