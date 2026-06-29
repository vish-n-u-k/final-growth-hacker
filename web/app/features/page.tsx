'use client'

import { useEffect, useState } from 'react'
import { Trash2, Plus, RefreshCw, Check, Download, ChevronDown, ChevronUp } from 'lucide-react'

interface Feature {
  id: string
  name: string
  description: string | null
  keywords: string | null
  isCompleted: boolean
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

interface ExistingFeature {
  id: string
  name: string
  description: string
  type: string
  order: number
}

export default function FeaturesPage() {
  const [features, setFeatures] = useState<Feature[]>([])
  const [existingFeatures, setExistingFeatures] = useState<ExistingFeature[]>([])
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [showExisting, setShowExisting] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    keywords: '',
    isCompleted: false,
  })

  // Fetch features
  const fetchFeatures = async () => {
    try {
      const [featRes, existRes] = await Promise.all([
        fetch('/api/features'),
        fetch('/api/features/existing'),
      ])

      const featuresData = await featRes.json()
      const existingData = await existRes.json()

      setFeatures(Array.isArray(featuresData) ? featuresData : [])
      setExistingFeatures(Array.isArray(existingData) ? existingData : [])
    } catch (error) {
      console.error('Failed to fetch features:', error)
      setFeatures([])
      setExistingFeatures([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchFeatures()
  }, [])

  // Add new feature
  const handleAddFeature = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.name.trim()) return

    try {
      const res = await fetch('/api/features', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description,
          keywords: formData.keywords,
          isCompleted: formData.isCompleted,
          completedAt: formData.isCompleted ? new Date().toISOString() : null,
        }),
      })

      if (res.ok) {
        const newFeature = await res.json()
        setFeatures([...features, newFeature])
        setFormData({ name: '', description: '', keywords: '', isCompleted: false })
      }
    } catch (error) {
      console.error('Failed to add feature:', error)
    }
  }

  // Add existing feature
  const handleAddExisting = async (existing: ExistingFeature, markCompleted = false) => {
    const newFeature = {
      name: existing.name,
      description: existing.description,
      keywords: existing.id, // Use module type as keyword for auto-detection
      isCompleted: markCompleted,
      completedAt: markCompleted ? new Date().toISOString() : null,
    }

    try {
      const res = await fetch('/api/features', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newFeature),
      })

      if (res.ok) {
        const created = await res.json()
        setFeatures([...features, created])
        if (Array.isArray(existingFeatures)) {
          setExistingFeatures(
            existingFeatures.filter((f) => f.id !== existing.id),
          )
        }
      }
    } catch (error) {
      console.error('Failed to add existing feature:', error)
    }
  }

  // Toggle feature completion
  const handleToggle = async (id: string, isCompleted: boolean) => {
    try {
      const res = await fetch(`/api/features/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isCompleted: !isCompleted }),
      })

      if (res.ok) {
        const updated = await res.json()
        if (Array.isArray(features)) {
          setFeatures(features.map((f) => (f.id === id ? updated : f)))
        }
      }
    } catch (error) {
      console.error('Failed to toggle feature:', error)
    }
  }

  // Delete feature
  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/features/${id}`, { method: 'DELETE' })
      if (res.ok) {
        if (Array.isArray(features)) {
          setFeatures(features.filter((f) => f.id !== id))
        }
      }
    } catch (error) {
      console.error('Failed to delete feature:', error)
    }
  }

  // Check git commits
  const handleCheckCommits = async () => {
    setChecking(true)
    try {
      const res = await fetch('/api/features/check-commits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 7 }),
      })

      if (res.ok) {
        const result = await res.json()
        alert(`Found and completed ${result.count} feature(s): ${result.completed.join(', ') || 'None'}`)
        await fetchFeatures()
      }
    } catch (error) {
      console.error('Failed to check commits:', error)
      alert('Failed to check commits')
    } finally {
      setChecking(false)
    }
  }

  const completedCount = features.filter((f) => f.isCompleted).length
  const totalCount = features.length

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-5xl font-bold text-white mb-2">🚀 Feature Tracker</h1>
              <p className="text-lg text-slate-400">
                Build faster. Track progress. Auto-complete on commit.
              </p>
            </div>
          </div>

          {/* Stats & Actions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Progress Card */}
            <div className="bg-gradient-to-br from-emerald-900/30 to-emerald-900/10 border border-emerald-500/30 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold text-emerald-300 uppercase">Progress</span>
                <span className="text-2xl font-bold text-emerald-400">
                  {totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0}%
                </span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-3">
                <div
                  className="bg-gradient-to-r from-emerald-500 to-teal-500 h-3 rounded-full transition-all duration-500"
                  style={{ width: totalCount > 0 ? `${(completedCount / totalCount) * 100}%` : '0%' }}
                />
              </div>
              <p className="text-sm text-slate-400 mt-3">
                {completedCount} of {totalCount} completed
              </p>
            </div>

            {/* Total Features Card */}
            <div className="bg-gradient-to-br from-blue-900/30 to-blue-900/10 border border-blue-500/30 rounded-xl p-6">
              <p className="text-sm font-semibold text-blue-300 uppercase mb-2">Total Features</p>
              <p className="text-4xl font-bold text-blue-400">{totalCount}</p>
              <p className="text-sm text-slate-400 mt-3">Being tracked</p>
            </div>

            {/* Check Commits Button */}
            <button
              onClick={handleCheckCommits}
              disabled={checking}
              className="bg-gradient-to-br from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:from-slate-600 disabled:to-slate-600 text-white rounded-xl p-6 font-semibold transition-all duration-300 flex items-center justify-center gap-2 group"
            >
              <RefreshCw size={20} className={checking ? 'animate-spin' : 'group-hover:rotate-12 transition-transform'} />
              <span>{checking ? 'Scanning...' : 'Scan Commits'}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - Add Features */}
          <div className="lg:col-span-2 space-y-8">
            {/* Existing Features */}
            {existingFeatures.length > 0 && (
              <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 backdrop-blur">
                <button
                  onClick={() => setShowExisting(!showExisting)}
                  className="flex items-center gap-3 text-xl font-bold text-white hover:text-emerald-400 transition-colors w-full"
                >
                  <Download size={24} className={`transition-transform ${showExisting ? 'rotate-180' : ''}`} />
                  <span>Add from App ({existingFeatures.length})</span>
                  <span className="ml-auto">{showExisting ? <ChevronUp size={20} /> : <ChevronDown size={20} />}</span>
                </button>

                {showExisting && (
                  <div className="grid grid-cols-1 gap-3 mt-6 pt-6 border-t border-slate-700">
                    {existingFeatures.map((existing) => (
                      <div
                        key={existing.id}
                        className="p-4 bg-slate-900/60 border border-slate-600 rounded-lg hover:border-emerald-500 hover:bg-slate-900 transition-all group"
                      >
                        <h4 className="font-semibold text-white group-hover:text-emerald-400 transition-colors">
                          {existing.name}
                        </h4>
                        <p className="text-xs text-slate-400 mt-2 line-clamp-2">
                          {existing.description}
                        </p>
                        <div className="flex items-center gap-2 mt-3">
                          <button
                            onClick={() => handleAddExisting(existing, false)}
                            className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 text-sm font-medium rounded transition-colors"
                          >
                            <Plus size={14} /> Add
                          </button>
                          <button
                            onClick={() => handleAddExisting(existing, true)}
                            className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded transition-colors"
                          >
                            <Check size={14} /> Add & Done
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Create New Feature */}
            <form onSubmit={handleAddFeature} className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 backdrop-blur">
              <h2 className="text-2xl font-bold text-white mb-6">✨ Create New Feature</h2>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-3">
                    Feature Name *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. Dark mode support"
                    className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-3">
                    Description
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="What will this feature do?"
                    rows={3}
                    className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all resize-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-3">
                    Git Keywords (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={formData.keywords}
                    onChange={(e) => setFormData({ ...formData, keywords: e.target.value })}
                    placeholder="e.g. dark-mode, darkMode, theme"
                    className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                  />
                  <p className="text-xs text-slate-400 mt-2">
                    🎯 Auto-completes when keywords appear in git commits
                  </p>
                </div>

                <div className="flex items-center gap-3 p-4 bg-emerald-950/30 border border-emerald-500/30 rounded-lg">
                  <input
                    type="checkbox"
                    id="isCompleted"
                    checked={formData.isCompleted}
                    onChange={(e) => setFormData({ ...formData, isCompleted: e.target.checked })}
                    className="w-5 h-5 rounded border-2 border-emerald-500 bg-slate-900 cursor-pointer accent-emerald-500"
                  />
                  <label htmlFor="isCompleted" className="text-sm font-medium text-emerald-300 cursor-pointer">
                    ✓ Mark as already completed
                  </label>
                </div>

                <button
                  type="submit"
                  className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-lg font-semibold transition-all duration-300 flex items-center justify-center gap-2 group"
                >
                  <Plus size={20} />
                  Create Feature
                </button>
              </div>
            </form>
          </div>

          {/* Right Column - Features List */}
          <div className="lg:col-span-1">
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 backdrop-blur sticky top-6">
              <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <Check size={24} className="text-emerald-500" />
                Features ({totalCount})
              </h2>

              {loading ? (
                <div className="text-center text-slate-400 py-8">⏳ Loading...</div>
              ) : features.length === 0 ? (
                <div className="text-center text-slate-400 py-8">
                  <p className="text-sm">No features yet</p>
                  <p className="text-xs mt-2">Add one to get started! 👈</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[600px] overflow-y-auto">
                  {features.map((feature) => (
                    <div
                      key={feature.id}
                      className={`p-3 rounded-lg border transition-all group ${
                        feature.isCompleted
                          ? 'bg-emerald-950/30 border-emerald-500/30 opacity-60'
                          : 'bg-slate-900/60 border-slate-600 hover:border-emerald-500/50'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() => handleToggle(feature.id, feature.isCompleted)}
                          className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                            feature.isCompleted
                              ? 'bg-emerald-600 border-emerald-600 ring-2 ring-emerald-500/30'
                              : 'border-slate-500 hover:border-emerald-500'
                          }`}
                        >
                          {feature.isCompleted && <Check size={14} className="text-white" />}
                        </button>

                        <div className="flex-1 min-w-0">
                          <h4
                            className={`text-sm font-medium transition-all ${
                              feature.isCompleted
                                ? 'text-slate-500 line-through'
                                : 'text-white group-hover:text-emerald-400'
                            }`}
                          >
                            {feature.name}
                          </h4>
                          {feature.completedAt && (
                            <p className="text-xs text-emerald-400 mt-1">
                              ✓ {new Date(feature.completedAt).toLocaleDateString()}
                            </p>
                          )}
                        </div>

                        <button
                          onClick={() => handleDelete(feature.id)}
                          className="flex-shrink-0 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
