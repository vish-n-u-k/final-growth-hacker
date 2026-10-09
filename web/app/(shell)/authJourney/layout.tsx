import ProGate from '@/components/ProGate'

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ProGate feature="Analytics" blurb="Live users, retention and traffic in one place, synced from PostHog, GA4 and Search Console.">{children}</ProGate>
}
