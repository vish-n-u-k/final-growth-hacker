// Shared Finding type + constructor — kept in its own file so audit.ts and
// browser-audit.ts can both import it without a circular dependency
// (audit.ts calls into browser-audit.ts, which needs Finding/f).

export type FindingLevel = 'good' | 'ok' | 'bad' | 'info'

export interface Finding {
  key: string
  level: FindingLevel
  text: string
  fix?: string
  code?: string
}

export function f(key: string, level: FindingLevel, text: string, fix?: string, code?: string): Finding {
  const out: Finding = { key, level, text }
  if (fix) out.fix = fix
  if (code) out.code = code
  return out
}
