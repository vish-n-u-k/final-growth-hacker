import { redirect } from 'next/navigation'

// Competitor Leads is part of Lead Finder now (a button per competitor on /leads). The review page
// (/lead-finder/review/[id]) still works for emails started from it. The old page's component
// (components/LeadFinder.tsx) is kept until Lead Finder has been in use for a while.
export default function LeadFinderPage() {
  redirect('/leads')
}
