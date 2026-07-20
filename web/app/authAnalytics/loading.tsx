export default function AuthAnalyticsLoading() {
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
        <div style={{ padding: '32px 0 24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="skel" style={{ width: '32px', height: '32px', borderRadius: '8px' }} />
          <div>
            <div className="skel" style={{ width: '160px', height: '26px', borderRadius: '8px' }} />
            <div className="skel" style={{ width: '220px', height: '13px', borderRadius: '6px', marginTop: '8px' }} />
          </div>
        </div>

        {/* stat cards row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '28px' }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="skel" style={{ height: '80px', borderRadius: '16px' }} />
          ))}
        </div>

        {/* chart area */}
        <div className="skel" style={{ height: '200px', borderRadius: '16px', marginBottom: '28px' }} />

        {/* module rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="skel" style={{ height: '64px', borderRadius: '14px' }} />
          ))}
        </div>

        <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <span className="md-spin" style={{ width: '48px', height: '48px' }} />
        </div>
      </div>
    </>
  )
}
