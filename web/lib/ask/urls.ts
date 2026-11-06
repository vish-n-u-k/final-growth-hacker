// URL helpers shared by Ask's Google card and visibility score.

/** A page address compared without www, query, hash or a trailing slash. */
export const norm = (u: string) => {
  try { const x = new URL(u); x.hash = ''; x.search = ''; x.hostname = x.hostname.replace(/^www\./, ''); if (x.pathname !== '/' && x.pathname.endsWith('/')) x.pathname = x.pathname.slice(0, -1); return x.href } catch { return u }
}

/** The first folder of a page ("/p/"), or "Main pages" for top-level ones. */
export const section = (u: string) => {
  try { const p = new URL(u).pathname.split('/').filter(Boolean); return p.length > 1 ? `/${p[0]}/` : 'Main pages' } catch { return 'Main pages' }
}
