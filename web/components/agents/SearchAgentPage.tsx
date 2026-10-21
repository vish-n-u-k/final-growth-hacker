'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { AgentTask, SearchAgentData, SearchSettings, Topic } from '@/lib/agents/store'
import { Spinner } from '@/components/ui/spinner'
import { Ago, Day, Toast, useAgentApi } from './shared'

export interface SearchAgentFlags { dataforseo: boolean; googleAds: boolean }
export interface DraftInfo { id: string; title: string; content: string; metaDescription: string | null; mdUrl: string }

const COUNTRIES: [string, string][] = [['US', 'United States'], ['IN', 'India'], ['GB', 'United Kingdom'], ['CA', 'Canada'], ['AU', 'Australia'], ['DE', 'Germany'], ['FR', 'France'], ['AE', 'UAE'], ['SG', 'Singapore']]
const ENGINE: Record<string, string> = { chat_gpt: 'ChatGPT', perplexity: 'Perplexity', gemini: 'Gemini' }
const TASK_TAG: Record<AgentTask['kind'], [string, string]> = {
  write: ['Write', ''], listing: ['Get listed', 'ag-pill-good'], refresh: ['Refresh', 'ag-pill-warn'], fix: ['Fix', 'ag-pill-crit'], ads: ['Ads', ''],
}
const TOPIC_STATUS: Record<Topic['status'], [string, string]> = {
  picked: ['Next to write', ''], writing: ['Writing', 'ag-pill-warn'], drafted: ['Draft ready', 'ag-pill-warn'],
  approved: ['Approved', 'ag-pill-good'], published: ['Published', 'ag-pill-good'], skipped: ['Skipped', ''],
}

function Settings({ initial, onSave, saving, firstTime }: { initial: SearchSettings; onSave: (s: SearchSettings) => void; saving: boolean; firstTime: boolean }) {
  const [country, setCountry] = useState(initial.country)
  const [seeds, setSeeds] = useState(initial.seeds.join('\n'))
  const [questions, setQuestions] = useState(initial.questions.join('\n'))
  const split = (t: string) => t.split('\n').map(x => x.trim()).filter(Boolean)
  return (
    <form className="ag-card" onSubmit={e => { e.preventDefault(); onSave({ enabled: firstTime ? true : initial.enabled, country, seeds: split(seeds), questions: split(questions) }) }}>
      <h2>{firstTime ? 'Set up your Search Agent' : 'Search Agent settings'}</h2>
      <p className="ag-card-sub">Leave the lists empty and the agent writes them from your brand on its first run.</p>
      <div className="ag-field" style={{ maxWidth: 320 }}>
        <label className="ag-label" htmlFor="sa-country">Country you want to rank in</label>
        <select id="sa-country" className="ag-select" value={country} onChange={e => setCountry(e.target.value)}>
          {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
        </select>
      </div>
      <div className="ag-grid2" style={{ gap: 14 }}>
        <div className="ag-field">
          <label className="ag-label" htmlFor="sa-seeds">Starting keywords (one per line)</label>
          <textarea id="sa-seeds" className="ag-textarea" rows={6} value={seeds} onChange={e => setSeeds(e.target.value)} placeholder={'ai caption generator\nsocial media scheduler'} />
        </div>
        <div className="ag-field">
          <label className="ag-label" htmlFor="sa-q">Buyer questions to ask ChatGPT, Perplexity and Gemini (one per line)</label>
          <textarea id="sa-q" className="ag-textarea" rows={6} value={questions} onChange={e => setQuestions(e.target.value)} placeholder={'What is the best AI tool for Instagram captions?'} />
        </div>
      </div>
      <div className="ag-row-actions">
        <button className="ag-btn ag-btn-primary" type="submit" disabled={saving}>{saving ? <><Spinner />Saving…</> : firstTime ? 'Start Search Agent' : 'Save settings'}</button>
      </div>
    </form>
  )
}

function DraftCard({ topic, draft, busy, onStatus, say }: { topic: Topic; draft: DraftInfo | undefined; busy: string | null; onStatus: (s: Topic['status']) => void; say: (m: string) => void }) {
  const [open, setOpen] = useState(false)
  const copy = async () => {
    if (!draft) return
    try { await navigator.clipboard.writeText(`# ${draft.title}\n\n${draft.content}`); say('Article copied as Markdown.') } catch { say('Could not copy.') }
  }
  return (
    <section className="ag-card ag-card-focus">
      <div className="ag-row-actions">
        <h2>{topic.status === 'drafted' ? 'Draft waiting for your OK' : 'Approved draft'}</h2>
        <span className={`ag-pill ${TOPIC_STATUS[topic.status][1]}`}>{TOPIC_STATUS[topic.status][0]}</span>
      </div>
      <div>
        <div className="ag-item-title" style={{ fontSize: 19 }}>{draft?.title ?? topic.keyword}</div>
        <div className="ag-meta">For “{topic.keyword}” · {topic.volume.toLocaleString('en-US')} searches a month{draft?.content ? ` · about ${draft.content.split(/\s+/).length.toLocaleString('en-US')} words` : ''}</div>
      </div>
      {topic.brief && (
        <div className="ag-brief">
          <div><span className="ag-brief-label">Today&apos;s #1 result</span>{topic.brief.top || 'Not available'}</div>
          <div className="ag-brief-good"><span className="ag-brief-label">How this draft beats it</span><ul>{topic.brief.beats.map(b => <li key={b}>{b}</li>)}</ul></div>
        </div>
      )}
      {open && draft && <div className="ag-article" tabIndex={0} aria-label="Article text">{draft.content}</div>}
      <div className="ag-row-actions">
        {draft && <button className="ag-btn" type="button" aria-expanded={open} onClick={() => setOpen(v => !v)}>{open ? 'Hide article' : 'Read article'}</button>}
        {draft && <button className="ag-btn" type="button" onClick={copy}>Copy Markdown</button>}
        {draft && <a className="ag-btn" href={draft.mdUrl} target="_blank" rel="noopener noreferrer">Markdown link for Claude</a>}
        {topic.status === 'drafted' && <button className="ag-btn ag-btn-primary" type="button" disabled={!!busy} onClick={() => onStatus('approved')}>Approve</button>}
        <button className={`ag-btn ${topic.status === 'approved' ? 'ag-btn-primary' : ''}`} type="button" disabled={!!busy} onClick={() => onStatus('published')}>It&apos;s on my site</button>
        <button className="ag-btn" type="button" disabled={!!busy} onClick={() => onStatus('skipped')}>Skip</button>
      </div>
      <p className="ag-card-sub" style={{ margin: 0 }}>To add it to your site, give Claude the Markdown link, or paste the Markdown into your blog editor.</p>
    </section>
  )
}

export default function SearchAgentPage({ initial, flags, drafts, brandName }: { initial: SearchAgentData; flags: SearchAgentFlags; drafts: DraftInfo[]; brandName: string }) {
  const { data, busy, call, toast, say } = useAgentApi<SearchAgentData>('/api/agents/search', initial)
  const router = useRouter()
  const firstTime = !data.settings.enabled && !data.lastResearchAt
  const [showSettings, setShowSettings] = useState(firstTime)
  const [tab, setTab] = useState<'week' | 'ranks' | 'ai'>('week')
  const s = data.settings
  const draftById = new Map(drafts.map(d => [d.id, d]))

  const answers = (data.answers?.items ?? []).filter(a => !a.error)
  const mentioned = answers.filter(a => a.mentioned).length
  const brandCounts = new Map<string, number>()
  for (const a of answers) for (const b of a.brands) brandCounts.set(b, (brandCounts.get(b) ?? 0) + 1)
  if (!brandCounts.has(brandName)) brandCounts.set(brandName, 0)
  const bars = [...brandCounts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6)
  const prevHist = data.mentionHistory.length > 1 ? data.mentionHistory[data.mentionHistory.length - 2] : null
  const questions = [...new Set(answers.map(a => a.question))]

  const topicsShown = data.topics.filter(t => t.status !== 'skipped').slice(-8).reverse()
  const draftTopics = data.topics.filter(t => (t.status === 'drafted' || t.status === 'approved') && t.blogId)
  const openTasks = data.tasks.filter(t => t.status === 'open')
  const waitingTopic = data.topics.some(t => t.status === 'picked')

  return (
    <div className="wrap ag-page">
      <Link href="/agents" className="ag-back">← AI Agents</Link>
      <div className="ag-hd">
        <h1 className="st-page-title">Search Agent</h1>
        <span className={`ag-pill ${s.enabled ? 'ag-pill-on' : ''}`}>{s.enabled ? 'On · weekly' : 'Off'}</span>
        <div className="ag-hd-actions">
          {!firstTime && <button className="ag-btn" type="button" disabled={!!busy} onClick={() => call('settings', { settings: { enabled: !s.enabled } })}>{s.enabled ? 'Pause' : 'Turn on'}</button>}
          <button className="ag-btn ag-btn-primary" type="button" disabled={!!busy || firstTime || !flags.dataforseo} onClick={() => call('research')}>{busy === 'research' ? <><Spinner />Researching…</> : 'Run research now'}</button>
          <button className="ag-btn" type="button" disabled={!!busy || !waitingTopic} onClick={async () => { await call('write'); router.refresh() }}>{busy === 'write' ? <><Spinner />Writing…</> : 'Write next draft'}</button>
          {!firstTime && <button className="ag-btn" type="button" aria-expanded={showSettings} onClick={() => setShowSettings(v => !v)}>Settings</button>}
        </div>
      </div>
      <p className="st-page-sub" style={{ marginTop: -12 }}>
        Picks keywords you can win, writes posts that beat the #1 result, and tracks your Google rank and whether AI assistants recommend you.
        {data.lastResearchAt ? <> Last research <Ago iso={data.lastResearchAt} />.</> : null}
      </p>
      {(busy === 'research' || busy === 'write') && <div className="ag-note">{busy === 'research' ? 'Asking the AI assistants and checking Google usually takes 1–2 minutes.' : 'Reading today\'s top results and writing usually takes 1–2 minutes.'} You can keep this page open.</div>}
      {!flags.dataforseo && <div className="ag-note ag-note-warn">The Search Agent needs GrowJin&apos;s DataForSEO account, which isn&apos;t set up yet. Settings can be saved now; research starts once it&apos;s connected.</div>}
      {data.lastError && <div className="ag-note ag-note-crit">Last run had a problem: {data.lastError}</div>}

      {showSettings && (
        <Settings
          initial={s}
          firstTime={firstTime}
          saving={busy === 'settings'}
          onSave={async (next) => {
            const r = await call('settings', { settings: next })
            if (r?.data) {
              setShowSettings(false)
              if (firstTime && flags.dataforseo) await call('research')
            }
          }}
        />
      )}

      {!firstTime && (
        <>
          <div className="ag-stats">
            <div className="ag-stat"><b>{data.topics.filter(t => t.status !== 'skipped').length}</b><span>Topics picked</span></div>
            <div className="ag-stat"><b>{data.topics.filter(t => t.status === 'drafted').length}</b><span>Drafts to read</span></div>
            <div className="ag-stat"><b>{answers.length ? `${mentioned}/${answers.length}` : '—'}{prevHist && answers.length && mentioned !== prevHist.mentioned ? <span className={mentioned > prevHist.mentioned ? 'ag-up' : 'ag-down'} style={{ fontSize: 13, marginLeft: 6 }}>{mentioned > prevHist.mentioned ? '↑' : '↓'}{Math.abs(mentioned - prevHist.mentioned)}</span> : null}</b><span>AI answers name you</span></div>
            <div className="ag-stat"><b>{openTasks.length}</b><span>Things to do</span></div>
          </div>

          {draftTopics.map(t => (
            <DraftCard key={t.keyword} topic={t} draft={t.blogId ? draftById.get(t.blogId) : undefined} busy={busy} say={say} onStatus={st => call('topic', { keyword: t.keyword, status: st }, `topic:${t.keyword}`)} />
          ))}

          <div className="ag-tabs" role="tablist" aria-label="Search Agent sections">
            {([['week', 'This week'], ['ranks', 'Google rankings'], ['ai', 'AI answers']] as const).map(([k, label]) => (
              <button key={k} type="button" role="tab" className="ag-tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>

          {tab === 'week' && (
            <>
              <section className="ag-card">
                <h2>What to do next</h2>
                <p className="ag-card-sub">Found by this week&apos;s research. The top ones are also on Today.</p>
                {data.tasks.length === 0 && <p className="ag-meta">No tasks yet. They appear after the first research.</p>}
                <div className="ag-list">
                  {data.tasks.map(t => (
                    <div key={t.key} className="ag-item" style={t.status !== 'open' ? { opacity: 0.6 } : undefined}>
                      <span className={`ag-pill ag-item-tag ${TASK_TAG[t.kind][1]}`}>{TASK_TAG[t.kind][0]}</span>
                      <div className="ag-item-main">
                        <div className="ag-item-title">{t.title}</div>
                        <div className="ag-item-detail">{t.detail}{t.url ? <> · <a href={t.url} target="_blank" rel="noopener noreferrer">open</a></> : null}</div>
                      </div>
                      {t.status === 'open'
                        ? <div className="ag-row-actions">
                            <button className="ag-btn" type="button" disabled={!!busy} onClick={() => call('task', { key: t.key, status: 'done' }, `task:${t.key}`)}>Done</button>
                            <button className="ag-btn" type="button" disabled={!!busy} onClick={() => call('task', { key: t.key, status: 'dismissed' }, `task:${t.key}`)}>Not for me</button>
                          </div>
                        : <span className="ag-pill">{t.status === 'done' ? 'Done' : 'Dismissed'}</span>}
                    </div>
                  ))}
                </div>
              </section>

              <section className="ag-card">
                <h2>Blog topics</h2>
                <p className="ag-card-sub">Keywords with real searches that {brandName} can realistically win. One is written each week.</p>
                {topicsShown.length === 0 && <p className="ag-meta">No topics yet.</p>}
                {topicsShown.length > 0 && (
                  <div className="ag-table-wrap">
                    <table className="ag-table">
                      <thead><tr><th>Keyword</th><th>Searches / month</th><th>Difficulty</th><th>Why this one</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
                      <tbody>
                        {topicsShown.map(t => (
                          <tr key={t.keyword}>
                            <td style={{ fontWeight: 600 }}>{t.keyword}</td>
                            <td>{t.volume.toLocaleString('en-US')}</td>
                            <td>{t.difficulty ?? '—'}</td>
                            <td>{t.why}</td>
                            <td><span className={`ag-pill ${TOPIC_STATUS[t.status][1]}`}>{TOPIC_STATUS[t.status][0]}</span></td>
                            <td>{t.status === 'picked' && <button className="ag-btn" type="button" disabled={!!busy} onClick={() => call('topic', { keyword: t.keyword, status: 'skipped' }, `topic:${t.keyword}`)}>Skip</button>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {data.adsTips.length > 0 && (
                <section className="ag-card">
                  <h2>Google Ads tips</h2>
                  {!flags.googleAds && <p className="ag-card-sub">Connect Google Ads in Settings → Integrations to also see wasted spend.</p>}
                  <div className="ag-grid2" style={{ gap: 12 }}>
                    {data.adsTips.map(t => (
                      <div key={t.title} className="ag-note" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span className="ag-brief-label">{t.kind === 'wasted' ? 'Wasted spend' : 'Try ads instead'}</span>
                        <b style={{ color: 'var(--text)' }}>{t.title}</b>
                        <span>{t.detail}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}

          {tab === 'ranks' && (
            <div className="ag-grid2">
              <section className="ag-card">
                <h2>What moved this week</h2>
                {data.rankChanges.length === 0 && <p className="ag-meta">{data.ranks ? 'No big moves since last week.' : 'Shown from the second week on.'}</p>}
                {data.rankChanges.length > 0 && (
                  <div className="ag-table-wrap">
                    <table className="ag-table">
                      <thead><tr><th>Keyword</th><th>Before</th><th>Now</th></tr></thead>
                      <tbody>
                        {data.rankChanges.map(c => {
                          const up = c.before !== null && c.now !== null ? c.now < c.before : c.now !== null
                          return (
                            <tr key={c.keyword}>
                              <td>{c.keyword}</td>
                              <td>{c.before ? `#${c.before}` : '—'}</td>
                              <td className={up ? 'ag-up' : 'ag-down'}>{c.now ? `#${c.now}` : 'gone'} {up ? '↑' : '↓'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              <section className="ag-card">
                <h2>Where you rank</h2>
                <p className="ag-card-sub">{data.ranks ? <>{data.ranks.rows.length} keywords · checked <Day iso={data.ranks.at} /></> : 'After the first research.'}</p>
                {data.ranks && data.ranks.rows.length > 0 && (
                  <div className="ag-table-wrap">
                    <table className="ag-table">
                      <thead><tr><th>Keyword</th><th>Searches</th><th>Rank</th></tr></thead>
                      <tbody>
                        {data.ranks.rows.slice(0, 20).map(r => (
                          <tr key={r.keyword}><td>{r.keyword}</td><td>{r.volume.toLocaleString('en-US')}</td><td>#{r.rank}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {data.ranks && data.ranks.rows.length === 0 && <p className="ag-meta">Google doesn&apos;t show your site for any tracked searches yet.</p>}
              </section>
            </div>
          )}

          {tab === 'ai' && (
            <>
              <section className="ag-card">
                <h2>How often AI assistants name you</h2>
                <p className="ag-card-sub">{answers.length ? <>{questions.length} buyer questions asked to {[...new Set(answers.map(a => ENGINE[a.engine] ?? a.engine))].join(', ')} · <Day iso={data.answers?.at} /></> : 'After the first research.'}</p>
                {bars.map(([name, n]) => (
                  <div key={name} className={`ag-bar-row ${name === brandName ? 'ag-bar-me' : ''}`}>
                    <div className="ag-bar-label" style={name === brandName ? { fontWeight: 700 } : undefined}>{name}</div>
                    <div className="ag-bar" aria-hidden="true"><div style={{ width: `${answers.length ? Math.round(n / answers.length * 100) : 0}%` }} /></div>
                    <div className="ag-bar-num">{n}/{answers.length}</div>
                  </div>
                ))}
                {data.description && (
                  <div className={`ag-note ${data.description.issue ? 'ag-note-warn' : ''}`}>
                    <b>How ChatGPT describes {brandName}:</b> {data.description.text || '(nothing)'}{data.description.issue ? <><br /><b>Problem:</b> {data.description.issue}</> : null}
                  </div>
                )}
              </section>
              {questions.length > 0 && (
                <section className="ag-card">
                  <h2>Question by question</h2>
                  <div className="ag-table-wrap">
                    <table className="ag-table">
                      <thead><tr><th>Question</th>{['chat_gpt', 'perplexity', 'gemini'].map(e => <th key={e}>{ENGINE[e]}</th>)}</tr></thead>
                      <tbody>
                        {questions.map(q => (
                          <tr key={q}>
                            <td>{q}</td>
                            {['chat_gpt', 'perplexity', 'gemini'].map(e => {
                              const a = answers.find(x => x.question === q && x.engine === e)
                              return (
                                <td key={e}>
                                  {!a ? '—' : a.mentioned
                                    ? <span className="ag-up">#{a.position} named</span>
                                    : <span className="ag-meta">{a.brands.length ? `Not named · ${a.brands.slice(0, 2).join(', ')}` : 'No brands named'}</span>}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          )}
        </>
      )}
      <Toast text={toast} />
    </div>
  )
}
