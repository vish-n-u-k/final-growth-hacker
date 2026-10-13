import type { Metadata, Viewport } from 'next'
import { Outfit, Fraunces, Geist_Mono } from 'next/font/google'
import Script from 'next/script'
import './globals.css'
import { cn } from "@/lib/utils";
import PwaRegister from '@/components/PwaRegister'

// Outfit for body text, Fraunces for headings, Geist Mono only for code-like bits.
// --font-display / --font-body are mapped onto these in globals.css so older rules keep working.
const outfit = Outfit({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })
const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-serif', display: 'swap' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' })

export const metadata: Metadata = {
  title: 'GrowJin',
  description: 'Your road to 500 users',
  icons: {
    icon: '/growjinlogo.svg',
    apple: '/icons/apple-touch-icon.png',
  },
  // iPhone "Add to Home Screen": open full-screen with its own name instead of as a Safari tab.
  appleWebApp: { capable: true, title: 'GrowJin', statusBarStyle: 'default' },
}

export const viewport: Viewport = {
  themeColor: '#f5f6f4',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", outfit.variable, fraunces.variable, geistMono.variable, "light")} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem('gh_theme')==='dark'){document.documentElement.classList.remove('light')}}catch(e){}})()`,
          }}
        />
      </head>
      <body>
        {children}
        <PwaRegister />
        <Script src="/fb-widget.js" strategy="lazyOnload" />
      </body>
    </html>
  )
}
