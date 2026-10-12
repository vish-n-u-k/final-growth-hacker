// Shown instantly while a page inside the app shell loads on the server (via app/(shell)/loading.tsx),
// so a sidebar click switches pages right away instead of appearing to do nothing.
export default function ShellLoading() {
  return (
    <div className="shell-loading" aria-busy="true" aria-label="Loading">
      <div className="shell-loading-top">
        <div className="skel" style={{ width: 180, height: 24, borderRadius: 8 }} />
        <div className="skel" style={{ width: 120, height: 12, borderRadius: 6, marginTop: 10 }} />
      </div>
      <div className="shell-loading-body">
        <div className="skel" style={{ height: 52, borderRadius: 12 }} />
        <div className="skel" style={{ height: 150, borderRadius: 14 }} />
        <div className="skel" style={{ height: 150, borderRadius: 14 }} />
      </div>
    </div>
  )
}
