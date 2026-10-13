'use client'

import { useEffect } from 'react'
import { captureInstallPrompt } from '@/lib/pwa-install'

// Registers public/sw.js, which makes the app installable. Skipped in dev so it never caches a dev build.
export default function PwaRegister() {
  useEffect(() => {
    captureInstallPrompt()
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {})
  }, [])
  return null
}
