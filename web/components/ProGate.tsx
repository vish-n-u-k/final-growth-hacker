import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getAccess } from '@/lib/billing/plan'
import { MODULE_MAP } from '@/lib/modules/registry'

// Wraps a Pro-only area (used by the tool folders' layout.tsx). Renders the children unless
// billing is on and the brand is on Free, in which case it shows an upgrade screen instead.
export default async function ProGate({ feature, blurb, children }: { feature: string; blurb: string; children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <>{children}</> // the page's own auth check redirects
  const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return <>{children}</>
  const access = await getAccess(brand.id, user.email)
  if (access.pro) return <>{children}</>
  const freeNames = access.freeModules.map(t => MODULE_MAP[t]?.name ?? t)

  return (
    <div className="pro-gate">
      <div className="pro-gate-card">
        <span className="pro-badge">Pro</span>
        <h1 className="pro-gate-title">{feature} is part of GrowJin Pro</h1>
        <p className="pro-gate-text">{blurb}</p>
        {freeNames.length > 0 && (
          <p className="pro-gate-text pro-gate-free">The free plan includes {freeNames.join(', ')}.</p>
        )}
        <div className="pro-gate-actions">
          <Link href="/pricing" className="pro-gate-cta">See Pro plans</Link>
          <Link href="/dashboard" className="pro-gate-secondary">Back to Growth Path</Link>
        </div>
      </div>
    </div>
  )
}
