'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import ToolHeader from '@/components/ToolHeader'
import { Popover } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import Campaigns from '@/components/email-outreach/Campaigns'
import Done, { type SentEmail } from '@/components/email-outreach/Done'
import FollowUps from '@/components/email-outreach/FollowUps'
import { useToast } from '@/components/email-outreach/shared'
import { Tabs } from '@/components/tool-ui'
import { isDue, loadReminders, openFollowUps } from '@/lib/email-outreach/followups'

// Email Outreach: send personal emails to a list of prospects from the user's own Gmail, and
// follow up with anyone who doesn't reply. Same layout as the other tools: the header with the
// main action, then three tabs: Follow-ups (what needs you now; opens first when any are due),
// Campaigns (a list, each one done in three steps) and Done (closed follow-ups, sent emails).

type Tab = 'followups' | 'campaigns' | 'done'

// ── Inline SVG icons (connect screen) ─────────────────────────────────────────

const IcMail = () => (
  <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
    <rect x="2" y="4" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M2 7l8 5 8-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)
const IcDraft = () => (
  <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
    <path d="M4 4h12a1 1 0 011 1v8a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M3 7l7 4 7-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M14 15l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
const IcClock = () => (
  <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
    <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M10 6v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
const IcReply = () => (
  <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
    <path d="M8 5L3 10l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M3 10h9a5 5 0 015 5v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)
const IcPipe = () => (
  <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
    <rect x="2" y="13" width="4" height="5" rx="1" stroke="currentColor" strokeWidth="1.5"/>
    <rect x="8" y="8" width="4" height="10" rx="1" stroke="currentColor" strokeWidth="1.5"/>
    <rect x="14" y="3" width="4" height="15" rx="1" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
)

export default function GmailHub({
  brandName,
  initialConnected = false,
  gmailAddress,
}: {
  brandName: string
  initialConnected?: boolean
  gmailAddress?: string | null
}) {
  const [isConnected, setIsConnected]   = useState(initialConnected)
  const [disconnecting, setDisconnecting] = useState(false)
  const [tab, setTab]                   = useState<Tab | null>(null)
  const [dueCount, setDueCount]         = useState(0)
  const [sent, setSent]                 = useState<SentEmail[]>([])
  const [reloadKey, setReloadKey]       = useState(0)
  const [newPending, setNewPending]     = useState(false)
  const [menuOpen, setMenuOpen]         = useState(false)
  const menuBtn = useRef<HTMLButtonElement>(null)
  const [toast, notify] = useToast()

  const loadSent = useCallback(() => {
    fetch('/api/outreach/emails').then(r => r.ok ? r.json() : null).then(data => {
      if (data?.emails) setSent(data.emails)
    }).catch(() => {})
  }, [])

  // Open on Follow-ups when some are due, else Campaigns. Then check Gmail for replies in the
  // background; anything that replied, opted out or bounced moves to Done.
  useEffect(() => {
    if (!isConnected) return
    loadSent()
    loadReminders()
      .then(rows => { const n = openFollowUps(rows).filter(isDue).length; setDueCount(n); setTab(t => t ?? (n > 0 ? 'followups' : 'campaigns')) })
      .catch(() => setTab(t => t ?? 'campaigns'))
    fetch('/api/gmail/followups/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(r => r.ok ? r.json() : null)
      .then((c: { replied?: number; optedOut?: number; bounced?: number } | null) => {
        if (!c) return
        const parts = [
          c.replied  ? `${c.replied} ${c.replied === 1 ? 'person' : 'people'} replied` : null,
          c.optedOut ? `${c.optedOut} opted out` : null,
          c.bounced  ? `${c.bounced} bounced` : null,
        ].filter(Boolean)
        if (parts.length) { notify(`${parts.join(', ')}. Those follow-ups moved to Done.`); setReloadKey(k => k + 1) }
      })
      .catch(() => {})
  }, [isConnected, loadSent, notify])

  // Keep the Follow-ups count right while another tab is open
  useEffect(() => {
    if (!isConnected || reloadKey === 0) return
    loadReminders().then(rows => setDueCount(openFollowUps(rows).filter(isDue).length)).catch(() => {})
  }, [isConnected, reloadKey])

  async function handleDisconnect() {
    setDisconnecting(true)
    await fetch('/api/gmail/disconnect', { method: 'POST' })
    setIsConnected(false)
    setDisconnecting(false)
    setMenuOpen(false)
  }

  async function cancelScheduled(emailId: string) {
    const res = await fetch(`/api/outreach/emails/${emailId}/cancel`, { method: 'POST' })
    const data = await res.json().catch(() => ({})) as { error?: string }
    notify(res.ok ? 'Scheduled email cancelled' : data.error ?? 'Could not cancel it')
    loadSent()
  }

  const onCount = useCallback((n: number) => setDueCount(n), [])
  const weekAgo = Date.now() - 7 * 86_400_000
  const sentThisWeek = sent.filter(e => e.status === 'sent' && e.sentAt && Date.parse(e.sentAt) > weekAgo).length

  // ── NOT CONNECTED ─────────────────────────────────────────────────────────

  if (!isConnected) {
    return (
      <div className="gh-page">
        <div className="gh-inner">

          <ToolHeader icon="mail" title="Email Outreach" chips={<span className="th-chip">New</span>} meta={brandName} intro="emailOutreach" />

          <div className="gh-connect-outer">

            <div className="gh-connect-left">
              <div className="gh-connect-eyebrow">Gmail</div>
              <h2 className="gh-connect-h2">Email your prospects from your own Gmail, and never miss a follow-up</h2>
              <p className="gh-connect-p">
                Paste a list, say what you offer, and GrowJin writes a personal email for each person. You check every one before it goes.
                When someone doesn&apos;t reply, a follow-up is ready to send in the same thread.
              </p>

              <div className="gh-connect-feats">
                {[
                  { Icon: IcDraft, label: 'Campaigns',        desc: 'One email, written for each person on your list, sent now or scheduled' },
                  { Icon: IcPipe,  label: 'Follow-ups',       desc: 'When someone hasn’t replied in a few days, a short follow-up is ready to send' },
                  { Icon: IcReply, label: 'Reply detection',  desc: 'Replies, opt-outs and bounces close their follow-up by themselves' },
                  { Icon: IcClock, label: 'Every tool, one place', desc: 'Emails sent from Competitor Leads and the agents show up here too' },
                ].map(({ Icon, label, desc }) => (
                  <div key={label} className="gh-connect-feat">
                    <div className="gh-feat-icon-wrap"><Icon /></div>
                    <div>
                      <div className="gh-feat-label">{label}</div>
                      <div className="gh-feat-desc">{desc}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="gh-scopes">
                <div className="gh-scopes-title">What we request access to</div>
                <div className="gh-scope-list">
                  {[
                    { yes: true,  name: 'gmail.readonly', reason: 'check your sent threads for replies' },
                    { yes: true,  name: 'gmail.compose',  reason: 'save emails to your Drafts' },
                    { yes: true,  name: 'gmail.send',     reason: 'send emails, only after you confirm' },
                    { yes: false, name: 'gmail.modify',   reason: 'not requested: we cannot move or delete emails' },
                  ].map(s => (
                    <div key={s.name} className={`gh-scope-row${s.yes ? '' : ' gh-scope-no'}`}>
                      <span className={`gh-scope-dot ${s.yes ? 'yes' : 'no'}`} />
                      <span className="gh-scope-name">{s.name}</span>
                      <span className="gh-scope-reason">— {s.reason}</span>
                    </div>
                  ))}
                </div>
              </div>

              <a href="/api/gmail/connect" className="gh-connect-btn">
                <IcMail />
                Connect Gmail
              </a>
              <p className="gh-connect-note">
                Encrypted at rest. You can disconnect and permanently delete all stored data from Settings at any time.
              </p>
            </div>

            {/* Right: what the tool looks like once connected */}
            <div className="gh-connect-right">
              <div className="gh-mockup">
                <div className="gh-mock-chrome">
                  <div className="gh-mock-dots">
                    <span className="gh-mock-dot r" />
                    <span className="gh-mock-dot y" />
                    <span className="gh-mock-dot g" />
                  </div>
                  <div className="gh-mock-url">Email Outreach · Follow-ups</div>
                </div>
                <div className="gh-mock-body">
                  <div className="gh-mock-threads">
                    {[
                      { i: 'SC', subj: 'Sarah Chen · Quick question about LaunchPad', tag: 'Due today' },
                      { i: 'TR', subj: 'Tom Ramirez · Your SEO audit', tag: 'Overdue 2 days' },
                      { i: 'NI', subj: 'Natasha Ivanova · Idea for ClearPath', tag: 'Tomorrow' },
                      { i: 'DO', subj: 'David Osei · AI search visibility', tag: 'Replied' },
                    ].map((t, idx) => (
                      <div key={idx} className={`gh-mock-thread${idx === 0 ? ' active' : ''}`}>
                        <div className="gh-mock-av gh-av-default">{t.i}</div>
                        <div className="gh-mock-tinfo">
                          <div className="gh-mock-tsubj">{t.subj}</div>
                          <span className={`gh-tag ${t.tag === 'Replied' ? 'gh-tag-warm' : t.tag.startsWith('Overdue') ? 'gh-tag-hot' : 'gh-tag-followup'}`}>{t.tag}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="gh-mock-overlay">
                    <div className="gh-mock-lock">
                      <svg viewBox="0 0 20 20" fill="none" width="22" height="22">
                        <rect x="4" y="9" width="12" height="9" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                        <path d="M7 9V7a3 3 0 116 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                      Connect to unlock
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    )
  }

  // ── CONNECTED ─────────────────────────────────────────────────────────────

  const startCampaign = () => { setTab('campaigns'); setNewPending(true) }

  return (
    <div className="tool-page eo">
      <ToolHeader
        icon="mail"
        title="Email Outreach"
        intro="emailOutreach"
        chips={<span className="th-chip th-chip--on">{gmailAddress ?? 'Gmail connected'}</span>}
        meta={`${sentThisWeek} sent this week`}
        actions={<>
          <button ref={menuBtn} type="button" className="btn btn-ghost btn-sm eo-more" aria-label="Gmail settings" aria-expanded={menuOpen} onClick={() => setMenuOpen(o => !o)}>
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><circle cx="4.5" cy="10" r="1.6" /><circle cx="10" cy="10" r="1.6" /><circle cx="15.5" cy="10" r="1.6" /></svg>
          </button>
          <Popover anchor={menuBtn} open={menuOpen} onClose={() => setMenuOpen(false)} width={260} label="Gmail settings" className="eo-menu">
            <div className="eo-menu-who">Sending from <b>{gmailAddress ?? 'your Gmail'}</b></div>
            <a className="eo-menu-item" href="/api/gmail/connect">Reconnect Gmail</a>
            <button type="button" className="eo-menu-item eo-danger" disabled={disconnecting} onClick={handleDisconnect}>
              {disconnecting ? <><Spinner />Disconnecting…</> : 'Disconnect Gmail'}
            </button>
          </Popover>
          <button type="button" className="btn btn-primary btn-sm" onClick={startCampaign}>New campaign</button>
        </>}
      />

      {/* Same tabs as the Lead Agent and Competitor Leads */}
      <Tabs value={tab ?? 'campaigns'} onChange={setTab} tabs={[
        { key: 'followups', label: 'Follow-ups', count: dueCount || null, hot: dueCount > 0 },
        { key: 'campaigns', label: 'Campaigns' },
        { key: 'done', label: 'Done' },
      ]} />

      <div className="eo-body">
        {tab === null && <div className="ro-working eo-loading"><Spinner /><span>Loading…</span><i /></div>}
        {tab === 'followups' && <FollowUps reloadKey={reloadKey} notify={notify} onCount={onCount} onNewCampaign={startCampaign} />}
        {tab === 'campaigns' && <Campaigns newPending={newPending} onNewOpened={() => setNewPending(false)} notify={notify} onSent={() => { loadSent(); setReloadKey(k => k + 1) }} />}
        {tab === 'done' && <Done reloadKey={reloadKey} sent={sent} notify={notify} onCancel={cancelScheduled}
          onChanged={() => setReloadKey(k => k + 1)} />}
      </div>

      {toast}
    </div>
  )
}
