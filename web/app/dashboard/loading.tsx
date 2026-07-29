export default function DashboardLoading() {
  return (
    <>
      <header>
        <div className="wrap md-header-inner">
          <div className="logo">
            <span className="mark">
              <img src="/favicon.svg" alt="" />
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
