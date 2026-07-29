import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { analysisRequests } from '@/lib/db/schema'
import { desc } from 'drizzle-orm'
import AdminDashboard from './AdminDashboard'
import { getAdminGmailAddress } from '@/lib/gmail/admin-token'

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ gmail?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (!user || !adminEmails.includes(user.email ?? '')) {
    redirect('/dashboard')
  }

  const [requests, gmailAddress, { gmail: gmailParam }] = await Promise.all([
    db.select().from(analysisRequests).orderBy(desc(analysisRequests.requestedAt)),
    getAdminGmailAddress(),
    searchParams,
  ])

  return <AdminDashboard requests={requests} gmailAddress={gmailAddress} gmailParam={gmailParam} />
}
