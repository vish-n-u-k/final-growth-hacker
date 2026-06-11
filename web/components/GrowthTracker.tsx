'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { LEVELS, LEVEL_DESCS } from '@/lib/data/levels'

interface Props {
  initialCheckedTasks: Record<string, boolean>
  initialUserCount: number
  userEmail: string
}

function getInitialActiveLevel(checked: Record<string, boolean>): number {
  for (let i = 0; i < LEVELS.length; i++) {
    const allDone = LEVELS[i].tasks.every((_, j) => checked[`${i}-${j}`])
    if (!allDone) return i
  }
  return LEVELS.length - 1
}

export default function GrowthTracker({ initialCheckedTasks, initialUserCount, userEmail }: Props) {
  const [checked, setChecked] = useState(initialCheckedTasks)
  const [userCount, setUserCount] = useState(initialUserCount)
  const [editingCount, setEditingCount] = useState(false)
  const [countInput, setCountInput] = useState(String(initialUserCount))
  const [openLevels, setOpenLevels] = useState<Set<number>>(
    () => new Set([getInitialActiveLevel(initialCheckedTasks)]),
  )
  const router = useRouter()

  // Derived level state
  const levelStates = LEVELS.map((level, i) => {
    const checkedCount = level.tasks.filter((_, j) => checked[`${i}-${j}`]).length
    return { checkedCount, isDone: checkedCount === level.tasks.length, total: level.tasks.length }
  })
  const activeLevelIdx = levelStates.findIndex((s) => !s.isDone)
  const currentLevelIdx = activeLevelIdx === -1 ? LEVELS.length - 1 : activeLevelIdx
  const journeyPct = Math.min((userCount / 500) * 100, 100)

  const toggleLevel = (i: number) => {
    setOpenLevels((prev) => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  const toggleTask = async (levelIdx: number, taskIdx: number) => {
    const key = `${levelIdx}-${taskIdx}`
    const newVal = !checked[key]
    setChecked((prev) => ({ ...prev, [key]: newVal }))
    await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ levelId: levelIdx, taskIndex: taskIdx, checked: newVal }),
    })
  }

  const submitCount = async () => {
    const n = Math.max(0, parseInt(countInput) || 0)
    setUserCount(n)
    setCountInput(String(n))
    setEditingCount(false)
    await fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userCount: n }),
    })
  }

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const getLevelClass = (i: number) => {
    const { isDone } = levelStates[i]
    const isActive = i === activeLevelIdx
    let cls = 'level'
    if (isDone) cls += ' done'
    else if (isActive) cls += ' active'
    else cls += ' locked'
    if (openLevels.has(i)) cls += ' open'
    return cls
  }

  return (
    <>
      <header>
        <div className="wrap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div className="logo">
            <span className="mark">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M5 12h4l2-6 3 12 2-6h3" stroke="#06140c" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            Growth Tracker
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="tag">🌱 Founder Edition</span>
            <button onClick={handleLogout} className="logout-btn">
              {userEmail} · Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="wrap">
        <div className="hero">
          <h1>Your road to 500 users</h1>
          <p>One level at a time. Clear each gate before you level up — don&apos;t skip ahead.</p>
        </div>

        <div className="overview">
          <div
            className="big-num"
            onClick={() => {
              setEditingCount(true)
              setCountInput(String(userCount))
            }}
            title="Click to update your user count"
          >
            {editingCount ? (
              <form onSubmit={(e) => { e.preventDefault(); submitCount() }} style={{ display: 'inline' }}>
                <input
                  autoFocus
                  type="number"
                  value={countInput}
                  onChange={(e) => setCountInput(e.target.value)}
                  onBlur={submitCount}
                />
                <span>/500</span>
              </form>
            ) : (
              <>
                {userCount}<span>/500</span>
              </>
            )}
          </div>
          <div className="meta">
            <div className="lvl">Currently · Level {currentLevelIdx}</div>
            <div className="desc">{LEVEL_DESCS[currentLevelIdx]}</div>
            <div className="journey-bar">
              <div className="journey-track">
                <div className="journey-fill" style={{ width: `${journeyPct}%` }} />
              </div>
              <div className="journey-labels">
                <span>0</span>
                <span>10</span>
                <span>50</span>
                <span>100</span>
                <span>500</span>
              </div>
            </div>
          </div>
        </div>

        <div className="levels">
          {LEVELS.map((level, i) => {
            const { checkedCount, isDone, total } = levelStates[i]
            const isActive = i === activeLevelIdx
            const isLocked = !isDone && !isActive
            const pct = total ? (checkedCount / total) * 100 : 0

            return (
              <div key={i} className={getLevelClass(i)}>
                <div className="level-head" onClick={() => toggleLevel(i)}>
                  <div className="level-badge">
                    {isDone ? '✓' : isLocked ? '🔒' : i}
                  </div>
                  <div className="level-info">
                    <div className="name">
                      {level.name}
                      {isDone && <span className="pill clear">Cleared</span>}
                      {isActive && <span className="pill now">You are here</span>}
                      {isLocked && <span className="pill soon">Locked</span>}
                    </div>
                    <div className="range">{level.range}</div>
                    <div className="focus">{level.focus}</div>
                  </div>
                  <div className="level-prog">
                    <div className="mini-track">
                      <div className="mini-fill" style={{ width: `${pct}%` }} />
                    </div>
                    {checkedCount}/{total}
                  </div>
                  <svg className="chev" width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="level-body">
                  <div className="tasks">
                    {level.tasks.map((task, j) => {
                      const isChecked = !!checked[`${i}-${j}`]
                      return (
                        <div
                          key={j}
                          className={`task${isChecked ? ' checked' : ''}`}
                          onClick={() => toggleTask(i, j)}
                        >
                          <span className="check">
                            <svg viewBox="0 0 24 24" fill="none">
                              <path d="M5 13l4 4L19 7" stroke="#06140c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </span>
                          <span className="label">{task}</span>
                        </div>
                      )
                    })}
                    <div className="gate">
                      🚪 <b>Gate:</b> {level.gate}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="foot-note">
          Retention is the throughline — from Level 3 on, every user you keep is one you don&apos;t re-acquire,
          <br />
          and an engaged user becomes your next recruiter. 🌿
        </div>
      </div>
    </>
  )
}
