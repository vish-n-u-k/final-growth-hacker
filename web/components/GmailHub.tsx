'use client'

import { useState, useEffect, useCallback, Fragment } from 'react'
import Link from 'next/link'

// ── Types ─────────────────────────────────────────────────────────────────────

type LeadTag = 'hot' | 'warm' | 'cold' | 'partnership' | 'press' | 'followup' | 'vendor'
type LeadStage = 'new' | 'contacted' | 'qualified' | 'closed'
type Tab = 'inbox' | 'pipeline' | 'drafts' | 'outreach' | 'campaign' | 'limitations'
type ProspectStatus = 'idle' | 'generating' | 'ready' | 'saving' | 'saved' | 'confirming' | 'sending' | 'sent' | 'error'
type InboxFilter = 'all' | 'leads' | 'press' | 'partnership'

interface Msg { from: string; time: string; body: string; isSelf: boolean }
interface Thread {
  id: string; from: string; email: string; initials: string
  subject: string; preview: string; time: string; isRead: boolean
  tag: LeadTag | null; messages: Msg[]; aiSummary: string; aiDraft: string
}
interface Lead {
  id: string; name: string; email: string; company: string
  stage: LeadStage; level: 'hot' | 'warm' | 'cold'
  lastContact: string; value: string; subject: string
}
interface Draft {
  id: string; to: string; email: string; subject: string
  context: string; content: string; urgency: 'high' | 'medium' | 'low'
}
interface Limit { name: string; severity: 'high' | 'medium' | 'low'; problem: string; solution: string }
interface Prospect { id: string; name: string; email: string; company: string; title: string }
interface ProspectState { status: ProspectStatus; subject: string; body: string; toEmail?: string; error?: string; editingHtml?: boolean }
interface CampaignProspect { id: string; email: string; name: string; domain: string }
interface EmailHistoryItem { id: string; toEmail: string; toName: string | null; subject: string; status: string; source: string | null; createdAt: string }
type CampaignStatus = 'idle' | 'generating' | 'ready' | 'sending' | 'sent' | 'error'
interface CampaignState { status: CampaignStatus; subject: string; body: string; error?: string; toEmail?: string; editingHtml?: boolean; confirming?: boolean }

// ── Data ──────────────────────────────────────────────────────────────────────

const TAG_LABELS: Record<LeadTag, string> = {
  hot: 'Hot Lead', warm: 'Warm Lead', cold: 'Cold Lead',
  partnership: 'Partnership', press: 'Press', followup: 'Follow-up', vendor: 'Vendor',
}

const THREADS: Thread[] = [
  {
    id: 't1', from: 'Priya Sharma', email: 'priya@scalex.io', initials: 'PS',
    subject: 'Interested in your growth tool — pricing?',
    preview: 'Came across your product via LinkedIn. We\'re a 12-person SaaS wondering about agency plans...',
    time: '9:14 AM', isRead: false, tag: 'hot',
    messages: [
      { from: 'Priya Sharma', time: 'Today, 9:14 AM', isSelf: false,
        body: 'Hi,\n\nCame across your product via LinkedIn. We\'re a 12-person SaaS startup and have been struggling with our marketing audit process.\n\nDo you have a pricing page? Also curious if there\'s an agency plan — we manage 3 client accounts alongside our own.\n\nBest,\nPriya' }
    ],
    aiSummary: 'Warm inbound lead from a 12-person SaaS. Clear buying signal: asking about pricing and agency plans. Manages 3 client accounts — upsell opportunity. Source: LinkedIn.',
    aiDraft: 'Hi Priya,\n\nThanks for reaching out — great that you found us via LinkedIn!\n\nWe do have an agency plan covering up to 5 brands under one account, which sounds perfect for your setup.\n\nHere\'s our pricing: [pricing page]\n\nWould Thursday or Friday work for a 20-minute call? Happy to walk you through the agency setup.\n\nBest,\n[Your name]',
  },
  {
    id: 't2', from: 'Marcus Webb', email: 'marcus@techforward.co', initials: 'MW',
    subject: 'Re: Following up on our conversation',
    preview: 'Just circling back. Still evaluating a few options but your GEO audit features stood out...',
    time: 'Yesterday', isRead: true, tag: 'warm',
    messages: [
      { from: 'You', time: '3 days ago, 2:30 PM', isSelf: true,
        body: 'Hi Marcus,\n\nFollowing up on our demo last week. Happy to send a custom proposal or answer any questions.\n\nBest,' },
      { from: 'Marcus Webb', time: 'Yesterday, 4:52 PM', isSelf: false,
        body: 'Hey — just circling back. Still evaluating a couple of options but your GEO audit features stood out. Main concern is integrations — does it connect with HubSpot?\n\nMarcus' }
    ],
    aiSummary: 'Warm lead in active evaluation. Attended a prior demo. Key objection: HubSpot integration. GEO audit was the standout feature. High close probability if the integration concern is addressed.',
    aiDraft: 'Hi Marcus,\n\nGood to hear back! HubSpot integration is on our Q3 roadmap. In the meantime you can export audit results as CSV and push them into HubSpot in a couple of minutes.\n\nHappy to show you the export flow on a quick screen share — should help close out your evaluation.\n\nDoes Thursday work?\n\nBest,\n[Your name]',
  },
  {
    id: 't3', from: 'TechCrunch Editorial', email: 'tips@techcrunch.com', initials: 'TC',
    subject: 'AI marketing tools roundup — contributors needed',
    preview: 'We\'re putting together a feature on AI tools for growth marketers. Deadline Friday EOD...',
    time: 'Mon', isRead: false, tag: 'press',
    messages: [
      { from: 'TechCrunch Editorial', time: 'Monday, 11:20 AM', isSelf: false,
        body: 'Hi,\n\nWe\'re putting together a feature on AI tools for growth marketers and would love to include your product. Could you share a brief description, key differentiators, and a demo video link?\n\nDeadline: Friday EOD.\n\nThanks,\nTC Editorial' }
    ],
    aiSummary: 'High-priority press opportunity. TechCrunch running an AI marketing tools roundup. Deadline Friday EOD. Respond within 24 hours with product description, differentiators, and demo video link.',
    aiDraft: 'Hi,\n\nThanks for reaching out — we\'d love to be included!\n\nGrowJin is an AI-powered marketing audit platform for SMBs. We surface gaps across SEO, GEO, content quality, and social presence — mapping every finding to a weighted growth score with AI-drafted fixes.\n\nKey differentiators:\n• Combined SEO + GEO (AI discoverability) audit\n• AI-verified checks with human override capability\n• Module-based progression system that guides growth teams\n\nDemo: [video link] | Product: [URL]\n\nBest,\n[Your name]',
  },
  {
    id: 't4', from: 'Aisha Okonkwo', email: 'aisha@brightleaf.co', initials: 'AO',
    subject: 'Partnership idea — content + audit collaboration',
    preview: 'I run a content agency for B2B brands. Think there\'s a natural overlap with what you do...',
    time: 'Sun', isRead: true, tag: 'partnership',
    messages: [
      { from: 'Aisha Okonkwo', time: 'Sunday, 3:40 PM', isSelf: false,
        body: 'Hi!\n\nI run Brightleaf, a content agency for B2B brands. I think there\'s a natural overlap between your audit capabilities and our content execution.\n\nWould you be open to a referral arrangement or co-marketing? I have ~400 newsletter subscribers who would benefit from your tool.\n\nAisha' }
    ],
    aiSummary: 'Inbound partnership proposal from Aisha at Brightleaf (B2B content agency). Offers referral/co-marketing + 400 newsletter subscribers as distribution. Low effort, potentially high ROI. Recommend a 30-min discovery call.',
    aiDraft: 'Hi Aisha,\n\nThis sounds like a great fit — I\'d love to explore it.\n\nWe often see clients needing content execution after surfacing gaps in their audit, so a referral arrangement makes sense both ways.\n\nFree for a 30-min intro call next week? Tuesday or Wednesday afternoon works well for me.\n\nLooking forward to it,\n[Your name]',
  },
  {
    id: 't5', from: 'Daniel Park', email: 'daniel@growthops.io', initials: 'DP',
    subject: 'Re: Free trial — GEO score question',
    preview: 'Thanks for the extended trial. The GEO score shows 0 for AI discovery — bug or real?...',
    time: '5 days ago', isRead: true, tag: 'followup',
    messages: [
      { from: 'Daniel Park', time: '5 days ago, 6:10 PM', isSelf: false,
        body: 'Thanks for the extended trial. One thing I noticed: the GEO score shows 0 for the AI discovery section — is that a bug or is my site genuinely not indexed?\n\nDaniel' }
    ],
    aiSummary: 'Trial user confused about GEO score showing 0 for AI discovery. Not a bug — site lacks llms.txt, GPTBot permissions, and structured data. Good opportunity to educate and convert to paid.',
    aiDraft: 'Hi Daniel,\n\nNot a bug — it means your site isn\'t currently indexed by AI crawlers like GPTBot or Anthropic\'s ClaudeBot.\n\nThe GEO module checks for: llms.txt file, AI crawler permissions in robots.txt, presence in AI search tools, and structured data. Most sites score 0 here initially.\n\nTop 3 fixes:\n1. Add llms.txt to your root (10 minutes)\n2. Allow GPTBot in robots.txt\n3. Add FAQ schema to key pages\n\nWant me to walk through these on a quick call?\n\nBest,\n[Your name]',
  },
  {
    id: 't6', from: 'Stripe', email: 'no-reply@stripe.com', initials: 'ST',
    subject: 'Invoice #1892 — July 2025',
    preview: '$149.00 due July 15, 2025. View invoice...',
    time: 'Mon', isRead: true, tag: 'vendor',
    messages: [
      { from: 'Stripe', time: 'Monday, 8:00 AM', isSelf: false,
        body: 'Invoice #1892 — $149.00 due July 15, 2025.\n\nView invoice: [link]' }
    ],
    aiSummary: 'Automated invoice from Stripe. $149 due July 15. No reply needed unless payment method requires updating.',
    aiDraft: '',
  },
]

const LEADS: Lead[] = [
  { id: 'l1', name: 'Priya Sharma', email: 'priya@scalex.io', company: 'ScaleX', stage: 'new', level: 'hot', lastContact: 'Today', value: '$4,800/yr', subject: 'Pricing + agency plan inquiry' },
  { id: 'l2', name: 'Carlos Mejia', email: 'carlos@digitalops.mx', company: 'DigitalOps', stage: 'new', level: 'cold', lastContact: '3 days ago', value: '$600/yr', subject: 'General enquiry' },
  { id: 'l3', name: 'Sophie Laurent', email: 'sophie@brandstudio.fr', company: 'BrandStudio', stage: 'new', level: 'warm', lastContact: '4 days ago', value: '$2,400/yr', subject: 'Feature comparison' },
  { id: 'l4', name: 'Marcus Webb', email: 'marcus@techforward.co', company: 'TechForward', stage: 'contacted', level: 'warm', lastContact: 'Yesterday', value: '$2,400/yr', subject: 'HubSpot integration question' },
  { id: 'l5', name: 'Daniel Park', email: 'daniel@growthops.io', company: 'GrowthOps', stage: 'contacted', level: 'warm', lastContact: '5 days ago', value: '$1,200/yr', subject: 'GEO score (trial user)' },
  { id: 'l6', name: 'Kenji Mori', email: 'kenji@saasops.jp', company: 'SaasOps', stage: 'contacted', level: 'warm', lastContact: '1 week ago', value: '$1,800/yr', subject: 'Competitor comparison' },
  { id: 'l7', name: 'Fatima Al-Rashid', email: 'fatima@nexusbrands.ae', company: 'Nexus Brands', stage: 'qualified', level: 'hot', lastContact: '2 days ago', value: '$9,600/yr', subject: 'Enterprise plan evaluation' },
  { id: 'l8', name: 'Jake Thornton', email: 'jake@loopagency.io', company: 'Loop Agency', stage: 'qualified', level: 'warm', lastContact: '1 week ago', value: '$6,000/yr', subject: 'White-label inquiry' },
  { id: 'l9', name: 'Yuki Tanaka', email: 'yuki@marketstack.jp', company: 'MarketStack', stage: 'closed', level: 'hot', lastContact: '2 weeks ago', value: '$3,600/yr', subject: 'Onboarded — paid' },
  { id: 'l10', name: 'Amara Diallo', email: 'amara@growhub.sn', company: 'GrowHub', stage: 'closed', level: 'warm', lastContact: '3 weeks ago', value: '$1,200/yr', subject: 'Onboarded — paid' },
]

const DRAFTS: Draft[] = [
  {
    id: 'd1', to: 'Priya Sharma', email: 'priya@scalex.io', urgency: 'high',
    subject: 'Re: Interested in your growth tool — pricing?',
    context: 'Hot lead — inbound pricing + agency plan inquiry',
    content: 'Hi Priya,\n\nThanks for reaching out — great that you found us via LinkedIn!\n\nWe do have an agency plan covering up to 5 brands under one account, which sounds perfect for your situation.\n\nHere\'s our pricing: [pricing page]\n\nWould Thursday or Friday work for a 20-minute call?\n\nBest,\n[Your name]',
  },
  {
    id: 'd2', to: 'Marcus Webb', email: 'marcus@techforward.co', urgency: 'medium',
    subject: 'Re: Following up on our conversation',
    context: 'Warm lead — HubSpot integration concern',
    content: 'Hi Marcus,\n\nGood to hear back! HubSpot integration is on our Q3 roadmap. In the meantime you can export audit results as CSV and push to HubSpot in a couple of minutes.\n\nHappy to show the export flow on a quick screen share.\n\nDoes Thursday work?\n\nBest,\n[Your name]',
  },
  {
    id: 'd3', to: 'TechCrunch Editorial', email: 'tips@techcrunch.com', urgency: 'high',
    subject: 'Re: AI marketing tools roundup',
    context: 'Press feature — deadline Friday EOD',
    content: 'Hi,\n\nThanks for reaching out — we\'d love to be included!\n\nGrowJin is an AI-powered marketing audit platform for SMBs — SEO, GEO, content quality, and social presence in one dashboard.\n\nDemo: [video link] | Product: [URL]\n\nHappy to provide additional assets.\n\nBest,\n[Your name]',
  },
  {
    id: 'd4', to: 'Aisha Okonkwo', email: 'aisha@brightleaf.co', urgency: 'low',
    subject: 'Re: Partnership idea',
    context: 'Partnership — referral + co-marketing proposal',
    content: 'Hi Aisha,\n\nThis sounds like a great fit. We often see clients needing content execution after their audit — a referral arrangement makes sense both ways.\n\nFree for a 30-min call next week? Tuesday or Wednesday afternoon works.\n\nLooking forward to it,\n[Your name]',
  },
]

const PROSPECTS: Prospect[] = [
  { id: 'p1', name: 'Sarah Chen',      email: 'sarah@launchpad.io',    company: 'LaunchPad',      title: 'Head of Growth' },
  { id: 'p2', name: 'Tom Ramirez',     email: 'tom@foundry.co',         company: 'Foundry Studio', title: 'Co-founder & CEO' },
  { id: 'p3', name: 'Natasha Ivanova', email: 'natasha@clearpath.io',  company: 'ClearPath',      title: 'Marketing Director' },
  { id: 'p4', name: 'David Osei',      email: 'david@buildforward.co', company: 'BuildForward',   title: 'VP Marketing' },
  { id: 'p5', name: 'Mei Lin',         email: 'mei@springhub.com',     company: 'SpringHub',      title: 'Growth Lead' },
]

const LIMITATIONS: Limit[] = [
  {
    name: 'Read-Only by Design — No Auto-Send, Ever',
    severity: 'low',
    problem: 'We request gmail.readonly + gmail.compose scopes only. We deliberately do not request gmail.send. All AI-drafted replies go to your Gmail Drafts folder — you must review and click Send yourself. This is an intentional product decision, not a technical limitation.',
    solution: 'The workflow is: AI drafts → you review → you send. We may add a one-click "Send" confirmation dialog in v2, but auto-send without user action will never exist in this product.',
  },
  {
    name: 'No Real-Time Inbox Sync',
    severity: 'medium',
    problem: 'Gmail push notifications via Google Pub/Sub require persistent server infrastructure that does not work on Vercel serverless functions. Your inbox view is a snapshot from the last sync, not a live feed.',
    solution: 'Inbox syncs every 15 minutes via Vercel Cron (Pro plan). You can also trigger a manual Refresh at any time. A "Last synced" timestamp is always shown in the header so you know data freshness.',
  },
  {
    name: 'Gmail API Daily Quota',
    severity: 'medium',
    problem: 'The Gmail API enforces per-project daily quotas. Fetching 50 threads with full bodies consumes significant quota, especially across multiple users. If quota is exhausted, syncs fail silently until midnight UTC.',
    solution: 'We cache aggressively — subsequent loads read from the database, not the Gmail API. Quota usage is monitored and you will see a warning banner when within 20% of the daily limit.',
  },
  {
    name: 'AI Lead Scoring is Probabilistic',
    severity: 'low',
    problem: 'Hot / Warm / Cold tags are generated by Claude based on email content. Claude may mis-tag a vendor email or miss a subtle buying signal in a brief reply. Scores are a best-effort first-pass triage, not a rule-based system.',
    solution: 'You can manually re-tag any thread at any time. Manual tags persist across all future syncs and always override AI tags.',
  },
  {
    name: 'Attachments Not Analyzed',
    severity: 'low',
    problem: 'Email attachments (PDFs, images, spreadsheets) are not downloaded or analyzed. We only process email text bodies to minimize data exposure and keep the integration scope minimal.',
    solution: 'Planned for v2 with explicit per-attachment opt-in. If a lead attaches an RFP or brief, you will need to review it directly in Gmail.',
  },
  {
    name: 'Email Content Stored in Your Database',
    severity: 'medium',
    problem: 'Thread content (sender, subject, body, AI summary) is stored in your Supabase database to power the inbox view and lead pipeline. Sensitive email content lives in a third-party database hosted on AWS.',
    solution: 'We store only synced/flagged threads — not your full inbox history. All data is AES-256 encrypted at rest. You can delete all stored email data from Settings at any time.',
  },
]

const STAGES: { key: LeadStage; label: string; color: string }[] = [
  { key: 'new',       label: 'New',       color: '#60a5fa' },
  { key: 'contacted', label: 'Contacted', color: '#f59e0b' },
  { key: 'qualified', label: 'Qualified', color: '#4ade80' },
  { key: 'closed',    label: 'Closed',    color: '#a3e635' },
]

// ── Inline SVG icons ──────────────────────────────────────────────────────────

const IcMail = () => (
  <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
    <rect x="2" y="4" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M2 7l8 5 8-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)
const IcLead = () => (
  <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
    <circle cx="10" cy="7" r="3.5" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M3 17c0-3.314 3.134-6 7-6s7 2.686 7 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M14 5l2 2-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
const IcDraft = () => (
  <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
    <path d="M4 4h12a1 1 0 011 1v8a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M3 7l7 4 7-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M14 15l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
const IcClock = () => (
  <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
    <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M10 6v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
const IcPipe = () => (
  <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
    <rect x="2" y="13" width="4" height="5" rx="1" stroke="currentColor" strokeWidth="1.5"/>
    <rect x="8" y="8" width="4" height="10" rx="1" stroke="currentColor" strokeWidth="1.5"/>
    <rect x="14" y="3" width="4" height="15" rx="1" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
)
const IcAI = () => (
  <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
    <path d="M10 2l1.5 4.5H16l-3.5 2.5 1.5 4.5L10 11l-4 2.5 1.5-4.5L4 6.5h4.5L10 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
  </svg>
)
const IcSend = () => (
  <svg viewBox="0 0 20 20" fill="none" width="15" height="15">
    <path d="M3 10l14-7-5 7 5 7-14-7z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
  </svg>
)
const IcBell = () => (
  <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
    <path d="M10 2a6 6 0 00-6 6v3l-1.5 2.5h15L16 11V8a6 6 0 00-6-6z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
    <path d="M8.5 16.5a1.5 1.5 0 003 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
)

// ── Component ─────────────────────────────────────────────────────────────────

export default function GmailHub({
  brandName,
  initialConnected = false,
  gmailAddress,
}: {
  brandName: string
  initialConnected?: boolean
  gmailAddress?: string | null
}) {
  const [isConnected, setIsConnected]         = useState(initialConnected)
  const [activeTab, setActiveTab]             = useState<Tab>('inbox')
  const [selectedId, setSelectedId]           = useState<string>('')
  const [copied, setCopied]                   = useState<string | null>(null)
  const [expandedDraft, setExpandedDraft]     = useState<string | null>('d1')
  const [inboxFilter, setInboxFilter]         = useState<InboxFilter>('all')
  const [showStalled, setShowStalled]         = useState(true)
  const [disconnecting, setDisconnecting]     = useState(false)
  const [prospectStates, setProspectStates]     = useState<Record<string, ProspectState>>({})
  const [expandedProspect, setExpandedProspect] = useState<string | null>(null)
  const [needsReconnect, setNeedsReconnect]     = useState(false)
  // Follow-up reminder state
  const [followUpEnabled, setFollowUpEnabled]   = useState(true)
  const [followUpDays, setFollowUpDays]         = useState(3)
  const [followUpToast, setFollowUpToast]       = useState<string | null>(null)
  // Reply-detected toast: { reminderId, threadId, name, hasReply? }[]
  const [replyToasts, setReplyToasts]           = useState<{ reminderId: string; threadId: string; name: string; hasReply?: boolean }[]>([])
  // Campaign state
  const [campaignInstruction, setCampaignInstruction] = useState('')
  const [campaignImportText, setCampaignImportText]   = useState('')
  const [campaignImportMode, setCampaignImportMode]   = useState<'csv' | 'ai'>('csv')
  const [campaignAiParsing, setCampaignAiParsing]     = useState(false)
  const [campaignAiParseErr, setCampaignAiParseErr]   = useState<string | null>(null)
  const [campaignProspects, setCampaignProspects]     = useState<CampaignProspect[]>([])
  const [campaignStates, setCampaignStates]           = useState<Record<string, CampaignState>>({})
  const [campaignExpandedId, setCampaignExpandedId]   = useState<string | null>(null)
  const [campaignCopied, setCampaignCopied]           = useState<string | null>(null)
  const [campaignDraftSaving, setCampaignDraftSaving] = useState<Set<string>>(new Set())
  const [campaignDraftSaved, setCampaignDraftSaved]   = useState<Set<string>>(new Set())
  const [campaignGoalError, setCampaignGoalError]     = useState(false)
  const [sendAllConfirming, setSendAllConfirming]     = useState(false)
  const [campaignManualForm, setCampaignManualForm]   = useState<{ email: string; name: string; domain: string } | null>(null)
  // AI bulk edit
  const [aiEditOpen, setAiEditOpen]                   = useState(false)
  const [aiEditInstruction, setAiEditInstruction]     = useState('')
  const [aiEditTargeting, setAiEditTargeting]         = useState<'all' | 'select'>('all')
  const [aiEditSelected, setAiEditSelected]           = useState<Set<string>>(new Set())
  const [aiEditApplying, setAiEditApplying]           = useState(false)
  const [aiEditProgress, setAiEditProgress]           = useState<{ done: number; total: number } | null>(null)
  // Email history
  const [emailHistory, setEmailHistory]               = useState<EmailHistoryItem[]>([])
  const [showHistory, setShowHistory]                 = useState(false)
  // Real inbox state
  const [inboxThreads, setInboxThreads]       = useState<Thread[]>([])
  const [inboxLoading, setInboxLoading]       = useState(false)
  const [loadingMsgs, setLoadingMsgs]         = useState<Set<string>>(new Set())
  const [summarizing, setSummarizing]         = useState<Set<string>>(new Set())

  // ── Inbox fetch ───────────────────────────────────────────────────────────

  const fetchInbox = useCallback(async () => {
    setInboxLoading(true)
    try {
      const [inboxRes, remindersRes] = await Promise.all([
        fetch('/api/gmail/inbox'),
        fetch('/api/reminders'),
      ])
      const data = await inboxRes.json() as Thread[]
      if (inboxRes.ok && Array.isArray(data)) {
        setInboxThreads(data)
        if (data.length > 0) setSelectedId(data[0].id)

        // Reply detection: find outreach reminders that reference a threadId, then check if
        // the corresponding thread now has more than one message (reply received)
        if (remindersRes.ok) {
          const remData = await remindersRes.json() as { reminders?: { id: string; title: string; description: string | null; category: string; lastDoneAt: string | null }[] }
          const outreachReminders = (remData.reminders ?? []).filter(
            r => r.category === 'outreach' && !r.lastDoneAt && r.description?.includes('gmailThreadId:')
          )
          const toasts: { reminderId: string; threadId: string; name: string }[] = []
          for (const r of outreachReminders) {
            const match = r.description!.match(/gmailThreadId:(\S+)/)
            if (!match) continue
            const tid = match[1]
            // We don't have message counts from inbox list, so check if a thread with this id
            // appears in inbox — if so, surface it as a candidate (user can confirm)
            // A heuristic: if the thread id is in the inbox, we prompt; user decides.
            // More accurate detection happens when the thread is opened (message count > 1).
            // For now, store the candidates so we can show the toast when messages load.
            // We track them in replyToasts and surface them when thread.messages.length > 1.
            const found = data.find(t => t.id === tid)
            if (found) {
              toasts.push({ reminderId: r.id, threadId: tid, name: r.title.replace(/^Follow up:\s*/, '') })
            }
          }
          if (toasts.length > 0) setReplyToasts(toasts)
        }
      }
    } catch { /* silent */ } finally {
      setInboxLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isConnected) fetchInbox()
  }, [isConnected, fetchInbox])

  useEffect(() => {
    // Load saved prospects and email history on mount
    fetch('/api/outreach/prospects').then(r => r.ok ? r.json() : null).then(data => {
      if (!data?.prospects?.length) return
      const loaded: CampaignProspect[] = data.prospects.map((p: { id: string; email: string; name?: string; domain?: string }) => ({
        id: p.id, email: p.email, name: p.name ?? '', domain: p.domain ?? '',
      }))
      setCampaignProspects(loaded)
    }).catch(() => {})
    fetch('/api/outreach/emails').then(r => r.ok ? r.json() : null).then(data => {
      if (data?.emails) setEmailHistory(data.emails)
    }).catch(() => {})
  }, [])

  async function fetchMessages(threadId: string) {
    setLoadingMsgs(prev => new Set(prev).add(threadId))
    try {
      const res  = await fetch(`/api/gmail/thread/${threadId}`)
      const msgs = await res.json() as { from: string; time: string; body: string; isSelf: boolean }[]
      if (res.ok && Array.isArray(msgs)) {
        setInboxThreads(prev => prev.map(t => t.id === threadId ? { ...t, messages: msgs } : t))
        // If this thread has a reply and there's a pending outreach reminder for it, surface toast
        if (msgs.length > 1) {
          setReplyToasts(prev => prev.map(t => t.threadId === threadId ? { ...t, hasReply: true } : t) as typeof prev)
        }
      }
    } catch { /* silent */ } finally {
      setLoadingMsgs(prev => { const s = new Set(prev); s.delete(threadId); return s })
    }
  }

  async function generateSummary(thread: Thread) {
    if (!thread.messages.length) return
    setSummarizing(prev => new Set(prev).add(thread.id))
    try {
      const res  = await fetch('/api/gmail/summarize-thread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: thread.subject, messages: thread.messages }),
      })
      const data = await res.json() as { summary?: string; draft?: string }
      if (res.ok) {
        setInboxThreads(prev => prev.map(t =>
          t.id === thread.id
            ? { ...t, aiSummary: data.summary ?? '', aiDraft: data.draft ?? '' }
            : t,
        ))
      }
    } catch { /* silent */ } finally {
      setSummarizing(prev => { const s = new Set(prev); s.delete(thread.id); return s })
    }
  }

  function handleSelectThread(id: string) {
    setSelectedId(id)
    const t = inboxThreads.find(x => x.id === id)
    if (t && t.messages.length === 0 && !loadingMsgs.has(id)) fetchMessages(id)
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    await fetch('/api/gmail/disconnect', { method: 'POST' })
    setIsConnected(false)
    setDisconnecting(false)
  }

  async function generateEmail(prospect: Prospect) {
    setProspectStates(prev => ({ ...prev, [prospect.id]: { status: 'generating', subject: '', body: '' } }))
    try {
      const res = await fetch('/api/gmail/generate-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospectName:    prospect.name,
          prospectEmail:   prospect.email,
          prospectCompany: prospect.company,
          prospectTitle:   prospect.title,
        }),
      })
      const data = await res.json() as { subject?: string; body?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Generation failed')
      setProspectStates(prev => ({
        ...prev,
        [prospect.id]: { status: 'ready', subject: data.subject ?? '', body: data.body ?? '' },
      }))
      setExpandedProspect(prospect.id)
    } catch (e: unknown) {
      setProspectStates(prev => ({
        ...prev,
        [prospect.id]: { status: 'error', subject: '', body: '', error: e instanceof Error ? e.message : 'Failed' },
      }))
    }
  }

  async function saveDraft(prospect: Prospect) {
    const state = prospectStates[prospect.id]
    if (!state?.subject || !state?.body) return
    setProspectStates(prev => ({ ...prev, [prospect.id]: { ...state, status: 'saving' } }))
    try {
      const res = await fetch('/api/gmail/save-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: state.toEmail ?? prospect.email, subject: state.subject, body: state.body }),
      })
      const data = await res.json() as { draftId?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Save failed')
      setProspectStates(prev => ({ ...prev, [prospect.id]: { ...state, status: 'saved' } }))
    } catch (e: unknown) {
      setProspectStates(prev => ({
        ...prev,
        [prospect.id]: { ...state, status: 'error', error: e instanceof Error ? e.message : 'Save failed' },
      }))
    }
  }

  async function sendEmail(prospect: Prospect) {
    const state = prospectStates[prospect.id]
    if (!state?.subject || !state?.body) return
    setProspectStates(prev => ({ ...prev, [prospect.id]: { ...state, status: 'sending' } }))
    try {
      const res = await fetch('/api/gmail/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: state.toEmail ?? prospect.email,
          subject: state.subject,
          body: state.body,
          followUpDays: followUpEnabled ? followUpDays : undefined,
        }),
      })
      const data = await res.json() as { messageId?: string; error?: string; message?: string }
      if (res.status === 403 && data.error === 'missing_send_scope') {
        setNeedsReconnect(true)
        setProspectStates(prev => ({ ...prev, [prospect.id]: { ...state, status: 'ready' } }))
        return
      }
      if (!res.ok) throw new Error(data.error ?? 'Send failed')
      setProspectStates(prev => ({ ...prev, [prospect.id]: { ...state, status: 'sent' } }))
      setExpandedProspect(null)
      if (followUpEnabled) {
        setFollowUpToast(`Follow-up reminder set for ${followUpDays} days`)
        setTimeout(() => setFollowUpToast(null), 4000)
      }
    } catch (e: unknown) {
      setProspectStates(prev => ({
        ...prev,
        [prospect.id]: { ...state, status: 'error', error: e instanceof Error ? e.message : 'Send failed' },
      }))
    }
  }

  async function setThreadFollowup(t: Thread, days: number) {
    try {
      const res = await fetch('/api/gmail/set-followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: t.id, subject: t.subject, recipientName: t.from, days }),
      })
      if (res.ok) {
        setFollowUpToast(`Reminder set — follow up with ${t.from} in ${days} days`)
        setTimeout(() => setFollowUpToast(null), 4000)
      }
    } catch { /* silent */ }
  }

  async function markReminderDone(reminderId: string) {
    await fetch(`/api/reminders/${reminderId}/done`, { method: 'POST' })
    setReplyToasts(prev => prev.filter(t => t.reminderId !== reminderId))
  }

  const thread = inboxThreads.find(t => t.id === selectedId) ?? inboxThreads[0] ?? null

  const filteredThreads = inboxThreads.filter(t => {
    if (inboxFilter === 'all') return true
    if (inboxFilter === 'leads') return ['hot', 'warm', 'cold', 'followup'].includes(t.tag ?? '')
    return t.tag === inboxFilter
  })

  const hotLeadCount  = inboxThreads.filter(t => t.tag === 'hot').length
  const leadCount     = inboxThreads.filter(t => ['hot', 'warm', 'cold', 'followup'].includes(t.tag ?? '')).length
  const pressCount    = inboxThreads.filter(t => t.tag === 'press').length
  const partnerCount  = inboxThreads.filter(t => t.tag === 'partnership').length

  function copyText(text: string, id: string) {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  // ── Campaign helpers ───────────────────────────────────────────────────────

  function saveProspectsToDB(prospects: CampaignProspect[], rawInput?: string) {
    fetch('/api/outreach/prospects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prospects: prospects.map(p => ({ email: p.email, name: p.name, domain: p.domain, rawInput: rawInput ?? null })) }),
    }).catch(() => {})
  }

  function parseImport() {
    const lines = campaignImportText.split('\n').map(l => l.trim()).filter(Boolean)
    const parsed: CampaignProspect[] = lines.map((line, i) => {
      const parts = line.split(',').map(p => p.trim())
      return {
        id:     `cp-${Date.now()}-${i}`,
        email:  parts[0] ?? '',
        name:   parts[1] ?? '',
        domain: parts[2] ?? '',
      }
    }).filter(p => p.email.includes('@'))
    setCampaignProspects(prev => [...prev, ...parsed])
    saveProspectsToDB(parsed)
    setCampaignImportText('')
  }

  async function parseWithAI() {
    if (!campaignImportText.trim()) return
    setCampaignAiParsing(true)
    setCampaignAiParseErr(null)
    try {
      const res = await fetch('/api/outreach/parse-prospects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: campaignImportText }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Parse failed')
      const prospects = data.prospects as CampaignProspect[]
      if (!prospects.length) { setCampaignAiParseErr('No contacts found in the text.'); return }
      setCampaignProspects(prev => [...prev, ...prospects])
      saveProspectsToDB(prospects, campaignImportText)
      setCampaignImportText('')
    } catch (e) {
      setCampaignAiParseErr(e instanceof Error ? e.message : 'Failed to parse')
    } finally {
      setCampaignAiParsing(false)
    }
  }

  function addCampaignRow() {
    setCampaignProspects(prev => [
      ...prev,
      { id: `cp-${Date.now()}`, email: '', name: '', domain: '' },
    ])
  }

  function removeCampaignProspect(id: string) {
    setCampaignProspects(prev => prev.filter(p => p.id !== id))
    setCampaignStates(prev => { const s = { ...prev }; delete s[id]; return s })
  }

  async function generateCampaignEmail(prospect: CampaignProspect) {
    if (!campaignInstruction.trim()) return
    setCampaignStates(prev => ({
      ...prev,
      [prospect.id]: { status: 'generating', subject: '', body: '' },
    }))
    try {
      const res  = await fetch('/api/gmail/campaign/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          email:       prospect.email,
          name:        prospect.name  || undefined,
          domain:      prospect.domain || undefined,
          instruction: campaignInstruction,
        }),
      })
      const data = await res.json() as { subject?: string; body?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Generation failed')
      setCampaignStates(prev => ({
        ...prev,
        [prospect.id]: { status: 'ready', subject: data.subject ?? '', body: data.body ?? '' },
      }))
    } catch (e: unknown) {
      setCampaignStates(prev => ({
        ...prev,
        [prospect.id]: { status: 'error', subject: '', body: '', error: e instanceof Error ? e.message : 'Failed' },
      }))
    }
  }

  async function sendCampaignEmail(prospect: CampaignProspect) {
    const state = campaignStates[prospect.id]
    if (!state?.subject || !state?.body) return
    setCampaignStates(prev => ({ ...prev, [prospect.id]: { ...state, status: 'sending', confirming: false } }))
    try {
      const res  = await fetch('/api/gmail/send-email', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          to: state.toEmail ?? prospect.email,
          subject: state.subject,
          body: state.body,
          followUpDays: followUpEnabled ? followUpDays : undefined,
        }),
      })
      const data = await res.json() as { messageId?: string; error?: string }
      if (res.status === 403 && data.error === 'missing_send_scope') {
        setNeedsReconnect(true)
        setCampaignStates(prev => ({ ...prev, [prospect.id]: { ...state, status: 'ready', confirming: false } }))
        return
      }
      if (!res.ok) throw new Error(data.error ?? 'Send failed')
      setCampaignStates(prev => ({ ...prev, [prospect.id]: { ...state, status: 'sent', confirming: false } }))
      if (campaignExpandedId === prospect.id) setCampaignExpandedId(null)
      if (followUpEnabled) {
        setFollowUpToast(`Follow-up reminder set for ${followUpDays} days`)
        setTimeout(() => setFollowUpToast(null), 4000)
      }
    } catch (e: unknown) {
      setCampaignStates(prev => ({
        ...prev,
        [prospect.id]: { ...state, status: 'error', error: e instanceof Error ? e.message : 'Send failed', confirming: false },
      }))
    }
  }

  async function saveCampaignDraft(prospect: CampaignProspect) {
    const state = campaignStates[prospect.id]
    if (!state?.subject || !state?.body) return
    setCampaignDraftSaving(prev => new Set(prev).add(prospect.id))
    try {
      const res = await fetch('/api/gmail/save-draft', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ to: state.toEmail ?? prospect.email, subject: state.subject, body: state.body }),
      })
      if (res.ok) {
        setCampaignDraftSaved(prev => new Set(prev).add(prospect.id))
        setTimeout(() => setCampaignDraftSaved(prev => { const n = new Set(prev); n.delete(prospect.id); return n }), 3000)
      }
    } catch { /* silent */ }
    setCampaignDraftSaving(prev => { const n = new Set(prev); n.delete(prospect.id); return n })
  }

  async function sendAllReady() {
    setSendAllConfirming(false)
    const ready = campaignProspects.filter(p => campaignStates[p.id]?.status === 'ready')
    for (const p of ready) {
      await sendCampaignEmail(p)
      await new Promise(r => setTimeout(r, 400))
    }
  }

  async function applyAiEdit() {
    if (!aiEditInstruction.trim()) return
    const targets = aiEditTargeting === 'all'
      ? campaignProspects.filter(p => campaignStates[p.id]?.status === 'ready')
      : campaignProspects.filter(p => campaignStates[p.id]?.status === 'ready' && aiEditSelected.has(p.id))
    if (targets.length === 0) return

    setAiEditApplying(true)
    setAiEditProgress({ done: 0, total: targets.length })

    // Process in batches of 3 to keep things responsive
    const batchSize = 3
    for (let i = 0; i < targets.length; i += batchSize) {
      const batch = targets.slice(i, i + batchSize)
      try {
        const res = await fetch('/api/gmail/campaign/refine', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instruction: aiEditInstruction,
            emails: batch.map(p => ({
              id:              p.id,
              prospectName:    p.name,
              prospectEmail:   p.email,
              prospectDomain:  p.domain,
              currentSubject:  campaignStates[p.id]?.subject ?? '',
              currentBody:     campaignStates[p.id]?.body ?? '',
            })),
          }),
        })
        if (res.ok) {
          const { results } = await res.json() as { results: { id: string; subject?: string; body?: string; error?: string }[] }
          setCampaignStates(prev => {
            const next = { ...prev }
            for (const r of results) {
              if (r.body && r.subject) {
                next[r.id] = { ...next[r.id], subject: r.subject, body: r.body, editingHtml: false }
              }
            }
            return next
          })
        }
      } catch { /* silent — batch failure doesn't stop the rest */ }
      setAiEditProgress({ done: Math.min(i + batchSize, targets.length), total: targets.length })
    }

    setAiEditApplying(false)
    setAiEditProgress(null)
  }

  // ── NOT CONNECTED ─────────────────────────────────────────────────────────

  if (!isConnected) {
    return (
      <div className="gh-page">
        <div className="gh-inner">

          <div className="gh-header">
            <div>
              <Link href="/dashboard" className="gh-back">← Dashboard</Link>
              <div className="gh-title">
                Gmail Intelligence Hub
                <span className="gh-badge-new">New</span>
              </div>
              <div className="gh-subtitle">{brandName} — turn your inbox into a growth engine</div>
            </div>
          </div>

          {/* 2-column connect layout */}
          <div className="gh-connect-outer">

            {/* Left: copy + features + CTA */}
            <div className="gh-connect-left">
              <div className="gh-connect-eyebrow">Gmail Integration</div>
              <h2 className="gh-connect-h2">Your inbox already contains your next 10 customers</h2>
              <p className="gh-connect-p">
                GrowJin reads your Gmail to detect inbound leads, draft contextual replies in your voice, and surface deals that have gone quiet — without ever sending anything without your explicit approval.
              </p>

              <div className="gh-connect-feats">
                {[
                  { Icon: IcLead, label: 'Lead Detection',   desc: 'AI tags inbound emails Hot / Warm / Cold based on buying intent' },
                  { Icon: IcDraft, label: 'AI Draft Replies', desc: 'Context-aware drafts saved to Gmail — you review before sending' },
                  { Icon: IcClock, label: 'Stalled Alerts',   desc: 'Surface deals that have gone quiet for 7+ days with no follow-up' },
                  { Icon: IcPipe,  label: 'Sales Pipeline',   desc: 'Leads flow from inbox to a visual kanban: New → Qualified → Closed' },
                ].map(({ Icon, label, desc }) => (
                  <div key={label} className="gh-connect-feat">
                    <div className="gh-feat-icon-wrap"><Icon /></div>
                    <div>
                      <div className="gh-feat-label">{label}</div>
                      <div className="gh-feat-desc">{desc}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="gh-scopes">
                <div className="gh-scopes-title">What we request access to</div>
                <div className="gh-scope-list">
                  {[
                    { yes: true,  name: 'gmail.readonly', reason: 'read threads and labels' },
                    { yes: true,  name: 'gmail.compose',  reason: 'create Drafts in your inbox' },
                    { yes: true,  name: 'gmail.send',     reason: 'send emails — only after your confirmation' },
                    { yes: false, name: 'gmail.modify',   reason: 'not requested — we cannot move or delete emails' },
                  ].map(s => (
                    <div key={s.name} className={`gh-scope-row${s.yes ? '' : ' gh-scope-no'}`}>
                      <span className={`gh-scope-dot ${s.yes ? 'yes' : 'no'}`} />
                      <span className="gh-scope-name">{s.name}</span>
                      <span className="gh-scope-reason">— {s.reason}</span>
                    </div>
                  ))}
                </div>
              </div>

              <a href="/api/gmail/connect" className="gh-connect-btn">
                <IcMail />
                Connect Gmail Account
              </a>
              <p className="gh-connect-note">
                Encrypted at rest. You can disconnect and permanently delete all stored data from Settings at any time.
              </p>
            </div>

            {/* Right: mini inbox mockup */}
            <div className="gh-connect-right">
              <div className="gh-mockup">
                <div className="gh-mock-chrome">
                  <div className="gh-mock-dots">
                    <span className="gh-mock-dot r" />
                    <span className="gh-mock-dot y" />
                    <span className="gh-mock-dot g" />
                  </div>
                  <div className="gh-mock-url">yourbrand.com/gmail-hub</div>
                </div>
                <div className="gh-mock-body">
                  <div className="gh-mock-stats-row">
                    <div className="gh-mock-stat red"><div className="gh-mock-sn">2</div><div className="gh-mock-sl">Hot Leads</div></div>
                    <div className="gh-mock-stat gold"><div className="gh-mock-sn">3</div><div className="gh-mock-sl">Stalled</div></div>
                    <div className="gh-mock-stat blue"><div className="gh-mock-sn">4</div><div className="gh-mock-sl">Drafts</div></div>
                    <div className="gh-mock-stat green"><div className="gh-mock-sn">$28k</div><div className="gh-mock-sl">Pipeline</div></div>
                  </div>
                  <div className="gh-mock-threads">
                    {[
                      { i: 'PS', tag: 'hot' as LeadTag,         subj: 'Interested in pricing?',        time: '9:14 AM',   unread: true },
                      { i: 'TC', tag: 'press' as LeadTag,        subj: 'AI tools roundup feature',      time: 'Mon',       unread: true },
                      { i: 'MW', tag: 'warm' as LeadTag,         subj: 'Re: Following up',              time: 'Yesterday', unread: false },
                      { i: 'AO', tag: 'partnership' as LeadTag,  subj: 'Content partnership idea',      time: 'Sun',       unread: false },
                    ].map((t, idx) => (
                      <div key={idx} className={`gh-mock-thread${idx === 0 ? ' active' : ''}${t.unread ? ' unread' : ''}`}>
                        <div className={`gh-mock-av gh-av-${t.tag}`}>{t.i}</div>
                        <div className="gh-mock-tinfo">
                          <div className="gh-mock-tsubj">{t.subj}</div>
                          <span className={`gh-tag gh-tag-${t.tag}`}>{TAG_LABELS[t.tag]}</span>
                        </div>
                        <span className="gh-mock-ttime">{t.time}</span>
                      </div>
                    ))}
                  </div>
                  <div className="gh-mock-overlay">
                    <div className="gh-mock-lock">
                      <svg viewBox="0 0 20 20" fill="none" width="22" height="22">
                        <rect x="4" y="9" width="12" height="9" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                        <path d="M7 9V7a3 3 0 116 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                      Connect to unlock
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    )
  }

  // ── CONNECTED ─────────────────────────────────────────────────────────────

  return (
    <div className="gh-page">
      <div className="gh-inner">

        {/* Header */}
        <div className="gh-header">
          <div>
            <Link href="/dashboard" className="gh-back">← Dashboard</Link>
            <div className="gh-title">
              Gmail Intelligence Hub
              <span className="gh-badge-new">New</span>
            </div>
            <div className="gh-subtitle">{brandName} — inbox intelligence dashboard</div>
          </div>
          <div className="gh-header-right">
            <div className="gh-connected-badge">
              <span className="gh-connected-dot" />
              {gmailAddress ?? 'Gmail connected'}
            </div>
            <span className="gh-sync-time">Synced 3 min ago</span>
            <Link href="/lead-finder" className="gh-hbtn gh-hbtn-outline">Find Leads</Link>
            <button className="gh-hbtn gh-hbtn-outline">Refresh</button>
            <button
              className="gh-hbtn gh-hbtn-ghost"
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        </div>

        {/* Follow-up reminder toast */}
        {followUpToast && (
          <div className="gh-followup-toast">
            <IcBell />
            <span>{followUpToast}</span>
            <button className="gh-alert-close" onClick={() => setFollowUpToast(null)}>✕</button>
          </div>
        )}

        {/* Reply-detected toasts */}
        {replyToasts.filter(t => t.hasReply).map(t => (
          <div key={t.reminderId} className="gh-reply-toast">
            <span>You got a reply from <strong>{t.name}</strong> — mark follow-up done?</span>
            <button
              className="gh-reply-toast-yes"
              onClick={() => markReminderDone(t.reminderId)}
            >
              Mark done
            </button>
            <button
              className="gh-alert-close"
              onClick={() => setReplyToasts(prev => prev.filter(x => x.reminderId !== t.reminderId))}
            >
              ✕
            </button>
          </div>
        ))}

        {/* Stalled alert banner */}
        {showStalled && (
          <div className="gh-alert-banner">
            <IcClock />
            <span><strong>3 stalled threads</strong> haven't had a reply in 7+ days — including Marcus Webb and Daniel Park.</span>
            <button className="gh-alert-cta" onClick={() => { setActiveTab('inbox'); setInboxFilter('leads') }}>View leads</button>
            <button className="gh-alert-close" onClick={() => setShowStalled(false)}>✕</button>
          </div>
        )}

        {/* Stats */}
        <div className="gh-stats">
          <div className="gh-stat">
            <div className="gh-stat-label">Hot Leads</div>
            <div className="gh-stat-num">{hotLeadCount}</div>
            <span className="gh-stat-sub">in inbox right now</span>
          </div>
          <div className="gh-stat">
            <div className="gh-stat-label">Stalled Threads</div>
            <div className="gh-stat-num">3</div>
            <span className="gh-stat-sub">no reply 7+ days</span>
          </div>
          <div className="gh-stat">
            <div className="gh-stat-label">Drafts Ready</div>
            <div className="gh-stat-num">{DRAFTS.length}</div>
            <span className="gh-stat-sub">awaiting your review</span>
          </div>
          <div className="gh-stat">
            <div className="gh-stat-label">Replied This Week</div>
            <div className="gh-stat-num">12</div>
            <span className="gh-stat-trend">↑ 4 vs last week</span>
          </div>
          <div className="gh-stat">
            <div className="gh-stat-label">Pipeline Value</div>
            <div className="gh-stat-num">$28.4k</div>
            <span className="gh-stat-sub">estimated ARR</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="gh-tabs">
          {([
            ['inbox',       'Inbox Intelligence'],
            ['pipeline',    'Lead Pipeline'],
            ['drafts',      `Draft Replies (${DRAFTS.length})`],
            ['outreach',    'Cold Outreach'],
            ['campaign',    'Campaigns'],
            ['limitations', 'Limitations'],
          ] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              className={`gh-tab${activeTab === key ? ' active' : ''}`}
              onClick={() => setActiveTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Inbox Intelligence ── */}
        {activeTab === 'inbox' && (
          <div className="gh-inbox-wrap">

            {/* Filter pills */}
            <div className="gh-inbox-filters">
              {([
                ['all', 'All', null],
                ['leads', 'Leads', leadCount],
                ['press', 'Press', pressCount],
                ['partnership', 'Partners', partnerCount],
              ] as [InboxFilter, string, number | null][]).map(([key, label, count]) => (
                <button
                  key={key}
                  className={`gh-filter-pill${inboxFilter === key ? ' active' : ''}`}
                  onClick={() => { setInboxFilter(key); if (filteredThreads.length > 0 && !filteredThreads.find(t => t.id === selectedId)) setSelectedId(filteredThreads[0].id) }}
                >
                  {label}
                  {count !== null && <span className="gh-filter-badge">{count}</span>}
                </button>
              ))}
              <span className="gh-filter-sep" />
              <span className="gh-filter-info">{inboxLoading ? 'Loading…' : `${filteredThreads.length} thread${filteredThreads.length !== 1 ? 's' : ''}`}</span>
              <button
                style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-faint)', background: 'transparent', border: '1px solid var(--line)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontFamily: 'inherit' }}
                onClick={fetchInbox}
                disabled={inboxLoading}
              >
                {inboxLoading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>

            {inboxLoading && inboxThreads.length === 0 ? (
              <div style={{ padding: '48px 28px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
                Loading inbox…
              </div>
            ) : !inboxLoading && inboxThreads.length === 0 ? (
              <div style={{ padding: '48px 28px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
                No emails in inbox.
              </div>
            ) : (
            <div className="gh-inbox-layout">

              {/* Thread list */}
              <div className="gh-thread-list">
                {filteredThreads.map(t => (
                  <div
                    key={t.id}
                    className={`gh-thread-item${selectedId === t.id ? ' active' : ''}${!t.isRead ? ' unread' : ''}`}
                    onClick={() => handleSelectThread(t.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    {!t.isRead && <span className="gh-unread-dot" />}
                    <div className={`gh-thread-av gh-av-${t.tag ?? 'default'}`}>{t.initials}</div>
                    <div className="gh-thread-body">
                      <div className="gh-thread-top">
                        <span className="gh-thread-from">{t.from}</span>
                        <span className="gh-thread-time">{t.time}</span>
                        <button
                          className="gh-bell-btn"
                          title={`Remind me to follow up with ${t.from} in 3 days`}
                          onClick={e => { e.stopPropagation(); setThreadFollowup(t, 3) }}
                        >
                          <IcBell />
                        </button>
                      </div>
                      <div className="gh-thread-subject">{t.subject}</div>
                      <div className="gh-thread-preview">{t.preview}</div>
                      {t.tag && <span className={`gh-tag gh-tag-${t.tag}`}>{TAG_LABELS[t.tag]}</span>}
                    </div>
                  </div>
                ))}
              </div>

              {/* Thread detail */}
              {thread && (
                <div className="gh-thread-detail">

                  {/* Sticky header */}
                  <div className="gh-detail-hd">
                    <div className="gh-detail-subject">{thread.subject}</div>
                    <div className="gh-detail-meta">
                      <div className={`gh-detail-av gh-av-${thread.tag ?? 'default'}`}>{thread.initials}</div>
                      <div>
                        <span className="gh-detail-from">{thread.from}</span>
                        <span className="gh-detail-email">&lt;{thread.email}&gt;</span>
                      </div>
                      {thread.tag && <span className={`gh-tag gh-tag-${thread.tag}`}>{TAG_LABELS[thread.tag]}</span>}
                    </div>
                  </div>

                  {/* Message thread */}
                  <div className="gh-messages">
                    {loadingMsgs.has(thread.id) ? (
                      <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading messages…</div>
                    ) : thread.messages.length === 0 ? (
                      <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
                        <button
                          style={{ fontSize: 12.5, color: 'var(--green)', background: 'transparent', border: '1px solid var(--green)', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontFamily: 'inherit' }}
                          onClick={() => fetchMessages(thread.id)}
                        >
                          Load messages
                        </button>
                      </div>
                    ) : (
                      thread.messages.map((msg, i) => (
                        <div key={i} className={`gh-msg${msg.isSelf ? ' gh-msg-self' : ''}`}>
                          {!msg.isSelf && (
                            <div className={`gh-msg-av gh-av-${thread.tag ?? 'default'}`}>{thread.initials}</div>
                          )}
                          <div className={`gh-msg-bubble${msg.isSelf ? ' self' : ''}`}>
                            <div className="gh-msg-meta">
                              <span className="gh-msg-from">{msg.from}</span>
                              <span className="gh-msg-time">{msg.time}</span>
                            </div>
                            <pre className="gh-msg-body">{msg.body}</pre>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* AI Summary */}
                  <div className="gh-ai-summary">
                    <div className="gh-ai-label" style={{ justifyContent: 'space-between' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><IcAI />AI Summary</span>
                      {thread.messages.length > 0 && (
                        <button
                          style={{ fontSize: 11, color: 'var(--text-faint)', background: 'transparent', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 9px', cursor: 'pointer', fontFamily: 'inherit' }}
                          onClick={() => generateSummary(thread)}
                          disabled={summarizing.has(thread.id)}
                        >
                          {summarizing.has(thread.id) ? 'Generating…' : thread.aiSummary ? 'Regenerate' : 'Generate'}
                        </button>
                      )}
                    </div>
                    {thread.aiSummary
                      ? <p className="gh-ai-text">{thread.aiSummary}</p>
                      : <p className="gh-ai-text" style={{ color: 'var(--text-faint)', fontStyle: 'italic' }}>
                          {summarizing.has(thread.id) ? 'Analysing thread…' : 'Click Generate to get an AI summary of this thread.'}
                        </p>
                    }
                  </div>

                  {/* AI Draft */}
                  {thread.aiDraft ? (
                    <div className="gh-ai-draft">
                      <div className="gh-draft-hd">
                        <div className="gh-ai-label lime">
                          <IcAI />
                          Suggested Reply
                        </div>
                        <button className="gh-draft-copy" onClick={() => copyText(thread.aiDraft, thread.id)}>
                          {copied === thread.id ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <pre className="gh-draft-body">{thread.aiDraft}</pre>
                      <div className="gh-draft-actions">
                        <button className="gh-draft-save">Save to Gmail Drafts</button>
                        <button className="gh-draft-regen" onClick={() => generateSummary(thread)}>Regenerate</button>
                      </div>
                    </div>
                  ) : !summarizing.has(thread.id) && thread.messages.length > 0 && thread.aiSummary ? (
                    <div className="gh-no-draft">No reply needed for this thread</div>
                  ) : null}

                  {/* Quick actions */}
                  <div className="gh-quick-actions">
                    {!['hot', 'warm'].includes(thread.tag ?? '') && (
                      <button className="gh-qa-btn gh-qa-green">Mark as Lead</button>
                    )}
                    <button className="gh-qa-btn">Archive</button>
                    <button className="gh-qa-btn gh-qa-danger">Dismiss</button>
                  </div>

                </div>
              )}
            </div>
            )}
          </div>
        )}

        {/* ── Lead Pipeline ── */}
        {activeTab === 'pipeline' && (
          <div className="gh-pipeline-wrap">

            <div className="gh-pipeline-top">
              <div>
                <div className="gh-pipeline-title">Lead Pipeline</div>
                <div className="gh-pipeline-sub">{LEADS.length} leads · estimated $28,400 ARR</div>
              </div>
              <button className="gh-add-lead-btn">+ Add manually</button>
            </div>

            <div className="gh-kanban">
              {STAGES.map(stage => {
                const stageLeads = LEADS.filter(l => l.stage === stage.key)
                const stageVal = stageLeads.reduce((s, l) => s + parseInt(l.value.replace(/[^0-9]/g, '') || '0'), 0)
                return (
                  <div key={stage.key} className="gh-kc" style={{ '--kc-color': stage.color } as React.CSSProperties}>
                    <div className="gh-kc-hd">
                      <div className="gh-kc-hd-left">
                        <span className="gh-kc-label">{stage.label}</span>
                        <span className="gh-kc-count">{stageLeads.length}</span>
                      </div>
                      <span className="gh-kc-val">${(stageVal / 1000).toFixed(1)}k</span>
                    </div>
                    <div className="gh-kc-bar"><div className="gh-kc-bar-fill" style={{ width: `${Math.min(100, stageLeads.length * 20)}%` }} /></div>
                    <div className="gh-kc-cards">
                      {stageLeads.map(lead => (
                        <div key={lead.id} className="gh-lead-card">
                          <div className="gh-lc-top-row">
                            <div className="gh-lc-av">{lead.name.split(' ').map(n => n[0]).join('')}</div>
                            <span className={`gh-lc-level gh-lc-${lead.level}`}>{lead.level}</span>
                          </div>
                          <div className="gh-lc-name">{lead.name}</div>
                          <div className="gh-lc-company">{lead.company}</div>
                          <div className="gh-lc-subject">{lead.subject}</div>
                          <div className="gh-lc-foot">
                            <span className="gh-lc-value">{lead.value}</span>
                            <span className="gh-lc-time">{lead.lastContact}</span>
                          </div>
                        </div>
                      ))}
                      <button className="gh-kc-add">+ Add</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Draft Replies ── */}
        {activeTab === 'drafts' && (
          <div className="gh-drafts">
            <div className="gh-drafts-notice">
              <IcDraft />
              <span>AI-drafted replies based on thread context. Review each one, then save to Gmail Drafts or discard. <strong>Nothing is sent automatically.</strong></span>
            </div>
            <div className="gh-draft-list">
              {DRAFTS.map(draft => (
                <div key={draft.id} className={`gh-draft-card${expandedDraft === draft.id ? ' expanded' : ''} gh-dc-urgency-${draft.urgency}`}>
                  <button className="gh-dc-hd" onClick={() => setExpandedDraft(expandedDraft === draft.id ? null : draft.id)}>
                    <div className="gh-dc-left">
                      <div className="gh-dc-to">
                        To: <strong>{draft.to}</strong>
                        <span className="gh-dc-email">&nbsp;&lt;{draft.email}&gt;</span>
                      </div>
                      <div className="gh-dc-subject">{draft.subject}</div>
                      <span className="gh-dc-context-tag">{draft.context}</span>
                    </div>
                    <div className="gh-dc-right">
                      <span className={`gh-dc-urgency-badge gh-dc-ub-${draft.urgency}`}>
                        {draft.urgency === 'high' ? 'Urgent' : draft.urgency === 'medium' ? 'Soon' : 'Low'}
                      </span>
                      <span className="gh-dc-expand">{expandedDraft === draft.id ? '−' : '+'}</span>
                    </div>
                  </button>
                  {expandedDraft === draft.id && (
                    <div className="gh-dc-body">
                      <pre className="gh-dc-content">{draft.content}</pre>
                      <div className="gh-dc-actions">
                        <button className="gh-dc-save">Save to Gmail Drafts</button>
                        <button className="gh-dc-copy" onClick={() => copyText(draft.content, draft.id)}>
                          {copied === draft.id ? 'Copied' : 'Copy text'}
                        </button>
                        <button className="gh-dc-discard">Discard</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Cold Outreach ── */}
        {activeTab === 'outreach' && (
          <div className="gh-outreach">

            {/* Header */}
            <div className="gh-outreach-hd">
              <div>
                <div className="gh-outreach-title">Cold Outreach</div>
                <div className="gh-outreach-sub">
                  {PROSPECTS.length} prospects · AI writes personalized emails using your brand playbook
                </div>
              </div>
              <button
                className="gh-gen-all-btn"
                onClick={() => PROSPECTS.forEach(p => {
                  const s = prospectStates[p.id]
                  if (!s || s.status === 'idle' || s.status === 'error') generateEmail(p)
                })}
              >
                <IcAI />
                Generate All
              </button>
            </div>

            {/* Reconnect banner — shown if send scope is missing */}
            {needsReconnect && (
              <div className="gh-reconnect-banner">
                <span>Gmail needs to be reconnected to enable sending. Your existing connection only has read + compose access.</span>
                <a href="/api/gmail/connect" className="gh-reconnect-btn">Reconnect Gmail</a>
                <button className="gh-alert-close" onClick={() => setNeedsReconnect(false)}>✕</button>
              </div>
            )}

            {/* Notice */}
            <div className="gh-outreach-notice">
              <IcAI />
              <span>
                Each email is generated from your brand&apos;s ICP, value proposition, and email templates.
                Edit inline, then <strong>Save to Gmail Drafts</strong> — nothing sends automatically.
              </span>
            </div>

            <div className="gh-prospect-list">
              {PROSPECTS.map(prospect => {
                const state      = prospectStates[prospect.id]
                const isExpanded = expandedProspect === prospect.id && (state?.status === 'ready' || state?.status === 'saved' || state?.status === 'confirming')
                const cardStatus = state?.status ?? 'idle'
                return (
                  <div key={prospect.id} className={`gh-prospect-card gh-pc-status-${cardStatus}${isExpanded ? ' expanded' : ''}`}>

                    {/* Card header */}
                    <div className="gh-pc-top">
                      <div className="gh-pc-left">
                        <div className="gh-pc-av">{prospect.name.split(' ').map(n => n[0]).join('')}</div>
                        <div className="gh-pc-info">
                          <div className="gh-pc-name-row">
                            <span className="gh-pc-name">{prospect.name}</span>
                            {cardStatus === 'ready'      && <span className="gh-pc-badge gh-pc-badge-ready">Email ready</span>}
                            {cardStatus === 'confirming' && <span className="gh-pc-badge gh-pc-badge-ready">Email ready</span>}
                            {cardStatus === 'saved'      && <span className="gh-pc-badge gh-pc-badge-saved">Saved to Drafts</span>}
                            {cardStatus === 'sent'       && <span className="gh-pc-badge gh-pc-badge-sent">Sent</span>}
                            {cardStatus === 'error'      && <span className="gh-pc-badge gh-pc-badge-error">Error</span>}
                          </div>
                          <div className="gh-pc-role">{prospect.title} · {prospect.company}</div>
                        </div>
                      </div>

                      <div className="gh-pc-actions">
                        {(cardStatus === 'idle' || cardStatus === 'error') && (
                          <button className="gh-gen-btn" onClick={() => generateEmail(prospect)}>
                            <IcAI />
                            {cardStatus === 'error' ? 'Retry' : 'Generate Email'}
                          </button>
                        )}
                        {cardStatus === 'generating' && (
                          <div className="gh-gen-spinner">
                            <span className="gh-spinner-dot" />
                            <span className="gh-spinner-dot" />
                            <span className="gh-spinner-dot" />
                            <span className="gh-gen-loading-text">Generating</span>
                          </div>
                        )}
                        {(cardStatus === 'ready' || cardStatus === 'confirming' || cardStatus === 'saved') && (
                          <div className="gh-pc-ready-actions">
                            <button
                              className={`gh-gen-btn gh-gen-outline${isExpanded ? ' active' : ''}`}
                              onClick={() => setExpandedProspect(isExpanded ? null : prospect.id)}
                            >
                              {isExpanded ? 'Collapse' : 'View / Edit'}
                            </button>
                            <button className="gh-gen-regen" onClick={() => generateEmail(prospect)} title="Regenerate">
                              ↺
                            </button>
                          </div>
                        )}
                        {(cardStatus === 'saving' || cardStatus === 'sending') && (
                          <div className="gh-gen-spinner">
                            <span className="gh-spinner-dot" />
                            <span className="gh-spinner-dot" />
                            <span className="gh-spinner-dot" />
                            <span className="gh-gen-loading-text">{cardStatus === 'sending' ? 'Sending' : 'Saving'}</span>
                          </div>
                        )}
                        {cardStatus === 'sent' && (
                          <span className="gh-gen-sent-badge">Sent</span>
                        )}
                      </div>
                    </div>

                    {/* Subject preview when collapsed but ready */}
                    {(cardStatus === 'ready' || cardStatus === 'confirming' || cardStatus === 'saved') && !isExpanded && state?.subject && (
                      <div className="gh-pc-subject-preview">
                        <span className="gh-pc-subj-label">Subject:</span> {state.subject}
                      </div>
                    )}

                    {/* Error row */}
                    {cardStatus === 'error' && state?.error && (
                      <div className="gh-gen-error">{state.error}</div>
                    )}

                    {/* Email editor */}
                    {isExpanded && state && (
                      <div className="gh-email-editor">
                        {/* To: row — editable */}
                        <div className="gh-ee-to-row">
                          <span className="gh-ee-to-label">To:</span>
                          <input
                            className="gh-ee-to-input"
                            value={state.toEmail ?? prospect.email}
                            onChange={e =>
                              setProspectStates(prev => ({
                                ...prev,
                                [prospect.id]: { ...state, toEmail: e.target.value },
                              }))
                            }
                            placeholder="recipient@email.com"
                          />
                        </div>

                        <div className="gh-ee-fields">
                          <div className="gh-ee-field">
                            <label className="gh-ee-label">Subject</label>
                            <input
                              className="gh-ee-input"
                              value={state.subject}
                              onChange={e =>
                                setProspectStates(prev => ({
                                  ...prev,
                                  [prospect.id]: { ...state, subject: e.target.value },
                                }))
                              }
                            />
                          </div>
                          <div className="gh-ee-field">
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                              <label className="gh-ee-label" style={{ marginBottom: 0 }}>Body</label>
                              <button
                                style={{ fontSize: 10.5, color: 'var(--text-faint)', background: 'transparent', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 9px', cursor: 'pointer', fontFamily: 'inherit' }}
                                onClick={() =>
                                  setProspectStates(prev => ({
                                    ...prev,
                                    [prospect.id]: { ...state, editingHtml: !state.editingHtml },
                                  }))
                                }
                              >
                                {state.editingHtml ? 'Preview' : 'Source'}
                              </button>
                            </div>
                            {state.editingHtml ? (
                              <textarea
                                className="gh-ee-textarea"
                                rows={11}
                                style={{ fontFamily: 'monospace', fontSize: 12.5 }}
                                value={state.body}
                                onChange={e =>
                                  setProspectStates(prev => ({
                                    ...prev,
                                    [prospect.id]: { ...state, body: e.target.value },
                                  }))
                                }
                              />
                            ) : (
                              <div
                                className="gh-ee-preview"
                                dangerouslySetInnerHTML={{ __html: state.body }}
                              />
                            )}
                          </div>
                        </div>

                        <div className="gh-ee-actions">
                          {/* Send button — two-click confirm */}
                          {cardStatus !== 'confirming' ? (
                            <button
                              className="gh-send-btn"
                              onClick={() => setProspectStates(prev => ({ ...prev, [prospect.id]: { ...state, status: 'confirming' } }))}
                            >
                              <IcSend />
                              Send Email
                            </button>
                          ) : (
                            <div className="gh-send-confirm">
                              <span className="gh-send-confirm-label">Send to {state.toEmail ?? prospect.email}?</span>
                              <label className="gh-followup-toggle">
                                <input
                                  type="checkbox"
                                  checked={followUpEnabled}
                                  onChange={e => setFollowUpEnabled(e.target.checked)}
                                />
                                Follow up in
                                <select
                                  className="gh-followup-days"
                                  value={followUpDays}
                                  onChange={e => setFollowUpDays(Number(e.target.value))}
                                  disabled={!followUpEnabled}
                                >
                                  <option value={2}>2 days</option>
                                  <option value={3}>3 days</option>
                                  <option value={5}>5 days</option>
                                  <option value={7}>7 days</option>
                                </select>
                              </label>
                              <button className="gh-send-confirm-yes" onClick={() => sendEmail(prospect)}>
                                Yes, send now
                              </button>
                              <button
                                className="gh-send-confirm-no"
                                onClick={() => setProspectStates(prev => ({ ...prev, [prospect.id]: { ...state, status: 'ready' } }))}
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                          <button
                            className={`gh-dc-save${cardStatus === 'saved' ? ' gh-dc-save-done' : ''}`}
                            onClick={() => saveDraft(prospect)}
                            disabled={cardStatus === 'saving'}
                          >
                            {cardStatus === 'saving' ? 'Saving…' : cardStatus === 'saved' ? 'Saved' : 'Save to Drafts'}
                          </button>
                          <button
                            className="gh-draft-copy"
                            onClick={() => copyText(`Subject: ${state.subject}\n\n${state.body.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim()}`, prospect.id)}
                          >
                            {copied === prospect.id ? 'Copied' : 'Copy'}
                          </button>
                          <button className="gh-dc-discard" onClick={() => generateEmail(prospect)}>
                            Regenerate
                          </button>
                        </div>
                      </div>
                    )}

                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Sent history (shown on outreach + campaign tabs) ── */}
        {(activeTab === 'outreach' || activeTab === 'campaign') && emailHistory.length > 0 && (
          <div className="gh-history-wrap">
            <button className="gh-history-toggle" onClick={() => setShowHistory(h => !h)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              {emailHistory.length} past email{emailHistory.length !== 1 ? 's' : ''}
              <span style={{ marginLeft: 4 }}>{showHistory ? '▲' : '▼'}</span>
            </button>
            {showHistory && (
              <table className="gh-history-table">
                <thead>
                  <tr>
                    <th className="gh-history-th">To</th>
                    <th className="gh-history-th">Subject</th>
                    <th className="gh-history-th">Status</th>
                    <th className="gh-history-th">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {emailHistory.map(e => (
                    <tr key={e.id} className="gh-history-tr">
                      <td className="gh-history-td">{e.toName ? `${e.toName} <${e.toEmail}>` : e.toEmail}</td>
                      <td className="gh-history-td">{e.subject}</td>
                      <td className="gh-history-td">
                        <span className={`gh-history-badge gh-history-badge-${e.status}`}>{e.status}</span>
                      </td>
                      <td className="gh-history-td gh-history-td-date">{new Date(e.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── Campaigns ── */}
        {activeTab === 'campaign' && (
          <div className="gh-campaign">

            {needsReconnect && (
              <div className="gh-reconnect-banner">
                <span>Gmail needs to be reconnected to enable sending.</span>
                <a href="/api/gmail/connect" className="gh-reconnect-btn">Reconnect Gmail</a>
                <button className="gh-alert-close" onClick={() => setNeedsReconnect(false)}>✕</button>
              </div>
            )}

            {/* Step 1 — Goal */}
            <div className="gh-cmp-section">
              <div className="gh-cmp-section-hd">
                <div className="gh-cmp-step-num">1</div>
                <div className="gh-cmp-section-title">What is your campaign goal?</div>
              </div>
              <textarea
                className="gh-cmp-textarea"
                rows={3}
                placeholder="e.g. Introduce our SEO audit tool to marketing directors at B2B SaaS companies. Focus on GEO discoverability and AI search visibility."
                value={campaignInstruction}
                onChange={e => setCampaignInstruction(e.target.value)}
              />
            </div>

            {/* Step 2 — Recipients */}
            <div className="gh-cmp-section">
              <div className="gh-cmp-section-hd">
                <div className="gh-cmp-step-num">2</div>
                <div className="gh-cmp-section-title">Who are you emailing?</div>
                {campaignProspects.length > 0 && (
                  <span className="gh-cmp-section-count">{campaignProspects.length} added</span>
                )}
              </div>

              {/* Paste import */}
              <div style={{ marginBottom: 12 }}>
                {/* Mode tabs */}
                <div style={{ display: 'flex', borderBottom: '1px solid #c8ddd0', marginBottom: 0 }}>
                  <button
                    onClick={() => { setCampaignImportMode('csv'); setCampaignAiParseErr(null) }}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      border: 'none',
                      borderBottom: campaignImportMode === 'csv' ? '2px solid #179a50' : '2px solid transparent',
                      background: 'transparent',
                      color: campaignImportMode === 'csv' ? '#179a50' : '#3a6048',
                      fontWeight: campaignImportMode === 'csv' ? 700 : 500,
                      fontSize: 13,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      marginBottom: -1,
                    }}
                  >
                    Formatted
                  </button>
                  <button
                    onClick={() => { setCampaignImportMode('ai'); setCampaignAiParseErr(null) }}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      border: 'none',
                      borderBottom: campaignImportMode === 'ai' ? '2px solid #179a50' : '2px solid transparent',
                      background: 'transparent',
                      color: campaignImportMode === 'ai' ? '#179a50' : '#3a6048',
                      fontWeight: campaignImportMode === 'ai' ? 700 : 500,
                      fontSize: 13,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      marginBottom: -1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 5,
                    }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                    Smart Import
                  </button>
                </div>

                {/* Textarea + footer inside a bordered box */}
                <div style={{ border: '1px solid #c8ddd0', borderTop: 'none', borderRadius: '0 0 8px 8px', overflow: 'hidden' }}>
                  <textarea
                    rows={campaignImportMode === 'ai' ? 6 : 4}
                    placeholder={campaignImportMode === 'ai'
                      ? 'Paste anything — LinkedIn profiles, notes, a spreadsheet column, raw text.\n\ne.g. "John Smith is CEO of Acme, john@acme.com"\nor just a list of emails, one per line'
                      : 'alice@acme.com, Alice Johnson, acme.com\nbob@startup.io, Bob Smith\ncharlie@company.com'}
                    value={campaignImportText}
                    onChange={e => { setCampaignImportText(e.target.value); setCampaignAiParseErr(null) }}
                    style={{
                      width: '100%',
                      display: 'block',
                      border: 'none',
                      outline: 'none',
                      resize: 'vertical',
                      padding: '10px 12px',
                      fontSize: 13,
                      fontFamily: 'inherit',
                      lineHeight: 1.5,
                      background: '#fff',
                      color: '#0c1d13',
                      boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#f0f6f2', gap: 8 }}>
                    <span style={{ fontSize: 12, color: '#3a6048' }}>
                      {campaignImportMode === 'csv'
                        ? <>One per line — <strong>email</strong>, name (optional), domain (optional)</>
                        : <>Paste any format — AI extracts emails, names &amp; companies</>}
                    </span>
                    {campaignImportMode === 'csv' ? (
                      <button
                        onClick={parseImport}
                        disabled={!campaignImportText.trim()}
                        style={{
                          flexShrink: 0,
                          padding: '6px 14px',
                          background: campaignImportText.trim() ? '#179a50' : '#c8ddd0',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 6,
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: campaignImportText.trim() ? 'pointer' : 'not-allowed',
                          fontFamily: 'inherit',
                        }}
                      >
                        Add to list
                      </button>
                    ) : (
                      <button
                        onClick={parseWithAI}
                        disabled={!campaignImportText.trim() || campaignAiParsing}
                        style={{
                          flexShrink: 0,
                          padding: '6px 14px',
                          background: (campaignImportText.trim() && !campaignAiParsing) ? '#179a50' : '#c8ddd0',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 6,
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: (campaignImportText.trim() && !campaignAiParsing) ? 'pointer' : 'not-allowed',
                          fontFamily: 'inherit',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        {campaignAiParsing
                          ? <><span className="gh-spinner-dot" style={{ width: 5, height: 5 }}/><span className="gh-spinner-dot" style={{ width: 5, height: 5 }}/><span className="gh-spinner-dot" style={{ width: 5, height: 5 }}/>&nbsp;Parsing</>
                          : 'Parse with AI'}
                      </button>
                    )}
                  </div>
                </div>
                {campaignAiParseErr && <p style={{ margin: '6px 0 0', fontSize: 12, color: '#c0392b' }}>{campaignAiParseErr}</p>}
              </div>

              {/* Prospect list */}
              {campaignProspects.length > 0 && (
                <div className="gh-cmp-pi-list">
                  <div className="gh-cmp-pi-list-hd">
                    <span>{campaignProspects.length} prospect{campaignProspects.length !== 1 ? 's' : ''}</span>
                    <button
                      className="gh-cmp-add-row-btn"
                      onClick={() => setCampaignManualForm({ email: '', name: '', domain: '' })}
                    >
                      + Add manually
                    </button>
                  </div>
                  <table className="gh-cmp-table">
                    <thead>
                      <tr>
                        <th className="gh-cmp-th">Email</th>
                        <th className="gh-cmp-th">Name</th>
                        <th className="gh-cmp-th">Domain</th>
                        <th className="gh-cmp-th"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {campaignProspects.map(p => (
                        <tr key={p.id} className="gh-cmp-tr">
                          <td className="gh-cmp-td gh-cmp-td-email">{p.email}</td>
                          <td className="gh-cmp-td">{p.name || <span className="gh-cmp-td-empty">—</span>}</td>
                          <td className="gh-cmp-td">{p.domain || <span className="gh-cmp-td-empty">—</span>}</td>
                          <td className="gh-cmp-td gh-cmp-td-action">
                            <button
                              className="gh-cmp-remove-btn"
                              onClick={() => removeCampaignProspect(p.id)}
                              title="Remove"
                            >✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Manual add form */}
              {campaignManualForm !== null && (
                <div className="gh-cmp-manual-form">
                  <input
                    className="gh-cmp-pinput"
                    placeholder="Email *"
                    value={campaignManualForm.email}
                    onChange={e => setCampaignManualForm(f => f ? { ...f, email: e.target.value } : f)}
                  />
                  <input
                    className="gh-cmp-pinput"
                    placeholder="Name (optional)"
                    value={campaignManualForm.name}
                    onChange={e => setCampaignManualForm(f => f ? { ...f, name: e.target.value } : f)}
                  />
                  <input
                    className="gh-cmp-pinput"
                    placeholder="Domain (optional)"
                    value={campaignManualForm.domain}
                    onChange={e => setCampaignManualForm(f => f ? { ...f, domain: e.target.value } : f)}
                  />
                  <button
                    className="gh-cmp-parse-btn"
                    disabled={!campaignManualForm.email.includes('@')}
                    onClick={() => {
                      if (!campaignManualForm.email.includes('@')) return
                      const p = { id: `cp-${Date.now()}`, ...campaignManualForm }
                      setCampaignProspects(prev => [...prev, p])
                      saveProspectsToDB([p])
                      setCampaignManualForm(null)
                    }}
                  >
                    Add
                  </button>
                  <button className="gh-cmp-remove-btn" onClick={() => setCampaignManualForm(null)}>✕</button>
                </div>
              )}

              {/* Empty state */}
              {campaignProspects.length === 0 && campaignManualForm === null && (
                <button
                  className="gh-cmp-add-row-btn"
                  onClick={() => setCampaignManualForm({ email: '', name: '', domain: '' })}
                >
                  + Add manually instead
                </button>
              )}
            </div>

            {/* Step 3 — Generate & Send */}
            {campaignProspects.length > 0 && (
              <div className="gh-cmp-section">
                <div className="gh-cmp-section-hd">
                  <div className="gh-cmp-step-num">3</div>
                  <div className="gh-cmp-section-title">Generate &amp; Send</div>
                  {(() => {
                    const genCount  = campaignProspects.filter(p => { const s = campaignStates[p.id]?.status; return s && s !== 'idle' && s !== 'error' }).length
                    const sentCount = campaignProspects.filter(p => campaignStates[p.id]?.status === 'sent').length
                    return genCount > 0 && (
                      <span className="gh-cmp-progress">
                        {genCount}/{campaignProspects.length} generated{sentCount > 0 ? <> · <strong>{sentCount} sent</strong></> : ''}
                      </span>
                    )
                  })()}
                  <div className="gh-cmp-section-actions">
                    <button
                      className="gh-cmp-gen-all-btn"
                      disabled={!campaignInstruction.trim()}
                      onClick={() => {
                        if (!campaignInstruction.trim()) {
                          setCampaignGoalError(true)
                          setTimeout(() => setCampaignGoalError(false), 3000)
                          return
                        }
                        campaignProspects.forEach(p => {
                          const s = campaignStates[p.id]
                          if (!s || s.status === 'idle' || s.status === 'error') generateCampaignEmail(p)
                        })
                      }}
                    >
                      <IcAI /> Generate All
                    </button>
                    {(() => {
                      const readyCount = campaignProspects.filter(p => campaignStates[p.id]?.status === 'ready').length
                      return readyCount > 0 && (
                        <button className="gh-cmp-send-all-btn" onClick={() => setSendAllConfirming(true)}>
                          <IcSend /> Send All Ready ({readyCount})
                        </button>
                      )
                    })()}
                  </div>
                </div>
                {campaignGoalError && (
                  <div className="gh-cmp-goal-hint">Fill in your campaign goal (Step 1) before generating.</div>
                )}
                {sendAllConfirming && (
                  <div className="gh-cmp-send-confirm-row">
                    <span className="gh-send-confirm-label">
                      Send {campaignProspects.filter(p => campaignStates[p.id]?.status === 'ready').length} emails now?
                    </span>
                    <button className="gh-send-confirm-yes" onClick={sendAllReady}>Yes, send all</button>
                    <button className="gh-send-confirm-no" onClick={() => setSendAllConfirming(false)}>Cancel</button>
                  </div>
                )}

                {/* AI bulk edit panel */}
                {(() => {
                  const readyEmails = campaignProspects.filter(p => campaignStates[p.id]?.status === 'ready')
                  if (readyEmails.length === 0) return null
                  const targetCount = aiEditTargeting === 'all'
                    ? readyEmails.length
                    : [...aiEditSelected].filter(id => campaignStates[id]?.status === 'ready').length
                  return (
                    <div style={{ margin: '0 0 12px', border: '1px solid #c8ddd0', borderRadius: 8, overflow: 'hidden' }}>
                      {/* Toggle header */}
                      <button
                        onClick={() => setAiEditOpen(v => !v)}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: aiEditOpen ? '#f0f6f2' : '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, color: '#179a50', textAlign: 'left' }}
                      >
                        <IcAI />
                        AI Edit Emails
                        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 400, color: '#3a6048' }}>
                          {aiEditOpen ? 'hide ▲' : `apply changes to ${readyEmails.length} ready email${readyEmails.length !== 1 ? 's' : ''} ▼`}
                        </span>
                      </button>

                      {aiEditOpen && (
                        <div style={{ padding: '12px 14px', borderTop: '1px solid #e0ece4', background: '#fafcfb' }}>
                          {/* Instruction input */}
                          <textarea
                            rows={2}
                            placeholder={'Describe the change to apply to all selected emails...\ne.g. "Make it shorter and more casual" or "Add a P.S. about our free trial"'}
                            value={aiEditInstruction}
                            onChange={e => setAiEditInstruction(e.target.value)}
                            style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #c8ddd0', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical', background: '#fff', color: '#0c1d13', outline: 'none', marginBottom: 10 }}
                          />

                          {/* Targeting toggle */}
                          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                            <button
                              onClick={() => setAiEditTargeting('all')}
                              style={{ padding: '6px 14px', border: '1px solid', borderColor: aiEditTargeting === 'all' ? '#179a50' : '#c8ddd0', borderRadius: 6, background: aiEditTargeting === 'all' ? '#179a50' : '#fff', color: aiEditTargeting === 'all' ? '#fff' : '#3a6048', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                            >
                              All ready ({readyEmails.length})
                            </button>
                            <button
                              onClick={() => setAiEditTargeting('select')}
                              style={{ padding: '6px 14px', border: '1px solid', borderColor: aiEditTargeting === 'select' ? '#179a50' : '#c8ddd0', borderRadius: 6, background: aiEditTargeting === 'select' ? '#179a50' : '#fff', color: aiEditTargeting === 'select' ? '#fff' : '#3a6048', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                            >
                              Select emails
                            </button>
                            {aiEditTargeting === 'select' && aiEditSelected.size > 0 && (
                              <span style={{ fontSize: 12, color: '#3a6048', alignSelf: 'center' }}>
                                {aiEditSelected.size} selected
                              </span>
                            )}
                          </div>

                          {aiEditTargeting === 'select' && (
                            <p style={{ margin: '0 0 10px', fontSize: 12, color: '#7aaa8a' }}>
                              Check the boxes on each email row below to select it.
                            </p>
                          )}

                          {/* Apply button */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <button
                              onClick={applyAiEdit}
                              disabled={aiEditApplying || !aiEditInstruction.trim() || targetCount === 0}
                              style={{ padding: '8px 18px', background: (!aiEditApplying && aiEditInstruction.trim() && targetCount > 0) ? '#179a50' : '#c8ddd0', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: (!aiEditApplying && aiEditInstruction.trim() && targetCount > 0) ? 'pointer' : 'not-allowed', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}
                            >
                              <IcAI />
                              {aiEditApplying
                                ? `Applying… ${aiEditProgress ? `(${aiEditProgress.done}/${aiEditProgress.total})` : ''}`
                                : `Apply to ${targetCount} email${targetCount !== 1 ? 's' : ''}`}
                            </button>
                            {aiEditApplying && (
                              <span style={{ fontSize: 12, color: '#7aaa8a' }}>Emails update as each batch completes</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* Per-prospect rows */}
                <div className="gh-cmp-oi-list">
                  <table className="gh-cmp-table">
                    <thead>
                      <tr>
                        {aiEditOpen && aiEditTargeting === 'select' && <th className="gh-cmp-th" style={{ width: 32 }} />}
                        <th className="gh-cmp-th">Email</th>
                        <th className="gh-cmp-th">Name</th>
                        <th className="gh-cmp-th">Domain</th>
                        <th className="gh-cmp-th">Status</th>
                        <th className="gh-cmp-th">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {campaignProspects.map(prospect => {
                        const state      = campaignStates[prospect.id]
                        const status     = state?.status ?? 'idle'
                        const isExpanded = campaignExpandedId === prospect.id && status === 'ready'
                        return (
                          <Fragment key={prospect.id}>
                            <tr className={`gh-cmp-tr${isExpanded ? ' expanded' : ''}`}>
                              {aiEditOpen && aiEditTargeting === 'select' && (
                                <td className="gh-cmp-td" style={{ width: 32, textAlign: 'center', verticalAlign: 'middle' }}>
                                  {status === 'ready' && (
                                    <input
                                      type="checkbox"
                                      checked={aiEditSelected.has(prospect.id)}
                                      onChange={e => setAiEditSelected(prev => {
                                        const next = new Set(prev)
                                        e.target.checked ? next.add(prospect.id) : next.delete(prospect.id)
                                        return next
                                      })}
                                      style={{ cursor: 'pointer', width: 14, height: 14, accentColor: '#179a50' }}
                                    />
                                  )}
                                </td>
                              )}
                              <td className="gh-cmp-td gh-cmp-td-email">
                                {prospect.email}
                                {!isExpanded && status === 'ready' && state?.subject && (
                                  <div className="gh-cmp-oi-subject">{state.subject}</div>
                                )}
                                {status === 'error' && state?.error && (
                                  <div className="gh-gen-error">{state.error}</div>
                                )}
                              </td>
                              <td className="gh-cmp-td">{prospect.name || <span className="gh-cmp-td-empty">—</span>}</td>
                              <td className="gh-cmp-td">{prospect.domain || <span className="gh-cmp-td-empty">—</span>}</td>
                              <td className="gh-cmp-td">
                                {status !== 'idle' && (
                                  <span className={`gh-cmp-status-badge gh-cmp-sb-${status}`}>
                                    {status === 'generating' ? 'Generating…'
                                      : status === 'ready'   ? 'Ready'
                                      : status === 'sending' ? 'Sending…'
                                      : status === 'sent'    ? 'Sent ✓'
                                      :                        'Error'}
                                  </span>
                                )}
                              </td>
                              <td className="gh-cmp-td gh-cmp-td-action">
                                {(status === 'idle' || status === 'error') && (
                                  <button
                                    className="gh-cmp-gen-btn"
                                    onClick={() => generateCampaignEmail(prospect)}
                                    disabled={!campaignInstruction.trim()}
                                  >
                                    <IcAI /> {status === 'error' ? 'Retry' : 'Generate'}
                                  </button>
                                )}
                                {(status === 'generating' || status === 'sending') && (
                                  <div className="gh-gen-spinner">
                                    <span className="gh-spinner-dot" />
                                    <span className="gh-spinner-dot" />
                                    <span className="gh-spinner-dot" />
                                  </div>
                                )}
                                {status === 'ready' && (
                                  <>
                                    <button
                                      className="gh-cmp-view-btn"
                                      onClick={() => setCampaignExpandedId(isExpanded ? null : prospect.id)}
                                    >
                                      {isExpanded ? 'Collapse' : 'View / Edit'}
                                    </button>
                                    <button
                                      className="gh-gen-regen"
                                      onClick={() => generateCampaignEmail(prospect)}
                                      title="Regenerate"
                                    >↺</button>
                                  </>
                                )}
                                {status === 'sent' && <span className="gh-gen-sent-badge">Sent</span>}
                              </td>
                            </tr>
                            {isExpanded && state && (
                              <tr>
                                <td colSpan={aiEditOpen && aiEditTargeting === 'select' ? 6 : 5} className="gh-cmp-td-expanded">
                                  <div className="gh-email-editor">
                                    <div className="gh-ee-to-row">
                                      <span className="gh-ee-to-label">To:</span>
                                      <input
                                        className="gh-ee-to-input"
                                        value={state.toEmail ?? prospect.email}
                                        onChange={e => setCampaignStates(prev => ({
                                          ...prev,
                                          [prospect.id]: { ...state, toEmail: e.target.value },
                                        }))}
                                        placeholder="recipient@email.com"
                                      />
                                    </div>
                                    <div className="gh-ee-fields">
                                      <div className="gh-ee-field">
                                        <label className="gh-ee-label">Subject</label>
                                        <input
                                          className="gh-ee-input"
                                          value={state.subject}
                                          onChange={e => setCampaignStates(prev => ({
                                            ...prev,
                                            [prospect.id]: { ...state, subject: e.target.value },
                                          }))}
                                        />
                                      </div>
                                      <div className="gh-ee-field">
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                                          <label className="gh-ee-label" style={{ marginBottom: 0 }}>Body</label>
                                          <button
                                            style={{ fontSize: 10.5, color: 'var(--text-faint)', background: 'transparent', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 9px', cursor: 'pointer', fontFamily: 'inherit' }}
                                            onClick={() => setCampaignStates(prev => ({
                                              ...prev,
                                              [prospect.id]: { ...state, editingHtml: !state.editingHtml },
                                            }))}
                                          >
                                            {state.editingHtml ? 'Preview' : 'Source'}
                                          </button>
                                        </div>
                                        {state.editingHtml ? (
                                          <textarea
                                            className="gh-ee-textarea"
                                            rows={11}
                                            style={{ fontFamily: 'monospace', fontSize: 12.5 }}
                                            value={state.body}
                                            onChange={e => setCampaignStates(prev => ({
                                              ...prev,
                                              [prospect.id]: { ...state, body: e.target.value },
                                            }))}
                                          />
                                        ) : (
                                          <div className="gh-ee-preview" dangerouslySetInnerHTML={{ __html: state.body }} />
                                        )}
                                      </div>
                                    </div>
                                    <div className="gh-ee-actions">
                                      {!state.confirming ? (
                                        <button
                                          className="gh-send-btn"
                                          onClick={() => setCampaignStates(prev => ({
                                            ...prev,
                                            [prospect.id]: { ...state, confirming: true },
                                          }))}
                                        >
                                          <IcSend /> Send Email
                                        </button>
                                      ) : (
                                        <div className="gh-send-confirm">
                                          <span className="gh-send-confirm-label">Send to {state.toEmail ?? prospect.email}?</span>
                                          <label className="gh-followup-toggle">
                                            <input
                                              type="checkbox"
                                              checked={followUpEnabled}
                                              onChange={e => setFollowUpEnabled(e.target.checked)}
                                            />
                                            Follow up in
                                            <select
                                              className="gh-followup-days"
                                              value={followUpDays}
                                              onChange={e => setFollowUpDays(Number(e.target.value))}
                                              disabled={!followUpEnabled}
                                            >
                                              <option value={2}>2 days</option>
                                              <option value={3}>3 days</option>
                                              <option value={5}>5 days</option>
                                              <option value={7}>7 days</option>
                                            </select>
                                          </label>
                                          <button className="gh-send-confirm-yes" onClick={() => sendCampaignEmail(prospect)}>Yes, send now</button>
                                          <button
                                            className="gh-send-confirm-no"
                                            onClick={() => setCampaignStates(prev => ({
                                              ...prev,
                                              [prospect.id]: { ...state, confirming: false },
                                            }))}
                                          >Cancel</button>
                                        </div>
                                      )}
                                      <button
                                        className={`gh-dc-save${campaignDraftSaved.has(prospect.id) ? ' gh-dc-save-done' : ''}`}
                                        onClick={() => saveCampaignDraft(prospect)}
                                        disabled={campaignDraftSaving.has(prospect.id)}
                                      >
                                        {campaignDraftSaving.has(prospect.id) ? 'Saving…' : campaignDraftSaved.has(prospect.id) ? 'Saved' : 'Save to Drafts'}
                                      </button>
                                      <button
                                        className="gh-draft-copy"
                                        onClick={() => {
                                          navigator.clipboard.writeText(
                                            `Subject: ${state.subject}\n\n${state.body.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim()}`
                                          )
                                          setCampaignCopied(prospect.id)
                                          setTimeout(() => setCampaignCopied(null), 2000)
                                        }}
                                      >
                                        {campaignCopied === prospect.id ? 'Copied' : 'Copy'}
                                      </button>
                                      <button className="gh-dc-discard" onClick={() => generateCampaignEmail(prospect)}>Regenerate</button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Limits warning */}
                <div className="gh-cmp-warn">
                  Gmail daily sending limit: 500 emails (personal) · 2,000 (Google Workspace). Bulk sending may trigger spam filters — personalise content and keep batches small.
                </div>

              </div>
            )}

          </div>
        )}



        {/* ── Limitations ── */}
        {activeTab === 'limitations' && (
          <div className="gh-limitations">
            <p className="gh-limit-intro">
              Honest summary of what this integration can and cannot do — technical constraints, API limits, and deliberate product decisions explained plainly.
            </p>
            <div className="gh-limit-grid">
              {LIMITATIONS.map(l => (
                <div key={l.name} className={`gh-limit-card gh-limit-${l.severity}`}>
                  <div className="gh-lim-head">
                    <div className="gh-lim-name">{l.name}</div>
                    <span className={`gh-lim-sev gh-lim-sev-${l.severity}`}>
                      {l.severity === 'high' ? 'Blocker' : l.severity === 'medium' ? 'Medium' : 'Low'}
                    </span>
                  </div>
                  <p className="gh-lim-problem">{l.problem}</p>
                  <div className="gh-lim-sol-label">How we handle it</div>
                  <div className="gh-lim-solution">{l.solution}</div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
