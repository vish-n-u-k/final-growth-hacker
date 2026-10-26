'use client'

import { usePathname } from 'next/navigation'
import { PageSkeleton } from '@/components/ui/loading'

// Shown instantly while a page inside the app shell loads on the server (via app/(shell)/loading.tsx),
// so a sidebar click switches pages right away instead of appearing to do nothing. The grey blocks
// take the shape of the page that is coming, so nothing jumps when it arrives.
export default function ShellLoading() {
  const path = usePathname() ?? ''
  const kind = path.startsWith('/today') ? 'today' : path.startsWith('/dashboard') ? 'module' : 'tool'
  return <PageSkeleton kind={kind} />
}
