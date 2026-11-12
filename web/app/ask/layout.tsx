import type { Metadata } from 'next'
import { Geist } from 'next/font/google'

// Ask has its own look (md_files/ASK_PLAN.md): Geist, paper and ink, one blue. No sidebar.
const geist = Geist({ subsets: ['latin'], variable: '--ask-font', display: 'swap' })

export const metadata: Metadata = { title: 'Ask · GrowJin' }

export default function AskLayout({ children }: { children: React.ReactNode }) {
  return <div className={geist.variable}>{children}</div>
}
