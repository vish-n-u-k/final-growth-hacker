// Real-browser UX checks (Playwright + a serverless Chromium binary).
//
// Everything in lib/audit/audit.ts works from the raw HTML (cheerio) or a
// hosted API (PageSpeed Insights) — none of it can see how the page actually
// renders or behaves. This file launches a real headless Chromium, loads the
// page, interacts with it (tab order, clicks, resizes, form submit), and
// takes screenshots for a Claude vision call to judge what a real visitor
// would see. It is the slowest, most failure-prone part of the audit, so
// every check here fails soft — a launch failure or a single check throwing
// returns fewer findings, never an exception that could take down the audit.

import { chromium as playwrightChromium, type Browser, type Page } from 'playwright-core'
import sparticuzChromium from '@sparticuz/chromium'
import type { Finding, FindingLevel } from './finding'
import { f } from './finding'
import { callAIVision, type VisionImage } from '@/lib/ai/client'

const NAV_TIMEOUT_MS = 20_000

async function launchBrowser(): Promise<Browser | null> {
  try {
    const executablePath = await sparticuzChromium.executablePath()
    return await playwrightChromium.launch({
      args: sparticuzChromium.args,
      executablePath,
      headless: true,
    })
  } catch (err) {
    console.error('[browser-audit] failed to launch browser:', err)
    return null
  }
}

// ── Keyboard tab order + focus traps ────────────────────────────────────────

async function checkKeyboardNav(page: Page): Promise<Finding[]> {
  try {
    await page.evaluate(() => (document.body as HTMLElement).focus())
    const visited = new Set<string>()
    let stuckStreak = 0
    let hiddenFocusCount = 0
    let prevKey = ''

    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab')
      // eslint-disable-next-line no-await-in-loop
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el || el === document.body) return null
        const rect = el.getBoundingClientRect()
        const style = getComputedStyle(el)
        const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
        return { tag: el.tagName, id: el.id, cls: (el.className ?? '').toString().slice(0, 40), visible }
      })
      if (!info) break
      const key = `${info.tag}#${info.id}.${info.cls}`
      if (key === prevKey) {
        stuckStreak++
        if (stuckStreak > 2) break
      } else {
        stuckStreak = 0
      }
      prevKey = key
      if (!info.visible) hiddenFocusCount++
      visited.add(key)
    }

    if (visited.size === 0) {
      return [f('keyboard-nav-order', 'info', 'Could not detect any keyboard-focusable elements to test tab order.')]
    }
    if (hiddenFocusCount > 0) {
      return [f('keyboard-nav-order', 'bad',
        `${hiddenFocusCount} of the first ${visited.size} tab stops land on a hidden or invisible element — keyboard users lose track of where focus went.`,
        'Remove tabindex from hidden elements, or make sure hidden elements are consistently display:none/visibility:hidden so they are skipped when tabbing.')]
    }
    return [f('keyboard-nav-order', 'good', `Tabbed through ${visited.size} focusable elements — no hidden focus traps detected.`)]
  } catch {
    return []
  }
}

// ── Visible focus states ────────────────────────────────────────────────────

async function checkFocusStates(page: Page): Promise<Finding[]> {
  try {
    const result = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('a[href], button, input, select, textarea')).slice(0, 15) as HTMLElement[]
      let noIndicator = 0
      let tested = 0
      for (const el of els) {
        const before = getComputedStyle(el)
        const beforeSig = before.outlineStyle + before.outlineWidth + before.boxShadow
        el.focus()
        const after = getComputedStyle(el)
        const afterSig = after.outlineStyle + after.outlineWidth + after.boxShadow
        el.blur()
        tested++
        if (beforeSig === afterSig) noIndicator++
      }
      return { tested, noIndicator }
    })
    if (result.tested === 0) return [f('focus-visible-states', 'info', 'No focusable elements found to test.')]
    if (result.noIndicator > 0) {
      return [f('focus-visible-states', result.noIndicator === result.tested ? 'bad' : 'ok',
        `${result.noIndicator} of ${result.tested} tested interactive elements show no visible change (outline/box-shadow) when focused.`,
        'Add a visible :focus-visible style (outline or box-shadow) to every interactive element — never remove the default outline without replacing it.')]
    }
    return [f('focus-visible-states', 'good', `All ${result.tested} tested interactive elements show a visible focus indicator.`)]
  } catch {
    return []
  }
}

// ── Cursor affordance on custom clickable elements ──────────────────────────

async function checkCursorAffordance(page: Page): Promise<Finding[]> {
  try {
    const result = await page.evaluate(() => {
      const clickable = Array.from(document.querySelectorAll('[onclick], [role="button"]')).filter(
        (el) => !['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName),
      ) as HTMLElement[]
      const sample = clickable.slice(0, 20)
      let missing = 0
      for (const el of sample) {
        if (getComputedStyle(el).cursor !== 'pointer') missing++
      }
      return { total: sample.length, missing }
    })
    if (result.total === 0) return [f('cursor-affordance', 'info', 'No custom clickable (non-link/non-button) elements found to test.')]
    if (result.missing > 0) {
      return [f('cursor-affordance', 'ok',
        `${result.missing} of ${result.total} custom clickable elements don't show a pointer cursor on hover.`,
        'Add cursor: pointer to any element with a click handler that isn\'t a native <a> or <button>.')]
    }
    return [f('cursor-affordance', 'good', `All ${result.total} custom clickable elements show a pointer cursor.`)]
  } catch {
    return []
  }
}

// ── Horizontal scroll + breakpoint coverage (320-1440px) ────────────────────

async function checkBreakpoints(page: Page): Promise<Finding[]> {
  const widths = [320, 375, 768, 1024, 1440]
  const broken: number[] = []
  try {
    for (const w of widths) {
      // eslint-disable-next-line no-await-in-loop
      await page.setViewportSize({ width: w, height: 900 })
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(150)
      // eslint-disable-next-line no-await-in-loop
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
      if (overflow) broken.push(w)
    }
  } catch {
    return []
  }

  const findings: Finding[] = []
  const mobileBroken = broken.filter((w) => w <= 375)
  if (mobileBroken.length > 0) {
    findings.push(f('horizontal-scroll-mobile', 'bad',
      `Page has horizontal scroll at ${mobileBroken.join('px, ')}px width — content overflows the mobile viewport.`,
      'Find the element causing the overflow (often a fixed-width container, table, or an unwrapped long word/URL) and constrain it to max-width: 100%.'))
  } else {
    findings.push(f('horizontal-scroll-mobile', 'good', 'No horizontal scroll detected at 320-375px viewport widths.'))
  }

  if (broken.length > 0) {
    findings.push(f('breakpoint-coverage', 'bad',
      `Layout overflows horizontally at: ${broken.join('px, ')}px.`,
      'Test the layout at each of these widths in DevTools — usually a fixed px width or a flex/grid item that refuses to wrap or shrink.'))
  } else {
    findings.push(f('breakpoint-coverage', 'good', `No layout overflow detected across ${widths.join('px, ')}px viewport widths.`))
  }
  return findings
}

// ── Mobile nav (hamburger) interaction ──────────────────────────────────────

async function checkMobileNav(page: Page): Promise<{ findings: Finding[]; before?: VisionImage; after?: VisionImage }> {
  try {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.waitForTimeout(150)
    const hamburger = page.locator(
      '[aria-label*="menu" i], [aria-label*="navigation" i], button.hamburger, button[class*="menu" i], button[class*="burger" i]',
    ).first()
    if (await hamburger.count() === 0) {
      return { findings: [f('mobile-nav-interaction', 'info', 'No mobile menu/hamburger button found to test.')] }
    }

    const beforeBuf = await page.screenshot({ type: 'jpeg', quality: 60 })
    await hamburger.click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(400)
    const afterBuf = await page.screenshot({ type: 'jpeg', quality: 60 })

    const expandedAfter = await hamburger.getAttribute('aria-expanded').catch(() => null)
    const navVisible = await page.evaluate(() => {
      const nav = document.querySelector('nav, [role="navigation"]')
      if (!nav) return null
      const style = getComputedStyle(nav)
      const rect = nav.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    })

    const before: VisionImage = { label: 'Mobile menu — before tap', base64: beforeBuf.toString('base64'), mediaType: 'image/jpeg' }
    const after: VisionImage = { label: 'Mobile menu — after tap', base64: afterBuf.toString('base64'), mediaType: 'image/jpeg' }

    if (expandedAfter === 'true' || navVisible) {
      return { findings: [f('mobile-nav-interaction', 'good', 'The mobile menu button opens the navigation when tapped.')], before, after }
    }
    return {
      findings: [f('mobile-nav-interaction', 'ok',
        'Found a mobile menu button, but could not confirm the navigation opens when tapped (no aria-expanded change or visible nav detected).',
        'Make sure the menu button toggles aria-expanded and reveals the nav menu, so both sighted and screen reader users get confirmation it worked.')],
      before, after,
    }
  } catch {
    return { findings: [] }
  }
}

// ── Form submit: validation feedback + loading/disabled state ──────────────

async function checkFormSubmit(page: Page): Promise<Finding[]> {
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    if (await page.locator('form').count() === 0) {
      return [
        f('form-submit-error-handling', 'info', 'No forms found on the page.'),
        f('loading-disabled-submit-state', 'info', 'No forms found on the page.'),
      ]
    }
    const form = page.locator('form').first()
    const submitBtn = form.locator('button[type="submit"], input[type="submit"], button:not([type="button"]):not([type="reset"])').first()
    if (await submitBtn.count() === 0) {
      return [
        f('form-submit-error-handling', 'info', 'Could not find a submit button to test.'),
        f('loading-disabled-submit-state', 'info', 'Could not find a submit button to test.'),
      ]
    }

    const beforeDisabled = await submitBtn.isDisabled().catch(() => false)
    const beforeText = ((await submitBtn.textContent().catch(() => '')) ?? '').trim()
    await submitBtn.click({ timeout: 3000, force: true }).catch(() => {})
    await page.waitForTimeout(500)
    const afterDisabled = await submitBtn.isDisabled().catch(() => beforeDisabled)
    const afterText = ((await submitBtn.textContent().catch(() => beforeText)) ?? '').trim()
    const stateChanged = afterDisabled !== beforeDisabled || afterText !== beforeText

    const hasInvalid = await page.evaluate(() => document.querySelectorAll(':invalid').length > 0)
    const hasVisibleErrorText = await page.evaluate(() => {
      const candidates = document.querySelectorAll('[class*="error" i], [role="alert"], .invalid-feedback')
      return Array.from(candidates).some((el) => (el.textContent ?? '').trim().length > 0 && getComputedStyle(el).display !== 'none')
    })

    const findings: Finding[] = []
    if (hasInvalid || hasVisibleErrorText) {
      findings.push(f('form-submit-error-handling', 'good', 'Submitting the form empty triggers visible validation feedback.'))
    } else {
      findings.push(f('form-submit-error-handling', 'ok',
        'Submitting the form empty did not show any visible validation error — could not confirm required-field feedback.',
        'Make sure every required field shows a clear, specific inline error when submitted empty (native HTML5 validation or a visible custom message).'))
    }
    if (stateChanged) {
      findings.push(f('loading-disabled-submit-state', 'good', 'The submit button visibly changes state (disabled and/or label) immediately after being clicked.'))
    } else {
      findings.push(f('loading-disabled-submit-state', 'ok',
        'The submit button showed no visible change (disabled state or label) immediately after being clicked.',
        'Disable the submit button and/or show a loading label while the request is in flight, so users don\'t double-submit.'))
    }
    return findings
  } catch {
    return []
  }
}

// ── Empty-state (no search results) ─────────────────────────────────────────

async function checkEmptyState(page: Page): Promise<{ shot?: VisionImage }> {
  try {
    const searchInput = page.locator('input[type="search"], input[name*="search" i], input[placeholder*="search" i]').first()
    if (await searchInput.count() === 0) return {}
    await searchInput.fill('zzzznonexistentqueryxyz123')
    await searchInput.press('Enter').catch(() => {})
    await page.waitForTimeout(800)
    const buf = await page.screenshot({ type: 'jpeg', quality: 60 })
    return { shot: { label: 'Empty search-results state', base64: buf.toString('base64'), mediaType: 'image/jpeg' } }
  } catch {
    return {}
  }
}

// ── Vision judgment on all captured screenshots (one batched call) ─────────

async function auditVisualJudgment(images: VisionImage[]): Promise<Finding[]> {
  if (images.length === 0) return []
  const hasSecondPage = images.some((i) => i.label.includes('Second page'))
  const hasNavShots = images.some((i) => i.label.includes('Mobile menu'))
  const hasEmptyState = images.some((i) => i.label.includes('Empty search'))

  const raw = await callAIVision({
    system: 'You are a senior UX/visual designer auditing a real website from its screenshots. Judge only what you can actually see — do not assume anything not visible. Be specific: reference actual colors, positions, and elements you see.',
    prompt: `Evaluate the screenshots above and return a JSON array of findings, one object per check below: "slug", "level" ("good"/"ok"/"bad"/"info"), "text" (1 sentence, specific to what you see), "fix" (1 actionable sentence, omit if level is "good").

1. slug "hero-cta-prominence": In the hero screenshots, is there one clear, visually prominent primary call-to-action above the fold?
2. slug "competing-ctas": Are there multiple CTAs competing for attention with similar visual weight, making it unclear which action to take first?
3. slug "icon-consistency": Are the icons visible across the screenshots consistent in style, stroke width, and sizing? Use "info" if few/no icons are visible.
4. slug "whitespace-rhythm": Does the layout have a consistent, breathable spacing rhythm, or does it feel cramped/inconsistent?
5. slug "text-legibility-busy-bg": Is any text placed over a busy, gradient, or photo background hard to read? Use "good" if all text sits on a clean/solid background.
6. slug "color-not-only-indicator": Is there any status or state shown only via color with no icon or text label (e.g. a red vs green dot with no other cue)? Use "info" if none is visible.
7. slug "trust-badges-placement": Are trust signals (badges, testimonials, logos, ratings) visible near key conversion points (near CTAs/forms)? Use "info" if not enough of the page is visible to judge.
8. slug "brand-consistency": ${hasSecondPage ? 'Compare the two page screenshots — is branding (logo, colors, typography) consistent between them?' : 'Only one page was captured — return level "info" noting a second page was not available to compare.'}
9. slug "mobile-nav-visual-quality": ${hasNavShots ? 'Compare the before/after mobile menu screenshots — does the menu open cleanly and look polished, or does it look broken/overlapping/glitchy?' : 'No mobile menu screenshots were captured — return level "info".'}
10. slug "empty-state-quality": ${hasEmptyState ? 'Judge the empty search-results screenshot — is it a helpful, on-brand empty state (explains no results, suggests next steps), or a blank/broken/generic one?' : 'No empty-state screenshot was captured (no search input found on the page) — return level "info".'}

Return ONLY a valid JSON array, no markdown fences, no text outside the array.`,
    images,
    maxTokens: 1800,
    model: 'claude-sonnet-4-6',
  })

  if (!raw) return []
  const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()
  try {
    const rows = JSON.parse(clean) as { slug: string; level: FindingLevel; text: string; fix?: string }[]
    return rows
      .filter((r) => r.slug && r.text && (r.level === 'good' || r.level === 'ok' || r.level === 'bad' || r.level === 'info'))
      .map((r) => f(r.slug, r.level, r.text, r.fix))
  } catch (err) {
    console.error('[browser-audit] vision JSON parse failed:', err, '\nraw response:', raw)
    return []
  }
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function runBrowserAudit(url: string): Promise<Finding[]> {
  const browser = await launchBrowser()
  if (!browser) return []

  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(NAV_TIMEOUT_MS)
    await page.setViewportSize({ width: 375, height: 812 })

    try {
      await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS })
    } catch (err) {
      console.error('[browser-audit] navigation failed:', err)
      return []
    }

    const images: VisionImage[] = []

    // Mobile hero screenshot (before any interaction touches the page)
    try {
      const mobileBuf = await page.screenshot({ type: 'jpeg', quality: 65 })
      images.push({ label: 'Mobile hero (375px)', base64: mobileBuf.toString('base64'), mediaType: 'image/jpeg' })
    } catch { /* non-fatal */ }

    // Grab one internal nav link for the cross-page brand-consistency check
    const secondPageUrl = await page.evaluate((currentUrl: string) => {
      const host = new URL(currentUrl).hostname
      const links = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[]
      for (const a of links) {
        try {
          const abs = new URL(a.href, currentUrl)
          if (abs.hostname === host && abs.href !== currentUrl && !abs.hash) return abs.href
        } catch { /* skip malformed */ }
      }
      return null
    }, url).catch(() => null)

    const deterministicFindings: Finding[] = []
    deterministicFindings.push(...await checkKeyboardNav(page))
    deterministicFindings.push(...await checkFocusStates(page))
    deterministicFindings.push(...await checkCursorAffordance(page))

    const navResult = await checkMobileNav(page)
    deterministicFindings.push(...navResult.findings)
    if (navResult.before) images.push(navResult.before)
    if (navResult.after) images.push(navResult.after)

    const emptyStateResult = await checkEmptyState(page)
    if (emptyStateResult.shot) images.push(emptyStateResult.shot)

    deterministicFindings.push(...await checkBreakpoints(page))

    // Fresh reload at desktop size for the form-submit test and desktop hero shot
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.reload({ waitUntil: 'load', timeout: NAV_TIMEOUT_MS }).catch(() => {})
    try {
      const desktopBuf = await page.screenshot({ type: 'jpeg', quality: 65 })
      images.push({ label: 'Desktop hero (1440px)', base64: desktopBuf.toString('base64'), mediaType: 'image/jpeg' })
    } catch { /* non-fatal */ }
    deterministicFindings.push(...await checkFormSubmit(page))

    // Second page for brand-consistency (best-effort, bounded time)
    if (secondPageUrl) {
      try {
        const secondPage = await browser.newPage()
        secondPage.setDefaultTimeout(10_000)
        await secondPage.setViewportSize({ width: 1440, height: 900 })
        await secondPage.goto(secondPageUrl, { waitUntil: 'load', timeout: 10_000 })
        const secondBuf = await secondPage.screenshot({ type: 'jpeg', quality: 60 })
        images.push({ label: 'Second page (brand consistency)', base64: secondBuf.toString('base64'), mediaType: 'image/jpeg' })
        await secondPage.close()
      } catch { /* non-fatal — skip brand-consistency comparison */ }
    }

    const visualFindings = await auditVisualJudgment(images)

    return [...deterministicFindings, ...visualFindings]
  } catch (err) {
    console.error('[browser-audit] unexpected failure:', err)
    return []
  } finally {
    await browser.close().catch(() => {})
  }
}
