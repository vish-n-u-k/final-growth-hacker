'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import ToolHeader from '@/components/ToolHeader'
import { DIRECTORIES, helpOf, listingDomain } from '@/lib/agents/task-kinds'
import type { AgentTask, AiAnswer, IdeaVerdict, LinkOpportunity, SearchAgentData, SearchSettings, Topic } from '@/lib/agents/store'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/email-outreach/shared'
import { ActionBar, Card, DemoSwitch, Pager, usePages, useShowAll, Finished, Flow, ListTools, LiveProgress, Sec, Side, Src, Tabs, Tag } from '@/components/tool-ui'
import { Day, DemoBanner, fmtAgo, fmtDate, useAgentApi } from './shared'

// Search Agent: gets the brand found on Google and in AI answers. The bar at the top says what it
// tracks (Change opens the settings); it researches by itself the first time the page is opened.
// Tabs: To do (posts to write, sites to pitch, other fixes), Done, Keywords (ideas and rankings) and AI answers.
// A post or a site opens into two short steps, like the other tools.

export interface SearchAgentFlags { dataforseo: boolean; googleAds: boolean; demo: boolean; demoForced: boolean }
export interface DraftInfo { id: string; title: string; content: string; metaDescription: string | null; mdUrl: string }

type TabKey = 'todo' | 'done' | 'rank' | 'ai'
type Item = { kind: 'topic'; key: string; t: Topic } | { kind: 'link'; key: string; l: LinkOpportunity } | { kind: 'task'; key: string; k: AgentTask }

const COUNTRIES: [string, string][] = [['US', 'United States'], ['IN', 'India'], ['GB', 'United Kingdom'], ['CA', 'Canada'], ['AU', 'Australia'], ['DE', 'Germany'], ['FR', 'France'], ['AE', 'UAE'], ['SG', 'Singapore']]
const ENGINE: Record<string, string> = { chat_gpt: 'ChatGPT', perplexity: 'Perplexity', gemini: 'Gemini', google_ai: 'Google AI Overview' }
const TASK: Record<AgentTask['kind'], [string, string]> = { write: ['✍', 'Write'], listing: ['🔗', 'Get listed'], refresh: ['↻', 'Refresh'], fix: ['!', 'Fix'], ads: ['$', 'Ads'] }
const PROGRESS = ['Finding what people search', 'Checking where you rank', 'Asking ChatGPT and Perplexity about you', 'Finding sites that list competitors']
// Article sites are pitched and Reddit is joined, not "listed"
const taskLabel = (k: AgentTask) => ({ article: 'Pitch', reddit: 'Reddit' } as Record<string, string>)[helpOf(k)] ?? TASK[k.kind][1]
// Why a keyword idea was or wasn't picked (Keywords tab)
const VERDICT: Record<IdeaVerdict, string> = {
  picked: 'In your to-do', fit: 'Good fit, waiting for room', broad: 'Too broad', hard: 'Hard to win',
  off: 'Not your buyers', unknown: 'Difficulty unknown', small: 'Too few searches', branded: 'Your brand name', unchecked: 'Not checked for fit',
}
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())

function tabOf(i: Item): 'todo' | 'done' {
  if (i.kind === 'topic') return ['picked', 'writing', 'drafted', 'approved'].includes(i.t.status) ? 'todo' : 'done'
  if (i.kind === 'link') return ['ready', 'new', 'replied'].includes(i.l.status) ? 'todo' : 'done'
  return i.k.status === 'open' ? 'todo' : 'done'
}
const sectionOf = (i: Item) => (i.kind === 'link' && i.l.status === 'replied' ? 'replied' : i.kind === 'topic' ? 'topic' : i.kind === 'link' ? 'pitch' : 'task')
const nameOf = (i: Item) => (i.kind === 'topic' ? i.t.keyword : i.kind === 'link' ? i.l.domain : i.k.title)

function Settings({ initial, saving, onSave, onCancel }: { initial: SearchSettings; saving: boolean; onSave: (s: SearchSettings) => void; onCancel: () => void }) {
  const [country, setCountry] = useState(initial.country)
  const [seeds, setSeeds] = useState(initial.seeds.join('\n'))
  const [questions, setQuestions] = useState(initial.questions.join('\n'))
  const [enabled, setEnabled] = useState(initial.enabled)
  const split = (t: string) => t.split('\n').map(x => x.trim()).filter(Boolean)
  return (
    <form className="tu-panel" onSubmit={e => { e.preventDefault(); onSave({ enabled, country, seeds: split(seeds), questions: split(questions) }) }}>
      <h3>Search settings</h3>
      <p className="tu-hint">Suggested from your site. Leave a list empty and it&apos;s written from your brand on the next research.</p>
      <div className="tu-grid">
        <label>Keywords (one per line)
          <textarea rows={4} value={seeds} onChange={e => setSeeds(e.target.value)} placeholder={'social media scheduler\ninstagram post maker'} />
        </label>
        <label>Questions buyers ask AI assistants (one per line)
          <textarea rows={4} value={questions} onChange={e => setQuestions(e.target.value)} placeholder="What's the best tool to make Instagram posts for a café?" />
        </label>
        <label>Country you want to rank in
          <select value={country} onChange={e => setCountry(e.target.value)}>{COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
        </label>
        <label className="tu-chk tu-full"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          <span>Research every week automatically<small>A new to-do list each Monday, and one post written for you.</small></span></label>
      </div>
      <div className="tu-panel-acts">
        <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? <><Spinner />Saving…</> : 'Save'}</button>
      </div>
    </form>
  )
}

export default function SearchAgentPage({ initial, flags, drafts, brandName }: { initial: SearchAgentData; flags: SearchAgentFlags; drafts: DraftInfo[]; brandName: string }) {
  const { data, busy, call, toast: said } = useAgentApi<SearchAgentData>('/api/agents/search', initial)
  const [toast, notify] = useToast()
  useEffect(() => { if (said) notify(said) }, [said, notify])
  const router = useRouter()
  const s = data.settings
  const draftById = new Map(drafts.map(d => [d.id, d]))
  const [demo, setDemo] = useState(flags.demo)
  // Demo data stands in for DataForSEO, so research works without it
  const dataReady = flags.dataforseo || demo
  const [tab, setTab] = useState<TabKey>('todo')
  const [panel, setPanel] = useState(false)
  const [q, setQ] = useState('')
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [stepNo, setStepNo] = useState(1)
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [reviewUrl, setReviewUrl] = useState('')
  // What only the business knows, asked before a post is written (all optional)
  const [inputs, setInputs] = useState<{ example: string; number: string; opinion: string }>({ example: '', number: '', opinion: '' })

  const researching = busy === 'research'
  const writing = busy?.startsWith('write') ?? false
  const running = researching || busy === 'links'
  const auto = useRef(false)
  useEffect(() => {
    if (auto.current || data.lastResearchAt || !dataReady) return
    auto.current = true
    call('research')
  }, [call, data.lastResearchAt, dataReady])

  const items: Item[] = [
    ...data.topics.map(t => ({ kind: 'topic' as const, key: `t:${t.keyword}`, t })),
    ...(data.links ?? []).map(l => ({ kind: 'link' as const, key: `l:${l.id}`, l })),
    ...data.tasks.map(k => ({ kind: 'task' as const, key: `k:${k.key}`, k })),
  ]
  const todo = items.filter(i => tabOf(i) === 'todo')
  const done = items.filter(i => tabOf(i) === 'done')

  // The list on screen: this tab, searched, in section order, a page at a time
  const SECTIONS = ['replied', 'topic', 'pitch', 'task']
  const needle = q.trim().toLowerCase()
  const tabAll = tab === 'done' ? done : todo
  const shown = tabAll
    .filter(i => !needle || `${nameOf(i)} ${i.kind === 'topic' ? i.t.why : i.kind === 'link' ? `${i.l.why} ${i.l.title}` : i.k.detail}`.toLowerCase().includes(needle))
    .sort((a, b) => (tab === 'todo' ? SECTIONS.indexOf(sectionOf(a)) - SECTIONS.indexOf(sectionOf(b)) : 0))
  const pg = usePages(shown, [tab, needle])
  const listTop = useRef<HTMLDivElement>(null)
  const open = openKey ? items.find(i => i.key === openKey) ?? null : null

  function openItem(i: Item) {
    setOpenKey(i.key); setStepNo(i.kind === 'topic' && i.t.status === 'approved' ? 2 : 1)
    if (i.kind === 'link') { setTo(i.l.email ?? ''); setSubject(i.l.pitch?.subject ?? ''); setBody(i.l.pitch?.body ?? '') }
    // The new wording is written the first time the fix is opened
    if (i.kind === 'task' && helpOf(i.k) === 'describe' && !i.k.copy && i.k.status === 'open') call('task_copy', {}, 'task_copy')
    setReviewUrl('')
    if (i.kind === 'topic') setInputs({ example: i.t.inputs?.example ?? '', number: i.t.inputs?.number ?? '', opinion: i.t.inputs?.opinion ?? '' })
    window.scrollTo({ top: 0 })
  }
  // An article site becomes a site to pitch, and opens straight in the pitch steps
  async function pitchTask(k: AgentTask) {
    const r = await call('task_pitch', { key: k.key }, `task:t:${k.key}`) as { linkId?: string; data?: SearchAgentData } | null
    const l = r?.data?.links?.find(x => x.id === r.linkId)
    if (l) openItem({ kind: 'link', key: `l:${l.id}`, l })
  }
  const copyText = async (text: string, what = 'Copied') => {
    try { await navigator.clipboard.writeText(text); notify(what) } catch { notify('Couldn’t copy. Select the text and copy it.') }
  }
  function skip(i: Item) {
    if (openKey === i.key) setOpenKey(null)
    if (i.kind === 'topic') { call('topic', { keyword: i.t.keyword, status: 'skipped' }, `topic:${i.key}`); notify('Skipped. Moved to Done.', () => { call('topic', { keyword: i.t.keyword, status: 'picked' }) }) }
    if (i.kind === 'link') { call('link', { id: i.l.id, status: 'skipped' }, `link:${i.key}`); notify('Skipped. Moved to Done.', () => { call('link', { id: i.l.id, status: 'new' }) }) }
    if (i.kind === 'task') { call('task', { key: i.k.key, status: 'dismissed' }, `task:${i.key}`); notify('Skipped. Moved to Done.', () => { call('task', { key: i.k.key, status: 'open' }) }) }
  }
  async function writeNow(t: Topic) {
    await call('write', { keyword: t.keyword, inputs }, `write:${t.keyword}`)
    router.refresh()
  }
  // A "Refresh a page" to-do becomes a page to rewrite, opened at the "what only you know" step
  async function improveTask(k: AgentTask) {
    const r = await call('improve', { key: k.key }, `task:i:${k.key}`) as { keyword?: string; data?: SearchAgentData } | null
    const t = r?.data?.topics.find(x => x.keyword === r.keyword && (x.status === 'picked' || x.status === 'writing'))
    if (t) openItem({ kind: 'topic', key: `t:${t.keyword}`, t })
  }

  // ── Cards ──────────────────────────────────────────────────────────────────

  function card(i: Item) {
    const isTodo = tabOf(i) === 'todo'
    const view = <button type="button" className="btn btn-sm cl-btn-outline" onClick={() => openItem(i)}>View</button>
    if (i.kind === 'topic') {
      const t = i.t
      const st = t.status
      return (
        <Card key={i.key} av={t.kind === 'improve' ? '↻' : '✍'} square name={t.keyword}
          sub={<>{t.kind === 'improve' && <Src label="Improve your page" />}<span>{t.volume.toLocaleString('en-US')} searches a month</span>{t.difficulty !== null && <span>· {t.difficulty < 30 ? 'easy to win' : t.difficulty < 60 ? 'some competition' : 'hard to win'}</span>}</>}
          why={t.why} quote={t.brief?.top ? `Today’s #1 result: ${t.brief.top}` : undefined}
          state={st === 'drafted' ? <Tag tone="ok">Draft ready</Tag> : st === 'approved' ? <Tag tone="ok">Approved · put it on your site</Tag> : st === 'writing' ? <Tag><Spinner size={10} />Writing</Tag> : st === 'published' ? <Tag tone="ok">✓ Published</Tag> : st === 'skipped' ? <Tag>Skipped</Tag> : <Tag>Written next</Tag>}
          onSkip={isTodo && st !== 'writing' ? () => skip(i) : undefined}
          action={!isTodo ? view : st === 'picked'
            ? <button type="button" className="btn btn-primary btn-sm cl-reach" disabled={!!busy} onClick={() => openItem(i)}>{t.kind === 'improve' ? 'Rewrite it →' : 'Write it now →'}</button>
            : <button type="button" className="btn btn-primary btn-sm cl-reach" disabled={st === 'writing'} onClick={() => openItem(i)}>{st === 'approved' ? 'Publish →' : 'Read draft →'}</button>} />
      )
    }
    if (i.kind === 'link') {
      const l = i.l
      const st = l.status
      return (
        <Card key={i.key} av="🔗" square name={l.domain}
          sub={<><Src label={l.source === 'list' ? 'List article' : 'Links to rivals'} tone={l.source === 'list' ? 'green' : undefined} />{l.authority !== null && <span>Authority {l.authority}</span>}{l.names.length > 0 && <span>· names {l.names.slice(0, 3).join(', ')}</span>}</>}
          why={st === 'replied' ? 'They answered your pitch.' : st === 'sent' ? (l.nextFollowUpAt && !l.followupSent ? `One follow-up goes out ${fmtDate(l.nextFollowUpAt)} unless they reply.` : 'Waiting for a reply.') : l.why}
          quote={st === 'replied' && l.replyNote ? `“${l.replyNote}”` : l.title ? `“${l.title}”` : undefined}
          state={st === 'replied' ? <Tag tone="crit">Replied</Tag> : st === 'ready' ? <Tag>Pitch drafted</Tag> : st === 'new' ? <Tag tone="warn">Needs an email</Tag> : st === 'sent' ? <Tag tone="ok">✓ Pitched {fmtDate(l.sentAt)}</Tag> : st === 'won' ? <Tag tone="ok">✓ Got the link</Tag> : st === 'bounced' ? <Tag tone="crit">Bounced</Tag> : st === 'opted_out' ? <Tag>Said no</Tag> : <Tag>Skipped</Tag>}
          onSkip={isTodo && st !== 'replied' ? () => skip(i) : undefined}
          action={isTodo ? <button type="button" className="btn btn-primary btn-sm cl-reach" onClick={() => openItem(i)}>{st === 'replied' ? 'Read reply →' : 'Pitch them →'}</button> : view} />
      )
    }
    const k = i.k
    const help = helpOf(k)
    const dir = DIRECTORIES[listingDomain(k).replace(/^www\./, '')]
    const pitching = busy === `task:t:${k.key}`
    return (
      <Card key={i.key} av={TASK[k.kind][0]} square name={k.title}
        sub={<Src label={taskLabel(k)} tone={k.kind === 'fix' ? 'red' : k.kind === 'refresh' ? 'amber' : helpOf(k) === 'reddit' ? 'orange' : undefined} />}
        why={k.detail} state={k.status === 'done' ? <Tag tone="ok">✓ Done</Tag> : k.status === 'dismissed' ? <Tag>Skipped</Tag> : help === 'other' && k.url ? <a className="th-link" href={k.url} target="_blank" rel="noopener noreferrer">Open the page ↗</a> : null}
        onSkip={isTodo ? () => skip(i) : undefined}
        action={!isTodo ? view
          : help === 'describe' ? <button type="button" className="btn btn-primary btn-sm cl-reach" onClick={() => openItem(i)}>Fix it →</button>
          : help === 'directory' ? <button type="button" className="btn btn-primary btn-sm cl-reach" onClick={() => openItem(i)}>Get listed on {dir?.name ?? 'it'} →</button>
          : help === 'article' ? <button type="button" className="btn btn-primary btn-sm cl-reach" disabled={!!busy} onClick={() => pitchTask(k)}>{pitching ? <><Spinner />Writing a pitch…</> : 'Pitch them →'}</button>
          : help === 'reddit' ? <button type="button" className="btn btn-primary btn-sm cl-reach" onClick={() => openItem(i)}>Join in →</button>
          : k.kind === 'refresh' && k.url ? <button type="button" className="btn btn-primary btn-sm cl-reach" disabled={!!busy} onClick={() => improveTask(k)}>{busy === `task:i:${k.key}` ? <><Spinner />Opening…</> : 'Draft a rewrite →'}</button>
          : isTodo
          ? <button type="button" className="btn btn-primary btn-sm cl-reach" disabled={!!busy} onClick={() => { call('task', { key: k.key, status: 'done' }, `task:${i.key}`); notify('Marked as done', () => { call('task', { key: k.key, status: 'open' }) }) }}>Mark as done</button>
          : <button type="button" className="btn btn-sm cl-btn-outline" disabled={!!busy} onClick={() => call('task', { key: k.key, status: 'open' }, `task:${i.key}`)}>Bring it back</button>} />
    )
  }

  function list(all: Item[], sections: boolean) {
    const tools = <><div ref={listTop} className="tu-anchor" /><ListTools q={q} setQ={setQ} shown={shown.length} total={all.length} onClear={() => setQ('')} /></>
    if (!shown.length) {
      return <>{tools}<div className="tu-empty">{all.length ? 'Nothing matches.' : running && !data.lastResearchAt ? 'Your to-do list appears here in a moment.' : sections ? 'All caught up. The next research brings new things to do.' : 'Nothing here yet.'}</div></>
    }
    if (!sections) return <>{tools}{pg.items.map(card)}<Pager p={pg} top={listTop} /></>
    return <>{tools}
      {([['replied', 'Replied: answer while they’re interested', 'crit'], ['topic', 'Posts to write', undefined], ['pitch', 'Sites to pitch', undefined], ['task', 'Other things to do', undefined]] as const).map(([k, label, tone]) => {
        // This page's cards of the section; the heading counts the whole section
        const group = pg.items.filter(i => sectionOf(i) === k)
        const total = shown.filter(i => sectionOf(i) === k).length
        // "Sites to pitch" shows even when empty (with Find more sites), on the first page
        if (!group.length && !(k === 'pitch' && !total && pg.page === 1)) return null
        return (
          <div key={k}>
            <div className="tu-sec-row">
              <Sec label={label} count={total} tone={tone} />
              {k === 'pitch' && (
                <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy || !dataReady} onClick={() => call('links')}>
                  {busy === 'links' ? <><Spinner />Looking…</> : 'Find more sites'}
                </button>
              )}
            </div>
            {group.map(card)}
            {k === 'pitch' && !group.length && <p className="tu-none">Sites that list or link to your competitors but not you show up here{data.lastLinksAt ? <>. Last checked <Day iso={data.lastLinksAt} />.</> : '.'}</p>}
          </div>
        )
      })}
      <Pager p={pg} top={listTop} />
    </>
  }

  // ── One item opened ────────────────────────────────────────────────────────

  function detail(i: Item) {
    const back = { label: 'Search Agent', onClick: () => setOpenKey(null) }
    const backBtn = <button key="back" type="button" className="btn btn-ghost ro-back" onClick={() => setOpenKey(null)}>← Back to the list</button>
    const next = todo.find(x => x.key !== i.key && (x.kind !== 'task' || helpOf(x.k) !== 'other'))
    const nextBtn = next && <button key="next" type="button" className="btn btn-primary" onClick={() => openItem(next)}>Next: {nameOf(next).slice(0, 30)}{nameOf(next).length > 30 ? '…' : ''} →</button>

    if (i.kind === 'topic') {
      const t = i.t
      const draft = t.blogId ? draftById.get(t.blogId) : undefined
      const improve = t.kind === 'improve'
      const side = <Side av={improve ? '↻' : '✍'} square name={t.keyword} sub={<span>{improve && t.pageUrl ? <>Your page <a className="th-link" href={t.pageUrl} target="_blank" rel="noopener noreferrer">{t.pageUrl.replace(/^https?:\/\/(www\.)?/, '')} ↗</a> · </> : null}{t.volume.toLocaleString('en-US')} searches a month</span>} quote={t.brief?.top ? `Today’s #1: ${t.brief.top}` : undefined} why={t.why} whyLabel="Why this one" />
      const flow = (at: number, title: string, hint: React.ReactNode, content: React.ReactNode, actions: React.ReactNode) =>
        <Flow back={back} crumb={t.keyword} side={side} steps={['Read the draft', 'Publish']} at={at} title={title} hint={hint} actions={actions} stepKey={`${i.key}:${at}:${t.status}`}>{content}</Flow>
      if (t.status === 'published' || t.status === 'skipped') {
        return flow(3, '', null, t.status === 'published'
          ? <Finished title="Marked as published" text="Its Google rank shows up in Rankings after the next research." />
          : <Finished grey title="Skipped" text="You skipped this one. Bring it back if you change your mind." />, <>
          {backBtn}
          {t.status === 'skipped' && <button key="r" type="button" className="btn cl-btn-outline" onClick={() => call('topic', { keyword: t.keyword, status: 'picked' })}>Bring it back</button>}
          {nextBtn}
        </>)
      }
      if (t.status === 'picked' || t.status === 'writing') {
        const w = busy === `write:${t.keyword}` || t.status === 'writing'
        const field = (k: keyof typeof inputs, label: string, hint: string) => (
          <label className="sa-in">{label}<small>{hint}</small>
            <textarea rows={2} value={inputs[k]} maxLength={600} onChange={e => setInputs(x => ({ ...x, [k]: e.target.value }))} />
          </label>
        )
        return flow(1, w ? (improve ? 'Rewriting your page' : 'Writing the post') : 'Add what only you know',
          w ? 'Reading today’s top results, then writing it as long as this search needs, in your brand voice.'
            : <>Optional, 30 seconds. {improve ? 'The rewrite' : 'The post'} uses your own example and numbers, which no other page has. Leave them empty and nothing is made up.</>,
          <>
            {w && <div className="ro-working"><Spinner /><span>{improve ? 'Rewriting your page' : 'Writing a post'} for “{t.keyword}”. Usually 1–2 minutes.</span><i /></div>}
            {!w && <div className="tu-stack">
              {field('example', 'A real example or customer story', `e.g. how a customer used ${brandName} for this`)}
              {field('number', 'A number you know', 'e.g. customers, time saved, posts made')}
              {field('opinion', 'Your own view, in one line', `what you think most people get wrong about “${t.keyword}”`)}
            </div>}
            {t.brief && !w && <div className="tu-brief"><b>How the post will beat today’s #1</b><ul>{t.brief.beats.map(b => <li key={b}>{b}</li>)}</ul></div>}
          </>,
          <>
            <button key="skip" type="button" className="btn btn-ghost ro-back" disabled={w} onClick={() => skip(i)}>Skip</button>
            <button key="w" type="button" className="btn btn-primary" disabled={w || !!busy} onClick={() => writeNow(t)}>{w ? <><Spinner />Writing…</> : improve ? 'Rewrite it now' : 'Write it now'}</button>
          </>)
      }
      if (stepNo === 1) {
        return flow(1, 'Read the draft', <>Written for “{t.keyword}”, in your brand voice{draft ? `, about ${draft.content.split(/\s+/).length.toLocaleString('en-US')} words` : ''}.</>,
          <>
            {draft && <div className="tu-draft tu-article"><h4>{draft.title}</h4>{draft.content}</div>}
            {t.brief && <div className="tu-brief"><b>{improve ? 'What changed from your page' : 'How it beats today’s #1'}</b><ul>{t.brief.beats.map(b => <li key={b}>{b}</li>)}</ul></div>}
          </>,
          <>
            <button key="skip" type="button" className="btn btn-ghost ro-back" onClick={() => skip(i)}>Skip</button>
            <button key="ok" type="button" className="btn btn-primary" disabled={!!busy} onClick={async () => { if (t.status === 'drafted') await call('topic', { keyword: t.keyword, status: 'approved' }, `topic:${i.key}`); setStepNo(2) }}>{t.status === 'drafted' ? 'Approve draft →' : 'Next: publish →'}</button>
          </>)
      }
      return flow(2, 'Put it on your site', improve && t.pageUrl ? <>Replace the text on <a className="th-link" href={t.pageUrl} target="_blank" rel="noopener noreferrer">{t.pageUrl.replace(/^https?:\/\/(www\.)?/, '')}</a> with this, keeping the same address so it keeps its place on Google.</> : 'Copy it into your blog, or give Claude the link and ask it to publish the post.',
        <div className="tu-row">
          <button type="button" className="btn cl-btn-outline" disabled={!draft} onClick={async () => { if (!draft) return; try { await navigator.clipboard.writeText(`# ${draft.title}\n\n${draft.content}`); notify('Copied as Markdown') } catch { notify('Couldn’t copy') } }}>Copy Markdown</button>
          <button type="button" className="btn cl-btn-outline" disabled={!draft} onClick={async () => { if (!draft) return; try { await navigator.clipboard.writeText(draft.mdUrl); notify('Link copied. Paste it to Claude.') } catch { notify('Couldn’t copy') } }}>Copy link for Claude</button>
        </div>,
        <>
          <button key="b2" type="button" className="btn btn-ghost ro-back" onClick={() => setStepNo(1)}>← Back</button>
          <button key="pub" type="button" className="btn btn-primary" disabled={!!busy} onClick={() => call('topic', { keyword: t.keyword, status: 'published' }, `topic:${i.key}`)}>It’s on my site</button>
        </>)
    }

    if (i.kind === 'link') {
      const l = i.l
      const side = <Side av="🔗" square name={l.domain}
        sub={<><Src label={l.source === 'list' ? 'List article' : 'Links to rivals'} tone={l.source === 'list' ? 'green' : undefined} /><a className="th-link" href={l.url} target="_blank" rel="noopener noreferrer">See the page ↗</a></>}
        quote={l.title || undefined} why={l.why} whyLabel="Why this site" />
      const flow = (at: number, title: string, hint: React.ReactNode, content: React.ReactNode, actions: React.ReactNode, steps = ['Their email', 'Send pitch']) =>
        <Flow back={back} crumb={l.domain} side={side} steps={steps} at={at} title={title} hint={hint} actions={actions} stepKey={`${i.key}:${at}:${l.status}`}>{content}</Flow>
      if (l.status === 'replied') {
        return flow(1, `${l.domain} replied`, 'Answer from Gmail, in the same thread.',
          <div className="tu-stack">
            {l.replyNote && <blockquote className="ro-quote tu-reply">“{l.replyNote}”</blockquote>}
            {l.threadId && <a className="btn cl-btn-outline tu-self" href={`https://mail.google.com/mail/u/0/#all/${l.threadId}`} target="_blank" rel="noopener noreferrer">Open the thread in Gmail ↗</a>}
          </div>,
          <>
            <button key="no" type="button" className="btn btn-ghost ro-back" disabled={!!busy} onClick={() => call('link', { id: l.id, status: 'skipped' })}>It didn’t work out</button>
            <button key="won" type="button" className="btn btn-primary" disabled={!!busy} onClick={() => call('link', { id: l.id, status: 'won' })}>I got the link</button>
          </>, ['Reply'])
      }
      if (tabOf(i) === 'done') {
        const [title, text, grey] = l.status === 'sent' ? [`Pitch sent to ${l.domain}`, <>Sent {l.sentAt ? `on ${fmtDate(l.sentAt)} ` : ''}to <b>{l.email}</b>. {l.nextFollowUpAt && !l.followupSent ? `One follow-up goes out ${fmtDate(l.nextFollowUpAt)} if they don’t reply.` : 'Waiting for a reply.'}</>, false]
          : l.status === 'won' ? ['You got the link', 'Nice. It helps Google and AI assistants find you.', false]
          : l.status === 'bounced' ? ['The pitch bounced', 'That address doesn’t work.', true]
          : l.status === 'opted_out' ? ['They said no', l.replyNote ? `“${l.replyNote}”` : 'No follow-ups will go out.', true]
          : ['Skipped', 'You skipped this one. Bring it back if you change your mind.', true]
        return flow(3, '', null, <Finished title={title} text={text} grey={grey} />, <>
          {backBtn}
          {l.status === 'sent' && <button key="won" type="button" className="btn cl-btn-outline" disabled={!!busy} onClick={() => call('link', { id: l.id, status: 'won' })}>I got the link</button>}
          {l.status === 'skipped' && <button key="r" type="button" className="btn cl-btn-outline" onClick={() => call('link', { id: l.id, status: 'new' })}>Bring it back</button>}
          {nextBtn}
        </>)
      }
      if (stepNo === 1) {
        return flow(1, 'Where should it go?', l.email ? 'From their website. Check it, or paste the right one.' : 'No email was found on their site. Paste one if you find it.',
          <>
            {l.email
              ? <div className="ro-found"><span className="ro-found-ic" aria-hidden="true">✉</span><div><b>{l.email}</b><span>{l.contactName ? `${l.contactName} · ` : ''}{l.emailVerified ? 'verified' : 'found on their site, not verified'}</span></div></div>
              : <div className="ro-found ro-found--none"><span className="ro-found-ic" aria-hidden="true">?</span><div><b>No email found</b><span>Try <a className="th-link" href={`https://${l.domain}/contact`} target="_blank" rel="noopener noreferrer">their contact page ↗</a>, or paste the pitch into their contact form.</span></div></div>}
            <form id={`to-${l.id}`} className="ro-field" onSubmit={e => { e.preventDefault(); if (validEmail(to)) setStepNo(2) }}>
              <label htmlFor={`to-in-${l.id}`}>Email address</label>
              <input id={`to-in-${l.id}`} type="email" value={to} onChange={e => setTo(e.target.value)} placeholder={`name@${l.domain}`} />
            </form>
          </>,
          <>
            <button key="skip" type="button" className="btn btn-ghost ro-back" onClick={() => skip(i)}>Skip</button>
            <button key="cont" type="submit" form={`to-${l.id}`} className="btn btn-primary" disabled={!validEmail(to)}>Continue →</button>
          </>)
      }
      const sending = busy === `send:${l.id}`
      return flow(2, 'Check the pitch, then send it', <>Short, specific, one clear ask. It starts with &ldquo;Hi{l.contactName ? ` ${l.contactName.split(' ')[0]}` : ''},&rdquo; and one follow-up goes out 5 days later unless they reply.</>,
        <div className="ro-mail">
          <label className="ro-mail-row"><span>To</span><input value={to} readOnly /></label>
          <label className="ro-mail-row"><span>Subject</span><input value={subject} onChange={e => setSubject(e.target.value)} /></label>
          <textarea className="ro-mail-body" aria-label="Message" rows={9} value={body} onChange={e => setBody(e.target.value)} />
          <div className="ro-mail-tools">
            <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(`${subject}\n\n${body}`); notify('Copied') } catch { /* ignore */ } }}>Copy</button>
            <span className="cl-muted">Sent from your Gmail</span>
          </div>
        </div>,
        <>
          <button key="b" type="button" className="btn btn-ghost ro-back" disabled={sending} onClick={() => setStepNo(1)}>← Back</button>
          <button key="send" type="button" className="btn btn-primary" disabled={sending || !subject.trim() || !body.trim()}
            onClick={() => call('link_send', { id: l.id, email: to, subject, body }, `send:${l.id}`)}>{sending ? <><Spinner />Sending…</> : 'Send pitch →'}</button>
        </>)
    }

    // ── Other things to do ─────────────────────────────────────────────────
    const k = i.k
    const help = helpOf(k)
    const dom = listingDomain(k).replace(/^www\./, '')
    const dir = DIRECTORIES[dom]
    const side = <Side av={TASK[k.kind][0]} square name={k.title} sub={<Src label={taskLabel(k)} tone={k.kind === 'fix' ? 'red' : undefined} />} why={k.detail} whyLabel="Why this matters" />
    const steps = help === 'describe' ? ['New wording', 'Put it on your site'] : help === 'directory' ? ['Get listed', 'Ask for reviews'] : ['Do it']
    const flow = (at: number, title: string, hint: React.ReactNode, content: React.ReactNode, actions: React.ReactNode) =>
      <Flow back={back} crumb={k.title} side={side} steps={steps} at={at} title={title} hint={hint} actions={actions} stepKey={`${i.key}:${at}:${k.status}`}>{content}</Flow>
    const done = (msg: string) => { call('task', { key: k.key, status: 'done' }, `task:${i.key}`); notify(msg) }
    const skipBtn = <button key="skip" type="button" className="btn btn-ghost ro-back" onClick={() => skip(i)}>Skip</button>

    if (k.status !== 'open') {
      return flow(steps.length + 1, '', null, k.status === 'done'
        ? <Finished title="Done" text={help === 'describe' ? 'The next research checks how ChatGPT describes you now.' : 'Nice. It helps AI assistants and Google find you.'} />
        : <Finished grey title="Skipped" text="You skipped this one. Bring it back if you change your mind." />, <>
        {backBtn}
        <button key="r" type="button" className="btn cl-btn-outline" onClick={() => call('task', { key: k.key, status: 'open' }, `task:${i.key}`)}>Bring it back</button>
        {nextBtn}
      </>)
    }

    const copyBox = (label: string, text: string, note?: string) => (
      <div className="tu-copy">
        <div className="tu-copy-hd"><b>{label}</b>{note && <span className="cl-muted">{note}</span>}<button type="button" className="btn btn-ghost btn-sm" onClick={() => copyText(text, `${label} copied`)}>Copy</button></div>
        <p>{text}</p>
      </div>
    )

    if (help === 'describe') {
      const c = k.copy
      if (stepNo === 1) {
        const writing = busy === 'task_copy'
        return flow(1, 'Say what you are, in your own words', <>AI assistants describe you from your own site. Here is wording that says what {brandName} really is.</>,
          writing ? <div className="ro-working"><Spinner /><span>Writing the new wording…</span><i /></div>
          : c ? <>
            {copyBox('Homepage headline', c.headline)}
            {copyBox('Search description', c.meta, `${c.meta.length} characters`)}
            {copyBox('About paragraph', c.about)}
          </> : <button type="button" className="btn cl-btn-outline tu-self" onClick={() => call('task_copy', {}, 'task_copy')}>Write it</button>,
          writing ? null : <>
            {skipBtn}
            {c && <button key="w" type="button" className="btn btn-ghost" onClick={() => call('task_copy', {}, 'task_copy')}>↻ Rewrite</button>}
            <button key="n" type="button" className="btn btn-primary" disabled={!c} onClick={() => setStepNo(2)}>Next: where to put it →</button>
          </>)
      }
      return flow(2, 'Put it on your site', 'Four places, a few minutes each. AI assistants pick up the change over the next few weeks.',
        <ol className="tu-steps-list">
          <li><b>Homepage headline</b>The big line at the top of your homepage.</li>
          <li><b>Search description</b>In your site builder&apos;s SEO settings for the homepage (Webflow, Wix, Shopify and WordPress all have one).</li>
          <li><b>About page</b>Make the About paragraph its first lines.</li>
          <li><b>Your social bios</b>Instagram, LinkedIn and X: the same one-line description.</li>
        </ol>,
        <>
          <button key="b" type="button" className="btn btn-ghost ro-back" onClick={() => setStepNo(1)}>← Back</button>
          <button key="d" type="button" className="btn btn-primary" disabled={!!busy} onClick={() => done('Marked as done. The next research checks it.')}>I’ve updated my site</button>
        </>)
    }

    if (help === 'directory') {
      const name = dir?.name ?? dom
      if (stepNo === 1) {
        return flow(1, `List ${brandName} on ${name}`, 'It’s free. AI assistants read these sites when people ask which tool to use.',
          <>
            <a className="btn btn-primary tu-self" href={dir?.add ?? `https://${dom}`} target="_blank" rel="noopener noreferrer">Open {name}{dir?.add ? '’s sign-up' : ''} ↗</a>
            <ol className="tu-steps-list">
              <li><b>Create a free vendor account</b>{dir?.add ? 'The link above goes straight to it.' : `On ${name}, look for “List your product” or “For vendors”.`}</li>
              <li><b>Add {brandName}</b>Name, website, category, and a short description that says what it is.</li>
              <li><b>Add screenshots and your logo</b>Listings with pictures get more clicks and more reviews.</li>
            </ol>
            {data.tasks.find(t => t.key === 'fix:description')?.copy && copyBox('A description you can use', data.tasks.find(t => t.key === 'fix:description')!.copy!.about)}
          </>,
          <>
            {skipBtn}
            <button key="n" type="button" className="btn btn-primary" onClick={() => setStepNo(2)}>I’ve listed it →</button>
          </>)
      }
      const ask = `Hi,\n\nThanks for using ${brandName}. Would you leave a short review on ${name}? It takes two minutes and helps other people find us.\n\n${reviewUrl.trim() || `[your ${name} listing link]`}\n\nThank you,\n${brandName}`
      return flow(2, 'Ask a few happy customers for a review', `A listing with reviews shows up far more. Send this to 3–5 customers who like ${brandName}.`,
        <>
          <form className="ro-field" onSubmit={e => e.preventDefault()}>
            <label htmlFor="tu-review-url">Your {name} listing link</label>
            <input id="tu-review-url" value={reviewUrl} onChange={e => setReviewUrl(e.target.value)} placeholder={`https://${dom}/products/…`} />
          </form>
          {copyBox('Email to customers', ask)}
        </>,
        <>
          <button key="b" type="button" className="btn btn-ghost ro-back" onClick={() => setStepNo(1)}>← Back</button>
          <button key="d" type="button" className="btn btn-primary" disabled={!!busy} onClick={() => done(`Done. ${name} is on your list.`)}>Done</button>
        </>)
    }

    // Reddit threads, and anything else: what to do, and done
    return flow(1, help === 'reddit' ? 'Join the threads AI answers cite' : k.title,
      help === 'reddit' ? 'Answer helpfully where people already ask. Say you make it, keep it short.' : k.detail,
      <div className="tu-stack">
        {k.url && <a className="btn cl-btn-outline tu-self" href={k.url} target="_blank" rel="noopener noreferrer">{help === 'reddit' ? 'Open the threads ↗' : 'Open the page ↗'}</a>}
        {help === 'reddit' && <p className="cl-muted">The Lead Agent&apos;s Community tab finds posts like these every day and drafts a reply for each. <a className="th-link" href="/agents/leads">Open the Lead Agent →</a></p>}
      </div>,
      <>
        {skipBtn}
        <button key="d" type="button" className="btn btn-primary" disabled={!!busy} onClick={() => done('Marked as done')}>Mark as done</button>
      </>)
  }

  // ── Rankings and AI answers ────────────────────────────────────────────────

  const change = new Map(data.rankChanges.map(c => [c.keyword, c]))
  const rankRows = useShowAll(data.ranks?.rows.slice(0, 30) ?? [], tab)
  const [ideaQ, setIdeaQ] = useState('')
  const ideaAll = data.ideas?.rows ?? []
  const ideaNeedle = ideaQ.trim().toLowerCase()
  const ideaShown = ideaAll.filter(r => !ideaNeedle || r.keyword.includes(ideaNeedle))
  const ideaRows = useShowAll(ideaShown, [tab, ideaNeedle])
  const keywords = (
    <>
      <Sec label="Keyword ideas" count={ideaAll.length} />
      {ideaAll.length > 8 && <ListTools q={ideaQ} setQ={setIdeaQ} shown={ideaShown.length} total={ideaAll.length} onClear={() => setIdeaQ('')} />}
      {ideaShown.length > 0 ? (
        <div className="tu-tbl">
          <table>
            <thead><tr><th>Keyword</th><th>Searches</th><th>Difficulty</th><th>Why</th><th /></tr></thead>
            <tbody>
              {ideaRows.items.map(r => (
                <tr key={r.keyword}>
                  <td><b>{r.keyword}</b></td>
                  <td className="tu-num">{r.volume.toLocaleString('en-US')}</td>
                  <td className="tu-num">{r.difficulty ?? '—'}</td>
                  <td className="tu-faint">{VERDICT[r.verdict]}</td>
                  <td>{r.verdict === 'picked' ? null
                    : <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy}
                        onClick={async () => { const j = await call('idea', { keyword: r.keyword }, `idea:${r.keyword}`); if (j && !j.error) notify('Added to your to-do') }}>
                        {busy === `idea:${r.keyword}` ? <Spinner /> : 'Write about this'}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="tu-empty">{ideaAll.length ? 'No keyword matches that search.' : 'Shown after the next research.'}</div>}
      {ideaRows.toggle}
      {data.ideas && <p className="cl-muted tu-note">From the research on <Day iso={data.ideas.at} />. Searches a month in {COUNTRIES.find(([c]) => c === s.country)?.[1] ?? s.country}; difficulty 0-100.</p>}

      <Sec label="Where you rank now" count={data.ranks?.rows.length ?? 0} />
      {data.ranks && data.ranks.rows.length > 0 ? (
        <div className="tu-tbl">
          <table>
            <thead><tr><th>Keyword</th><th>Your rank</th><th>Since last week</th><th>Searches</th><th>Page</th></tr></thead>
            <tbody>
              {rankRows.items.map(r => {
                const c = change.get(r.keyword)
                const moved = c && c.before !== null && c.now !== null ? c.before - c.now : null
                return (
                  <tr key={r.keyword}>
                    <td><b>{r.keyword}</b></td>
                    <td className="tu-num">#{r.rank}</td>
                    <td className={moved ? (moved > 0 ? 'tu-up' : 'tu-down') : undefined}>{moved ? `${moved > 0 ? '▲' : '▼'} ${Math.abs(moved)}` : c && c.before === null ? 'New' : '—'}</td>
                    <td className="tu-num">{r.volume.toLocaleString('en-US')}</td>
                    <td className="tu-faint">{r.url.replace(/^https?:\/\/(www\.)?/, '')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : <div className="tu-empty">{data.ranks ? 'Google doesn’t show your site for any tracked searches yet. Posts you publish show up here.' : 'Shown after the first research.'}</div>}
      {rankRows.toggle}
      <p className="cl-muted tu-note">{data.ranks ? <>Checked <Day iso={data.ranks.at} />{s.enabled ? ', and every Monday' : ''}.</> : null}</p>
      {data.adsTips.length > 0 && <>
        <Sec label="Google Ads tips" count={data.adsTips.length} />
        {!flags.googleAds && !demo && <p className="cl-muted tu-note">Connect Google Ads in Settings → Integrations to also see wasted spend.</p>}
        {data.adsTips.map(t => (
          <Card key={t.title} av="$" square name={t.title} sub={<Src label={t.kind === 'wasted' ? 'Wasted spend' : 'Try ads instead'} tone="amber" />} why={t.detail} />
        ))}
      </>}
    </>
  )

  const all = (data.answers?.items ?? []).filter(a => !a.error)
  const answers = all.filter(a => a.engine !== 'google_ai')
  const overviews = all.filter(a => a.engine === 'google_ai')
  const questions = [...new Set(answers.map(a => a.question))]
  const qRows = useShowAll(questions, tab)
  const engines = ['chat_gpt', 'perplexity', 'gemini'].filter(e => answers.some(a => a.engine === e))
  // One week is noisy (answers change from one ask to the next): the headline is the 4-week average
  const last4 = data.mentionHistory.slice(-4)
  const asked4 = last4.reduce((t, h) => t + h.asked, 0)
  const avg = asked4 ? Math.round((100 * last4.reduce((t, h) => t + h.mentioned, 0)) / asked4) : null
  // The steadier, more useful part: which sites AI answers keep citing when they leave the brand out
  const cited = new Map<string, { n: number; url: string; title: string }>()
  for (const a of all.filter(x => !x.mentioned)) {
    for (const c of a.citations) {
      if (!c.domain || /(^|\.)google\.|vertexaisearch/.test(c.domain)) continue
      const cur = cited.get(c.domain) ?? { n: 0, url: c.url, title: c.title }
      cur.n += 1
      cited.set(c.domain, cur)
    }
  }
  const topCited = [...cited.entries()].sort((x, y) => y[1].n - x[1].n).slice(0, 8)
  const cell = (a: AiAnswer | undefined) => {
    if (!a) return '—'
    const hits = a.hits ?? (a.mentioned ? 1 : 0), n = a.samples ?? 1
    const label = n > 1 ? `${hits} of ${n}` : a.mentioned ? 'Names you' : 'Not yet'
    return <span title={a.brands.length ? `Named: ${a.brands.join(', ')}` : 'No tracked brand named'}><Tag tone={hits && a.mentioned ? 'ok' : undefined}>{label}{a.mentioned && a.position ? ` · #${a.position}` : ''}</Tag></span>
  }
  const aiTab = all.length ? (
    <>
      <p className="tu-lead">
        <b>{avg !== null ? `${brandName} is named in ${avg}% of AI answers` : `${brandName} AI answers`}</b>{' '}
        <span className="cl-muted">· {last4.length > 1 ? `${last4.length}-week average` : 'first week, the average builds up weekly'} · asked <Day iso={data.answers?.at} /></span>
      </p>
      {topCited.length > 0 && <>
        <Sec label="Sites AI answers cite when they leave you out" count={topCited.length} />
        <p className="cl-muted tu-note">These change less from week to week than who gets named. Getting mentioned on them is the surest way into the answers.</p>
        <div className="tu-tbl">
          <table>
            <thead><tr><th>Site</th><th>Cited</th><th>Example page</th></tr></thead>
            <tbody>
              {topCited.map(([dom, c]) => (
                <tr key={dom}>
                  <td><b>{dom}</b></td>
                  <td className="tu-num">{c.n}×</td>
                  <td className="tu-faint"><a className="th-link" href={c.url} target="_blank" rel="noopener noreferrer">{(c.title || c.url).slice(0, 70)}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}
      {data.description && (
        <div className={`ag-note ${data.description.issue ? 'ag-note-warn' : ''}`}>
          <b>How ChatGPT describes {brandName}:</b> {data.description.text || '(nothing)'}{data.description.issue ? <><br /><b>Problem:</b> {data.description.issue}</> : null}
        </div>
      )}
      {questions.length > 0 && <>
        <Sec label="Questions buyers ask" count={questions.length} />
        <p className="cl-muted tu-note">Each question is asked more than once, because answers change: “1 of 2” means one of two answers named you.</p>
        <div className="tu-tbl">
          <table>
            <thead><tr><th>Question</th>{engines.map(e => <th key={e}>{ENGINE[e]}</th>)}</tr></thead>
            <tbody>
              {qRows.items.map(qq => (
                <tr key={qq}>
                  <td>{qq}</td>
                  {engines.map(e => <td key={e}>{cell(answers.find(x => x.question === qq && x.engine === e))}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {qRows.toggle}
      </>}
      {overviews.length > 0 && <>
        <Sec label="Google AI Overviews" count={overviews.length} />
        <p className="cl-muted tu-note">The AI answer Google shows above the results, for your main searches.</p>
        <div className="tu-tbl">
          <table>
            <thead><tr><th>Search</th><th>Names you?</th><th>Brands named</th></tr></thead>
            <tbody>
              {overviews.map(o => (
                <tr key={o.question}>
                  <td><b>{o.question}</b></td>
                  <td>{o.mentioned ? <Tag tone="ok">Yes</Tag> : <Tag>Not yet</Tag>}</td>
                  <td className="tu-faint">{o.brands.join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}
    </>
  ) : <div className="tu-empty">Shown after the first research.</div>

  // ── Page ───────────────────────────────────────────────────────────────────

  const country = COUNTRIES.find(([c]) => c === s.country)?.[1] ?? s.country
  const seeds = s.seeds.slice(0, 2)
  const hot = todo.some(i => sectionOf(i) === 'replied')

  return (
    <div className="tool-page">
      <ToolHeader icon="search" title="Search Agent" intro="searchAgent"
        chips={s.enabled && !demo ? <span className="th-chip th-chip--on">Researches every week</span> : null}
        actions={<DemoSwitch on={demo} forced={flags.demoForced} busy={!!busy} onChange={async on => {
          const r = await call('demo', { on }) as { demo?: boolean; data?: SearchAgentData } | null
          if (typeof r?.demo !== 'boolean') return
          setDemo(r.demo); setOpenKey(null); setTab('todo')
          // Never run in this mode yet (first time in demo): the first-visit search above starts it
        }} />} />
      {open ? detail(open) : <>
        {demo && <DemoBanner>Run research again any time: rankings shift a little each run, so &ldquo;since last week&rdquo; has something to show.</DemoBanner>}
        {!dataReady && <div className="ag-note ag-note-warn">The Search Agent needs GrowJin&apos;s DataForSEO account, which isn&apos;t set up yet. Settings can be saved now; research starts once it&apos;s connected.</div>}
        {data.lastError && !running && <div className="ag-note ag-note-crit">The last research had a problem: {data.lastError}</div>}
        {data.linksError && !running && <div className="ag-note ag-note-warn">Finding sites to pitch had a problem: {data.linksError}</div>}

        {panel && <Settings initial={s} saving={busy === 'settings'} onCancel={() => setPanel(false)}
          onSave={async next => { const r = await call('settings', { settings: next }); if (r?.data) { setPanel(false); notify('Saved') } }} />}
        <ActionBar
          status={researching ? (data.lastResearchAt ? 'Researching…' : 'Running your first research…') : busy === 'links' ? 'Finding sites to pitch…' : data.lastResearchAt ? `Researched ${fmtAgo(data.lastResearchAt)}${s.enabled ? ' · next on Monday' : ''}` : 'Not researched yet'}
          setup={seeds.length ? <>Tracking {seeds.map((x, n) => <span key={x}>{n ? ' and ' : ''}<b>{x}</b></span>)}{s.seeds.length > 2 ? ` and ${s.seeds.length - 2} more` : ''} in {country}</> : <>Keywords are picked from your site · {country}</>}
          onChange={() => setPanel(p => !p)}
          secondary={<button type="button" className="btn btn-ghost" aria-expanded={panel} onClick={() => setPanel(p => !p)}>Search settings</button>}
          primary={<button type="button" className="btn btn-primary" disabled={!!busy || !dataReady} onClick={() => { setPanel(false); call('research') }}>{researching ? <><Spinner />Working…</> : 'Run research now'}</button>} />
        <LiveProgress agent="search" active={running || writing} fallback={writing ? ['Checking top results', 'Reading them', 'Writing the article', 'Saving the draft'] : PROGRESS} />

        <Tabs value={tab} onChange={k => { setTab(k); setQ('') }} tabs={[
          { key: 'todo', label: 'To do', count: todo.length, hot },
          { key: 'done', label: 'Done', count: done.length },
          { key: 'rank', label: 'Keywords' },
          { key: 'ai', label: 'AI answers' },
        ]} />
        {tab === 'todo' && list(todo, true)}
        {tab === 'done' && list(done, false)}
        {tab === 'rank' && keywords}
        {tab === 'ai' && aiTab}
      </>}
      {toast}
    </div>
  )
}
