// Names and fill-ins for "Add your own emails" (lib/agents/own-list.ts). No server imports, so the
// page uses the same rules for its previews.

export const MAX_LIST = 100
export interface Person { email: string; first: string; company: string }
export interface Skipped { email: string; why: string }

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const GENERIC = /^(hello|hi|hey|info|contact|team|sales|support|admin|office|mail|enquiries|enquiry|help|booking|bookings|orders|hr|jobs|careers|marketing|accounts|billing|noreply|no-reply)$/i
// Personal mailboxes (no company in the address): the company is left out and the email says "your business"
const FREE = /^(gmail|googlemail|yahoo|ymail|rocketmail|outlook|hotmail|live|msn|windowslive|icloud|me|mac|aol|proton|protonmail|pm|tuta|tutanota|gmx|web|zoho|yandex|mail|email|inbox|fastmail|hey|duck|mailbox|posteo|rediffmail|rediff|sify|qq|163|126|naver|daum|comcast|verizon|att|sbcglobal|bellsouth|cox|charter|btinternet|sky|virginmedia|orange|wanadoo|free|laposte|libero|t-online|freenet|bigpond|optusnet|shaw|rogers|sympatico|telus|seznam|wp|o2|interia|onet|example|test|yopmail|mailinator|guerrillamail)\./i
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()

/** First name and company for an address: the name given in the file, else guessed from the email. */
export function personFrom(email: string, name?: string): Person {
  const e = email.trim().toLowerCase()
  const [local, domain = ''] = e.split('@')
  let first = (name ?? '').trim().split(/\s+/)[0] ?? ''
  if (first.includes('@')) first = ''
  if (!first) {
    const part = local.split(/[._+-]/)[0]
    if (!GENERIC.test(part) && /^[a-z]{2,15}$/.test(part)) first = cap(part)
  }
  const company = FREE.test(domain) ? '' : domain.split('.')[0].replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  return { email: e, first: first ? cap(first) : '', company }
}

/** {first name} and {company} filled in for one person. With no name, "Hi {first name}," becomes "Hi,". */
export function fillFor(text: string, p: Pick<Person, 'first' | 'company'>): string {
  return text
    .replace(/(Hi|Hello|Hey|Dear)\s*\{first name\},/gi, (_m, hi: string) => (p.first ? `${hi} ${p.first},` : `${hi},`))
    .replace(/\{first name\}/gi, p.first || 'there')
    .replace(/\{company\}/gi, p.company || 'your business')
}

/** Emails (and a name after them, if any) out of pasted text, one person per line. */
export function readPasted(text: string): { email: string; name?: string }[] {
  const out: { email: string; name?: string }[] = []
  for (const line of text.split(/\r?\n/)) {
    for (const m of line.matchAll(/[\w.+'-]+@[\w-]+(\.[\w-]+)+/g)) {
      const name = line.replace(m[0], ' ').replace(/[,;<>"()\t|]+/g, ' ').replace(/\S+@\S+/g, ' ').trim()
      out.push({ email: m[0].toLowerCase(), name: name && !/\./.test(name.split(/\s+/)[0]) ? name.slice(0, 80) : undefined })
    }
  }
  return out
}
