import type { Metadata } from 'next'
import { Fraunces, Outfit, Geist } from 'next/font/google'
import Script from 'next/script'
import './globals.css'
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
})

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'GrowJin',
  description: 'Your road to 500 users',
  icons: {
    icon: '/growjinlogo.svg',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn(fraunces.variable, outfit.variable, "font-sans", geist.variable, "light")} suppressHydrationWarning>
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
