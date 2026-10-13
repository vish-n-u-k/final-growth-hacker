'use client'

import { useEffect, useState } from 'react'
import { getInstallPrompt, clearInstallPrompt, onInstallPromptChange, isStandalone, isIosBrowser } from '@/lib/pwa-install'

// "Install app" in the sidebar. Chrome/Edge/Android: opens the browser's install dialog.
// iPhone/iPad: shows how to add it from the Share menu. Hidden once the app runs installed,
// and on browsers that can't install it.
export default function InstallAppButton({ className, icon }: { className: string; icon: React.ReactNode }) {
  const [mode, setMode] = useState<'none' | 'prompt' | 'ios'>('none')
  const [hintOpen, setHintOpen] = useState(false)

  useEffect(() => {
    if (isStandalone()) return
    const update = () => setMode(getInstallPrompt() ? 'prompt' : isIosBrowser() ? 'ios' : 'none')
    update()
    return onInstallPromptChange(update)
  }, [])

  if (mode === 'none') return null

  async function handleClick() {
    if (mode === 'ios') { setHintOpen(o => !o); return }
    const prompt = getInstallPrompt()
    if (!prompt) return
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === 'accepted') clearInstallPrompt()
  }

  return (
    <>
      <button type="button" className={className} onClick={handleClick} aria-expanded={mode === 'ios' ? hintOpen : undefined}>
        {icon}
        Install app
      </button>
      {mode === 'ios' && hintOpen && (
        <p className="app-install-hint">
          Tap <b>Share</b> <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-label="Share icon"><path d="M10 2.5v10M6.5 6 10 2.5 13.5 6" /><path d="M6 9H5a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 5 18h10a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 15 9h-1" /></svg> in Safari, then <b>Add to Home Screen</b>.
        </p>
      )}
    </>
  )
}
