import ProGate from '@/components/ProGate'

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ProGate feature="Outreach" blurb="Turn your inbox into a pipeline: leads tagged hot to cold, stalled threads flagged, replies drafted for you to send.">{children}</ProGate>
}
