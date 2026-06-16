'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/dashboard')
      router.refresh()
    }
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
      <h1>Welcome back</h1>
      <p className="auth-sub">Sign in to your account</p>
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
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="h-11 bg-[var(--bg-soft)] border-[var(--line)] text-[var(--text)] placeholder:text-[var(--text-faint)] focus-visible:border-[var(--green)] focus-visible:ring-[var(--green)]/20"
        />
        {error && <p className="auth-error">{error}</p>}
        <Button
          type="submit"
          disabled={loading}
          className="w-full h-11 bg-gradient-to-br from-[var(--green-bright)] to-[var(--green)] text-[#06140c] font-semibold hover:opacity-90 mt-1"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <p className="auth-switch">
        Don&apos;t have an account? <Link href="/signup">Sign up</Link>
      </p>
    </div>
  )
}
