# Puppeteer — Removed (2026-09-25)

Puppeteer (headless Chrome) was removed from the app for now. Nothing in the codebase depends on it.

## What was removed

- `puppeteer` package (`^24.43.1`) — uninstalled from `package.json` / `package-lock.json`
- `lib/audit/browser.ts` — deleted. It exported `fetchWithBrowser(url, timeoutMs)`: launched headless Chrome, loaded the page (`waitUntil: 'domcontentloaded'`), returned `page.content()`, 5-min in-memory cache per URL.
- Browser fallback calls in:
  - `lib/audit/audit.ts` → `runAudit()` (Website module)
  - `lib/audit/seo-audit.ts` → `runSeoAudit()` (SEO module)
  - `lib/modules/foundation/fetcher.ts` → `fetchFoundationData()` (Foundation module, `/api/items/verify`, `/api/settings/playbook`, MCP `analyze_module`)

## Current behaviour

- Website / SEO audits: if the direct `fetch()` throws, the audit returns `{ error }` (same as before Puppeteer was added).
- Foundation: if `safeFetch()` (browser UA + retry with minimal headers) returns null, `extracted` is `null` and `jinaFallback` is `false` — the rule engine marks the site as not accessible.
- Kept (not Puppeteer-specific): response header capture, `status` variable, `responseTimeMs/ttfb = -1` "could not be measured" branches, `jinaFallback` flag, `safeFetch` retry logic.

## Why

- Full `puppeteer` bundles ~170MB Chrome — does not fit Vercel serverless functions.
- Launched a new Chrome per call with no concurrency limit.
- Only triggered when `fetch()` threw — never for 403/503 bot-challenge pages (which don't throw) or JS-rendered sites (200 with empty shell), so it rarely helped.
- Foundation set `jinaFallback: true` on browser success, so the rule engine discarded the real HTML and reported GA4/GSC/PostHog as "Cannot verify".
- Errors were swallowed silently (`catch { return null }`).

## If re-adding later

1. Use `puppeteer-core` + `@sparticuz/chromium` on Vercel (or run it in a separate worker service).
2. Trigger the fallback on blocked responses too (403/429/503, challenge pages) and on near-empty bodies (JS-rendered sites), not only on thrown errors.
3. Use `waitUntil: 'networkidle2'` (or wait for a selector) so JS-rendered content is present.
4. Capture response headers/status/timing from the Puppeteer response so security-header and speed checks aren't run on empty data.
5. Add a separate flag (e.g. `browserFallback`) — don't reuse `jinaFallback`, which tells the rule engine the HTML is unusable.
6. Reuse one browser instance and cap concurrency; log failures.
