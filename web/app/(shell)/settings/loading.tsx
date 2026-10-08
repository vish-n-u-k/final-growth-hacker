export default function SettingsLoading() {
  return (
    <>
      <header>
        <div className="md-header-inner">
          <div className="logo">
            <span className="mark">
              <img src="/growjinlogo.svg" alt="" />
            </span>
            GrowJin
          </div>
          <div className="md-header-actions">
            <div className="skel" style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--line)' }} />
            <div className="skel" style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--line)' }} />
            <div className="skel mob-hide" style={{ width: '140px', height: '30px', borderRadius: '8px', background: 'var(--line)' }} />
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

      </div>
    </>
  )
}
