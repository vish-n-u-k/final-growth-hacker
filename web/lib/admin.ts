// GrowJin team accounts: the comma-separated ADMIN_EMAILS env var (same list the /admin pages use).
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const admins = (process.env.ADMIN_EMAILS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  return admins.includes(email.toLowerCase())
}
