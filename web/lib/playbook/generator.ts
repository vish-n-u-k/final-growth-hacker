import { callAI } from '@/lib/ai/client'
import type { FoundationFetchResult } from '@/lib/modules/foundation/fetcher'
import type { PlaybookData } from './fields'
export type { PlaybookData } from './fields'

export async function generatePlaybook(
  data: FoundationFetchResult,
  brandName: string,
  brainCtx?: string,
): Promise<PlaybookData | null> {
  if (!data.extracted) return null

  const siteContext = [
    data.extracted.title ? `Title: ${data.extracted.title}` : null,
    data.extracted.metaDescription ? `Meta description: ${data.extracted.metaDescription}` : null,
    data.extracted.h1 ? `H1: ${data.extracted.h1}` : null,
    data.extracted.h2s.length > 0 ? `Headings: ${data.extracted.h2s.join(' | ')}` : null,
    data.extracted.ctaTexts.length > 0 ? `CTAs: ${data.extracted.ctaTexts.join(' | ')}` : null,
    data.extracted.bodyTextSnippet ? `Body: ${data.extracted.bodyTextSnippet}` : null,
  ].filter(Boolean).join('\n')

  const prompt = `You are building a full Sales Playbook for a company based on their website. Every section must be specific to this company — no generic placeholder content. Write exactly as a senior sales rep would use it: direct, practical, copy-paste ready.

Company: ${brandName}
URL: ${data.url}

Website data:
${siteContext}${brainCtx ? `\n\nAdditional brand intelligence from completed audits:\n${brainCtx}` : ''}

Generate the complete Sales Playbook as a single JSON object. Use \\n for line breaks within string values. Be specific and detailed — especially for email templates, scripts, and sequences. If you cannot infer something confidently, write a realistic placeholder based on what you do know.

Return ONLY a valid JSON object with exactly these 19 keys:

{
  "executiveSummary": "1 paragraph overview of the brand for a new sales rep — what it does, who it serves, core value delivered, and the main selling angle",

  "icp": "Bullet-point ICP: industry, company size, job titles, geography, tech stack indicators, buying triggers, and 2-3 clear disqualifiers",

  "buyerPersonas": "2-3 named personas. Each: Name/Title — their main pain point — what they care about most — best way to open a conversation with them",

  "competitiveLandscape": "3 named competitors. Each: Competitor name — their main strength — how to differentiate from them in a sales conversation (specific talking point)",

  "industryTrends": "3 numbered trends relevant to this product's buyers. Each trend is 2-3 sentences — what it is and why it is a good outreach hook",

  "coldEmailTemplates": "3 complete cold emails with different angles. Format each as:\\nEMAIL 1 — [angle name]\\nSubject: [subject line]\\n[full email body]\\n\\nEMAIL 2 — [angle name]\\nSubject: [subject line]\\n[full email body]\\n\\nEMAIL 3 — [angle name]\\nSubject: [subject line]\\n[full email body]",

  "linkedInTemplates": "3 LinkedIn DM templates. Format each as:\\nDM 1 — [context]:\\n[message]\\n\\nDM 2 — [context]:\\n[message]\\n\\nDM 3 — [context]:\\n[message]",

  "discoveryCallScript": "Format as:\\nOPENING:\\n[opening line]\\n\\nQUALIFICATION QUESTIONS:\\n1. [question]\\n2. [question]\\n3. [question]\\n4. [question]\\n5. [question]\\n\\nTRANSITION TO DEMO:\\n[transition line]",

  "objectionHandlers": "5 objections with responses. Format each as:\\nOBJECTION: [exact objection]\\nRESPONSE: [word-for-word response]",

  "demoFlow": "5-step demo. Format as:\\nSTEP 1 ([X min]): [what to show and say]\\nSTEP 2 ([X min]): [what to show and say]\\nSTEP 3 ([X min]): [what to show and say]\\nSTEP 4 ([X min]): [what to show and say]\\nSTEP 5 ([X min]): [close and next steps]",

  "caseStudyTemplates": "2 case study templates. Format as:\\nTEMPLATE 1 — [industry/use case]:\\nContext: [who the customer was]\\nChallenge: [what problem they had]\\nSolution: [what they used]\\nResult: [quantified outcome]\\nInterview questions: [3-4 questions to ask the customer]\\n\\nTEMPLATE 2 — [industry/use case]:\\n[same structure]",

  "roiFramework": "ROI formula with example numbers. Format as:\\nFORMULA:\\n[formula]\\n\\nEXAMPLE (typical customer):\\n[walk through the numbers]\\n\\nHOW TO USE IN A PROPOSAL:\\n[1-2 sentences on how to present this]",

  "socialProofExamples": "How to use social proof in sales. Format as:\\nIN COLD EMAIL: [how to reference it]\\nIN A CALL: [how to bring it up naturally]\\nIN A PROPOSAL: [how to structure it]\\nIF THEY ASK FOR REFERENCES: [what to say]",

  "outreachSequence": "7-day sequence. Format as:\\nDAY 1: [channel] — [specific action and copy]\\nDAY 2: [channel] — [specific action]\\nDAY 3: [channel] — [specific action and copy]\\nDAY 5: [channel] — [specific action and copy]\\nDAY 7: [channel] — [specific action]",

  "taskChecklist": "Format as:\\nPRE-CALL (do before every call):\\n[ ] [task]\\n[ ] [task]\\n[ ] [task]\\n[ ] [task]\\n\\nDURING CALL:\\n[ ] [task]\\n[ ] [task]\\n[ ] [task]\\n\\nPOST-CALL (within 24h):\\n[ ] [task]\\n[ ] [task]\\n[ ] [task]",

  "followUpSchedule": "Exact cadence after first meeting. Format as:\\nSame day: [action]\\n24 hours: [action + what to say]\\n3 days: [action + what to say]\\n1 week: [action + what to say]\\n2 weeks: [action]\\nIf no reply after 3 weeks: [what to do]",

  "successMetrics": "KPIs with targets. Format as:\\nOUTREACH:\\n- Email open rate target: [X%]\\n- Reply rate target: [X%]\\n- LinkedIn response rate: [X%]\\n\\nPIPELINE:\\n- Meetings booked per week: [X]\\n- Opportunities created per month: [X]\\n- Close rate target: [X%]\\n\\nREVENUE:\\n- Average deal size: [X]\\n- Sales cycle length: [X days]",

  "planComparison": "Pricing tier talking points. Format as:\\n[TIER NAME]:\\n- Best for: [who]\\n- Key features to highlight: [what]\\n- Upsell angle: [what to say to move them up]\\n\\n[TIER NAME]:\\n[same structure]",

  "keyOneLiners": "7 one-sentence selling points. Each on its own line. Format as:\\n1. [one-liner]\\n2. [one-liner]\\n3. [one-liner]\\n4. [one-liner]\\n5. [one-liner]\\n6. [one-liner]\\n7. [one-liner]"
}

No markdown fences. No explanation. Return only the JSON object.`

  try {
    const raw = await callAI({
      system: 'You are a senior B2B sales strategist and copywriter. You write in plain, direct language. Everything you produce is immediately usable — no fluff, no placeholders, no generic advice.',
      prompt,
      maxTokens: 8000,
    })

    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start === -1 || end === -1) return null

    const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<PlaybookData>
    if (!parsed.executiveSummary && !parsed.icp) return null

    return {
      executiveSummary: parsed.executiveSummary ?? '',
      icp: parsed.icp ?? '',
      buyerPersonas: parsed.buyerPersonas ?? '',
      competitiveLandscape: parsed.competitiveLandscape ?? '',
      industryTrends: parsed.industryTrends ?? '',
      coldEmailTemplates: parsed.coldEmailTemplates ?? '',
      linkedInTemplates: parsed.linkedInTemplates ?? '',
      discoveryCallScript: parsed.discoveryCallScript ?? '',
      objectionHandlers: parsed.objectionHandlers ?? '',
      demoFlow: parsed.demoFlow ?? '',
      caseStudyTemplates: parsed.caseStudyTemplates ?? '',
      roiFramework: parsed.roiFramework ?? '',
      socialProofExamples: parsed.socialProofExamples ?? '',
      outreachSequence: parsed.outreachSequence ?? '',
      taskChecklist: parsed.taskChecklist ?? '',
      followUpSchedule: parsed.followUpSchedule ?? '',
      successMetrics: parsed.successMetrics ?? '',
      planComparison: parsed.planComparison ?? '',
      keyOneLiners: parsed.keyOneLiners ?? '',
      generatedAt: new Date().toISOString(),
    }
  } catch {
    return null
  }
}
