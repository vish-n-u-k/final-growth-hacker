'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface NavItem {
  href: string
  label: string
  lockedType?: 'gmail-outreach' | 'meta-ads'
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const NAV: NavGroup[] = [
  { label: 'Grow', items: [
    { href: '/dashboard', label: 'Growth Path' },
    { href: '/today', label: 'Today' },
  ]},
  { label: 'Work', items: [
    { href: '/gmail-hub', label: 'Outreach', lockedType: 'gmail-outreach' },
    { href: '/social', label: 'Social Studio' },
    { href: '/dashboard/meta-ads/blueprint', label: 'Meta Ads', lockedType: 'meta-ads' },
    { href: '/lead-finder', label: 'Lead Finder' },
    { href: '/reminders', label: 'Reminders' },
  ]},
  { label: 'Insights', items: [
    { href: '/analytics', label: 'Analytics' },
  ]},
]

// Growth Path owns every /dashboard/* route except the ones other nav items claim
// for themselves (Meta Ads lives under /dashboard/meta-ads).
function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') {
    return (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) && !pathname.startsWith('/dashboard/meta-ads')
  }
  return pathname === href || pathname.startsWith(href + '/')
}

export default function AppSidebar({
  brandName,
  lockedTypes,
}: {
  brandName: string
  lockedTypes: string[]
}) {
  const pathname = usePathname()

  return (
    <nav className="app-sidebar">
      <div className="app-sidebar-brand">
        <span className="app-sidebar-mark" />
        GrowJin
      </div>
      {NAV.map((group) => (
        <div className="app-sidebar-group" key={group.label}>
          <div className="app-sidebar-glabel">{group.label}</div>
          {group.items.map((item) => {
            const locked = item.lockedType ? lockedTypes.includes(item.lockedType) : false
            const active = isActive(pathname, item.href)
            if (locked) {
              return (
                <span className="app-navitem app-navitem-locked" key={item.href} title="Locked until the module before it is further along">
                  {item.label}
                  <svg width="13" height="13" viewBox="0 0 20 20" fill="none" style={{ marginLeft: 'auto', flexShrink: 0 }}>
                    <rect x="4.5" y="9" width="11" height="8" rx="1.6" stroke="currentColor" strokeWidth="1.6"/>
                    <path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9" stroke="currentColor" strokeWidth="1.6"/>
                  </svg>
                </span>
              )
            }
            return (
              <Link href={item.href} className={`app-navitem${active ? ' active' : ''}`} key={item.href}>
                {item.label}
              </Link>
            )
          })}
        </div>
      ))}
      <div className="app-sidebar-foot">
        <Link href="/settings" className={`app-navitem${pathname.startsWith('/settings') ? ' active' : ''}`}>
          Settings
        </Link>
        <div className="app-sidebar-workspace">
          <div className="app-sidebar-avatar">{brandName.slice(0, 1).toUpperCase()}</div>
          <div className="app-sidebar-wsname">{brandName}</div>
        </div>
      </div>
    </nav>
  )
}
