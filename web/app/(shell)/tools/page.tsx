import { redirect } from 'next/navigation'
import { getSessionUser, getBrandForUser } from '@/lib/server-session'
import Link from 'next/link'
import { isComingSoon } from '@/lib/features'
import { hasEarlyAccess } from '@/lib/early-access'
import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { TOOL_GROUPS } from '@/lib/tools'
import ToolIcon from '@/components/ToolIcon'
import ToolHeader from '@/components/ToolHeader'
import ToolCardStatus from './ToolCardStatus'

export default async function ToolsPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const brand = await getBrandForUser(user.id)
  if (!brand) redirect('/onboarding')

  const earlyAccess = await hasEarlyAccess(user.email)
  const [gmailInteg] = await db
    .select({ status: brandIntegrations.status })
    .from(brandIntegrations)
    .where(and(eq(brandIntegrations.brandId, brand.id), eq(brandIntegrations.provider, 'gmail')))
    .limit(1)
  const gmailConnected = gmailInteg?.status === 'connected'

  return (
    <div className="tool-page">
        <ToolHeader icon="grid" title="Tools" meta={`${brand.name} · every growth tool in one place`} />

        {/* Same groups, names and icons as the sidebar (lib/tools.ts); parked tools (lib/features.ts) are left out. */}
        {TOOL_GROUPS.map(group => ({ ...group, items: group.items.filter(t => !isComingSoon(t.href, earlyAccess)) }))
          .filter(group => group.items.length > 0)
          .map(group => (
          <section key={group.label} className="tl-group">
            <h2 className="tool-label">{group.label}</h2>
            <div className="tl-grid">
              {group.items.map(tool => (
                <Link key={tool.href} href={tool.href} className="tl-card">
                  <div className="tl-card-top">
                    <div className="tl-card-icon"><ToolIcon name={tool.icon} size={18} /></div>
                    {tool.gmail && (
                      <span className={`tl-card-badge ${gmailConnected ? 'tl-card-badge--on' : 'tl-card-badge--off'}`}>
                        {gmailConnected ? 'Gmail connected' : 'Gmail not connected'}
                      </span>
                    )}
                  </div>
                  <div className="tl-card-title">{tool.label}</div>
                  <div className="tl-card-desc">{tool.desc}</div>
                  <ToolCardStatus color="var(--green)" />
                </Link>
              ))}
            </div>
          </section>
        ))}
    </div>
  )
}
