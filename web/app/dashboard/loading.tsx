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
        <div className="overview-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className="skel" style={{ width: '40px', height: '40px', borderRadius: '9px', flexShrink: 0 }} />
            <div className="skel" style={{ width: '220px', height: '28px', borderRadius: '8px' }} />
          </div>

          <div className="skel" style={{ width: '260px', height: '32px', borderRadius: '99px', marginTop: '14px' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '16px' }}>
            <div className="skel" style={{ width: '90px', height: '16px', borderRadius: '6px' }} />
            <div style={{ width: '1px', height: '16px', background: 'var(--line)' }} />
            <div style={{ display: 'flex', gap: '8px' }}>
              {[1, 2, 3, 4, 5, 6].map(i => (
                <div key={i} className="skel" style={{ width: '32px', height: '32px', borderRadius: '9px' }} />
              ))}
            </div>
          </div>

          <div style={{ height: '1px', background: 'var(--line)', margin: '20px 0' }} />

          <div style={{ display: 'flex', gap: '60px', flexWrap: 'wrap' }}>
            <div style={{ minWidth: '180px' }}>
              <div className="skel" style={{ width: '110px', height: '12px', borderRadius: '6px' }} />
              <div className="skel" style={{ width: '90px', height: '36px', borderRadius: '8px', marginTop: '10px' }} />
              <div className="skel" style={{ width: '140px', height: '12px', borderRadius: '6px', marginTop: '10px' }} />
              <div className="skel" style={{ width: '180px', height: '56px', borderRadius: '14px', marginTop: '16px' }} />
            </div>
            <div style={{ flex: 1, minWidth: '240px' }}>
              <div className="skel" style={{ width: '90%', height: '14px', borderRadius: '6px' }} />
              <div className="skel" style={{ width: '70%', height: '14px', borderRadius: '6px', marginTop: '8px' }} />
              <div style={{ display: 'flex', alignItems: 'center', marginTop: '28px' }}>
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="skel" style={{ width: '12px', height: '12px', borderRadius: '50%', marginRight: i < 5 ? '60px' : 0 }} />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {[1, 2, 3].map(i => (
            <div key={i} className="level" style={{ boxShadow: 'none' }}>
              <div className="level-head" style={{ cursor: 'default' }}>
                <div className="skel" style={{ width: '64px', height: '64px', borderRadius: '50%', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div className="skel" style={{ width: '160px', height: '18px', borderRadius: '6px' }} />
                  <div className="skel" style={{ width: '220px', height: '13px', borderRadius: '6px', marginTop: '8px' }} />
                </div>
                <div className="skel" style={{ width: '70px', height: '30px', borderRadius: '8px' }} />
                <div className="skel" style={{ width: '16px', height: '16px', borderRadius: '4px' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
