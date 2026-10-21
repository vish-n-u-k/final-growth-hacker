import ProGate from '@/components/ProGate'

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ProGate feature="Lead Finder" blurb="Mine competitor reviews for unhappy customers that fit your product, scored and ready for outreach.">{children}</ProGate>
}
