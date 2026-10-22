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
        <div className="tool-hd">
          <div className="tool-hd-main">
            <h1 className="tool-title">Tools</h1>
            <p className="tool-sub">{brand.name} — every growth tool in one place</p>
          </div>
        </div>

        {/* Same groups, names and icons as the sidebar (lib/tools.ts); live tools first in each group. */}
        {TOOL_GROUPS.map(group => (
          <section key={group.label} className="tl-group">
            <h2 className="tool-label">{group.label}</h2>
            <div className="tl-grid">
              {group.items
                .map(t => ({ ...t, comingSoon: isComingSoon(t.href, earlyAccess) }))
                .sort((a, b) => Number(a.comingSoon) - Number(b.comingSoon))
                .map(tool => {
                  const content = (
                    <>
                      <div className="tl-card-top">
                        <div className="tl-card-icon"><ToolIcon name={tool.icon} size={18} /></div>
                        {tool.comingSoon ? (
                          <span className="cs-badge">Coming Soon</span>
                        ) : tool.gmail && (
                          <span className={`tl-card-badge ${gmailConnected ? 'tl-card-badge--on' : 'tl-card-badge--off'}`}>
                            {gmailConnected ? 'Gmail connected' : 'Gmail not connected'}
                          </span>
                        )}
                      </div>
                      <div className="tl-card-title">{tool.label}</div>
                      <div className="tl-card-desc">{tool.desc}</div>
                      {!tool.comingSoon && <ToolCardStatus color="var(--green)" />}
                    </>
                  )
                  return tool.comingSoon ? (
                    <div key={tool.href} className="tl-card tl-card--disabled">{content}</div>
                  ) : (
                    <Link key={tool.href} href={tool.href} className="tl-card">{content}</Link>
                  )
                })}
            </div>
          </section>
        ))}
    </div>
  )
}
