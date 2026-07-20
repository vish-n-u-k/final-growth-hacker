export default function SettingsLoading() {
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
        <div style={{ padding: '32px 0 24px' }}>
          <div className="skel" style={{ width: '120px', height: '28px', borderRadius: '8px' }} />
          <div className="skel" style={{ width: '260px', height: '14px', borderRadius: '6px', marginTop: '10px' }} />
        </div>

        <div className="skel" style={{ height: '44px', borderRadius: '12px', marginBottom: '24px', maxWidth: '320px' }} />

        <div className="skel" style={{ height: '320px', borderRadius: '16px' }} />

        <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <span className="md-spin" style={{ width: '48px', height: '48px' }} />
        </div>
      </div>
    </>
  )
}
