// Plain text from a Gmail API message payload (format=full)

export interface GmailPart {
  mimeType: string
  headers?: { name: string; value: string }[]
  body?: { data?: string }
  parts?: GmailPart[]
}

function decodeBase64(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
}

export function extractText(payload: GmailPart): string {
  if (payload.body?.data) {
    const text = decodeBase64(payload.body.data)
    return payload.mimeType === 'text/html' ? stripHtml(text) : text
  }
  if (!payload.parts) return ''
  for (const part of payload.parts) {
    if (part.mimeType === 'text/plain' && part.body?.data) return decodeBase64(part.body.data)
  }
  for (const part of payload.parts) {
    if (part.mimeType.startsWith('multipart/')) {
      const nested = extractText(part)
      if (nested) return nested
    }
  }
  for (const part of payload.parts) {
    if (part.mimeType === 'text/html' && part.body?.data) return stripHtml(decodeBase64(part.body.data))
  }
  return ''
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Drops the quoted original ("On … wrote:" and "> " lines) so only the new reply remains. */
export function stripQuoted(text: string): string {
  const cut = text.search(/^\s*On .{5,200}wrote:\s*$/m)
  const body = cut > 0 ? text.slice(0, cut) : text
  return body.split('\n').filter((l) => !l.trimStart().startsWith('>')).join('\n').trim()
}
