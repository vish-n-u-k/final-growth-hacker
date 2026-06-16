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
  const router = useRouter()

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
            Settings
          </div>
          <button className="logout-btn" onClick={() => router.push('/dashboard')}>
            ← Back to dashboard
          </button>
        </div>
      </header>

      <div className="wrap st-page-hd">
        <h1 className="st-page-title">Settings</h1>
        <p className="st-page-sub">Manage your brand, integrations, and account.</p>
      </div>

      <div className="wrap st-layout">
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
              onClick={() => setTab(key)}
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

// ── Integrations Section ──────────────────────────────────────────────────────

function IntegrationsSection({
  registry,
  connected,
}: {
  registry: IntegrationDefinition[]
  connected: Record<string, ConnectedIntegration>
}) {
  // Group integrations by their group field
  const grouped = registry.reduce<Record<string, IntegrationDefinition[]>>((acc, def) => {
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
        if (!defs || defs.length === 0) return null
        const groupMeta = INTEGRATION_GROUPS[groupKey]
        return (
          <div key={groupKey} className="st-int-group">
            <div className="st-int-group-hd">
              <span className="st-int-group-label">{groupMeta.label}</span>
              <span className="st-int-group-desc">{groupMeta.description}</span>
            </div>
            <div className="st-integrations">
              {defs.map((def) => (
                <IntegrationCard
                  key={def.provider}
                  def={def}
                  connected={connected[def.provider] ?? null}
                />
              ))}
            </div>
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
