// Pages whose HTML is an empty shell filled in by JavaScript in the browser (React/Vite/Vue
// single-page apps). Our audits read the HTML before any JavaScript runs, so content checks
// (headings, links, buttons, testimonials…) can't be judged on them, and AI crawlers that
// don't run JavaScript see an empty page too.

import type * as cheerio from 'cheerio'

export const JS_SHELL_SKIP = 'Couldn\'t check: this page builds its content with JavaScript, so it isn\'t in the HTML we read (see "Content visible without JavaScript").'

export function isJsShell($: cheerio.CheerioAPI): boolean {
  const body = $('body').clone()
  body.find('script, style, noscript, template, svg').remove()
  const text = body.text().replace(/\s+/g, ' ').trim()
  if (text.length >= 200) return false
  const hasApp = $('script[type="module"]').length > 0 ||
    $('#root, #app, #__next, #__nuxt, #svelte, [data-reactroot], app-root').length > 0
  const scripts = $('script[src]').length
  return hasApp || scripts > 0
}
