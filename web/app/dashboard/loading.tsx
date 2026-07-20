export default function DashboardLoading() {
  return (
    <>
      <header>
        <div className="wrap md-header-inner">
          <div className="logo">
            <span className="mark">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M5 12h4l2-6 3 12 2-6h3" stroke="#06140c" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            GrowJin
          </div>
        </div>
      </header>

      <div className="wrap">
        <div className="hero">
          <div className="skel" style={{ width: '280px', height: '32px', borderRadius: '8px' }} />
          <div className="skel" style={{ width: '340px', height: '16px', borderRadius: '6px', marginTop: '10px' }} />
        </div>

        <div className="skel" style={{ height: '110px', borderRadius: '18px', marginBottom: '32px' }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
          {[1, 2, 3].map(i => (
            <div key={i} className="skel" style={{ height: '72px', borderRadius: '18px' }} />
          ))}
        </div>

        <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <span className="md-spin" style={{ width: '48px', height: '48px' }} />
        </div>
      </div>
    </>
  )
}
