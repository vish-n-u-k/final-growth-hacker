import Link from 'next/link'
import ComingSoon from '@/components/ComingSoon'

// Full-page placeholder for a parked tool (see lib/features.ts).
export default function ComingSoonPage({ feature, blurb }: { feature: string; blurb: string }) {
  return (
    <div className="cs-page">
      <ComingSoon variant="module" title={feature} note={blurb} />
      <Link href="/dashboard" className="cs-page-back">← Back to Growth Path</Link>
    </div>
  )
}
