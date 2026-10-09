'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, type JSX } from 'react'

interface NavItem {
  href: string
  label: string
  icon: string
  lockedType?: 'gmail-outreach' | 'meta-ads'
  pro?: boolean // needs GrowJin Pro when billing is on
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const NAV: NavGroup[] = [
  { label: 'Grow', items: [
    { href: '/dashboard', label: 'Growth Path', icon: 'path' },
    { href: '/today', label: 'Today', icon: 'sun', pro: true },
  ]},
  { label: 'Work', items: [
    { href: '/gmail-hub', label: 'Outreach', icon: 'mail', lockedType: 'gmail-outreach', pro: true },
    { href: '/social', label: 'Social Studio', icon: 'image', pro: true },
    { href: '/dashboard/meta-ads/blueprint', label: 'Meta Ads', icon: 'megaphone', lockedType: 'meta-ads', pro: true },
    { href: '/lead-finder', label: 'Lead Finder', icon: 'target', pro: true },
    { href: '/reminders', label: 'Reminders', icon: 'bell', pro: true },
  ]},
  { label: 'Insights', items: [
    { href: '/analytics', label: 'Analytics', icon: 'chart', pro: true },
  ]},
]

const ICON: Record<string, JSX.Element> = {
  path: <path d="M6 16h4a4 4 0 0 0 4-4V8a4 4 0 0 1 4-4M4 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM16 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />,
  sun: <><circle cx="10" cy="10" r="3.2" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.8 4.8l1.4 1.4M13.8 13.8l1.4 1.4M4.8 15.2l1.4-1.4M13.8 6.2l1.4-1.4" /></>,
  mail: <><rect x="2.5" y="4.5" width="15" height="11" rx="2" /><path d="M3.5 6l6.5 5 6.5-5" /></>,
  image: <><rect x="2.5" y="3.5" width="15" height="13" rx="2" /><circle cx="7" cy="8" r="1.4" /><path d="M4 14l3.5-3.5L10 13l3-3.5 3 3.5" /></>,
  megaphone: <><path d="M3 8v4h2.5L13 16V4L5.5 8H3Z" /><path d="M15.5 8.3a2.6 2.6 0 0 1 0 3.4" /></>,
  target: <><circle cx="10" cy="10" r="7" /><circle cx="10" cy="10" r="3.4" /></>,
  bell: <><path d="M6 7.5a4 4 0 0 1 8 0c0 3.5 1.2 4.7 1.5 5.3H4.5C4.8 12.2 6 11 6 7.5Z" /><path d="M8.3 15.5a1.8 1.8 0 0 0 3.4 0" /></>,
  chart: <path d="M3 16.5h14M5.8 16.5v-5M10 16.5v-9M14.2 16.5V4.5" />,
  gear: <><circle cx="10" cy="10" r="2.6" /><path d="M10 3v2M10 15v2M17 10h-2M5 10H3M14.9 5.1l-1.4 1.4M6.5 13.5l-1.4 1.4M14.9 14.9l-1.4-1.4M6.5 6.5L5.1 5.1" /></>,
}

function NavIcon({ name }: { name: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      {ICON[name]}
    </svg>
  )
}

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
  plan = { enabled: false, pro: true },
}: {
  brandName: string
  lockedTypes: string[]
  plan?: { enabled: boolean; pro: boolean }
}) {
  // Free users (billing on): the Pro tools move into one "Pro" group with a single Upgrade link,
  // rather than a badge on every item. The pages themselves show the upgrade screen.
  const showPro = plan.enabled && !plan.pro
  const groups: (NavGroup & { pro?: boolean })[] = showPro
    ? [
        { label: 'Grow', items: NAV.flatMap(g => g.items).filter(i => !i.pro) },
        { label: 'Pro', items: NAV.flatMap(g => g.items).filter(i => i.pro), pro: true },
      ].filter(g => g.items.length > 0)
    : NAV
  const pathname = usePathname()
  // Phones: the sidebar becomes a slide-in drawer behind a menu button (desktop ignores this state).
  const [open, setOpen] = useState(false)
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  // Close when the route changes (a nav item was tapped).
  useEffect(() => { setOpen(false) }, [pathname])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeBtnRef.current?.focus()
    const menuBtn = menuBtnRef.current
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      menuBtn?.focus()
    }
  }, [open])

  // Tapping the page you're already on doesn't change the route, so close explicitly.
  const closeOnNav = () => setOpen(false)

  return (
    <>
    {/* Settings has its own section menu and a back arrow on phones, so the GrowJin bar is left out there. */}
    {!pathname.startsWith('/settings') && <header className="app-mobilebar">
      <button
        ref={menuBtnRef}
        className="app-mobilebar-btn"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        aria-controls="app-sidebar"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>
      <span className="app-mobilebar-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/growjinlogo.svg" alt="" width={24} height={24} className="app-sidebar-logo" />
        GrowJin
      </span>
    </header>}
    <div className={`app-drawer-backdrop${open ? ' open' : ''}`} onClick={() => setOpen(false)} aria-hidden="true" />
    <nav id="app-sidebar" className={`app-sidebar${open ? ' open' : ''}`} aria-label="Main">
      <div className="app-sidebar-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/growjinlogo.svg" alt="" width={24} height={24} className="app-sidebar-logo" />
        GrowJin
        <button ref={closeBtnRef} className="app-drawer-close" onClick={() => setOpen(false)} aria-label="Close menu">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      {groups.map((group) => (
        <div className={`app-sidebar-group${'pro' in group && group.pro ? ' app-sidebar-group--pro' : ''}`} key={group.label}>
          {'pro' in group && group.pro ? (
            <div className="app-sidebar-glabel app-sidebar-glabel--pro">
              <span>Pro</span>
              <Link href="/pricing" className="app-sidebar-upgrade" onClick={closeOnNav}>Upgrade</Link>
            </div>
          ) : (
            <div className="app-sidebar-glabel">{group.label}</div>
          )}
          {group.items.map((item) => {
            const proTagged = showPro && item.pro
            // Plan beats progress: a Pro tool shows as Pro (clickable → upgrade screen), not padlocked.
            const locked = !proTagged && (item.lockedType ? lockedTypes.includes(item.lockedType) : false)
            const active = isActive(pathname, item.href)
            if (locked) {
              return (
                <span className="app-navitem app-navitem-locked" key={item.href} title="Locked until the module before it is further along">
                  <NavIcon name={item.icon} />
                  {item.label}
                  <svg width="13" height="13" viewBox="0 0 20 20" fill="none" style={{ marginLeft: 'auto', flexShrink: 0 }}>
                    <rect x="4.5" y="9" width="11" height="8" rx="1.6" stroke="currentColor" strokeWidth="1.6"/>
                    <path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9" stroke="currentColor" strokeWidth="1.6"/>
                  </svg>
                </span>
              )
            }
            return (
              <Link href={item.href} className={`app-navitem${active ? ' active' : ''}`} key={item.href} onClick={closeOnNav} aria-current={active ? 'page' : undefined}>
                <NavIcon name={item.icon} />
                {item.label}
              </Link>
            )
          })}
        </div>
      ))}
      <div className="app-sidebar-foot">
        {plan.enabled && plan.pro && (
          <Link href="/pricing" className="app-plan" onClick={closeOnNav}>
            <span className="pro-badge">Pro</span> Your plan
          </Link>
        )}
        <Link href="/settings" className={`app-navitem${pathname.startsWith('/settings') ? ' active' : ''}`} onClick={closeOnNav}>
          <NavIcon name="gear" />
          Settings
        </Link>
        <div className="app-sidebar-workspace">
          <div className="app-sidebar-avatar">{brandName.slice(0, 1).toUpperCase()}</div>
          <div className="app-sidebar-wsname">{brandName}</div>
        </div>
      </div>
    </nav>
    </>
  )
}
