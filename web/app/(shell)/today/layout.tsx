import ComingSoonPage from '@/components/ComingSoonPage'

// Parked for now (lib/features.ts). The page itself stays in the codebase; restore the ProGate
// wrapper from git history when bringing it back.
export default function Layout() {
  return <ComingSoonPage feature="Today" blurb="Your daily action list: the few things to do today, picked from your audits, traffic and social signals." />
}
