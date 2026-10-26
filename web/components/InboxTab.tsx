'use client'

import { useState, useEffect, useCallback } from 'react'
import { LoadingState, Spinner } from '@/components/ui/spinner'

// Inbox limited to the threads GrowJin sent (campaigns, outreach, follow-ups, Lead Agent and
// link-building emails). The list comes from our own records; a thread's messages are loaded
// from Gmail only when it is opened. Replies come first, ordered by what the prospect said.

type Status = 'replied' | 'due' | 'waiting' | 'auto_reply' | 'sent' | 'closed' | 'opted_out' | 'bounced'
type Intent = 'meeting' | 'interested' | 'question' | 'objection' | 'later' | 'other'

interface Conversation {
  threadId: string
  toEmail: string | null
  toName: string | null
  subject: string
  source: 'campaign' | 'outreach' | 'followup' | 'lead-agent' | 'link-agent' | 'competitor-leads'
  sentAt: string | null
  status: Status
  intent: Intent | null
  note: string | null
  followUpDueAt: string | null
}

interface Msg { id: string; from: string; at: string | null; body: string; isSelf: boolean }
interface ThreadState { loading: boolean; messages?: Msg[]; error?: string }

// Label and colour class (gh-tag-* / gh-av-*) per intent and status
const INTENT: Record<Intent, [string, string]> = {
  meeting:    ['Wants a call', 'hot'],
  interested: ['Interested', 'hot'],
  question:   ['Question', 'warm'],
  objection:  ['Objection', 'cold'],
  later:      ['Later', 'followup'],
  other:      ['Replied', 'partnership'],
}
const INTENT_RANK: Intent[] = ['meeting', 'interested', 'question', 'objection', 'later', 'other']
const STATUS: Record<Exclude<Status, 'replied'>, [string, string]> = {
  due:        ['Follow-up due', 'warm'],
  waiting:    ['Waiting', 'vendor'],
  auto_reply: ['Out of office', 'vendor'],
  sent:       ['Not tracked', 'vendor'],
  closed:     ['Closed', 'vendor'],
  opted_out:  ['Opted out', 'vendor'],
  bounced:    ['Bounced', 'vendor'],
}
const SOURCE: Record<Conversation['source'], string> = {
  campaign: 'Campaign', outreach: 'Outreach', followup: 'Follow-up', 'lead-agent': 'Lead Agent', 'link-agent': 'Search Agent · links', 'competitor-leads': 'Competitor Leads',
}

const GROUPS: { key: string; title: string; hint?: string; statuses: Status[]; collapsed?: boolean }[] = [
  { key: 'replied', title: 'Replied', statuses: ['replied'] },
  { key: 'due',     title: 'Follow-up due', statuses: ['due'] },
  { key: 'waiting', title: 'Waiting for a reply', statuses: ['waiting', 'auto_reply'] },
  { key: 'sent',    title: 'Not tracked', hint: 'Sent without a follow-up, so replies aren’t checked', statuses: ['sent'] },
  { key: 'closed',  title: 'Closed', statuses: ['closed', 'opted_out', 'bounced'], collapsed: true },
]

function tagOf(c: Conversation): [string, string] {
  return c.status === 'replied' ? INTENT[c.intent ?? 'other'] : STATUS[c.status]
}

function nameOf(c: Conversation): string {
  return c.toName || c.toEmail || 'Unknown'
}

function initials(name: string): string {
  const parts = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase()
}

function shortTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  if (days < 1 && d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (days < 7) return d.toLocaleDateString('en-US', { weekday: 'short' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function longTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
}

export default function InboxTab({
  refreshKey,
  gmailAddress,
  onOpenFollowups,
}: {
  refreshKey: number
  gmailAddress?: string | null
  onOpenFollowups: () => void
}) {
  const [conversations, setConversations] = useState<Conversation[] | null>(null)
  const [error, setError]                 = useState<string | null>(null)
  const [selectedId, setSelectedId]       = useState<string | null>(null)
  const [threads, setThreads]             = useState<Record<string, ThreadState>>({})
  const [showClosed, setShowClosed]       = useState(false)
  const [refreshing, setRefreshing]       = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/gmail/conversations')
      const data = await res.json() as { conversations?: Conversation[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not load conversations')
      setConversations(data.conversations ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load conversations')
      setConversations(prev => prev ?? [])
    }
  }, [])

  // refreshKey changes when the hub's reply check finishes, so new replies show up
  useEffect(() => { load() }, [load, refreshKey])

  async function refresh() {
    setRefreshing(true)
    await fetch('/api/gmail/followups/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {})
    await load()
    setRefreshing(false)
  }

  const openThread = useCallback(async (threadId: string, force = false) => {
    setSelectedId(threadId)
    if (!force && threads[threadId] && !threads[threadId].error) return
    setThreads(prev => ({ ...prev, [threadId]: { loading: true } }))
    try {
      const res = await fetch(`/api/gmail/conversations/${threadId}`)
      const data = await res.json() as { messages?: Msg[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not load messages')
      setThreads(prev => ({ ...prev, [threadId]: { loading: false, messages: data.messages ?? [] } }))
    } catch (e) {
      setThreads(prev => ({ ...prev, [threadId]: { loading: false, error: e instanceof Error ? e.message : 'Could not load messages' } }))
    }
  }, [threads])

  if (conversations === null) {
    return <div className="gh-inbox-wrap"><LoadingState style={{ padding: '48px 28px' }}>Loading conversations…</LoadingState></div>
  }

  const grouped = GROUPS.map(g => {
    const items = conversations.filter(c => g.statuses.includes(c.status))
    if (g.key === 'replied') {
      items.sort((a, b) => INTENT_RANK.indexOf(a.intent ?? 'other') - INTENT_RANK.indexOf(b.intent ?? 'other'))
    }
    return { ...g, items }
  }).filter(g => g.items.length > 0)

  const selected = conversations.find(c => c.threadId === selectedId) ?? null
  const thread = selected ? threads[selected.threadId] : undefined
  const gmailUrl = (threadId: string) =>
    `https://mail.google.com/mail/${gmailAddress ? `?authuser=${encodeURIComponent(gmailAddress)}` : 'u/0/'}#all/${threadId}`

  return (
    <div className="gh-inbox-wrap">
      <div className="gh-inbox-filters">
        <span className="gh-filter-info">
          Only emails sent from GrowJin are shown. The rest of your Gmail stays out of here.
        </span>
        <span className="gh-filter-sep" />
        <button className="gh-qa-btn" onClick={refresh} disabled={refreshing}>
          {refreshing ? <><Spinner />Checking…</> : 'Check for replies'}
        </button>
      </div>

      {error && <div className="gh-conv-error">{error}</div>}

      {conversations.length === 0 ? (
        <div className="gh-conv-empty">
          No emails sent from GrowJin yet. Send a campaign and the conversations will show up here.
        </div>
      ) : (
        <div className="gh-inbox-layout gh-conv-layout">

          {/* Conversation list */}
          <div className="gh-thread-list">
            {grouped.map(g => {
              const hidden = g.collapsed && !showClosed
              return (
                <div key={g.key}>
                  <button
                    className="gh-conv-group"
                    onClick={g.collapsed ? () => setShowClosed(v => !v) : undefined}
                    disabled={!g.collapsed}
                    title={g.hint}
                  >
                    <span>{g.title}</span>
                    <span className="gh-filter-badge">{g.items.length}</span>
                    {g.collapsed && <span className="gh-conv-toggle">{hidden ? 'Show' : 'Hide'}</span>}
                  </button>
                  {!hidden && g.items.map(c => {
                    const [label, cls] = tagOf(c)
                    const name = nameOf(c)
                    return (
                      <div
                        key={c.threadId}
                        className={`gh-thread-item${selectedId === c.threadId ? ' active' : ''}${c.status === 'replied' ? ' unread' : ''}`}
                        onClick={() => openThread(c.threadId)}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className={`gh-thread-av gh-av-${cls === 'vendor' ? 'default' : cls}`}>{initials(name)}</div>
                        <div className="gh-thread-body">
                          <div className="gh-thread-top">
                            <span className="gh-thread-from">{name}</span>
                            <span className="gh-thread-time">{shortTime(c.sentAt)}</span>
                          </div>
                          <div className="gh-thread-subject">{c.subject}</div>
                          {c.note && <div className="gh-thread-preview">{c.note}</div>}
                          <span className={`gh-tag gh-tag-${cls}`}>{label}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>

          {/* Conversation detail */}
          {selected ? (
            <div className="gh-thread-detail">
              <div className="gh-detail-hd">
                <div className="gh-detail-subject">{selected.subject}</div>
                <div className="gh-detail-meta">
                  <div>
                    <span className="gh-detail-from">{nameOf(selected)}</span>
                    {selected.toEmail && selected.toEmail !== nameOf(selected) && (
                      <span className="gh-detail-email">&lt;{selected.toEmail}&gt;</span>
                    )}
                  </div>
                  <span className={`gh-tag gh-tag-${tagOf(selected)[1]}`}>{tagOf(selected)[0]}</span>
                  <span className="gh-conv-source">{SOURCE[selected.source]}{selected.sentAt ? ` · sent ${longTime(selected.sentAt)}` : ''}</span>
                </div>
              </div>

              <div className="gh-messages">
                {!thread || thread.loading ? (
                  <LoadingState>Loading messages…</LoadingState>
                ) : thread.error ? (
                  <div className="gh-conv-empty">
                    {thread.error}
                    <div style={{ marginTop: 12 }}>
                      <button className="gh-qa-btn" onClick={() => openThread(selected.threadId, true)}>Try again</button>
                    </div>
                  </div>
                ) : (thread.messages ?? []).map(m => (
                  <div key={m.id} className={`gh-msg${m.isSelf ? ' gh-msg-self' : ''}`}>
                    {!m.isSelf && (
                      <div className={`gh-msg-av gh-av-${tagOf(selected)[1] === 'vendor' ? 'default' : tagOf(selected)[1]}`}>{initials(m.from)}</div>
                    )}
                    <div className={`gh-msg-bubble${m.isSelf ? ' self' : ''}`}>
                      <div className="gh-msg-meta">
                        <span className="gh-msg-from">{m.from}</span>
                        <span className="gh-msg-time">{longTime(m.at)}</span>
                      </div>
                      <pre className="gh-msg-body">{m.body}</pre>
                    </div>
                  </div>
                ))}
              </div>

              <div className="gh-quick-actions">
                <a className="gh-qa-btn gh-qa-green" href={gmailUrl(selected.threadId)} target="_blank" rel="noopener noreferrer">
                  {selected.status === 'replied' ? 'Reply in Gmail' : 'Open in Gmail'}
                </a>
                {['due', 'waiting', 'auto_reply'].includes(selected.status) && !selected.source.endsWith('-agent') && (
                  <button className="gh-qa-btn" onClick={onOpenFollowups}>Go to Follow-ups</button>
                )}
              </div>
            </div>
          ) : (
            <div className="gh-thread-detail gh-conv-placeholder">
              Pick a conversation to read it. Messages are loaded from Gmail when you open them and aren&apos;t stored.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
