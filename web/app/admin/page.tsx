import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { analysisRequests } from '@/lib/db/schema'
import { desc } from 'drizzle-orm'
import AdminDashboard from './AdminDashboard'

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (!user || !adminEmails.includes(user.email ?? '')) {
    redirect('/dashboard')
  }

  const requests = await db.select().from(analysisRequests).orderBy(desc(analysisRequests.requestedAt))

  return <AdminDashboard requests={requests} />
}
