export interface PlaybookData {
  _stale?: boolean   // true = new module data available, user should regenerate

  // Executive Summary
  executiveSummary: string

  // Section 1: What to Know
  icp: string
  buyerPersonas: string
  competitiveLandscape: string
  industryTrends: string

  // Section 2: What to Say
  coldEmailTemplates: string
  linkedInTemplates: string
  discoveryCallScript: string
  objectionHandlers: string

  // Section 3: What to Show
  demoFlow: string
  caseStudyTemplates: string
  roiFramework: string
  socialProofExamples: string

  // Section 4: What to Do
  outreachSequence: string
  taskChecklist: string
  followUpSchedule: string
  successMetrics: string

  // Appendix
  planComparison: string
  keyOneLiners: string

  generatedAt: string
}

export interface PlaybookField {
  key: keyof Omit<PlaybookData, 'generatedAt'>
  label: string
  placeholder: string
  rows: number
}

export interface PlaybookSection {
  id: string
  label: string
  fields: PlaybookField[]
}

export const PLAYBOOK_SECTIONS: PlaybookSection[] = [
  {
    id: 'executive-summary',
    label: 'Executive Summary',
    fields: [
      {
        key: 'executiveSummary',
        label: 'Executive Summary',
        placeholder: '1-paragraph overview of the brand, what it does, who it serves, and the core value it delivers — written for a new sales rep joining the team.',
        rows: 4,
      },
    ],
  },
  {
    id: 'what-to-know',
    label: 'Section 1: What to Know',
    fields: [
      {
        key: 'icp',
        label: '1.1 Ideal Customer Profile (ICP)',
        placeholder: 'Industry, company size, job titles, geography, tech stack, buying triggers, and disqualifiers.',
        rows: 5,
      },
      {
        key: 'buyerPersonas',
        label: '1.2 Buyer Personas',
        placeholder: '2-3 named personas — their role, main pain point, what they care about most, and how to speak to them.',
        rows: 6,
      },
      {
        key: 'competitiveLandscape',
        label: '1.3 Competitive Landscape',
        placeholder: 'Top 3 competitors, their strengths, and how to differentiate against each one in a conversation.',
        rows: 6,
      },
      {
        key: 'industryTrends',
        label: '1.4 Industry Trends',
        placeholder: '3 trends your buyers care about that can be used as outreach hooks or conversation starters.',
        rows: 4,
      },
    ],
  },
  {
    id: 'what-to-say',
    label: 'Section 2: What to Say',
    fields: [
      {
        key: 'coldEmailTemplates',
        label: '2.1 Cold Email Templates',
        placeholder: '3 cold email variants with subject line and full body copy — each targeting a different angle or persona.',
        rows: 10,
      },
      {
        key: 'linkedInTemplates',
        label: '2.2 LinkedIn Message Templates',
        placeholder: '2-3 LinkedIn DM templates for different outreach contexts (connection request, follow-up, post-engage).',
        rows: 7,
      },
      {
        key: 'discoveryCallScript',
        label: '2.3 Discovery Call Script',
        placeholder: 'Opening line, 5-7 qualification questions, and transition to the demo or next step.',
        rows: 7,
      },
      {
        key: 'objectionHandlers',
        label: '2.4 Common Objections + Responses',
        placeholder: '5 common objections with word-for-word responses the rep can use immediately.',
        rows: 8,
      },
    ],
  },
  {
    id: 'what-to-show',
    label: 'Section 3: What to Show',
    fields: [
      {
        key: 'demoFlow',
        label: '3.1 Recommended Demo Flow',
        placeholder: '5-step demo walkthrough with timing per step and key talking points.',
        rows: 7,
      },
      {
        key: 'caseStudyTemplates',
        label: '3.2 Case Study Templates',
        placeholder: '2 case study structures with interview questions and the narrative arc to follow.',
        rows: 6,
      },
      {
        key: 'roiFramework',
        label: '3.3 ROI Calculation Framework',
        placeholder: 'Formula for calculating ROI with example numbers a rep can use in a proposal.',
        rows: 5,
      },
      {
        key: 'socialProofExamples',
        label: '3.4 Social Proof Examples',
        placeholder: 'How to reference testimonials, logos, or results in conversations and proposals.',
        rows: 4,
      },
    ],
  },
  {
    id: 'what-to-do',
    label: 'Section 4: What to Do',
    fields: [
      {
        key: 'outreachSequence',
        label: '4.1 7-Day Outreach Sequence',
        placeholder: 'Day-by-day actions (email, LinkedIn, call) with specific instructions and copy for each touchpoint.',
        rows: 9,
      },
      {
        key: 'taskChecklist',
        label: '4.2 Task Checklist',
        placeholder: 'Pre-call, during-call, and post-call checklists a rep follows every time.',
        rows: 7,
      },
      {
        key: 'followUpSchedule',
        label: '4.3 Follow-Up Schedule',
        placeholder: 'Exact cadence — timing, channel, and what to say at each follow-up touchpoint.',
        rows: 5,
      },
      {
        key: 'successMetrics',
        label: '4.4 Success Metrics to Track',
        placeholder: 'KPIs with targets — open rates, reply rates, meetings booked, pipeline, close rate.',
        rows: 5,
      },
    ],
  },
  {
    id: 'appendix',
    label: 'Appendix',
    fields: [
      {
        key: 'planComparison',
        label: 'Plan Comparison',
        placeholder: 'Pricing tier talking points — what each plan includes, who it is for, and how to upsell.',
        rows: 5,
      },
      {
        key: 'keyOneLiners',
        label: 'Key Selling Points (One-Liners)',
        placeholder: '5-7 sharp one-sentence selling points that can be dropped into any email, call, or message.',
        rows: 5,
      },
    ],
  },
]

// Flat list for brainCtx injection and backward compat
export const PLAYBOOK_FIELDS = PLAYBOOK_SECTIONS.flatMap((s) => s.fields)
