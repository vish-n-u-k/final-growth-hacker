import ProGate from '@/components/ProGate'

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ProGate feature="Engagement Hub" blurb="Find and join the conversations where your customers already are.">{children}</ProGate>
}
