import ProGate from '@/components/ProGate'

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ProGate feature="Reminders" blurb="Recurring growth chores — reviews, pricing checks, newsletters — suggested for your business and tracked for you.">{children}</ProGate>
}
