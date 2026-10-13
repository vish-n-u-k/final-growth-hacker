'use client'

// Chrome/Edge/Android fire `beforeinstallprompt` once, early, often before the sidebar has mounted.
// PwaRegister catches it here so the Install button can use it whenever it renders.

export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(fn => fn())

export function captureInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // we show our own button instead of Chrome's mini-infobar
    deferred = e as InstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => { deferred = null; notify() })
}

export const getInstallPrompt = () => deferred
export function clearInstallPrompt() { deferred = null; notify() }
export function onInstallPromptChange(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/** iPhone/iPad Safari: no install prompt exists, people use Share → Add to Home Screen. */
export function isIosBrowser(): boolean {
  const ua = navigator.userAgent
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return /iPhone|iPad|iPod/.test(ua) || iPadOS
}
