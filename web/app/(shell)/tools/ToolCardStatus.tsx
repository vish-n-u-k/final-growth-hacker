'use client'

import { useLinkStatus } from 'next/link'
import { Spinner } from '@/components/ui/loading'

export default function ToolCardStatus({ color }: { color: string }) {
  const { pending } = useLinkStatus()
  return (
    <div className={`tl-card-arrow${pending ? ' is-pending' : ''}`} style={{ color }}>
      {pending ? (
        <>
          <Spinner size={12} />
          Opening…
        </>
      ) : (
        'Open →'
      )}
    </div>
  )
}
