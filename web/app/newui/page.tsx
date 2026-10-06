'use client'

import { useState } from 'react'

type Item = { label: string; note: string; done: boolean }
type Cat = { name: string; open?: boolean; items: Item[] }
type Mod = {
  id: number
  name: string
  railLabel: string
  sub: string
  score: number
  desc: string
  unlockNext: string
  cats: Cat[]
}

const MODULES: Mod[] = [
  {
    id: 1, name: 'Foundation', railLabel: 'Foundation', sub: 'Always unlocked', score: 62,
    desc: 'Site basics — HTTPS, analytics, trust signals and email setup. Always unlocked, no prerequisites.',
    unlockNext: 'Website Audit',
    cats: [
      { name: 'Technical', open: true, items: [
        { label: 'HTTPS / SSL active', note: 'Valid certificate, auto-renews', done: true },
        { label: 'Mobile viewport tag present', note: 'Found in <head>', done: true },
        { label: 'GA4 or GTM detected on homepage', note: 'gtag.js found', done: true },
        { label: 'No noindex tag found', note: 'Homepage is indexable', done: false },
      ] },
      { name: 'Analytics & Search', items: [
        { label: 'Google Search Console verified', note: 'Meta tag present', done: true },
        { label: 'PostHog installed', note: 'Not detected on homepage', done: false },
      ] },
      { name: 'Trust & Conversion', items: [
        { label: 'Privacy policy link in footer', note: 'Linked from footer', done: true },
        { label: 'Contact information visible', note: 'No contact page or email found', done: false },
        { label: 'Favicon present', note: '32×32 favicon.svg found', done: true },
      ] },
      { name: 'Email Setup', items: [
        { label: 'SPF record configured', note: 'v=spf1 include:_spf.google.com found', done: true },
        { label: 'DKIM signing enabled', note: 'No DKIM selector found for google._domainkey', done: false },
        { label: 'DMARC policy published', note: 'p=none — monitoring only', done: true },
        { label: 'Email signup form on site', note: 'No newsletter or waitlist form detected', done: false },
      ] },
    ],
  },
  {
    id: 2, name: 'Website Audit', railLabel: 'Website Audit', sub: 'Unlocked — Foundation ≥ 70%', score: 34,
    desc: 'UX, navigation, speed, and mobile friendliness. Unlocked because Foundation reached 80%.',
    unlockNext: 'SEO',
    cats: [
      { name: 'UX & UI', open: true, items: [
        { label: 'Title tag length (30–60 chars)', note: 'Currently 71 characters — too long', done: false },
        { label: 'Exactly one H1 per page', note: 'Found 1 H1', done: true },
        { label: 'Viewport meta tag present', note: 'Found in <head>', done: true },
      ] },
      { name: 'Navigation & Structure', items: [
        { label: 'Nav landmark present', note: '<nav> element found', done: true },
        { label: 'Descriptive anchor text', note: '4 links use "click here"', done: false },
      ] },
      { name: 'Page Speed', items: [
        { label: 'Server response time < 200ms', note: 'Currently 340ms TTFB', done: false },
        { label: 'Images have width/height attributes', note: '12 of 18 images missing', done: false },
      ] },
    ],
  },
]

const LOCKED_LABELS = ['SEO', 'GEO', 'Social Media', 'Brand & Content', 'Competitors', 'Audience']
const TOTAL_STEPS = MODULES.length + LOCKED_LABELS.length
const UNLOCK_AT = 80

const TODAY_ROWS = [
  { num: 1, name: 'Foundation', sub: 'Always unlocked', score: '62%', open: true, locked: false, items: ['HTTPS / SSL active', 'GA4 or GTM detected on homepage', 'Privacy policy link found in footer', 'Mobile viewport tag present'] },
  { num: 2, name: 'Website Audit', sub: 'Unlocked — Foundation ≥ 70%', score: '34%', open: false, locked: false, items: ['Title tag length check', 'Nav landmark present', 'Server response time'] },
  { num: 3, name: 'SEO Audit', sub: 'Locked — unlocks at Website Audit 80%', score: 'Locked', open: false, locked: true, items: [] },
  { num: 4, name: 'GEO Audit', sub: 'Locked', score: 'Locked', open: false, locked: true, items: [] },
  { num: 5, name: 'Social Media Audit', sub: 'Locked', score: 'Locked', open: false, locked: true, items: [] },
]

function stepInfo(num: number): { label: string; data: Mod | null } | null {
  if (num < 1 || num > TOTAL_STEPS) return null
  if (num <= MODULES.length) return { label: MODULES[num - 1].railLabel, data: MODULES[num - 1] }
  return { label: LOCKED_LABELS[num - MODULES.length - 1], data: null }
}

function LockIcon({ size, color = 'var(--text-faint)', stroke = 2 }: { size: number; color?: string; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke={color} strokeWidth={stroke} />
      <path d="M8,11 V8 a4,4 0 0 1 8,0 V11" fill="none" stroke={color} strokeWidth={stroke} />
    </svg>
  )
}

function Check({ size, stroke }: { size: number; stroke: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <polyline points="4,13 9,18 20,6" fill="none" stroke="#ffffff" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Chevron({ dir, size, color = 'var(--text-faint)' }: { dir: 'left' | 'right' | 'down'; size: number; color?: string }) {
  const points = dir === 'left' ? '15,6 9,12 15,18' : dir === 'right' ? '9,6 15,12 9,18' : '6,9 12,15 18,9'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <polyline points={points} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Ring({ score }: { score: number }) {
  const C = 2 * Math.PI * 40
  return (
    <svg width="68" height="68" viewBox="0 0 92 92">
      <circle cx="46" cy="46" r="40" fill="none" stroke="var(--line)" strokeWidth="8" />
      <circle cx="46" cy="46" r="40" fill="none" stroke="var(--green)" strokeWidth="8" strokeLinecap="round"
        strokeDasharray={`${C} ${C}`} strokeDashoffset={C * (1 - score / 100)} />
    </svg>
  )
}

export default function NewUIPage() {
  const [mode, setMode] = useState<'proposed' | 'today'>('proposed')
  const [currentStep, setCurrentStep] = useState(1)
  const [openCatByStep, setOpenCatByStep] = useState<Record<number, number>>({})
  const [toast, setToast] = useState<string | null>(null)
  const [todayOpen, setTodayOpen] = useState<Record<number, boolean>>(
    () => Object.fromEntries(TODAY_ROWS.map(r => [r.num, r.open])),
  )

  const info = stepInfo(currentStep)!
  const canAdvance = !!info.data && info.data.score >= UNLOCK_AT

  function goTo(n: number) {
    setCurrentStep(n)
    setToast(null)
  }
  function goPrev() {
    if (currentStep > 1) goTo(currentStep - 1)
  }
  function goNext() {
    if (canAdvance && currentStep < TOTAL_STEPS) goTo(currentStep + 1)
    else {
      const nxt = stepInfo(currentStep + 1)
      setToast(`Reach ${UNLOCK_AT}% on "${info.label}" to unlock ${nxt ? nxt.label : 'the next module'}`)
    }
  }

  const mod = info.data
  const openIdx = mod ? (openCatByStep[mod.id] ?? mod.cats.findIndex(c => c.open)) : -1

  return (
    <div className="nu-root">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <header className="nu-header">
        <div className="nu-logo"><div className="nu-mark" />GrowJin</div>
        <div className="nu-header-right">
        <a className="nu-tools-link" href="/tools">Tools</a>
        <div className="nu-mode-toggle">
          <button className={mode === 'proposed' ? 'active' : ''} onClick={() => setMode('proposed')}>Proposed</button>
          <button className={mode === 'today' ? 'active' : ''} onClick={() => setMode('today')}>Today</button>
        </div>
        </div>
      </header>

      {mode === 'proposed' ? (
        <div>
          <div className="nu-rail-outer">
            <div className="nu-rail">
              <div className="nu-rail-line" />
              <div className="nu-rail-progress" style={{ width: `${((currentStep - 1) / (TOTAL_STEPS - 1)) * 100}%` }} />
              <div className="nu-rail-steps">
                {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map(n => {
                  const s = stepInfo(n)!
                  const isDone = n < currentStep
                  const isCurrent = n === currentStep
                  const isLocked = n > currentStep
                  return (
                    <button
                      key={n}
                      className={`nu-step${isLocked ? ' locked' : ''}`}
                      aria-disabled={isLocked}
                      onClick={() =>
                        isLocked
                          ? setToast(`Reach ${UNLOCK_AT}% on "${stepInfo(n - 1)!.label}" to unlock ${s.label}`)
                          : goTo(n)
                      }
                    >
                      <div
                        className="nu-dot"
                        style={{
                          background: isDone ? 'var(--green)' : isCurrent ? 'var(--card)' : 'var(--bg-soft)',
                          border: isDone || isCurrent ? '2px solid var(--green)' : '1px solid var(--line)',
                          color: 'var(--green)',
                        }}
                      >
                        {isDone ? <Check size={14} stroke={3} /> : isLocked ? <LockIcon size={12} /> : n}
                      </div>
                      <div
                        className="nu-lbl"
                        style={{
                          color: isCurrent ? 'var(--text)' : isDone ? 'var(--text-dim)' : 'var(--text-faint)',
                          fontWeight: isCurrent ? 600 : 400,
                        }}
                      >
                        {s.label}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <main className="nu-main">
            <div className="nu-plan">
              <div className="nu-plan-main">
                <div className="nu-plan-tag">Your Plan</div>
                <div className="nu-plan-stage">Early traction · 10–100 users</div>
                <div className="nu-plan-focus">Focus this week: personal outreach to 20 prospects and fix the gaps below.</div>
              </div>
              <a className="nu-plan-btn" href="#">View plan</a>
            </div>
            <p className="nu-eyebrow">Step {currentStep} of {TOTAL_STEPS}</p>
            {!mod ? (
              <div className="nu-locked-panel">
                <LockIcon size={34} />
                <div className="t">{info.label} is locked</div>
                <div>Reach {UNLOCK_AT}% on the previous module to unlock it.</div>
              </div>
            ) : (
              <>
                <div className="nu-mod-head">
                  <h1 className="nu-display">{mod.name}</h1>
                  <div className="nu-mod-actions">
                    <button className="nu-reanalyse">Re-analyse</button>
                    <div className="nu-ring-wrap">
                      <Ring score={mod.score} />
                      <div className="nu-ring-pct">{mod.score}%</div>
                    </div>
                  </div>
                </div>
                <p className="nu-mod-desc">{mod.desc}</p>
                <div className="nu-unlock-bar">
                  <div className="row">
                    <span>Reach <b>{UNLOCK_AT}%</b> to unlock {mod.unlockNext}</span>
                    <b>{mod.score}% / {UNLOCK_AT}%</b>
                  </div>
                  <div className="nu-track">
                    <div className="fill" style={{ width: `${mod.score}%` }} />
                    <div className="marker" style={{ left: `${UNLOCK_AT}%` }} />
                  </div>
                </div>
                {mod.cats.map((cat, i) => {
                  const isOpen = i === openIdx
                  const doneCount = cat.items.filter(it => it.done).length
                  return (
                    <div key={cat.name} className={`nu-cat${isOpen ? ' open' : ''}`}>
                      <button
                        className="nu-cat-head"
                        onClick={() => setOpenCatByStep(prev => ({ ...prev, [mod.id]: openIdx === i ? -1 : i }))}
                      >
                        <div className="name">{cat.name}</div>
                        <div className="count">{doneCount}/{cat.items.length}</div>
                        <Chevron dir="down" size={14} />
                      </button>
                      {isOpen && (
                        <div className="nu-cat-body">
                          {cat.items.map(it => (
                            <div key={it.label} className="nu-item">
                              <div className={`box${it.done ? ' done' : ''}`}>{it.done && <Check size={9} stroke={4} />}</div>
                              <div>
                                <div className="label">{it.label}</div>
                                <div className="note">{it.note}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </>
            )}
          </main>

          <button className="nu-arrow prev" aria-label="Previous module" disabled={currentStep === 1} onClick={goPrev}>
            <Chevron dir="left" size={17} color="var(--text-dim)" />
          </button>
          <button className="nu-arrow next" aria-label="Next module" onClick={goNext}>
            <Chevron dir="right" size={17} color="var(--text-dim)" />
            {!canAdvance && (
              <span className="nu-lock-badge"><LockIcon size={8} color="var(--gold)" stroke={2.6} /></span>
            )}
          </button>

          <div className="nu-bottombar">
            <button disabled={currentStep === 1} onClick={goPrev}>
              <Chevron dir="left" size={13} color="currentColor" />
              Prev
            </button>
            <div className="divider" />
            <button onClick={goNext}>Next</button>
          </div>

          <div className={`nu-toast${toast ? ' show' : ''}`}>
            <span>{toast}</span>
            <button onClick={() => setToast(null)} aria-label="Dismiss">✕</button>
          </div>
        </div>
      ) : (
        <div className="nu-today">
          <h1 className="nu-display">Your growth modules</h1>
          <p className="sub">All 16 modules live on this one page today. Click a row to expand it — scroll keeps going past locked modules below.</p>
          {TODAY_ROWS.map(r => {
            const open = todayOpen[r.num]
            return (
              <div key={r.num} className={`nu-trow${open ? ' open' : ''}${r.locked ? ' locked' : ''}`}>
                <button className="nu-trow-head" onClick={() => setTodayOpen(prev => ({ ...prev, [r.num]: !prev[r.num] }))}>
                  <div className="num">{r.num}</div>
                  <div className="main">
                    <div className="name">{r.name}</div>
                    <div className="sub">{r.sub}</div>
                  </div>
                  <div className="score">{r.score}</div>
                  <Chevron dir="down" size={15} />
                </button>
                {open && (
                  <div className="nu-trow-body">
                    {r.items.map(i => (
                      <div key={i} className="line"><div className="chk" />{i}</div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          <div className="nu-more-note">↓ 11 more modules continue below, same pattern ↓</div>
        </div>
      )}
    </div>
  )
}

const CSS = `
.nu-root{
  min-height:100vh; background:var(--bg); color:var(--text);
  font-family:var(--font-body),-apple-system,sans-serif; -webkit-font-smoothing:antialiased;
}
.nu-root *{box-sizing:border-box;}
.nu-root button{font-family:inherit;}
.nu-display{font-family:var(--font-display),serif;}

/* header — fixed dark brand anchor */
.nu-header{
  display:flex; align-items:center; justify-content:space-between;
  padding:18px 32px; background:#0d2218; gap:16px; flex-wrap:wrap;
}
.nu-logo{display:flex; align-items:center; gap:10px; font-weight:700; font-size:19px; letter-spacing:-.3px; color:#ffffff;}
.nu-mark{width:28px; height:28px; border-radius:8px; background:#4ade80; flex-shrink:0;}
.nu-header-right{display:flex; align-items:center; gap:14px;}
.nu-tools-link{color:#6ee7b7; font-size:13px; font-weight:600; text-decoration:none;}
.nu-tools-link:hover{color:#ffffff;}
.nu-mode-toggle{display:flex; gap:2px; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.12); border-radius:9px; padding:3px;}
.nu-mode-toggle button{
  padding:7px 14px; border:none; background:transparent; color:#6ee7b7;
  font-size:12.5px; font-weight:600; border-radius:7px; cursor:pointer; transition:background .15s, color .15s;
}
.nu-mode-toggle button.active{background:rgba(255,255,255,.14); color:#ffffff;}

/* stepper rail */
.nu-rail-outer{padding:22px 0 18px; border-bottom:1px solid var(--line); background:var(--card); overflow-x:auto;}
.nu-rail-outer::-webkit-scrollbar{height:0;}
.nu-rail{position:relative; max-width:960px; margin:0 auto; padding:0 40px; min-width:640px;}
.nu-rail-line{position:absolute; top:17px; left:40px; right:40px; height:2px; background:var(--line);}
.nu-rail-progress{position:absolute; top:17px; left:40px; height:2px; background:var(--green); transition:width .2s;}
.nu-rail-steps{position:relative; display:flex; justify-content:space-between;}
.nu-step{display:flex; flex-direction:column; align-items:center; gap:6px; width:80px; background:transparent; border:none; cursor:pointer; padding:0;}
.nu-step.locked{cursor:default;}
.nu-dot{
  width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center;
  flex-shrink:0; font-size:12px; font-weight:700; transition:background .15s, border-color .15s;
}
.nu-lbl{font-size:11px; text-align:center; line-height:1.25; transition:color .15s;}

/* pinned plan card */
.nu-plan{display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:28px; padding:14px 18px; border:1px solid var(--line); border-left:3px solid var(--green); border-radius:10px; background:var(--card);}
.nu-plan-main{min-width:0;}
.nu-plan-tag{font-size:10.5px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--green);}
.nu-plan-stage{font-size:14px; font-weight:600; color:var(--text); margin-top:3px;}
.nu-plan-focus{font-size:12.5px; color:var(--text-dim); margin-top:3px; line-height:1.5;}
.nu-plan-btn{flex-shrink:0; padding:7px 13px; border-radius:8px; background:var(--accent); color:var(--accent-foreground); font-size:12.5px; font-weight:600; text-decoration:none;}
.nu-plan-btn:hover{box-shadow:0 2px 12px var(--green-glow);}

/* main */
.nu-main{max-width:720px; width:100%; margin:0 auto; padding:36px 24px 120px; position:relative;}
.nu-eyebrow{font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--text-faint); margin:0 0 6px;}
.nu-mod-head{display:flex; align-items:center; justify-content:space-between; gap:20px; flex-wrap:wrap; margin-bottom:6px;}
.nu-mod-head h1{font-size:28px; margin:0; color:var(--text);}
.nu-mod-actions{display:flex; align-items:center; gap:16px;}
.nu-reanalyse{padding:8px 15px; border-radius:8px; border:1px solid var(--line); background:var(--card); color:var(--text); font-size:13px; font-weight:600; cursor:pointer;}
.nu-reanalyse:hover{background:var(--bg-soft); border-color:var(--green);}
.nu-ring-wrap{position:relative; width:68px; height:68px; flex-shrink:0;}
.nu-ring-wrap svg{transform:rotate(-90deg);}
.nu-ring-pct{position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:16px; font-weight:700; color:var(--text);}
.nu-mod-desc{color:var(--text-dim); font-size:14px; line-height:1.6; margin:0 0 22px;}

.nu-unlock-bar{margin-bottom:26px; padding:13px 16px; border:1px solid var(--line); border-radius:10px; background:var(--bg-soft);}
.nu-unlock-bar .row{display:flex; justify-content:space-between; font-size:12px; color:var(--text-dim); margin-bottom:8px;}
.nu-unlock-bar .row b{color:var(--text);}
.nu-track{position:relative; height:6px; border-radius:99px; background:var(--line);}
.nu-track .fill{position:absolute; left:0; top:0; height:6px; border-radius:99px; background:var(--green); transition:width .2s;}
.nu-track .marker{position:absolute; top:-3px; width:2px; height:12px; background:var(--text-faint);}

.nu-cat{margin-bottom:9px; border:1px solid var(--line); border-radius:12px; background:var(--card); overflow:hidden;}
.nu-cat-head{width:100%; display:flex; align-items:center; gap:12px; padding:14px 16px; background:transparent; border:none; cursor:pointer; text-align:left; color:inherit;}
.nu-cat-head .name{flex:1; font-size:14px; font-weight:600; color:var(--text);}
.nu-cat-head .count{font-size:11.5px; color:var(--text-faint);}
.nu-cat-head svg{transition:transform .15s; flex-shrink:0;}
.nu-cat.open .nu-cat-head svg{transform:rotate(180deg);}
.nu-cat-body{padding:0 16px 14px; display:flex; flex-direction:column; gap:11px;}
.nu-item{display:flex; align-items:flex-start; gap:10px;}
.nu-item .box{width:15px; height:15px; border-radius:4px; border:1.5px solid var(--line); flex-shrink:0; margin-top:2px; display:flex; align-items:center; justify-content:center; background:var(--card);}
.nu-item .box.done{border-color:var(--green); background:var(--green);}
.nu-item .label{font-size:13px; color:var(--text);}
.nu-item .note{font-size:11.5px; color:var(--text-faint); margin-top:2px;}

.nu-locked-panel{text-align:center; padding:70px 20px; color:var(--text-faint);}
.nu-locked-panel svg{margin-bottom:14px;}
.nu-locked-panel .t{font-size:15px; color:var(--text-dim); margin-bottom:6px;}

/* carousel nav (desktop) */
.nu-arrow{
  position:fixed; top:50%; transform:translateY(-50%); width:48px; height:48px; border-radius:50%;
  background:var(--card); border:1px solid var(--line); box-shadow:0 2px 8px var(--green-glow); cursor:pointer;
  display:flex; align-items:center; justify-content:center;
}
.nu-arrow:hover:not([disabled]){background:var(--bg-soft); border-color:var(--green);}
.nu-arrow.prev{left:24px;} .nu-arrow.next{right:24px;}
.nu-arrow[disabled]{opacity:.35; cursor:default; box-shadow:none;}
.nu-lock-badge{position:absolute; bottom:-3px; right:-3px; width:17px; height:17px; border-radius:50%; background:var(--bg-soft); border:1px solid var(--gold); display:flex; align-items:center; justify-content:center;}

.nu-toast{
  position:fixed; bottom:28px; left:50%; transform:translateX(-50%); background:var(--card); border:1px solid var(--gold);
  padding:11px 18px; border-radius:10px; font-size:13px; color:var(--gold); display:flex; align-items:center; gap:14px;
  box-shadow:0 12px 28px var(--green-glow); opacity:0; pointer-events:none; transition:opacity .15s; z-index:30;
}
.nu-toast.show{opacity:1; pointer-events:auto;}
.nu-toast button{background:transparent; border:none; color:var(--gold); font-size:15px; cursor:pointer; opacity:.7;}

/* bottom bar (mobile) */
.nu-bottombar{display:none; position:fixed; left:0; right:0; bottom:0; border-top:1px solid var(--line); background:var(--card);}
.nu-bottombar button{flex:1; padding:15px; background:transparent; border:none; color:var(--text-dim); font-size:13px; font-weight:600; display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer;}
.nu-bottombar button[disabled]{color:var(--text-faint); opacity:.5; cursor:default;}
.nu-bottombar .divider{width:1px; background:var(--line);}

@media (max-width: 820px){
  .nu-arrow{display:none;}
  .nu-bottombar{display:flex;}
  .nu-main{padding-bottom:90px;}
  .nu-toast{bottom:72px;}
}

/* "Today" accordion view */
.nu-today{max-width:880px; margin:0 auto; padding:40px 24px 100px;}
.nu-today h1{font-size:26px; margin:0 0 6px; color:var(--text);}
.nu-today > .sub{color:var(--text-dim); font-size:14px; margin:0 0 28px; line-height:1.6;}
.nu-trow{margin-bottom:10px; border:1px solid var(--line); border-radius:12px; background:var(--card); overflow:hidden;}
.nu-trow.open{border-color:var(--green);}
.nu-trow-head{width:100%; display:flex; align-items:center; gap:14px; padding:16px 18px; background:transparent; border:none; cursor:pointer; text-align:left; color:inherit;}
.nu-trow-head .num{width:26px; height:26px; border-radius:50%; background:var(--accent); color:var(--accent-foreground); display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; flex-shrink:0;}
.nu-trow.locked{opacity:.55;}
.nu-trow.locked .num{background:var(--bg-soft); color:var(--text-faint);}
.nu-trow-head .main{flex:1; min-width:0;}
.nu-trow-head .name{font-size:15px; font-weight:600; color:var(--text);}
.nu-trow-head .sub{font-size:12px; color:var(--text-faint); margin-top:2px;}
.nu-trow-head .score{font-size:13px; font-weight:600; color:var(--text-dim);}
.nu-trow-head svg{transition:transform .15s; flex-shrink:0;}
.nu-trow.open .nu-trow-head svg{transform:rotate(180deg);}
.nu-trow-body{display:flex; padding:0 18px 16px 58px; flex-direction:column; gap:9px;}
.nu-trow-body .line{font-size:12.5px; color:var(--text-dim); display:flex; gap:9px; align-items:flex-start;}
.nu-trow-body .chk{width:14px; height:14px; border-radius:4px; border:1.5px solid var(--line); flex-shrink:0; margin-top:1px;}
.nu-more-note{margin-top:26px; padding:13px 18px; border:1px dashed var(--line); border-radius:12px; font-size:12px; color:var(--text-faint); text-align:center;}
`
