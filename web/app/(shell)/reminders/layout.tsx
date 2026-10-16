import ProGate from '@/components/ProGate'

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ProGate feature="Reminders" blurb="Find out when something changes: a page losing Google clicks, a search falling off page 1, a DNS record breaking. Plus follow-ups on emails with no reply, and the recurring checks you choose.">{children}</ProGate>
}
