'use client'

import { useRef, useState } from 'react'
import ToolHeader from '@/components/ToolHeader'
import { ActionBar, Card, Pager, Sec, Src, Tabs, Tag, usePages } from '@/components/tool-ui'
import { Spinner } from '@/components/ui/loading'
import { Toast, fmtAgo, initials, useAgentApi } from '@/components/agents/shared'
import { STATUS_CHOICES, STATUS_LABEL, type EngagementData, type EngagementLead, type EngagementProfile } from '@/lib/engagement/types'

// Engagement Leads: the accounts and threads where this brand's buyers are, to follow, comment on
// and reply to by hand. One list, two tabs (To do / Done), one green button: find new leads.

type Tab = 'todo' | 'done'
const PLATFORM = { reddit: 'Reddit', instagram: 'Instagram' } as const
const TYPE_LABEL = { asking_for_help: 'Asking for help', buyer: 'Posts as a buyer', hub: 'Hub account', competitor_follower: 'Follows a competitor' } as const
const ACTION_LABEL = { 'follow + comment': 'Follow and comment', 'reply in thread': 'Reply in the thread', 'comment regularly': 'Comment regularly' } as const

const asText = (l: string[]) => l.join('\n')
const emptyProfile = (): EngagementProfile => ({ buyer: '', problem: '', phrases: [], subreddits: [], hashtags: [], competitors: [], exclude: [], by: 'user', at: '' })

export default function EngagementPage({ initial, ready }: { initial: EngagementData; ready: boolean }) {
  const { data, busy, call, toast } = useAgentApi<EngagementData>('/api/engagement', initial)
  const [tab, setTab] = useState<Tab>('todo')
  const [settings, setSettings] = useState(false)
  const top = useRef<HTMLDivElement>(null)

  const todo = data.leads.filter(l => l.status === 'to_do')
  const done = data.leads.filter(l => l.status !== 'to_do')
  const shown = tab === 'todo' ? todo : done
  const pages = usePages(shown, tab)
  const searching = busy === 'run'
  const first = todo[0]

  const run = () => { setTab('todo'); return call('run') }

  return (
    <div className="tool-page lfp" ref={top}>
      <ToolHeader
        title="Engagement Leads"
        meta={data.lastRun ? <>Last search {fmtAgo(data.lastRun.at)}</> : 'Not searched yet'}
        actions={<button type="button" className="th-link tu-linkbtn" onClick={() => setSettings(s => !s)}>{settings ? 'Close settings' : 'Settings'}</button>}
      />

      {!ready && <p className="tu-hint">Engagement search isn’t switched on yet. It needs GrowJin’s Apify account.</p>}

      {settings && <Settings key={data.profile?.at ?? 'new'} profile={data.profile ?? emptyProfile()} busy={busy} onFill={() => call('profile')} onSave={p => call('save_profile', { profile: p }).then(() => setSettings(false))} onCancel={() => setSettings(false)} />}

      {!settings && data.leads.length === 0 && !searching && (
        <section className="tu-panel lfp-form" style={{ width: '100%', boxSizing: 'border-box' }}>
          <h2 className="lfp-form-h">Where we’ll look</h2>
          <p className="tu-hint">GrowJin works out who your buyers are from your brand, then reads Reddit threads where they ask for help, Instagram posts under the tags they use, and the people commenting on a competitor’s newest posts. You follow and comment by hand from your own account. Nothing is posted for you.</p>
          <div className="tu-panel-acts">
            <button type="button" className="btn btn-primary" disabled={!ready} onClick={run}>Start finding leads</button>
          </div>
        </section>
      )}

      {(data.leads.length > 0 || searching) && !settings && (
        <>
          <ActionBar
            status={searching ? 'Searching…' : `${todo.length} to do`}
            setup="Searching Reddit, Instagram tags and competitor comments"
            onChange={() => setSettings(true)}
            secondary={first ? <a className="btn btn-ghost" href={first.url} target="_blank" rel="noopener noreferrer">Open the first one ↗</a> : null}
            primary={<button type="button" className="btn btn-primary" disabled={!ready || !!busy} onClick={run}>{searching ? <><Spinner />Searching…</> : 'Find new leads'}</button>}
          />
          {searching && <p className="tu-hint">Reading Reddit and Instagram. This takes a minute or two. You can leave this page.</p>}
          {data.lastRun && data.lastRun.notes.length > 0 && <p className="tu-hint">{data.lastRun.notes.join(' ')}</p>}

          <Tabs<Tab> tabs={[{ key: 'todo', label: 'To do', count: todo.length }, { key: 'done', label: 'Done', count: done.length }]} value={tab} onChange={setTab} />

          {shown.length === 0
            ? <p className="tu-hint">{tab === 'todo' ? 'Nothing left to do. Find new leads to fill this list.' : 'Nothing here yet. Leads you follow, comment on or skip appear here.'}</p>
            : (
              <>
                <Sec label={tab === 'todo' ? 'To do' : 'Done'} count={shown.length} />
                <div>
                  {pages.items.map(l => <LeadCard key={l.id} l={l} busy={busy} call={call} />)}
                </div>
                <Pager p={pages} top={top} />
              </>
            )}

          <Rules />
        </>
      )}
      <Toast text={toast} />
    </div>
  )
}

function LeadCard({ l, busy, call }: { l: EngagementLead; busy: string | null; call: (op: string, payload?: Record<string, unknown>, key?: string) => Promise<unknown> }) {
  const open = l.status === 'to_do'
  const set = (status: string) => call('status', { id: l.id, status }, `status:${l.id}`)
  return (
    <Card
      av={initials(l.platform === 'reddit' ? (l.niche || 'R') : l.handle.replace(/^@/, ''))}
      name={l.platform === 'reddit' ? l.handle : <a className="th-link" href={l.profileUrl ?? l.url} target="_blank" rel="noopener noreferrer">{l.handle}</a>}
      sub={<><Src label={PLATFORM[l.platform]} /> {TYPE_LABEL[l.type]}{l.niche ? ` · ${l.niche}` : ''}{l.engagement != null ? ` · ${l.engagement} ${l.platform === 'reddit' ? 'comments' : 'likes'}` : ''}</>}
      why={l.why}
      quote={l.excerpt ? `“${l.excerpt}”` : undefined}
      state={open ? ACTION_LABEL[l.action] : <Tag>{STATUS_LABEL[l.status]}</Tag>}
      onSkip={open ? () => set('skip') : undefined}
      action={open
        ? <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', minWidth: 0 }}>
            <a className="btn btn-ghost btn-sm" href={l.url} target="_blank" rel="noopener noreferrer">Open ↗</a>
            {STATUS_CHOICES[l.platform].map(s => (
              <button key={s} type="button" className="btn btn-ghost btn-sm" disabled={busy === `status:${l.id}`} onClick={() => set(s)}>{STATUS_LABEL[s]}</button>
            ))}
          </span>
        : <button type="button" className="btn btn-ghost btn-sm" disabled={busy === `status:${l.id}`} onClick={() => set('to_do')}>Undo</button>}
    />
  )
}

function Rules() {
  return (
    <details className="tu-hint">
      <summary>How to engage</summary>
      <ul>
        <li>Answer the actual question first. Mention your brand only when someone asks for a tool or a recommendation: most subreddits ban promotion.</li>
        <li>On a buyer’s post, leave something useful (an idea, a tip, a better caption), never a pitch or a link in a message.</li>
        <li>Fresh posts with few comments work best: the owner reads every early comment.</li>
        <li>Comment and follow by hand from your own account. Never automate it.</li>
      </ul>
    </details>
  )
}

function Settings({ profile, busy, onFill, onSave, onCancel }: {
  profile: EngagementProfile
  busy: string | null
  onFill: () => Promise<unknown>
  onSave: (p: Partial<Record<keyof EngagementProfile, string>>) => Promise<unknown>
  onCancel: () => void
}) {
  const [f, setF] = useState({
    buyer: profile.buyer, problem: profile.problem, phrases: asText(profile.phrases), subreddits: asText(profile.subreddits),
    hashtags: asText(profile.hashtags), competitors: asText(profile.competitors), exclude: asText(profile.exclude),
  })
  const set = (k: keyof typeof f, v: string) => setF(x => ({ ...x, [k]: v }))
  const saving = busy === 'save_profile'
  const filling = busy === 'profile'
  return (
    <form className="tu-panel lfp-form" style={{ width: '100%', boxSizing: 'border-box' }} onSubmit={e => { e.preventDefault(); void onSave(f) }}>
      <h2 className="lfp-form-h">What we search for</h2>
      <p className="tu-hint">Written from your brand. Change anything: one item per line.</p>
      <div className="tu-panel-acts">
        <button type="button" className="btn btn-ghost" disabled={filling || saving} onClick={async () => { await onFill() }}>
          {filling ? <><Spinner />Filling in…</> : 'Fill in with AI'}
        </button>
      </div>
      <label className="lfp-field">Who buys from you<input value={f.buyer} onChange={e => set('buyer', e.target.value)} placeholder="e.g. small online shop owners" /></label>
      <label className="lfp-field">Their problem<input value={f.problem} onChange={e => set('problem', e.target.value)} placeholder="e.g. no time to post every day" /></label>
      <label className="lfp-field">What they say about it (Reddit)
        <textarea rows={4} value={f.phrases} onChange={e => set('phrases', e.target.value)} placeholder="what to post on social media for my shop" /></label>
      <label className="lfp-field">Subreddits (without r/)
        <textarea rows={3} value={f.subreddits} onChange={e => set('subreddits', e.target.value)} placeholder="smallbusiness" /></label>
      <label className="lfp-field">Instagram tags they use (without #)
        <textarea rows={3} value={f.hashtags} onChange={e => set('hashtags', e.target.value)} placeholder="smallbusinessowner" /></label>
      <label className="lfp-field">Competitors on Instagram (handles)
        <textarea rows={2} value={f.competitors} onChange={e => set('competitors', e.target.value)} placeholder="competitorname" /></label>
      <label className="lfp-field">Leave out
        <textarea rows={3} value={f.exclude} onChange={e => set('exclude', e.target.value)} placeholder="marketing agencies" /></label>
      <div className="tu-panel-acts">
        <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" type="submit" disabled={saving || filling}>{saving ? <><Spinner />Saving…</> : 'Save'}</button>
      </div>
    </form>
  )
}
