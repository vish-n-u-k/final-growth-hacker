import ProGate from '@/components/ProGate'

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ProGate feature="Social Studio" blurb="AI-suggested posts and series for each platform, scheduled and published through Frekto.">{children}</ProGate>
}
