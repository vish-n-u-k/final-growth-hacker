import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import BugReportsDashboard from './BugReportsDashboard'

export default async function BugReportsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (!user || !adminEmails.includes(user.email ?? '')) {
    redirect('/dashboard')
  }

  return <BugReportsDashboard />
}
