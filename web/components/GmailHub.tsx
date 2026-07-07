'use client'

import { useState } from 'react'
import Link from 'next/link'

// ── Types ─────────────────────────────────────────────────────────────────────

type LeadTag = 'hot' | 'warm' | 'cold' | 'partnership' | 'press' | 'followup' | 'vendor'
type LeadStage = 'new' | 'contacted' | 'qualified' | 'closed'
type Tab = 'inbox' | 'pipeline' | 'drafts' | 'outreach' | 'limitations'
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
interface ProspectState { status: ProspectStatus; subject: string; body: string; toEmail?: string; error?: string }

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
    aiDraft: 'Hi,\n\nThanks for reaching out — we\'d love to be included!\n\nGrowth Hacker is an AI-powered marketing audit platform for SMBs. We surface gaps across SEO, GEO, content quality, and social presence — mapping every finding to a weighted growth score with AI-drafted fixes.\n\nKey differentiators:\n• Combined SEO + GEO (AI discoverability) audit\n• AI-verified checks with human override capability\n• Module-based progression system that guides growth teams\n\nDemo: [video link] | Product: [URL]\n\nBest,\n[Your name]',
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
    content: 'Hi,\n\nThanks for reaching out — we\'d love to be included!\n\nGrowth Hacker is an AI-powered marketing audit platform for SMBs — SEO, GEO, content quality, and social presence in one dashboard.\n\nDemo: [video link] | Product: [URL]\n\nHappy to provide additional assets.\n\nBest,\n[Your name]',
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
  const [selectedId, setSelectedId]           = useState('t1')
  const [copied, setCopied]                   = useState<string | null>(null)
  const [expandedDraft, setExpandedDraft]     = useState<string | null>('d1')
  const [inboxFilter, setInboxFilter]         = useState<InboxFilter>('all')
  const [showStalled, setShowStalled]         = useState(true)
  const [disconnecting, setDisconnecting]     = useState(false)
  const [prospectStates, setProspectStates]     = useState<Record<string, ProspectState>>({})
  const [expandedProspect, setExpandedProspect] = useState<string | null>(null)
  const [needsReconnect, setNeedsReconnect]     = useState(false)

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
        body: JSON.stringify({ to: state.toEmail ?? prospect.email, subject: state.subject, body: state.body }),
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
    } catch (e: unknown) {
      setProspectStates(prev => ({
        ...prev,
        [prospect.id]: { ...state, status: 'error', error: e instanceof Error ? e.message : 'Send failed' },
      }))
    }
  }

  const thread = THREADS.find(t => t.id === selectedId) ?? THREADS[0]

  const filteredThreads = THREADS.filter(t => {
    if (inboxFilter === 'all') return true
    if (inboxFilter === 'leads') return ['hot', 'warm', 'cold', 'followup'].includes(t.tag ?? '')
    return t.tag === inboxFilter
  })

  const hotLeadCount  = THREADS.filter(t => t.tag === 'hot').length
  const leadCount     = THREADS.filter(t => ['hot', 'warm', 'cold', 'followup'].includes(t.tag ?? '')).length
  const pressCount    = THREADS.filter(t => t.tag === 'press').length
  const partnerCount  = THREADS.filter(t => t.tag === 'partnership').length

  function copyText(text: string, id: string) {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
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
                Growth Hacker reads your Gmail to detect inbound leads, draft contextual replies in your voice, and surface deals that have gone quiet — without ever sending anything without your explicit approval.
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
              <span className="gh-filter-info">{filteredThreads.length} thread{filteredThreads.length !== 1 ? 's' : ''}</span>
            </div>

            <div className="gh-inbox-layout">

              {/* Thread list */}
              <div className="gh-thread-list">
                {filteredThreads.map(t => (
                  <button
                    key={t.id}
                    className={`gh-thread-item${selectedId === t.id ? ' active' : ''}${!t.isRead ? ' unread' : ''}`}
                    onClick={() => setSelectedId(t.id)}
                  >
                    {!t.isRead && <span className="gh-unread-dot" />}
                    <div className={`gh-thread-av gh-av-${t.tag ?? 'default'}`}>{t.initials}</div>
                    <div className="gh-thread-body">
                      <div className="gh-thread-top">
                        <span className="gh-thread-from">{t.from}</span>
                        <span className="gh-thread-time">{t.time}</span>
                      </div>
                      <div className="gh-thread-subject">{t.subject}</div>
                      <div className="gh-thread-preview">{t.preview}</div>
                      {t.tag && <span className={`gh-tag gh-tag-${t.tag}`}>{TAG_LABELS[t.tag]}</span>}
                    </div>
                  </button>
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
                    {thread.messages.map((msg, i) => (
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
                    ))}
                  </div>

                  {/* AI Summary */}
                  <div className="gh-ai-summary">
                    <div className="gh-ai-label">
                      <IcAI />
                      AI Summary
                    </div>
                    <p className="gh-ai-text">{thread.aiSummary}</p>
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
                        <button className="gh-draft-regen">Regenerate</button>
                      </div>
                    </div>
                  ) : (
                    <div className="gh-no-draft">No draft needed for this thread type</div>
                  )}

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
                            <label className="gh-ee-label">Body</label>
                            <textarea
                              className="gh-ee-textarea"
                              rows={11}
                              value={state.body}
                              onChange={e =>
                                setProspectStates(prev => ({
                                  ...prev,
                                  [prospect.id]: { ...state, body: e.target.value },
                                }))
                              }
                            />
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
                          <button className="gh-dc-save" onClick={() => saveDraft(prospect)}>
                            Save to Drafts
                          </button>
                          <button
                            className="gh-draft-copy"
                            onClick={() => copyText(`Subject: ${state.subject}\n\n${state.body}`, prospect.id)}
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
