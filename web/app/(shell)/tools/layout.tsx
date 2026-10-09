import ProGate from '@/components/ProGate'

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ProGate feature="Tools" blurb="The full GrowJin toolset — outreach, social, leads and more.">{children}</ProGate>
}
