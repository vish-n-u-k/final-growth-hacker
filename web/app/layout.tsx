import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import Script from 'next/script'
import './globals.css'
import { cn } from "@/lib/utils";

// One typeface across the app: Geist for everything (headings, body), Geist Mono only for code-like bits.
// --font-display / --font-body are mapped onto Geist in globals.css so older rules keep working.
const geist = Geist({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' })

export const metadata: Metadata = {
  title: 'GrowJin',
  description: 'Your road to 500 users',
  icons: {
    icon: '/growjinlogo.svg',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable, geistMono.variable, "light")} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem('gh_theme')==='dark'){document.documentElement.classList.remove('light')}}catch(e){}})()`,
          }}
        />
      </head>
      <body>
        {children}
        <Script src="/fb-widget.js" strategy="lazyOnload" />
      </body>
    </html>
  )
}
