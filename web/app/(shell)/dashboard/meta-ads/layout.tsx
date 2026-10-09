import ProGate from '@/components/ProGate'

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ProGate feature="Meta Ads" blurb="Audit your Meta Ads setup and get a ready-to-launch campaign blueprint.">{children}</ProGate>
}
