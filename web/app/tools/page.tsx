import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

interface Tool {
  href: string
  title: string
  desc: string
  color: string
  glow: string
  icon: React.ReactNode
  badge?: 'connected' | 'not-connected'
  comingSoon?: boolean
}

export default async function ToolsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) redirect('/onboarding')

  const [gmailInteg] = await db
    .select({ status: brandIntegrations.status })
    .from(brandIntegrations)
    .where(and(eq(brandIntegrations.brandId, brand.id), eq(brandIntegrations.provider, 'gmail')))
    .limit(1)

  const gmailConnected = gmailInteg?.status === 'connected'
  const gmailBadge: Tool['badge'] = gmailConnected ? 'connected' : 'not-connected'

  const tools: Tool[] = [
    {
      href: '/gmail-hub',
      title: 'Gmail Hub',
      desc: 'Sorted leads, AI drafts, and follow-ups from your inbox.',
      color: '#2563eb',
      glow: 'rgba(37,99,235,0.25)',
      badge: gmailBadge,
      icon: (
        <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
          <rect x="2" y="4" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M2 7l8 5 8-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      href: '/lead-finder',
      title: 'Find Leads',
      desc: 'Scrape reviews for warm prospects, then draft outreach.',
      color: '#0891b2',
      glow: 'rgba(8,145,178,0.25)',
      badge: gmailBadge,
      icon: (
        <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
          <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M17 17l-4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      href: '/dashboard/meta-ads/blueprint',
      title: 'Meta Ads',
      desc: 'A ready-to-launch 3-funnel Meta ad campaign.',
      color: '#7c3aed',
      glow: 'rgba(124,58,237,0.25)',
      icon: (
        <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
          <rect x="3" y="3" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
          <rect x="11" y="3" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
          <rect x="3" y="11" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
          <rect x="11" y="11" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
        </svg>
      ),
    },
    {
      href: '/today',
      title: "Today's List",
      desc: 'Your highest-impact tasks for today, in one place.',
      color: '#d97706',
      glow: 'rgba(217,119,6,0.25)',
      icon: (
        <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
          <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M10 6v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
    },
    {
      href: '/reminders',
      title: 'Create Reminders',
      desc: 'Recurring nudges so follow-ups never slip through.',
      color: '#e11d48',
      glow: 'rgba(225,29,72,0.25)',
      icon: (
        <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
          <path d="M10 2a6 6 0 00-6 6v3l-1.5 2.5h15L16 11V8a6 6 0 00-6-6z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
          <path d="M8.5 16.5a1.5 1.5 0 003 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      href: '/social',
      title: 'Social Studio',
      desc: 'Generate and schedule posts across platforms.',
      color: '#64748b',
      glow: 'rgba(100,116,139,0.25)',
      comingSoon: true,
      icon: (
        <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
          <circle cx="5" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.5"/>
          <circle cx="15" cy="4.5" r="2.2" stroke="currentColor" strokeWidth="1.5"/>
          <circle cx="15" cy="15.5" r="2.2" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M6.9 8.9l6.2-3.3M6.9 11.1l6.2 3.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
    },
  ]

  return (
    <div className="gh-page">
      <div className="gh-inner">
        <div className="gh-header">
          <div>
            <Link href="/dashboard" className="gh-back">← Dashboard</Link>
            <div className="gh-title">Tools</div>
            <div className="gh-subtitle">{brand.name} — every growth tool in one place</div>
          </div>
        </div>

        <div className="tl-grid">
          {tools.map(tool => {
            const content = (
              <>
                <div className="tl-card-top">
                  <div className="tl-card-icon" style={{ background: tool.color, borderColor: tool.color, color: '#fff' }}>{tool.icon}</div>
                  {tool.comingSoon ? (
                    <span className="cs-badge">Coming Soon</span>
                  ) : tool.badge && (
                    <span className={`tl-card-badge ${tool.badge === 'connected' ? 'tl-card-badge--on' : 'tl-card-badge--off'}`}>
                      {tool.badge === 'connected' ? 'Connected' : 'Not connected'}
                    </span>
                  )}
                </div>
                <div className="tl-card-title">{tool.title}</div>
                <div className="tl-card-desc">{tool.desc}</div>
                {!tool.comingSoon && <div className="tl-card-arrow" style={{ color: tool.color }}>Open →</div>}
              </>
            )

            return tool.comingSoon ? (
              <div key={tool.href} className="tl-card tl-card--disabled">{content}</div>
            ) : (
              <Link key={tool.href} href={tool.href} className="tl-card" style={{ '--tl-color': tool.color, '--tl-glow': tool.glow } as React.CSSProperties}>{content}</Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
