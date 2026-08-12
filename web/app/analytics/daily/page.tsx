import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import DailySummaryCard from './DailySummaryCard'

export default async function DailySummaryPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) redirect('/onboarding')

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '32px 16px' }}>
      {/* Back link */}
      <div style={{ maxWidth: 480, margin: '0 auto 24px' }}>
        <Link
          href="/analytics"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            color: 'var(--text-dim)', fontSize: 13, textDecoration: 'none',
          }}
        >
          <ArrowLeft size={14} />
          Back to analytics
        </Link>
      </div>

      {/* Card */}
      <DailySummaryCard />

      {/* Link to full dashboard */}
      <div style={{ maxWidth: 480, margin: '12px auto 0', textAlign: 'center' }}>
        <Link
          href="/analytics"
          style={{ fontSize: 13, color: 'var(--green)', textDecoration: 'none' }}
        >
          View full dashboard
        </Link>
      </div>
    </div>
  )
}
