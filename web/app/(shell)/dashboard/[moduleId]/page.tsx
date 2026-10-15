import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { modules } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { getSessionUser, getBrandForUser } from '@/lib/server-session'

// Old-style module links (/dashboard/<module id>, e.g. in emails and cached Today cards) open that
// module on Growth Path, which picks a module by type (?module=seo) and a check by slug (&item=).
export default async function ModulePage({ params, searchParams }: { params: Promise<{ moduleId: string }>; searchParams: Promise<{ item?: string }> }) {
  const [{ moduleId }, { item }] = await Promise.all([params, searchParams])
  const user = await getSessionUser()
  const brand = user ? await getBrandForUser(user.id) : null
  const [mod] = brand && /^[0-9a-f-]{36}$/i.test(moduleId)
    ? await db.select({ type: modules.type }).from(modules).where(and(eq(modules.id, moduleId), eq(modules.brandId, brand.id))).limit(1)
    : []
  if (!mod) redirect('/dashboard')
  redirect(`/dashboard?module=${encodeURIComponent(mod.type)}${item ? `&item=${encodeURIComponent(item)}` : ''}`)
}
