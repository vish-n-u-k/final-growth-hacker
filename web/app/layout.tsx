import type { Metadata } from 'next'
import { Fraunces, Outfit, Geist } from 'next/font/google'
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
  title: 'Growth Tracker',
  description: 'Your road to 500 users',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn(fraunces.variable, outfit.variable, "font-sans", geist.variable)} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem('gh_theme')!=='dark'){document.documentElement.classList.add('light')}}catch(e){document.documentElement.classList.add('light')}})()`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
