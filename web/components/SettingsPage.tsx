'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { IntegrationDefinition } from '@/lib/integrations/registry'
import { INTEGRATION_GROUPS } from '@/lib/integrations/registry'

interface ConnectedIntegration {
  status: string
  apiKey: string | null
  accessToken: string | null
  metadata: Record<string, string> | null
}

interface Props {
  brand: { name: string; websiteUrl: string }
  userEmail: string
  integrationRegistry: IntegrationDefinition[]
  connectedIntegrations: Record<string, ConnectedIntegration>
}

type Tab = 'brand' | 'integrations' | 'account'

export default function SettingsPage({ brand, userEmail, integrationRegistry, connectedIntegrations }: Props) {
  const [tab, setTab] = useState<Tab>('brand')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const router = useRouter()

  const handleTabClick = (key: Tab) => {
    setTab(key)
    setDrawerOpen(false)
  }

  return (
    <>
      <header>
        <div className="wrap md-header-inner">
          <div className="logo" style={{ cursor: 'pointer' }} onClick={() => router.push('/dashboard')}>
            <span className="mark">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M5 12h4l2-6 3 12 2-6h3" stroke="#06140c" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            Growth Hacker

          </div>
          <button className="logout-btn" onClick={() => router.push('/dashboard')}>
           Back 
          </button>
        </div>
      </header>

      <div className="wrap st-page-hd">
        <button
          className="st-drawer-toggle"
          onClick={() => setDrawerOpen(!drawerOpen)}
          aria-label="Toggle navigation menu"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <h1 className="st-page-title">Settings</h1>
        <p className="st-page-sub">Manage your brand, integrations, and account.</p>
      </div>

      <div
        className={`wrap st-layout${drawerOpen ? ' drawer-open' : ''}`}
        onClick={(e) => {
          if ((e.target as HTMLElement).classList.contains('st-layout')) {
            setDrawerOpen(false)
          }
        }}
      >
        {/* Tab nav */}
        <nav className="st-tabs">
          {([
            { key: 'brand', label: 'Brand', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><polyline points="9 22 9 12 15 12 15 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg> },
            { key: 'integrations', label: 'Integrations', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg> },
            { key: 'account', label: 'Account', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg> },
          ] as { key: Tab; label: string; icon: React.ReactNode }[]).map(({ key, label, icon }) => (
            <button
              key={key}
              className={`st-tab${tab === key ? ' st-tab-active' : ''}`}
              onClick={() => handleTabClick(key)}
            >
              {icon}
              {label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="st-content">
          {tab === 'brand' && <BrandSection brand={brand} />}
          {tab === 'integrations' && (
            <IntegrationsSection
              registry={integrationRegistry}
              connected={connectedIntegrations}
            />
          )}
          {tab === 'account' && <AccountSection userEmail={userEmail} />}
        </div>
      </div>
    </>
  )
}

// ── Brand Section ─────────────────────────────────────────────────────────────

function BrandSection({ brand }: { brand: { name: string; websiteUrl: string } }) {
  const [name, setName] = useState(brand.name)
  const [url, setUrl] = useState(brand.websiteUrl)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    const res = await fetch('/api/settings/brand', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandName: name, websiteUrl: url }),
    })
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      router.refresh()
    } else {
      const d = await res.json()
      setError(d.error ?? 'Failed to save')
    }
    setSaving(false)
  }

  return (
    <div className="st-section">
      <div className="st-section-hd">
        <h2 className="st-section-title">Brand</h2>
        <p className="st-section-desc">Your brand name and website are used across all modules and reports.</p>
      </div>
      <div className="st-card">
        <form onSubmit={handleSave} className="st-form">
          <div className="st-field">
            <label className="st-label">Brand name</label>
            <input
              className="st-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your brand name"
              required
            />
          </div>
          <div className="st-field">
            <label className="st-label">Website URL</label>
            <input
              className="st-input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://yourdomain.com"
              required
            />
          </div>
          {error && <p className="st-error">{error}</p>}
          <button type="submit" disabled={saving} className="st-btn-primary">
            {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save changes'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Social Profiles Card ──────────────────────────────────────────────────────

const FIXED_PLATFORMS = [
  { key: 'instagram_url', label: 'Instagram',  placeholder: 'https://instagram.com/yourbrand' },
  { key: 'facebook_url',  label: 'Facebook',   placeholder: 'https://facebook.com/yourbrand' },
  { key: 'linkedin_url',  label: 'LinkedIn',   placeholder: 'https://linkedin.com/company/yourbrand' },
  { key: 'youtube_url',   label: 'YouTube',    placeholder: 'https://youtube.com/@yourbrand' },
  { key: 'twitter_url',   label: 'X (Twitter)',placeholder: 'https://x.com/yourbrand' },
  { key: 'tiktok_url',    label: 'TikTok',     placeholder: 'https://tiktok.com/@yourbrand' },
]

function detectPlatformName(url: string): string {
  try {
    const host = new URL(url).hostname.replace('www.', '')
    const known: Record<string, string> = {
      'pinterest.com': 'Pinterest', 'threads.net': 'Threads',
      'snapchat.com': 'Snapchat', 'reddit.com': 'Reddit',
      'tumblr.com': 'Tumblr', 'bsky.app': 'Bluesky',
    }
    if (known[host]) return known[host]
    const part = host.split('.')[0]
    return part.charAt(0).toUpperCase() + part.slice(1)
  } catch {
    return 'Custom'
  }
}

function SocialProfilesCard({ connected }: { connected: ConnectedIntegration | null }) {
  const [urls, setUrls] = useState<Record<string, string>>(() => {
    const m = connected?.metadata ?? {}
    return Object.fromEntries(FIXED_PLATFORMS.map((p) => [p.key, m[p.key] ?? '']))
  })
  const [customPlatforms, setCustomPlatforms] = useState<{ name: string; url: string }[]>(() => {
    try { return JSON.parse(connected?.metadata?.custom_links ?? '[]') }
    catch { return [] }
  })
  const [customInput, setCustomInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const activeCount = [
    ...FIXED_PLATFORMS.filter((p) => urls[p.key]?.trim()),
    ...customPlatforms.filter((p) => p.url?.trim()),
  ].length

  const insight =
    activeCount === 0
      ? 'Add your social media URLs to improve audit accuracy.'
      : activeCount < 3
      ? `Active on ${activeCount} platform(s). Consider expanding to 3+ platforms for a stronger presence.`
      : `Active on ${activeCount} platform(s). Keep posting 3–4x/week for best results.`

  const handleSave = async () => {
    setSaving(true)
    setError('')
    const fields: Record<string, string> = {}
    for (const p of FIXED_PLATFORMS) fields[p.key] = urls[p.key] ?? ''
    fields.custom_links = JSON.stringify(customPlatforms)
    const res = await fetch('/api/settings/integrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'social_profiles', fields }),
    })
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      router.refresh()
    } else {
      const d = await res.json()
      setError(d.error ?? 'Failed to save')
    }
    setSaving(false)
  }

  const handleAddCustom = () => {
    const trimmed = customInput.trim()
    if (!trimmed) return
    const url = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`
    const name = detectPlatformName(url)
    setCustomPlatforms((prev) => [...prev, { name, url }])
    setCustomInput('')
  }

  return (
    <div className={`sp-card${activeCount > 0 ? ' sp-card-connected' : ''}`}>
      <div className="sp-card-hd">
        <div className="sp-card-info">
          <span className="sp-card-title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>
            </svg>
            Social Media Profiles
          </span>
          <p className="sp-card-desc">Add your profile URLs for richer analysis — no API tokens required.</p>
        </div>
        {activeCount > 0 && <span className="sp-active-badge">{activeCount} active</span>}
      </div>

      <div className="sp-platforms">
        {FIXED_PLATFORMS.map((p) => (
          <div key={p.key} className="sp-platform-row">
            <span className="sp-platform-label">{p.label}</span>
            <input
              className="sp-platform-input"
              type="url"
              placeholder={p.placeholder}
              value={urls[p.key]}
              onChange={(e) => setUrls((prev) => ({ ...prev, [p.key]: e.target.value }))}
            />
            <div className="sp-platform-cell">
              <span className={`sp-dot${urls[p.key]?.trim() ? ' sp-dot-on' : ''}`} />
            </div>
          </div>
        ))}
        {customPlatforms.map((cp, i) => (
          <div key={i} className="sp-platform-row">
            <span className="sp-platform-label">{cp.name}</span>
            <input
              className="sp-platform-input"
              type="url"
              value={cp.url}
              onChange={(e) => {
                const updated = [...customPlatforms]
                updated[i] = { ...updated[i], url: e.target.value }
                setCustomPlatforms(updated)
              }}
            />
            <div className="sp-platform-cell">
              <button
                className="sp-remove-btn"
                onClick={() => setCustomPlatforms((prev) => prev.filter((_, j) => j !== i))}
                type="button"
                title="Remove"
              >×</button>
            </div>
          </div>
        ))}
      </div>

      <div className="sp-custom-row">
        <input
          className="sp-custom-input"
          placeholder="Add custom platform..."
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
        />
        <button className="sp-add-btn" onClick={handleAddCustom} type="button">+ Add</button>
      </div>

      <div className="sp-footer">
        <div className="sp-insight">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>{insight}</span>
        </div>
        {error && <p className="st-error" style={{ margin: 0 }}>{error}</p>}
        <button className="st-btn-primary" onClick={handleSave} disabled={saving} type="button" style={{ flexShrink: 0 }}>
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

// ── Integrations Section ──────────────────────────────────────────────────────

function IntegrationsSection({
  registry,
  connected,
}: {
  registry: IntegrationDefinition[]
  connected: Record<string, ConnectedIntegration>
}) {
  // Group integrations by their group field, excluding customUI entries from the card grid
  const grouped = registry
    .filter((def) => !def.customUI)
    .reduce<Record<string, IntegrationDefinition[]>>((acc, def) => {
      const g = def.group ?? 'developer'
      if (!acc[g]) acc[g] = []
      acc[g].push(def)
      return acc
    }, {})

  const groupOrder = ['developer', 'analytics', 'social']

  return (
    <div className="st-section">
      <div className="st-section-hd">
        <h2 className="st-section-title">Integrations</h2>
        <p className="st-section-desc">Connect external services to unlock automated fixes and richer analysis.</p>
      </div>
      {groupOrder.map((groupKey) => {
        const defs = grouped[groupKey]
        const groupMeta = INTEGRATION_GROUPS[groupKey]
        return (
          <div key={groupKey} className="st-int-group">
            <div className="st-int-group-hd">
              <span className="st-int-group-label">{groupMeta.label}</span>
              <span className="st-int-group-desc">{groupMeta.description}</span>
            </div>
            {groupKey === 'social' && (
              <SocialProfilesCard connected={connected['social_profiles'] ?? null} />
            )}
            {defs && defs.length > 0 && (
              <div className="st-integrations">
                {defs.map((def) => (
                  <IntegrationCard
                    key={def.provider}
                    def={def}
                    connected={connected[def.provider] ?? null}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function IntegrationCard({
  def,
  connected,
}: {
  def: IntegrationDefinition
  connected: ConnectedIntegration | null
}) {
  const [editing, setEditing] = useState(!connected)
  const [fields, setFields] = useState<Record<string, string>>(() => {
    if (!connected) return {}
    const initial: Record<string, string> = {}
    for (const f of def.fields) {
      if (f.isMetadata) initial[f.key] = connected.metadata?.[f.key] ?? ''
      else if (f.key === 'api_key') initial[f.key] = connected.apiKey ?? ''
      else if (f.key === 'access_token') initial[f.key] = connected.accessToken ?? ''
    }
    return initial
  })
  const [saving, setSaving] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const isConnected = !!connected && connected.status === 'connected'

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    const res = await fetch('/api/settings/integrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: def.provider, fields }),
    })
    if (res.ok) {
      setEditing(false)
      router.refresh()
    } else {
      const d = await res.json()
      setError(d.error ?? 'Failed to save')
    }
    setSaving(false)
  }

  const handleDisconnect = async () => {
    if (!confirm(`Disconnect ${def.name}? This will remove your saved credentials.`)) return
    setDisconnecting(true)
    await fetch('/api/settings/integrations', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: def.provider }),
    })
    setEditing(true)
    setFields({})
    router.refresh()
    setDisconnecting(false)
  }

  return (
    <div className={`st-int-card${isConnected ? ' st-int-card-connected' : ''}`}>
      <div className="st-int-card-hd">
        <div className="st-int-card-info">
          <div className="st-int-provider-name">{def.name}</div>
          <p className="st-int-desc">{def.description}</p>
        </div>
        <div className="st-int-status-wrap">
          {isConnected ? (
            <span className="st-int-badge st-int-badge-connected">Connected</span>
          ) : (
            <span className="st-int-badge st-int-badge-none">Not connected</span>
          )}
        </div>
      </div>

      {isConnected && !editing ? (
        <div className="st-int-actions">
          <button className="st-btn-ghost" onClick={() => setEditing(true)}>Edit credentials</button>
          <button className="st-btn-danger" onClick={handleDisconnect} disabled={disconnecting}>
            {disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
      ) : (
        <form onSubmit={handleSave} className="st-int-form">
          {def.fields.map((field) => (
            <div key={field.key} className="st-field">
              <label className="st-label">{field.label}</label>
              <input
                className="st-input"
                type={field.inputType}
                placeholder={field.placeholder}
                value={fields[field.key] ?? ''}
                onChange={(e) => setFields((prev) => ({ ...prev, [field.key]: e.target.value }))}
                required={!field.optional}
                autoComplete="off"
              />
              {field.helpText && <p className="st-field-hint">{field.helpText}</p>}
            </div>
          ))}
          {error && <p className="st-error">{error}</p>}
          <div className="st-int-form-actions">
            {isConnected && (
              <button type="button" className="st-btn-ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
            <button type="submit" disabled={saving} className="st-btn-primary">
              {saving ? 'Saving…' : isConnected ? 'Update' : `Connect ${def.name}`}
            </button>
          </div>
          {def.docsUrl && (
            <a href={def.docsUrl} target="_blank" rel="noopener noreferrer" className="st-docs-link">
              How to get your {def.name} credentials →
            </a>
          )}
        </form>
      )}
    </div>
  )
}

// ── Account Section ───────────────────────────────────────────────────────────

function AccountSection({ userEmail }: { userEmail: string }) {
  const [deleting, setDeleting] = useState(false)
  const router = useRouter()

  const handleDelete = async () => {
    if (!confirm('Delete your account? This will permanently remove all your data including modules, findings, and integrations. This cannot be undone.')) return
    setDeleting(true)
    const res = await fetch('/api/settings/account', { method: 'DELETE' })
    if (res.ok) {
      router.push('/login')
      router.refresh()
    } else {
      setDeleting(false)
    }
  }

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="st-section">
      <div className="st-section-hd">
        <h2 className="st-section-title">Account</h2>
        <p className="st-section-desc">Manage your login and data.</p>
      </div>

      <div className="st-card">
        <div className="st-form">
          <div className="st-field">
            <label className="st-label">Email</label>
            <input className="st-input" value={userEmail} disabled />
          </div>

          <div className="st-divider" />

          <div className="st-account-actions">
            <button onClick={handleSignOut} className="st-btn-ghost">Sign out</button>
            <button onClick={handleDelete} disabled={deleting} className="st-btn-danger">
              {deleting ? 'Deleting…' : 'Delete account'}
            </button>
          </div>
          <p className="st-hint">Deleting your account permanently removes all data including modules, findings, and connected integrations.</p>
        </div>
      </div>
    </div>
  )
}
