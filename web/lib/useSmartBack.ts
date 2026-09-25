'use client'

import { useRouter } from 'next/navigation'

// Goes to the previous in-app page when there is browsing history to go back to
// (e.g. Tools -> Reminders -> back lands on Tools). Falls back to a fixed route
// when the page was opened directly (no history to pop), e.g. a bookmark or new tab.
export function useSmartBack(fallback: string) {
  const router = useRouter()
  return () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
    } else {
      router.push(fallback)
    }
  }
}
