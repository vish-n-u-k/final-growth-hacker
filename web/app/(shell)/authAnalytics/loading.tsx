export default function AuthAnalyticsLoading() {
  return (
    <div className="wrap" style={{ padding: '32px 28px' }}>
      {/* Header: back button + title, range toggle + refresh */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="skel" style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }} />
          <div>
            <div className="skel" style={{ width: 200, height: 30, borderRadius: 8 }} />
            <div className="skel" style={{ width: 160, height: 14, borderRadius: 6, marginTop: 6 }} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="skel" style={{ width: 150, height: 34, borderRadius: 99 }} />
          <div className="skel" style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }} />
        </div>
      </div>

      {/* Road to 500 banner */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 18, padding: '24px 28px', marginBottom: 28 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr auto', gap: 32, alignItems: 'center' }}>
          <div>
            <div className="skel" style={{ width: 110, height: 12, borderRadius: 6 }} />
            <div className="skel" style={{ width: 80, height: 52, borderRadius: 8, marginTop: 10 }} />
          </div>
          <div>
            <div className="skel" style={{ height: 5, borderRadius: 99 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} className="skel" style={{ width: 24, height: 11, borderRadius: 4 }} />
              ))}
            </div>
          </div>
          <div className="skel" style={{ width: 170, height: 66, borderRadius: 12, flexShrink: 0 }} />
        </div>
      </div>

      {/* Last 24 hours */}
      <div className="skel" style={{ width: 130, height: 12, borderRadius: 6, marginBottom: 14 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 36 }}>
        {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
          <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '22px 22px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div className="skel" style={{ width: 38, height: 38, borderRadius: 10 }} />
              <div className="skel" style={{ width: 70, height: 20, borderRadius: 99 }} />
            </div>
            <div className="skel" style={{ width: 56, height: 32, borderRadius: 8 }} />
            <div className="skel" style={{ width: 90, height: 13, borderRadius: 4 }} />
          </div>
        ))}
      </div>

      {/* Growth & retention */}
      <div className="skel" style={{ width: 160, height: 12, borderRadius: 6, marginBottom: 14 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14 }}>
        {[1, 2, 3, 4].map(i => (
          <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '22px 22px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div className="skel" style={{ width: 60, height: 12, borderRadius: 6 }} />
              <div className="skel" style={{ width: 70, height: 20, borderRadius: 99 }} />
            </div>
            <div className="skel" style={{ width: 64, height: 30, borderRadius: 8 }} />
            <div className="skel" style={{ width: '80%', height: 13, borderRadius: 4 }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="skel" style={{ height: 260, borderRadius: 14 }} />
        <div className="skel" style={{ height: 200, borderRadius: 14 }} />
      </div>
    </div>
  )
}
