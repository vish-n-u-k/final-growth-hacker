// Right arrow for "go somewhere" buttons and links (replaces the text "→", which renders
// differently per font and sits off the baseline).
export default function ArrowIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: '-0.15em', flex: 'none' }}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}
