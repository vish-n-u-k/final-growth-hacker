import { redirect } from 'next/navigation'

// The Lead Agent is part of Lead Finder now: its sources (companies, seller pages, Reddit and Hacker
// News, Google Maps), settings and leads all live on /leads. The old page and its component
// (components/agents/LeadAgentPage.tsx) are kept until Lead Finder has been in use for a while.
export default function LeadAgentRoute() {
  redirect('/leads')
}
