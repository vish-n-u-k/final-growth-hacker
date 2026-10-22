'use client'

import Link, { useLinkStatus } from 'next/link'
import ArrowIcon from '@/components/ArrowIcon'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { isComingSoon } from '@/lib/features'
import InstallAppButton from '@/components/InstallAppButton'
import ThemeToggle from '@/components/ThemeToggle'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRoadmap } from '@/components/RoadmapContext'
import { buildRoadmapPhases, currentRoadmapType, progressColor, roadmapState, type RoadmapModule } from '@/lib/modules/roadmap'
import { Spinner } from '@/components/ui/spinner'
import ToolIcon from '@/components/ToolIcon'
import { TOOL_GROUPS, type ToolItem } from '@/lib/tools'

type NavItem = Omit<ToolItem, 'desc'>

interface NavGroup {
  label: string
  items: NavItem[]
}

// Growth Path and Today are pinned on top; the tools follow in the job groups from lib/tools.ts
const NAV: NavGroup[] = [
  { label: '', items: [
    { href: '/dashboard', label: 'Growth Path', icon: 'path' },
    { href: '/today', label: 'Today', icon: 'sun', pro: true },
  ]},
  ...TOOL_GROUPS,
]

const NavIcon = ToolIcon

// Spinner shown inside a nav link while its page is still loading.
function PendingHint() {
  const { pending } = useLinkStatus()
  return <span aria-hidden="true" className={`app-nav-pending${pending ? ' is-pending' : ''}`} />
}

// Growth Path owns every /dashboard/* route except the ones other nav items claim
// for themselves (Meta Ads lives under /dashboard/meta-ads).
function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') {
    return (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) && !pathname.startsWith('/dashboard/meta-ads')
  }
  return pathname === href || pathname.startsWith(href + '/')
}

// Growth Path roadmap: the four stages with their modules. The stage holding the selected module
// is open; finished stages stay closed until opened. Picking a module while on the Growth Path page
// switches it in place (no server round trip); from any other page it links to /dashboard?module=...
function RoadmapNav({ modules, pathname, onNavigate, showUpgrade }: {
  modules: RoadmapModule[]
  pathname: string
  onNavigate: () => void
  showUpgrade: boolean
}) {
  const { live, pickModule } = useRoadmap()
  // Once Growth Path has published its live lock state, use it (it updates as items are ticked);
  // until then the server's lock state, worked out from the saved scores, applies.
  const liveLocked = live.locked
  const mods = useMemo(
    () => liveLocked ? modules.map(m => (m.comingSoon ? m : { ...m, locked: liveLocked.includes(m.type) })) : modules,
    [modules, liveLocked],
  )
  const phases = useMemo(() => buildRoadmapPhases(mods, live.scores), [mods, live.scores])
  const onDashboard = pathname === '/dashboard'
  const inGrowthPath = isActive(pathname, '/dashboard')
  const currentType = currentRoadmapType(mods, live.scores)
  const selectedType = inGrowthPath ? (live.selectedType ?? currentType) : null
  // Every stage starts closed and only one is open at a time. The stage holding the module you are on
  // gets an accent colour so you can still tell where you are.
  const selectedPhase = selectedType ? phases.find(p => p.mods.some(m => m.type === selectedType))?.name ?? null : null
  const [openStage, setOpenStage] = useState<string | null>(null)
  const toggle = (name: string) => setOpenStage(prev => (prev === name ? null : name))
  const hasPro = phases.some(p => p.pro)

  return (
    <div className="app-rm" role="group" aria-label="Growth Path roadmap">
      <Link href="/dashboard" className="app-rm-title" onClick={onNavigate}>Your roadmap</Link>
      {phases.map((p, i) => {
        const isOpen = openStage === p.name
        const gated = p.locked || p.pro
        return (
          <div key={p.name} className={`app-rm-stage${isOpen ? ' is-open' : ''}${gated ? ' is-locked' : ''}${p.name === selectedPhase ? ' has-selected' : ''}`}>
            <button type="button" className="app-rm-hd" aria-expanded={isOpen} onClick={() => toggle(p.name)} title={p.blurb}>
              <svg className="app-rm-chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <span className="app-rm-name">{i + 1} · {p.name}</span>
              <span className="app-rm-count">
                {gated ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-label="Locked"><rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" /><path d="M8 11V7a4 4 0 1 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                ) : `${p.done}/${p.total}`}
              </span>
              {!gated && (
                <span className="app-rm-bar" aria-hidden="true"><i style={{ width: `${p.pct}%`, background: progressColor(p.pct) }} /></span>
              )}
            </button>
            {isOpen && (
              <div className="app-rm-mods">
                {p.mods.map(m => {
                  const st = roadmapState(m, live.scores)
                  const state = st.done ? 'done' : st.locked || st.soon || st.pro ? 'locked' : 'open'
                  const selected = m.type === selectedType
                  return (
                    <Link
                      key={m.id}
                      href={`/dashboard?module=${encodeURIComponent(m.type)}`}
                      className={`app-rm-mod app-rm-mod--${state}${selected ? ' is-selected' : ''}`}
                      aria-current={selected ? 'page' : undefined}
                      title={st.pro ? `${m.name} — GrowJin Pro` : st.locked ? `${m.name} — locked until the module before it is further along` : st.soon ? `${m.name} — coming soon` : `${m.name} — ${st.score}%`}
                      onClick={e => {
                        onNavigate()
                        if (onDashboard) { e.preventDefault(); pickModule(m.type) }
                      }}
                    >
                      <span
                        className={`app-rm-dot${state !== 'locked' && m.analysed ? ' is-scored' : ''}`}
                        style={state !== 'locked' && m.analysed ? { background: progressColor(st.score), borderColor: progressColor(st.score) } : undefined}
                        aria-hidden="true"
                      >
                        {state === 'locked' ? (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2.4" /><path d="M8 11V7a4 4 0 1 1 8 0v4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
                        ) : null}
                      </span>
                      <span className="app-rm-modname">{m.name}</span>
                      {st.soon ? <span className="app-rm-pct">Soon</span>
                        : !st.locked && !st.pro && <span className="app-rm-pct">{m.analysed ? `${st.score}%` : '—'}</span>}
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
      {showUpgrade && hasPro && <Link href="/pricing" className="app-rm-upgrade" onClick={onNavigate}>Unlock more steps with Pro <ArrowIcon size={12} /></Link>}
    </div>
  )
}

export default function AppSidebar({
  brandName,
  lockedTypes,
  plan = { enabled: false, pro: true },
  roadmap = [],
  earlyAccess = false,
}: {
  brandName: string
  lockedTypes: string[]
  plan?: { enabled: boolean; pro: boolean }
  roadmap?: RoadmapModule[]
  earlyAccess?: boolean
}) {
  const isSoon = (href: string) => isComingSoon(href, earlyAccess)
  // Free users (billing on): the Pro tools move into one "Pro" group with a single Upgrade link,
  // rather than a badge on every item. The pages themselves show the upgrade screen.
  const showPro = plan.enabled && !plan.pro
  const allItems = NAV.flatMap(g => g.items)
  const baseGroups: (NavGroup & { pro?: boolean })[] = !showPro
    ? [
        { label: '', items: allItems.filter(i => i.href === '/dashboard') },
        ...TOOL_GROUPS,
      ]
    : showPro
    ? [
        { label: 'Grow', items: NAV.flatMap(g => g.items).filter(i => !i.pro) },
        { label: 'Pro', items: NAV.flatMap(g => g.items).filter(i => i.pro), pro: true },
      ].filter(g => g.items.length > 0)
    : NAV
  // Parked tools sit together in one quiet group at the bottom instead of between the live ones.
  // Today ("what do I do now?") always sits first, above the roadmap, whether it is live or parked.
  const todayItem = allItems.find(i => i.href === '/today')
  const notToday = (i: NavItem) => i.href !== '/today'
  const soonItems = NAV.flatMap(g => g.items).filter(i => isSoon(i.href) && notToday(i))
  const groups: (NavGroup & { pro?: boolean; soon?: boolean })[] = [
    ...(todayItem ? [{ label: '', items: [todayItem] }] : []),
    ...baseGroups.map(g => ({ ...g, items: g.items.filter(i => !isSoon(i.href) && notToday(i)) })).filter(g => g.items.length > 0),
    ...(soonItems.length ? [{ label: 'Coming soon', items: soonItems, soon: true }] : []),
  ]
  const actualPath = usePathname()
  // The link just clicked counts as active straight away, so the menu reacts before the page arrives.
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  useEffect(() => { setPendingHref(null) }, [actualPath])
  const pathname = pendingHref ?? actualPath
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)
  // Settings, install and sign out live in a menu on the profile row at the bottom.
  const [profileOpen, setProfileOpen] = useState(false)
  const profileRef = useRef<HTMLDivElement>(null)
  useEffect(() => { setProfileOpen(false) }, [actualPath])
  useEffect(() => {
    if (!profileOpen) return
    const onDown = (e: MouseEvent | TouchEvent) => { if (!profileRef.current?.contains(e.target as Node)) setProfileOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setProfileOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); document.removeEventListener('keydown', onKey) }
  }, [profileOpen])
  const handleSignOut = async () => {
    setSigningOut(true)
    await createClient().auth.signOut()
    router.push('/login')
    router.refresh()
  }
  // Phones: the sidebar becomes a slide-in drawer behind a menu button (desktop ignores this state).
  const [open, setOpen] = useState(false)
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  // Close when the route changes (a nav item was tapped).
  useEffect(() => { setOpen(false) }, [actualPath])

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
  const navTo = (href: string) => () => { setOpen(false); if (href !== actualPath) setPendingHref(href) }

  return (
    <>
    {/* Settings has its own section menu and a back arrow on phones, so the GrowJin bar is left out there. */}
    {!pathname.startsWith('/settings') && <header className="app-mobilebar">
      <Link href="/dashboard" className="app-mobilebar-brand app-brand-link" aria-label="GrowJin: go to Growth Path">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/growjinlogo.svg" alt="" width={24} height={24} className="app-sidebar-logo" />
        GrowJin
      </Link>
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
    </header>}
    <div className={`app-drawer-backdrop${open ? ' open' : ''}`} onClick={() => setOpen(false)} aria-hidden="true" />
    <nav id="app-sidebar" className={`app-sidebar${open ? ' open' : ''}`} aria-label="Main">
      <div className="app-sidebar-brand">
        <Link href="/dashboard" className="app-brand-link" onClick={closeOnNav} aria-label="GrowJin: go to Growth Path">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/growjinlogo.svg" alt="" width={24} height={24} className="app-sidebar-logo" />
          GrowJin
        </Link>
        <button ref={closeBtnRef} className="app-drawer-close" onClick={() => setOpen(false)} aria-label="Close menu">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      {groups.map((group, gi) => (
        <div className={`app-sidebar-group${'pro' in group && group.pro ? ' app-sidebar-group--pro' : ''}${'soon' in group && group.soon ? ' app-sidebar-group--soon' : ''}`} key={`${group.label}-${gi}`}>
          {'pro' in group && group.pro ? (
            <div className="app-sidebar-glabel app-sidebar-glabel--pro">
              <span>Pro</span>
              <Link href="/pricing" className="app-sidebar-upgrade" onClick={closeOnNav}>Upgrade</Link>
            </div>
          ) : group.label ? (
            <div className="app-sidebar-glabel">{group.label}</div>
          ) : null}
          {group.items.map((item) => {
            // Growth Path expands into the roadmap (stages and their modules).
            if (item.href === '/dashboard' && roadmap.length > 0) {
              return <RoadmapNav key={item.href} modules={roadmap} pathname={pathname} onNavigate={closeOnNav} showUpgrade={showPro} />
            }
            if (isSoon(item.href)) {
              return (
                <span className="app-navitem app-navitem-locked app-navitem-soon" key={item.href} title="Coming soon">
                  <NavIcon name={item.icon} />
                  {item.label}
                </span>
              )
            }
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
              <Link href={item.href} className={`app-navitem${active ? ' active' : ''}`} key={item.href} onClick={navTo(item.href)} aria-current={active ? 'page' : undefined}>
                <NavIcon name={item.icon} />
                {item.label}
                <PendingHint />
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
        <div className="app-profile" ref={profileRef}>
          {profileOpen && (
            <div className="app-profile-menu" role="menu" aria-label="Account">
              <Link href="/settings" role="menuitem" className={`app-navitem${pathname.startsWith('/settings') ? ' active' : ''}`} onClick={() => { setProfileOpen(false); navTo('/settings')() }}>
                <NavIcon name="gear" />
                Settings
                <PendingHint />
              </Link>
              <InstallAppButton className="app-navitem app-navitem--btn" icon={<NavIcon name="install" />} />
              <button type="button" role="menuitem" className="app-navitem app-navitem--btn" onClick={handleSignOut} disabled={signingOut}>
                <NavIcon name="logout" />
                {signingOut ? <><Spinner />Signing out…</> : 'Sign out'}
              </button>
            </div>
          )}
          <div className="app-sidebar-workspace">
            <button type="button" className="app-profile-btn" onClick={() => setProfileOpen(o => !o)} aria-haspopup="menu" aria-expanded={profileOpen}>
              <span className="app-sidebar-avatar">{brandName.slice(0, 1).toUpperCase()}</span>
              <span className="app-sidebar-wsname">{brandName}</span>
              <svg className="app-profile-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6" /></svg>
            </button>
            <span className="app-sidebar-theme"><ThemeToggle /></span>
          </div>
        </div>
      </div>
    </nav>
    </>
  )
}
