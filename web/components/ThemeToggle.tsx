'use client'

import { useEffect, useState } from 'react'

export default function ThemeToggle() {
  const [light, setLight] = useState(true)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const stored = localStorage.getItem('gh_theme')
    if (stored === 'dark') {
      document.documentElement.classList.remove('light')
      setLight(false)
    }
  }, [])

  function toggle() {
    const next = !light
    setLight(next)
    if (next) {
      document.documentElement.classList.add('light')
      localStorage.setItem('gh_theme', 'light')
    } else {
      document.documentElement.classList.remove('light')
      localStorage.setItem('gh_theme', 'dark')
    }
  }

  const sunIcon = (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  )

  const moonIcon = (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )

  return (
    <button
      onClick={toggle}
      title={light ? 'Switch to dark mode' : 'Switch to light mode'}
      className="w-10 h-10 border border-[var(--line)] text-[var(--text-dim)] hover:border-[var(--green)] hover:text-[var(--text)] bg-transparent rounded-[10px] grid place-items-center transition-all duration-150 flex-shrink-0 cursor-pointer"
      suppressHydrationWarning
    >
      {/* Light is the default, so render moon on server; swap after mount to avoid hydration mismatch */}
      {mounted ? (light ? moonIcon : sunIcon) : moonIcon}
    </button>
  )
}
