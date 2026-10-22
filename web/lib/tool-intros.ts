// The "What is this?" panel at the top of each tool (components/ToolIntro): one plain sentence on
// what the tool is for, then three steps on how it works. Written for someone who has never seen
// the tool: no jargon, no feature names.

export interface ToolIntroText {
  what: string
  steps: [string, string, string]
  note?: string
}

export const TOOL_INTROS = {
  today: {
    what: 'Your to-do list for growing the business, picked fresh each day from your website, search and social data.',
    steps: [
      'See what changed since yesterday: visitors, sign-ups and where they came from.',
      'Work through the action cards, most important first.',
      'Tick each one off with Mark done. Tomorrow you get a new list.',
    ],
  },
  reminders: {
    what: 'A to-do list that repeats, for jobs you need to redo every few weeks (like updating a listing) and emails nobody replied to.',
    steps: [
      'Add a check, or pick a suggested one, and choose how often it repeats.',
      'When it is due, it shows here, on Today and in your daily email.',
      'Do it and tick it. The next one is scheduled for you.',
    ],
    note: '"What changed" at the top lists drops GrowJin spotted in your Google and email data.',
  },
  social: {
    what: 'Get social media posts made and published for you. GrowJin decides what to post; Frekto designs it and publishes it to your accounts.',
    steps: [
      'GrowJin suggests a post idea from your audit, or you describe your own.',
      'Frekto makes a preview: the image or video, caption and hashtags.',
      'You approve it and pick a time. Frekto publishes it.',
    ],
    note: 'Nothing is posted until you approve it, unless you turn on "Post automatically".',
  },
  metaAds: {
    what: 'Get ready to run Facebook and Instagram ads: it checks your website is set up for ads and drafts your next campaign.',
    steps: [
      'Check the Meta Pixel and the ad preview tags on your website.',
      'Run the audit to get a ready-made campaign: audience, budget, ad text and image.',
      'Review it, change anything you like, and launch it to your Meta Ads account.',
    ],
  },
  leadAgent: {
    what: 'Finds new customers for you every day and emails them from your Gmail.',
    steps: [
      'It searches the web for people asking for what you sell, and unhappy customers of your competitors.',
      'It finds their email address and writes a personal note to each one.',
      'You approve; it sends from your Gmail and follows up if they don\'t reply.',
    ],
    note: 'Nothing is sent until you approve it.',
  },
  competitorLeads: {
    what: "Turns a competitor's bad reviews into a list of people to contact. Their unhappy customers are often looking for something like yours.",
    steps: [
      "Paste a link to a competitor's Shopify App Store or Trustpilot page.",
      'GrowJin reads the reviews and scores how well you fit each unhappy reviewer.',
      'Write and send an email to the best ones from your Gmail.',
    ],
  },
  emailOutreach: {
    what: 'Your sales inbox: it reads your Gmail to spot people likely to buy, helps you email new prospects, and reminds you to follow up.',
    steps: [
      'Connect Gmail. Incoming emails are tagged as hot, warm or cold leads.',
      'Send personal emails, or one campaign to a list of prospects, written for you.',
      "When someone doesn't reply, you get a reminder with a follow-up ready to send.",
    ],
  },
  searchAgent: {
    what: 'Gets you found on Google and in AI answers like ChatGPT: it finds what people search for, writes posts to rank for it, and tracks the results.',
    steps: [
      'It picks searches you have a real chance to rank for.',
      'It writes a blog post for each one for you to review and publish.',
      'Every week it checks your Google position and whether ChatGPT, Perplexity and Gemini recommend you.',
    ],
  },
  analytics: {
    what: 'Shows how many people visit your website and sign up, and where they come from.',
    steps: [
      'Connect Google Analytics or PostHog in Settings → Integrations.',
      'See visitors, sign-ups and your top sources at a glance.',
      'Click any number to see the people and pages behind it.',
    ],
  },
} satisfies Record<string, ToolIntroText>

export type ToolIntroId = keyof typeof TOOL_INTROS
