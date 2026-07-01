interface Props {
  title: string
  note?: string
  /** 'module' = full-width centered block for an entire module; 'category' = inline within a category body */
  variant?: 'module' | 'category'
}

export default function ComingSoon({ title, note, variant = 'category' }: Props) {
  if (variant === 'module') {
    return (
      <div className="cs-module">
        <div className="cs-module-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </div>
        <span className="cs-badge">Coming Soon</span>
        <p className="cs-module-title">{title}</p>
        {note && <p className="cs-module-note">{note}</p>}
      </div>
    )
  }

  return (
    <div className="cs-cat">
      <span className="cs-badge">Coming Soon</span>
      <p className="cs-cat-title">{title}</p>
      {note && <p className="cs-cat-note">{note}</p>}
    </div>
  )
}
