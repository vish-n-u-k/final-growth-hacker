'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { data, error } = await supabase.auth.signUp({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else if (!data.session) {
      // Email confirmation required
      setConfirming(true)
      setLoading(false)
    } else {
      router.push('/dashboard')
      router.refresh()
    }
  }

  if (confirming) {
    return (
      <div className="auth-card">
        <div className="auth-logo">
          <span className="mark">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M5 12h4l2-6 3 12 2-6h3" stroke="#06140c" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span>Growth Tracker</span>
        </div>
        <h1>Check your email</h1>
        <p className="auth-sub" style={{ marginBottom: 0 }}>
          We sent a confirmation link to <strong style={{ color: 'var(--text)' }}>{email}</strong>.
          Click it to activate your account, then come back and sign in.
        </p>
        <p className="auth-switch" style={{ marginTop: '24px' }}>
          <Link href="/login">Back to sign in</Link>
        </p>
      </div>
    )
  }

  return (
    <div className="auth-card">
      <div className="auth-logo">
        <span className="mark">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M5 12h4l2-6 3 12 2-6h3" stroke="#06140c" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span>Growth Tracker</span>
      </div>
      <h1>Create account</h1>
      <p className="auth-sub">Start tracking your road to 500 users</p>
      <form onSubmit={handleSubmit} className="auth-form">
        <Input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="h-11 bg-[var(--bg-soft)] border-[var(--line)] text-[var(--text)] placeholder:text-[var(--text-faint)] focus-visible:border-[var(--green)] focus-visible:ring-[var(--green)]/20"
        />
        <Input
          type="password"
          placeholder="Password (min 6 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          className="h-11 bg-[var(--bg-soft)] border-[var(--line)] text-[var(--text)] placeholder:text-[var(--text-faint)] focus-visible:border-[var(--green)] focus-visible:ring-[var(--green)]/20"
        />
        {error && <p className="auth-error">{error}</p>}
        <Button
          type="submit"
          disabled={loading}
          className="w-full h-11 bg-gradient-to-br from-[var(--green-bright)] to-[var(--green)] text-[#06140c] font-semibold hover:opacity-90 mt-1"
        >
          {loading ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
      <p className="auth-switch">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </div>
  )
}
