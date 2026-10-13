import ProGate from '@/components/ProGate'

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ProGate feature="Today" blurb="Your daily action list — the few things to do today, picked from your audits, traffic and social signals.">{children}</ProGate>
}
