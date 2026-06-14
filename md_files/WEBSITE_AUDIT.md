# Website Audit Engine — Developer Integration Guide

## Overview

A self-contained website auditing engine that analyzes a single URL across **8
categories** and returns a structured result. Each finding includes a severity
level and, where applicable, an actionable fix with a code example.

The engine is plain JavaScript (Node.js) with no external services and **no API keys**. It is
designed to be dropped into an existing application — call one function, get back
a JSON-serializable object.

## The 8 audit categories

1. **UX & UI Analysis** — title, headings (h1), viewport, inline-style usage
2. **Navigation & Structure** — nav landmarks, internal/external links, link labels
3. **Page Speed** — response timing, payload size, compression (optional Lighthouse)
4. **Mobile Friendliness** — viewport config, fixed-width elements, media queries
5. **Trust Signals** — HTTPS, SSL certificate validity, security headers, privacy/contact
6. **Conversion (CRO)** — CTA presence, action language, above-the-fold CTA, social proof
7. **Forms & CTAs** — form field labels, form length, submit buttons
8. **Technical Health** — meta description, canonical, Open Graph, image alt text, robots.txt, sitemap.xml, structured data, lang attribute

## Dependencies

Two third-party npm packages are required. Everything else is the Node.js
standard library (`https`, `http`, `tls`, `net`, `child_process`, `url`).

```
node-fetch
cheerio
```

Install:

```bash
npm install node-fetch cheerio
```

### Open-source components, sources and licenses

These are the exact open-source projects the engine depends on. Use these
canonical sources (verified, not package mirrors) for any security or license
review.

| Component | Required? | Purpose | Canonical source | License |
|-----------|-----------|---------|------------------|---------|
| **node-fetch** | Yes | HTTP fetching | github.com/node-fetch/node-fetch | MIT |
| **cheerio** | Yes | HTML parsing | github.com/cheeriojs/cheerio | MIT |
| **Lighthouse** | Optional | Richer page-speed metrics (CLI, auto-detected) | github.com/GoogleChrome/lighthouse | Apache-2.0 |
| Node.js stdlib | Built-in | SSL checks, networking, parsing | nodejs.org | MIT |

Notes:
- **cheerio** is a fast, jQuery-like HTML parser for Node.js; install from npm
  as `cheerio` (import as `import * as cheerio from 'cheerio'`).
- **Lighthouse** is a Node.js CLI. It is entirely optional and is detected at
  runtime via `which lighthouse`; the engine works fully without it. Install via
  `npm install -g lighthouse` only if you want the extra metrics.
- All required components are MIT licensed, which is compatible with commercial
  and closed-source integration. Confirm against your own organization's policy.

## Integration — the one function you call

The engine exposes a single entry point:

```js
import { runAudit } from './audit.js'

const result = await runAudit('example.com')  // scheme optional; https:// is assumed
```

`runAudit(url)` returns an object (see the schema below). It performs one
HTTP GET to the target page plus small requests to `/robots.txt` and
`/sitemap.xml` at the site root. It never throws on normal failures — if the site
is unreachable it returns `{ error: '...' }` instead.

### Minimal usage

```js
import { runAudit } from './audit.js'

const result = await runAudit('https://example.com')

if (result.error) {
  handleError(result.error)
} else {
  console.log(result.overall)          // 0-100 overall score
  for (const section of result.sections) {
    console.log(section.name, section.score)
    for (const finding of section.findings) {
      console.log(finding.level, finding.text)
      if (finding.fix) console.log('  fix:', finding.fix)
    }
  }
}
```

## Output schema

`runAudit` returns:

```jsonc
{
  "url": "https://example.com",        // normalized input URL
  "final_url": "https://example.com/", // after redirects
  "status": 200,                       // HTTP status code
  "timestamp": "2026-01-01 12:00:00",
  "lighthouse": false,                 // true if Lighthouse was used for speed
  "overall": 78,                       // average of section scores, 0-100
  "action_count": 12,                  // number of findings that include a fix
  "sections": [
    {
      "name": "UX & UI Analysis",
      "key": "ux",                     // stable machine key
      "score": 80,                     // 0-100
      "findings": [
        {
          "level": "bad",              // "good" | "ok" | "bad" | "info"
          "text": "Page has no <title>.",
          "fix": "Add a unique, descriptive <title> (50-60 chars) inside <head>.",
          "code": "<title>Acme - Affordable Widgets</title>"
        }
        // ...more findings
      ]
    }
    // ...8 sections total
  ]
}
```

### Field reference

| Field | Type | Notes |
|-------|------|-------|
| `url` | string | Normalized target (scheme added if missing) |
| `final_url` | string | URL after following redirects |
| `status` | number | HTTP status of the fetched page |
| `timestamp` | string | Local time the audit ran |
| `lighthouse` | boolean | Whether Lighthouse produced the speed numbers |
| `overall` | number | Mean of the 8 section scores |
| `action_count` | number | Count of findings with a `fix` key |
| `sections[]` | array | Always 8 entries, in the order listed above |
| `sections[].key` | string | One of: `ux, nav, speed, mobile, trust, cro, forms, tech` |
| `findings[].level` | string | `good` (pass), `ok` (warn), `bad` (fail), `info` (neutral) |
| `findings[].fix` | string? | Present only when there is an action to take |
| `findings[].code` | string? | Present only when a code example helps; may contain newlines |

`fix` and `code` are **optional** — only present on findings that have an action.
A `good` or `info` finding usually has no `fix`.

## Error handling

```js
const result = await runAudit(url)
if (result.error) {
  // Site unreachable, DNS failure, timeout, etc.
  // result.error is a human-readable string.
}
```

`runAudit` catches all network exceptions and returns the error string rather than
throwing. The only key present in the error case is `{ error: '...' }`.

## Behavior notes / constraints

- **Single page**: audits only the URL given (plus root `robots.txt` and
  `sitemap.xml`). It is not a crawler.
- **Timeout**: HTTP requests use a 15-second timeout (`AbortSignal.timeout(15000)`).
- **User-Agent**: sends a desktop Chrome-like UA. Some sites behind bot
  protection (e.g. Cloudflare challenges) may block automated requests and
  return an error.
- **No rendering**: parses static HTML only. It does not execute JavaScript, so
  things that require a rendered DOM (computed color contrast, actual tap-target
  sizes) are reported as `info` tips, not scored.
- **Scoring**: each section starts at 100 and subtracts points per issue;
  `overall` is the mean. Thresholds are heuristic and can be tuned.

## Optional: richer page-speed metrics

If the **Lighthouse** CLI is installed on the host and on `PATH`, the engine
auto-detects it and uses it for the Page Speed section (adding FCP, LCP, TBT,
CLS, and a performance score). This is entirely optional and needs **no API
key**. If Lighthouse is absent, the engine falls back to built-in timing and
everything still works. To enable:

```bash
npm install -g lighthouse   # requires Node.js
```

Detection is automatic via `which lighthouse` using Node's `child_process`; no configuration needed.

## Async & performance

- `runAudit` is stateless and safe to call concurrently — it holds no shared
  mutable state. Run multiple audits in parallel with `Promise.all`.
- Typical run is bounded by network latency to the target site plus two small
  root requests. Without Lighthouse it is fast; with Lighthouse it can take
  significantly longer (headless browser run), so call it off the request path
  (e.g. a background job or queue) if you enable it.

```js
// Parallel audits
const [a, b] = await Promise.all([
  runAudit('https://example.com'),
  runAudit('https://other.com'),
])
```

## Suggested integration patterns

- **API route**: wrap `runAudit` in your existing API route and return the object
  as JSON directly (works in Next.js, Express, Fastify, etc.).
- **Background job**: for batch auditing or when Lighthouse is enabled, run
  `runAudit` in a worker/queue and persist the result.
- **Caching**: results are a function of the live page; cache by URL with a TTL
  that suits your needs.

## Files in this module

| File | Purpose |
|------|---------|
| `audit.js` | The engine. Contains `runAudit()` and the 8 per-section functions. |

Everything needed to integrate is in `audit.js`. Import `runAudit` and go.
