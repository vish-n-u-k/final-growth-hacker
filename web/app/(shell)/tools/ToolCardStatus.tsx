'use client'

import { useLinkStatus } from 'next/link'

export default function ToolCardStatus({ color }: { color: string }) {
  const { pending } = useLinkStatus()
  return (
    <div className={`tl-card-arrow${pending ? ' is-pending' : ''}`} style={{ color }}>
      {pending ? (
        <>
          <span className="tl-card-spinner" aria-hidden />
          Opening…
        </>
      ) : (
        'Open →'
      )}
    </div>
  )
}
