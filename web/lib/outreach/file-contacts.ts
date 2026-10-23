import readExcelFile from 'read-excel-file/node'
import { extractText, getDocumentProxy } from 'unpdf'
import mammoth from 'mammoth'

// Pulls email contacts out of an uploaded file for Email Outreach → "Who should get it?".
// Spreadsheets (CSV, TSV, Excel) use their columns: the email column, plus a name and a website
// column when there is one. Contact cards (.vcf) use FN / EMAIL. Anything else (PDF, Word, text)
// is read as text and every email address in it is taken. No AI: what's in the file is what's added.

export interface FileContact { email: string; name: string; domain: string }

export const MAX_FILE_BYTES = 5 * 1024 * 1024
export const ACCEPTED = ['.csv', '.tsv', '.txt', '.vcf', '.xlsx', '.pdf', '.docx'] as const
const MAX_CONTACTS = 2000

export class FileContactsError extends Error {}

const EMAIL_RE = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const NOT_EMAIL = /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i
// Webmail addresses say nothing about the person's website
const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'yandex.com', 'zoho.com'])

type Row = string[]

function cleanEmail(raw: string): string | null {
  const e = raw.trim().replace(/^mailto:/i, '').replace(/[.,;:]+$/, '').toLowerCase()
  return e.match(EMAIL_RE)?.[0] === e && !NOT_EMAIL.test(e) ? e : null
}

function domainOf(email: string, website = ''): string {
  const w = website.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '')
  if (w.includes('.')) return w.toLowerCase()
  const d = email.split('@')[1] ?? ''
  return FREE_MAIL.has(d) ? '' : d
}

/** Minimal CSV/TSV parser: quoted fields, doubled quotes, newlines inside quotes. */
function parseDelimited(text: string, sep: string): Row[] {
  const rows: Row[] = []
  let row: string[] = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === sep) { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(v => v.trim()))
}

function fromRows(rows: Row[]): FileContact[] {
  if (!rows.length) return []
  const header = rows[0].map(h => h.trim().toLowerCase())
  const col = (re: RegExp) => header.findIndex(h => re.test(h))
  const emailCol = col(/e-?mail/)
  if (emailCol === -1 || cleanEmail(rows[0][emailCol] ?? '')) {
    // No header row. "email, name, website" rows (the paste box's format) keep the name and
    // website; otherwise every email in every cell is taken
    return rows.flatMap(r => {
      const first = cleanEmail(r[0] ?? '')
      if (first) return [{ email: first, name: (r[1] ?? '').trim(), domain: domainOf(first, r[2] ?? '') }]
      return r.flatMap(cell => [...cell.matchAll(EMAIL_RE)].map(m => cleanEmail(m[0])))
        .filter((e): e is string => !!e)
        .map(email => ({ email, name: '', domain: domainOf(email) }))
    })
  }
  const nameCol  = col(/^(full ?name|name|contact( name)?|person)$/)
  const firstCol = col(/^first[ _-]?name$/)
  const lastCol  = col(/^(last[ _-]?name|surname)$/)
  const siteCol  = col(/website|domain|url|site/)
  return rows.slice(1).flatMap(r => {
    const email = cleanEmail(r[emailCol] ?? '')
    if (!email) return []
    const name = nameCol >= 0 ? r[nameCol] ?? ''
      : [firstCol >= 0 ? r[firstCol] : '', lastCol >= 0 ? r[lastCol] : ''].filter(Boolean).join(' ')
    return [{ email, name: name.trim(), domain: domainOf(email, siteCol >= 0 ? r[siteCol] ?? '' : '') }]
  })
}

function fromVCards(text: string): FileContact[] {
  return text.split(/BEGIN:VCARD/i).slice(1).flatMap(card => {
    const name = card.match(/^FN[^:]*:(.*)$/im)?.[1]?.trim() ?? ''
    return [...card.matchAll(/^(?:item\d+\.)?EMAIL[^:]*:(.*)$/gim)]
      .map(m => cleanEmail(m[1])).filter((e): e is string => !!e)
      .map(email => ({ email, name, domain: domainOf(email) }))
  })
}

function fromText(text: string): FileContact[] {
  return [...text.matchAll(EMAIL_RE)].map(m => cleanEmail(m[0])).filter((e): e is string => !!e)
    .map(email => ({ email, name: '', domain: domainOf(email) }))
}

export async function contactsFromFile(name: string, data: Buffer): Promise<FileContact[]> {
  const ext = name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? ''
  let found: FileContact[]
  switch (ext) {
    case '.csv': case '.tsv': case '.txt': {
      const text = data.toString('utf-8').replace(/^﻿/, '')
      const firstLine = text.split(/\r?\n/, 1)[0]
      const sep = ext === '.tsv' || firstLine.includes('\t') ? '\t' : firstLine.includes(';') && !firstLine.includes(',') ? ';' : ','
      found = ext === '.txt' && !/e-?mail/i.test(firstLine) ? fromText(text) : fromRows(parseDelimited(text, sep))
      break
    }
    case '.vcf':
      found = fromVCards(data.toString('utf-8'))
      break
    case '.xlsx': {
      const sheets = await readExcelFile(data)
      found = sheets.flatMap(s => fromRows(s.data.map(r => r.map(v => v == null ? '' : v instanceof Date ? v.toISOString() : String(v)))))
      break
    }
    case '.pdf': {
      const pdf = await getDocumentProxy(new Uint8Array(data))
      const { text } = await extractText(pdf, { mergePages: true })
      found = fromText(text)
      break
    }
    case '.docx': {
      const { value } = await mammoth.extractRawText({ buffer: data })
      found = fromText(value)
      break
    }
    case '.xls': case '.doc':
      throw new FileContactsError(`Old ${ext} files can't be read. Save it as ${ext === '.xls' ? '.xlsx or .csv' : '.docx or .pdf'} and try again.`)
    default:
      throw new FileContactsError(`Can't read ${ext || 'that'} files. Use ${ACCEPTED.join(', ')}.`)
  }

  // One entry per address; keep the first name / website seen for it
  const byEmail = new Map<string, FileContact>()
  for (const c of found) {
    const prev = byEmail.get(c.email)
    if (!prev) byEmail.set(c.email, c)
    else byEmail.set(c.email, { email: c.email, name: prev.name || c.name, domain: prev.domain || c.domain })
  }
  return [...byEmail.values()].slice(0, MAX_CONTACTS)
}
