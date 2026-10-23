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
    what: 'Finds new customers for you every day and emails them from your Gmail.',
    steps: [
      { title: 'Find people', body: 'It searches the web for people asking for what you sell, and unhappy customers of your competitors.' },
      { title: 'Write to them', body: 'It finds their email address and writes a personal note to each one.' },
      { title: 'Approve & send', body: 'You approve; it sends from your Gmail and follows up if they don\'t reply.' },
    ],
    note: 'Nothing is sent until you approve it.',
  },
  competitorLeads: {
    icon: 'target',
    what: "Finds the people unhappy with a competitor who your product could actually help, so you can email them.",
    steps: [
      { title: 'Read the reviews', body: "Paste a competitor's website or Shopify App Store link. GrowJin reads their newest reviews and checks how well you fit each unhappy reviewer." },
      { title: 'See only good fits', body: 'Only reviewers you could really help are listed. Press Reach out on one, and GrowJin looks for their email.' },
      { title: 'Send the email', body: 'Review the short email written for them, edit it if you like, and send it from your Gmail.' },
    ],
  },
  emailOutreach: {
    icon: 'mail',
    what: 'Your sales inbox: it reads your Gmail to spot people likely to buy, helps you email new prospects, and reminds you to follow up.',
    steps: [
      { title: 'Connect Gmail', body: 'Connect Gmail. Incoming emails are tagged as hot, warm or cold leads.' },
      { title: 'Send emails', body: 'Send personal emails, or one campaign to a list of prospects, written for you.' },
      { title: 'Follow up', body: "When someone doesn't reply, you get a reminder with a follow-up ready to send." },
    ],
  },
  searchAgent: {
    icon: 'search',
    what: 'Gets you found on Google and in AI answers like ChatGPT: it finds what people search for, writes posts to rank for it, finds sites that should link to you, and tracks the results.',
    steps: [
      { title: 'Pick searches', body: 'It picks searches you have a real chance to rank for.' },
      { title: 'Write posts', body: 'It writes a blog post for each one for you to review and publish.' },
      { title: 'Get links & track', body: 'It finds sites that link to your competitors but not you, drafts a pitch for each, and checks your Google position and AI mentions every week.' },
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
