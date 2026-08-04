'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface Note {
  id: string
  title: string
  content: string
  tags: string[]
  pinned: boolean
  moduleType: string | null
  createdAt: string
  updatedAt: string
}

interface Props {
  open: boolean
  onClose: () => void
}

const MODULE_OPTIONS = [
  { value: '', label: 'No module' },
  { value: 'foundation', label: 'Foundation' },
  { value: 'seo', label: 'SEO' },
  { value: 'geo', label: 'GEO' },
  { value: 'social_media', label: 'Social Media' },
  { value: 'content', label: 'Content' },
  { value: 'ads', label: 'Ads' },
  { value: 'email', label: 'Email' },
]

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return new Date(iso).toLocaleDateString()
}

// ── Shared inline style helpers ───────────────────────────────────────────────

const S = {
  iconBtn: (extra?: React.CSSProperties): React.CSSProperties => ({
    display: 'grid', placeItems: 'center', width: 28, height: 28,
    background: 'none', border: '1px solid var(--line)', borderRadius: 7,
    cursor: 'pointer', color: 'var(--text-dim)', flexShrink: 0,
    ...extra,
  }),
  input: (extra?: React.CSSProperties): React.CSSProperties => ({
    width: '100%', padding: '7px 10px', background: 'var(--bg-soft)',
    border: '1px solid var(--line)', borderRadius: 7, color: 'var(--text)',
    fontSize: 13, outline: 'none', fontFamily: 'inherit',
    ...extra,
  }),
  chip: (active?: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px',
    background: active ? 'color-mix(in srgb, var(--green) 15%, transparent)' : 'var(--bg-soft)',
    border: `1px solid ${active ? 'var(--green)' : 'var(--line)'}`,
    borderRadius: 20, fontSize: 11, color: active ? 'var(--green)' : 'var(--text-dim)',
    cursor: 'pointer', transition: 'all 0.15s',
  }),
  tagChip: (): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', padding: '2px 7px',
    background: 'color-mix(in srgb, var(--green) 12%, transparent)',
    border: '1px solid color-mix(in srgb, var(--green) 25%, transparent)',
    borderRadius: 10, fontSize: 10, color: 'var(--green)', fontWeight: 500,
  }),
  select: (): React.CSSProperties => ({
    padding: '5px 8px', background: 'var(--bg-soft)', border: '1px solid var(--line)',
    borderRadius: 7, color: 'var(--text-dim)', fontSize: 12, cursor: 'pointer', outline: 'none',
  }),
}

export default function NotesDrawer({ open, onClose }: Props) {
  const [notes, setNotes] = useState<Note[]>([])
  const [selected, setSelected] = useState<Note | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'title'>('newest')
  const [filterTag, setFilterTag] = useState<string | null>(null)
  const [filterPinned, setFilterPinned] = useState(false)
  const [filterModule, setFilterModule] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [draft, setDraft] = useState<Partial<Note>>({})
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [hoverNote, setHoverNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/notes')
    if (res.ok) setNotes(await res.json())
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const allTags = Array.from(new Set(notes.flatMap(n => n.tags))).sort()
  const allModules = Array.from(new Set(notes.map(n => n.moduleType).filter(Boolean))) as string[]

  const filtered = notes
    .filter(n => {
      if (filterPinned && !n.pinned) return false
      if (filterTag && !n.tags.includes(filterTag)) return false
      if (filterModule && n.moduleType !== filterModule) return false
      if (search) {
        const q = search.toLowerCase()
        return n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)
      }
      return true
    })
    .sort((a, b) => {
      if (sortBy === 'newest') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      if (sortBy === 'oldest') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      return a.title.localeCompare(b.title)
    })

  function openNew() {
    setDraft({ title: '', content: '', tags: [], pinned: false, moduleType: null })
    setSelected(null)
    setIsNew(true)
    setTagInput('')
  }

  function openNote(note: Note) {
    setDraft({ ...note })
    setSelected(note)
    setIsNew(false)
    setTagInput('')
  }

  function closeEditor() {
    setSelected(null)
    setIsNew(false)
    setDraft({})
    setTagInput('')
  }

  const scheduleSave = useCallback((updatedDraft: Partial<Note>) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => { void doSave(updatedDraft) }, 900)
  }, []) // eslint-disable-line

  async function doSave(d: Partial<Note>) {
    if (!d.title && !d.content) return
    setSaving(true)
    try {
      if (isNew && !selected) {
        const res = await fetch('/api/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: d.title ?? '', content: d.content ?? '', tags: d.tags ?? [], pinned: d.pinned ?? false, moduleType: d.moduleType ?? null }),
        })
        if (res.ok) {
          const created: Note = await res.json()
          setNotes(prev => [created, ...prev])
          setSelected(created)
          setDraft(created)
          setIsNew(false)
        }
      } else if (selected) {
        const res = await fetch(`/api/notes/${selected.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: d.title ?? '', content: d.content ?? '', tags: d.tags ?? [], pinned: d.pinned ?? false, moduleType: d.moduleType ?? null }),
        })
        if (res.ok) {
          const updated: Note = await res.json()
          setNotes(prev => prev.map(n => n.id === updated.id ? updated : n))
          setSelected(updated)
        }
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!selected) return
    await fetch(`/api/notes/${selected.id}`, { method: 'DELETE' })
    setNotes(prev => prev.filter(n => n.id !== selected.id))
    closeEditor()
  }

  function updateDraft(patch: Partial<Note>) {
    const updated = { ...draft, ...patch }
    setDraft(updated)
    scheduleSave(updated)
  }

  function addTag() {
    const tag = tagInput.trim()
    if (!tag || (draft.tags ?? []).includes(tag)) { setTagInput(''); return }
    updateDraft({ tags: [...(draft.tags ?? []), tag] })
    setTagInput('')
  }

  function removeTag(tag: string) {
    updateDraft({ tags: (draft.tags ?? []).filter(t => t !== tag) })
  }

  const showEditor = isNew || selected !== null

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          zIndex: 200, opacity: open ? 1 : 0,
          transition: 'opacity 0.25s',
          pointerEvents: open ? 'auto' : 'none',
        }}
      />

      {/* Drawer */}
      <div
        style={{
          position: 'fixed', top: 0, right: 0, height: '100vh',
          width: 380, maxWidth: '95vw',
          background: 'var(--card)', borderLeft: '1px solid var(--line)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s ease',
          zIndex: 201, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>Notes</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {saving && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>Saving…</span>}
            <button style={S.iconBtn()} onClick={onClose} title="Close">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 12px', borderBottom: '1px solid var(--line)', flexShrink: 0, flexWrap: 'wrap' }}>
          <button
            onClick={openNew}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            New Note
          </button>
          <input
            style={{ ...S.input(), flex: 1, minWidth: 80, padding: '5px 10px', fontSize: 12 }}
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select style={S.select()} value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="title">A–Z</option>
          </select>
        </div>

        {/* Filters */}
        {(allTags.length > 0 || allModules.length > 0) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '7px 12px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
            <button style={S.chip(filterPinned)} onClick={() => setFilterPinned(p => !p)}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill={filterPinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
              Pinned
            </button>
            {allTags.map(tag => (
              <button key={tag} style={S.chip(filterTag === tag)} onClick={() => setFilterTag(filterTag === tag ? null : tag)}>
                {tag}
              </button>
            ))}
            {allModules.map(mod => (
              <button key={mod} style={S.chip(filterModule === mod)} onClick={() => setFilterModule(filterModule === mod ? null : mod)}>
                {mod}
              </button>
            ))}
          </div>
        )}

        {/* Note list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {filtered.length === 0 && (
            <div style={{ padding: '36px 20px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
              {notes.length === 0 ? 'No notes yet. Click + New Note to start.' : 'No notes match your filters.'}
            </div>
          )}
          {filtered.map(note => (
            <button
              key={note.id}
              onClick={() => openNote(note)}
              onMouseEnter={() => setHoverNote(note.id)}
              onMouseLeave={() => setHoverNote(null)}
              style={{
                width: '100%', textAlign: 'left', padding: '11px 14px',
                background: selected?.id === note.id
                  ? 'color-mix(in srgb, var(--green) 8%, transparent)'
                  : hoverNote === note.id ? 'var(--bg-soft)' : 'none',
                border: 'none',
                borderBottom: '1px solid var(--line)',
                borderLeft: selected?.id === note.id ? '2px solid var(--green)' : '2px solid transparent',
                cursor: 'pointer', color: 'var(--text)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {note.pinned && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style={{ color: 'var(--gold)', flexShrink: 0 }}>
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  )}
                  {note.title || <span style={{ color: 'var(--text-faint)', fontStyle: 'italic', fontWeight: 400 }}>Untitled</span>}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-faint)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {timeAgo(note.updatedAt ?? note.createdAt)}
                </span>
              </div>
              {note.content && (
                <p style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5, margin: '3px 0 5px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                  {note.content}
                </p>
              )}
              {note.tags.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                  {note.tags.map(t => <span key={t} style={S.tagChip()}>{t}</span>)}
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Editor */}
        {showEditor && (
          <div style={{ borderTop: '2px solid var(--line)', background: 'var(--bg-soft)', padding: '14px 14px 16px', display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '54vh', overflowY: 'auto', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{isNew ? 'New note' : 'Edit'}</span>
              <button style={S.iconBtn({ width: 24, height: 24 })} onClick={closeEditor} title="Close editor">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            <input
              style={{ ...S.input({ fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-display)', padding: '7px 10px' }) }}
              placeholder="Title"
              value={draft.title ?? ''}
              onChange={e => updateDraft({ title: e.target.value })}
            />

            <textarea
              style={{ width: '100%', padding: '8px 10px', background: 'var(--bg-soft)', border: '1px solid var(--line)', borderRadius: 7, color: 'var(--text)', fontSize: 13, lineHeight: 1.6, outline: 'none', resize: 'vertical', minHeight: 90, fontFamily: 'inherit' }}
              placeholder="Write your note here…"
              value={draft.content ?? ''}
              onChange={e => updateDraft({ content: e.target.value })}
              rows={5}
            />

            {/* Tags */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', width: 44, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Tags</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center', flex: 1 }}>
                {(draft.tags ?? []).map(t => (
                  <span key={t} style={{ ...S.tagChip(), gap: 3 }}>
                    {t}
                    <button onClick={() => removeTag(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, lineHeight: 1, fontSize: 12 }}>×</button>
                  </span>
                ))}
                <input
                  style={{ padding: '2px 8px', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, fontSize: 11, color: 'var(--text)', outline: 'none', minWidth: 80 }}
                  placeholder="Add tag…"
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag() } }}
                  onBlur={addTag}
                />
              </div>
            </div>

            {/* Module */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', width: 44, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Module</span>
              <select style={S.select()} value={draft.moduleType ?? ''} onChange={e => updateDraft({ moduleType: e.target.value || null })}>
                {MODULE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Pin */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', width: 44, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Pin</span>
              <button
                onClick={() => updateDraft({ pinned: !draft.pinned })}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px',
                  background: draft.pinned ? 'color-mix(in srgb, var(--gold) 12%, transparent)' : 'var(--bg-soft)',
                  border: `1px solid ${draft.pinned ? 'var(--gold)' : 'var(--line)'}`,
                  borderRadius: 7, fontSize: 12, color: draft.pinned ? 'var(--gold)' : 'var(--text-dim)',
                  cursor: 'pointer',
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill={draft.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                {draft.pinned ? 'Pinned' : 'Pin note'}
              </button>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
              <button
                onClick={() => doSave(draft)}
                disabled={saving || (!draft.title && !draft.content)}
                style={{ flex: 1, padding: '7px 16px', background: saving || (!draft.title && !draft.content) ? 'rgba(47,191,113,0.3)' : 'var(--green)', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: saving || (!draft.title && !draft.content) ? 'not-allowed' : 'pointer' }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              {selected && (
                <button
                  onClick={handleDelete}
                  style={{ padding: '7px 14px', background: 'none', border: '1px solid color-mix(in srgb, #e05252 35%, transparent)', borderRadius: 7, fontSize: 12.5, color: '#f08080', cursor: 'pointer' }}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
