'use client'

import { useState } from 'react'

interface ChecklistItem {
  label: string
  note: string
  done: boolean
}

interface Category {
  name: string
  items: ChecklistItem[]
}

interface ModuleData {
  id: number
  name: string
  sub: string
  score: number
  desc: string
  unlockNext: string
  cats: Category[]
}

const MODULES: ModuleData[] = [
  {
    id: 1,
    name: 'Foundation',
    sub: 'Always unlocked',
    score: 62,
    desc: 'Site basics — HTTPS, analytics, trust signals. Always unlocked, no prerequisites.',
    unlockNext: 'Website Audit',
    cats: [
      {
        name: 'Technical',
        items: [
          { label: 'HTTPS / SSL active', note: 'Valid certificate, auto-renews', done: true },
          { label: 'Mobile viewport tag present', note: 'Found in <head>', done: true },
          { label: 'GA4 or GTM detected on homepage', note: 'gtag.js found', done: true },
          { label: 'No noindex tag found', note: 'Homepage is indexable', done: false },
        ],
      },
      {
        name: 'Analytics & Search',
        items: [
          { label: 'Google Search Console verified', note: 'Meta tag present', done: true },
          { label: 'PostHog installed', note: 'Not detected on homepage', done: false },
        ],
      },
      {
        name: 'Trust & Conversion',
        items: [
          { label: 'Privacy policy link in footer', note: 'Linked from footer', done: true },
          { label: 'Contact information visible', note: 'No contact page or email found', done: false },
          { label: 'Favicon present', note: '32×32 favicon.svg found', done: true },
        ],
      },
    ],
  },
  {
    id: 2,
    name: 'Website Audit',
    sub: 'Unlocked — Foundation ≥ 70%',
    score: 34,
    desc: 'UX, navigation, speed, and mobile friendliness. Unlocked because Foundation reached 80%.',
    unlockNext: 'SEO Audit',
    cats: [
      {
        name: 'UX & UI',
        items: [
          { label: 'Title tag length (30–60 chars)', note: 'Currently 71 characters — too long', done: false },
          { label: 'Exactly one H1 per page', note: 'Found 1 H1', done: true },
          { label: 'Viewport meta tag present', note: 'Found in <head>', done: true },
        ],
      },
      {
        name: 'Navigation & Structure',
        items: [
          { label: 'Nav landmark present', note: '<nav> element found', done: true },
          { label: 'Descriptive anchor text', note: '4 links use "click here"', done: false },
        ],
      },
      {
        name: 'Page Speed',
        items: [
          { label: 'Server response time < 200ms', note: 'Currently 340ms TTFB', done: false },
          { label: 'Images have width/height attributes', note: '12 of 18 images missing', done: false },
        ],
      },
    ],
  },
]

const LOCKED_LABELS = [
  'SEO', 'GEO', 'Comp. Gap', 'Social', 'Brand', 'Content', 'Competitors',
  'Outreach', 'Meta Ads', 'Analytics', 'Targets', 'Stage', 'Email', 'Audience',
]
const TOTAL_STEPS = MODULES.length + LOCKED_LABELS.length

const TODAY_ROWS = [
  { num: 1, name: 'Foundation', sub: 'Always unlocked', score: '62%', items: ['HTTPS / SSL active', 'GA4 or GTM detected on homepage', 'Privacy policy link found in footer', 'Mobile viewport tag present'] },
  { num: 2, name: 'Website Audit', sub: 'Unlocked — Foundation ≥ 70%', score: '34%', items: ['Title tag length check', 'Nav landmark present', 'Server response time'] },
  { num: 3, name: 'SEO Audit', sub: 'Locked — unlocks at Website Audit 80%', score: 'Locked', locked: true, items: [] },
  { num: 4, name: 'GEO Audit', sub: 'Locked', score: 'Locked', locked: true, items: [] },
  { num: 5, name: 'Social Media Audit', sub: 'Locked', score: 'Locked', locked: true, items: [] },
]

function stepInfo(num: number): { label: string; data: ModuleData | null } {
  if (num <= MODULES.length) return { label: MODULES[num - 1].name, data: MODULES[num - 1] }
  return { label: LOCKED_LABELS[num - MODULES.length - 1], data: null }
}

function ringSvg(score: number) {
  const C = 2 * Math.PI * 40
  const offset = C * (1 - score / 100)
  return (
    <svg width={68} height={68} viewBox="0 0 92 92" style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={46} cy={46} r={40} fill="none" stroke="var(--line)" strokeWidth={8} />
      <circle cx={46} cy={46} r={40} fill="none" stroke="var(--green)" strokeWidth={8} strokeLinecap="round"
        strokeDasharray={`${C} ${C}`} strokeDashoffset={offset} />
    </svg>
  )
}

export default function NewUiPage() {
  const [mode, setMode] = useState<'proposed' | 'today'>('proposed')
  const [currentStep, setCurrentStep] = useState(1)
  const [openCatByStep, setOpenCatByStep] = useState<Record<number, number>>({ 1: 0, 2: 0 })
  const [toast, setToast] = useState<string | null>(null)
  const [openToday, setOpenToday] = useState<Set<number>>(new Set([1]))

  const info = stepInfo(currentStep)
  const atFirst = currentStep === 1
  const canAdvance = !!(info.data && info.data.score >= 80)
  const progressPct = ((currentStep - 1) / (TOTAL_STEPS - 1)) * 100

  function goTo(n: number) {
    setCurrentStep(n)
    setToast(null)
  }

  function goPrev() {
    if (currentStep > 1) { setCurrentStep(currentStep - 1); setToast(null) }
  }

  function goNext() {
    if (info.data && info.data.score >= 80 && currentStep < TOTAL_STEPS) {
      setCurrentStep(currentStep + 1)
      setToast(null)
    } else {
      const nxt = stepInfo(currentStep + 1)
      setToast(`Reach 80% on "${info.label}" to unlock ${nxt ? nxt.label : 'the next module'}`)
    }
  }

  function toggleCat(modId: number, idx: number) {
    setOpenCatByStep(prev => ({ ...prev, [modId]: prev[modId] === idx ? -1 : idx }))
  }

  function toggleTodayRow(num: number) {
    setOpenToday(prev => {
      const next = new Set(prev)
      if (next.has(num)) next.delete(num); else next.add(num)
      return next
    })
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Outfit', var(--font-body), sans-serif" }}>
      <style>{`
        .nu-rail-outer::-webkit-scrollbar { height: 0; }
        @media (max-width: 820px) {
          .nu-arrow { display: none !important; }
          .nu-bottombar { display: flex !important; }
          .nu-main { padding-bottom: 90px !important; }
        }
      `}</style>

      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 32px', background: '#0d2218', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700, fontSize: 19, letterSpacing: '-.3px', color: '#ffffff', fontFamily: "'Fraunces', var(--font-display), serif" }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: '#4ade80', flexShrink: 0 }} />
          GrowJin
        </div>
        <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 9, padding: 3 }}>
          <button onClick={() => setMode('proposed')} style={{ padding: '7px 14px', border: 'none', background: mode === 'proposed' ? 'rgba(255,255,255,.14)' : 'transparent', color: mode === 'proposed' ? '#ffffff' : '#6ee7b7', fontSize: 12.5, fontWeight: 600, borderRadius: 7, cursor: 'pointer' }}>Proposed</button>
          <button onClick={() => setMode('today')} style={{ padding: '7px 14px', border: 'none', background: mode === 'today' ? 'rgba(255,255,255,.14)' : 'transparent', color: mode === 'today' ? '#ffffff' : '#6ee7b7', fontSize: 12.5, fontWeight: 600, borderRadius: 7, cursor: 'pointer' }}>Today</button>
        </div>
      </header>

      {mode === 'proposed' ? (
        <div>
          <div className="nu-rail-outer" style={{ padding: '22px 0 18px', borderBottom: '1px solid var(--line)', background: 'var(--card)', overflowX: 'auto' }}>
            <div style={{ position: 'relative', maxWidth: 1280, margin: '0 auto', padding: '0 40px', minWidth: 880 }}>
              <div style={{ position: 'absolute', top: 17, left: 40, right: 40, height: 2, background: 'var(--locked)', opacity: 0.4 }} />
              <div style={{ position: 'absolute', top: 17, left: 40, height: 2, background: 'var(--green)', width: `${progressPct}%`, transition: 'width .2s' }} />
              <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between' }}>
                {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map(n => {
                  const s = stepInfo(n)
                  const isDone = n < currentStep
                  const isCurrent = n === currentStep
                  const isLocked = n > currentStep
                  return (
                    <button
                      key={n}
                      disabled={isLocked}
                      onClick={() => isLocked
                        ? setToast(`Reach 80% on "${stepInfo(n - 1).label}" to unlock ${s.label}`)
                        : goTo(n)}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 62, background: 'transparent', border: 'none', cursor: isLocked ? 'default' : 'pointer', padding: 0 }}
                    >
                      <div style={{
                        width: 34, height: 34, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        background: isDone ? 'var(--green)' : isCurrent ? 'var(--card)' : 'var(--bg-soft)',
                        border: isCurrent ? '2px solid var(--green-bright)' : isDone ? '2px solid var(--green)' : '1px solid var(--locked)',
                      }}>
                        {isDone ? (
                          <svg width={14} height={14} viewBox="0 0 24 24"><polyline points="4,13 9,18 20,6" fill="none" stroke="#ffffff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" /></svg>
                        ) : isLocked ? (
                          <svg width={12} height={12} viewBox="0 0 24 24"><rect x={5} y={11} width={14} height={10} rx={2} fill="none" stroke="var(--text-faint)" strokeWidth={2} /><path d="M8,11 V8 a4,4 0 0 1 8,0 V11" fill="none" stroke="var(--text-faint)" strokeWidth={2} /></svg>
                        ) : (
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green-bright)' }}>{n}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 10, textAlign: 'center', lineHeight: 1.25, color: isCurrent ? 'var(--text)' : isDone ? 'var(--text-dim)' : 'var(--text-faint)', fontWeight: isCurrent ? 600 : 400 }}>
                        {s.label}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <main className="nu-main" style={{ maxWidth: 720, width: '100%', margin: '0 auto', padding: '36px 24px 120px', position: 'relative' }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-faint)', margin: '0 0 6px' }}>
              Step {currentStep} of {TOTAL_STEPS}
            </p>

            {!info.data ? (
              <div style={{ textAlign: 'center', padding: '70px 20px', color: 'var(--text-faint)' }}>
                <svg width={34} height={34} viewBox="0 0 24 24" style={{ marginBottom: 14 }}><rect x={5} y={11} width={14} height={10} rx={2} fill="none" stroke="var(--text-faint)" strokeWidth={2} /><path d="M8,11 V8 a4,4 0 0 1 8,0 V11" fill="none" stroke="var(--text-faint)" strokeWidth={2} /></svg>
                <div style={{ fontSize: 15, color: 'var(--text-dim)', marginBottom: 6 }}>{info.label} is locked</div>
                <div>Reach 80% on the previous module to unlock it.</div>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 6 }}>
                  <h1 style={{ fontSize: 28, margin: 0, fontFamily: "'Fraunces', var(--font-display), serif" }}>{info.data.name}</h1>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <button style={{ padding: '8px 15px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Re-analyse</button>
                    <div style={{ position: 'relative', width: 68, height: 68, flexShrink: 0 }}>
                      {ringSvg(info.data.score)}
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700 }}>{info.data.score}%</div>
                    </div>
                  </div>
                </div>
                <p style={{ color: 'var(--text-dim)', fontSize: 14, lineHeight: 1.6, margin: '0 0 22px' }}>{info.data.desc}</p>

                <div style={{ marginBottom: 26, padding: '13px 16px', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--bg-soft)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
                    <span>Reach <b style={{ color: 'var(--text)' }}>80%</b> to unlock {info.data.unlockNext}</span>
                    <b style={{ color: 'var(--text)' }}>{info.data.score}% / 80%</b>
                  </div>
                  <div style={{ position: 'relative', height: 6, borderRadius: 99, background: 'var(--line)' }}>
                    <div style={{ position: 'absolute', left: 0, top: 0, height: 6, borderRadius: 99, background: 'var(--green)', width: `${info.data.score}%` }} />
                    <div style={{ position: 'absolute', left: '80%', top: -3, width: 2, height: 12, background: 'var(--text-faint)' }} />
                  </div>
                </div>

                {info.data.cats.map((cat, i) => {
                  const isOpen = (openCatByStep[info.data!.id] ?? 0) === i
                  const doneCount = cat.items.filter(it => it.done).length
                  return (
                    <div key={cat.name} style={{ marginBottom: 9, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--card)', overflow: 'hidden' }}>
                      <button onClick={() => toggleCat(info.data!.id, i)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'inherit' }}>
                        <div style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{cat.name}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{doneCount}/{cat.items.length}</div>
                        <svg width={14} height={14} viewBox="0 0 24 24" style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .15s', flexShrink: 0 }}>
                          <polyline points="6,9 12,15 18,9" fill="none" stroke="var(--text-faint)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                      {isOpen && (
                        <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: 11 }}>
                          {cat.items.map(it => (
                            <div key={it.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                              <div style={{
                                width: 15, height: 15, borderRadius: 4, flexShrink: 0, marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                border: `1.5px solid ${it.done ? 'var(--green)' : 'var(--locked)'}`, background: it.done ? 'var(--green)' : 'var(--card)',
                              }}>
                                {it.done && <svg width={9} height={9} viewBox="0 0 24 24"><polyline points="4,13 9,18 20,6" fill="none" stroke="#ffffff" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" /></svg>}
                              </div>
                              <div>
                                <div style={{ fontSize: 13, color: 'var(--text)' }}>{it.label}</div>
                                <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>{it.note}</div>
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

          <button
            className="nu-arrow"
            aria-label="Previous module"
            disabled={atFirst}
            onClick={goPrev}
            style={{ position: 'fixed', top: '50%', left: 24, transform: 'translateY(-50%)', width: 48, height: 48, borderRadius: '50%', background: 'var(--card)', border: '1px solid var(--line)', boxShadow: atFirst ? 'none' : '0 2px 8px rgba(17,24,39,.08)', opacity: atFirst ? 0.35 : 1, cursor: atFirst ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <svg width={17} height={17} viewBox="0 0 24 24"><polyline points="15,6 9,12 15,18" fill="none" stroke="var(--text-dim)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button
            className="nu-arrow"
            aria-label="Next module"
            onClick={goNext}
            style={{ position: 'fixed', top: '50%', right: 24, transform: 'translateY(-50%)', width: 48, height: 48, borderRadius: '50%', background: 'var(--card)', border: '1px solid var(--line)', boxShadow: '0 2px 8px rgba(17,24,39,.08)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <svg width={17} height={17} viewBox="0 0 24 24"><polyline points="9,6 15,12 9,18" fill="none" stroke="var(--text-dim)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" /></svg>
            {!canAdvance && (
              <span style={{ position: 'absolute', bottom: -3, right: -3, width: 17, height: 17, borderRadius: '50%', background: '#fffbeb', border: '1px solid #fde68a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width={8} height={8} viewBox="0 0 24 24"><rect x={5} y={11} width={14} height={10} rx={2} fill="none" stroke="#92400e" strokeWidth={2.6} /><path d="M8,11 V8 a4,4 0 0 1 8,0 V11" fill="none" stroke="#92400e" strokeWidth={2.6} /></svg>
              </span>
            )}
          </button>

          <div className="nu-bottombar" style={{ display: 'none', position: 'fixed', left: 0, right: 0, bottom: 0, borderTop: '1px solid var(--line)', background: 'var(--card)' }}>
            <button disabled={atFirst} onClick={goPrev} style={{ flex: 1, padding: 15, background: 'transparent', border: 'none', color: atFirst ? 'var(--text-faint)' : 'var(--text-dim)', opacity: atFirst ? 0.5 : 1, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <svg width={13} height={13} viewBox="0 0 24 24"><polyline points="15,6 9,12 15,18" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" /></svg>
              Prev
            </button>
            <div style={{ width: 1, background: 'var(--line)' }} />
            <button onClick={goNext} style={{ flex: 1, padding: 15, background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>Next</button>
          </div>

          {toast && (
            <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: '#fffbeb', border: '1px solid #fde68a', padding: '11px 18px', borderRadius: 10, fontSize: 13, color: '#92400e', display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 12px 28px rgba(17,24,39,.14)', zIndex: 30 }}>
              <span>{toast}</span>
              <button onClick={() => setToast(null)} style={{ background: 'transparent', border: 'none', color: '#92400e', opacity: 0.7, fontSize: 15, cursor: 'pointer' }}>✕</button>
            </div>
          )}
        </div>
      ) : (
        <div style={{ maxWidth: 880, margin: '0 auto', padding: '40px 24px 100px' }}>
          <h1 style={{ fontSize: 26, margin: '0 0 6px', fontFamily: "'Fraunces', var(--font-display), serif" }}>Your growth modules</h1>
          <p style={{ color: 'var(--text-dim)', fontSize: 14, margin: '0 0 28px', lineHeight: 1.6 }}>
            All 16 modules live on this one page today. Click a row to expand it — scroll keeps going past locked modules below.
          </p>
          {TODAY_ROWS.map(r => {
            const isOpen = openToday.has(r.num)
            return (
              <div key={r.num} style={{ marginBottom: 10, border: `1px solid ${isOpen ? 'var(--green)' : 'var(--line)'}`, borderRadius: 12, background: 'var(--card)', overflow: 'hidden', opacity: r.locked ? 0.55 : 1 }}>
                <button onClick={() => toggleTodayRow(r.num)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'inherit' }}>
                  <div style={{ width: 26, height: 26, borderRadius: '50%', background: r.locked ? 'var(--bg-soft)' : 'var(--accent)', color: r.locked ? 'var(--text-faint)' : 'var(--accent-foreground)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{r.num}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{r.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>{r.sub}</div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-dim)' }}>{r.score}</div>
                  <svg width={15} height={15} viewBox="0 0 24 24" style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .15s', flexShrink: 0 }}>
                    <polyline points="6,9 12,15 18,9" fill="none" stroke="var(--text-faint)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {isOpen && (
                  <div style={{ padding: '0 18px 16px 58px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                    {r.items.map(i => (
                      <div key={i} style={{ fontSize: 12.5, color: 'var(--text-dim)', display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                        <div style={{ width: 14, height: 14, borderRadius: 4, border: '1.5px solid var(--locked)', flexShrink: 0, marginTop: 1 }} />
                        {i}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          <div style={{ marginTop: 26, padding: '13px 18px', border: '1px dashed var(--locked)', borderRadius: 12, fontSize: 12, color: 'var(--text-faint)', textAlign: 'center' }}>
            ↓ 11 more modules continue below, same pattern ↓
          </div>
        </div>
      )}
    </div>
  )
}
