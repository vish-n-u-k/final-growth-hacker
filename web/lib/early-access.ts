// Early-access users: every Growth Path module is open (no "previous module must reach 80%" lock)
// and the coming-soon tools are live. The list is the EARLY_ACCESS_EMAILS env var, comma-separated.
export function hasEarlyAccess(email: string | null | undefined): boolean {
  if (!email) return false
  const emails = (process.env.EARLY_ACCESS_EMAILS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  return emails.includes(email.toLowerCase())
}
