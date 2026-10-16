// The app's one loading indicator. It takes the text colour around it, so it works inside any
// button or label: put it before the "Saving…" text, or use <LoadingState> for a whole area.
export function Spinner({ size = 13, label, className = '', style }: {
  size?: number
  label?: string       // set when the spinner stands alone, so screen readers announce it
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <span
      className={`spinner ${className}`.trim()}
      style={{ width: size, height: size, ...style }}
      {...(label ? { role: 'status', 'aria-label': label } : { 'aria-hidden': true })}
    />
  )
}

/** A centred spinner with a line of text, for a panel or list that is still loading. */
export function LoadingState({ children, compact, className = '', style }: {
  children: React.ReactNode
  compact?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div className={`loading-state${compact ? ' loading-state--compact' : ''} ${className}`.trim()} role="status" aria-live="polite" style={style}>
      <Spinner size={compact ? 14 : 18} />
      <span>{children}</span>
    </div>
  )
}
