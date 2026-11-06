import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/server-session'
import { hasEarlyAccess } from '@/lib/early-access'
import { askIsHome } from '@/lib/features'

/** Today and Growth Path call this first: when Ask is home (lib/features.ts), they send people to /ask. */
export async function sendToAskIfHome(): Promise<void> {
  const user = await getSessionUser()
  if (user && askIsHome(await hasEarlyAccess(user.email))) redirect('/ask')
}
