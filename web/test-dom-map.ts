/**
 * Quick test for DOM map + patch functions.
 * Run with: npx tsx test-dom-map.ts
 */

import { buildDomMap, applyPatches } from './lib/modules/seo/fix-agent'

const SAMPLE_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Acme Corp | Home</title>
  <meta name="description" content="We build software for teams." />
</head>
<body>
  <header>
    <nav><a href="/">Home</a></nav>
  </header>
  <main>
    <section class="hero">
      <h2>Welcome to Acme</h2>
      <img src="/images/hero.jpg" alt="" />
      <p>We help teams move faster.</p>
    </section>
    <section class="team">
      <h2>Our Team</h2>
      <img src="/images/team.png" alt="" />
      <img src="/images/office.jpg" alt="Our office" />
    </section>
  </main>
  <footer>
    <p>© 2025 Acme Corp</p>
  </footer>
</body>
</html>`

async function main() {
  // ── Test 1: buildDomMap ──────────────────────────────────────────────────
  console.log('\n=== TEST 1: buildDomMap ===\n')
  const domMap = buildDomMap(SAMPLE_HTML)
  console.log(JSON.stringify(domMap, null, 2))

  console.log('\n--- Checks ---')
  console.log('sections:', domMap.sections)
  console.log('headings count:', domMap.headings.length)
  console.log('images count:', domMap.images.length)
  console.log('images with empty alt:', domMap.images.filter(i => i.alt === null).length)

  // ── Test 2: hardcoded patches (no AI call) ───────────────────────────────
  console.log('\n=== TEST 2: hardcoded patches (no AI) ===\n')
  const patches = [
    { action: 'setAttribute' as const, selector: 'img[src="/images/hero.jpg"]', attribute: 'alt', value: 'Acme Corp hero banner' },
    { action: 'setAttribute' as const, selector: 'img[src="/images/team.png"]',  attribute: 'alt', value: 'Acme Corp team members' },
  ]
  console.log('Patches:', JSON.stringify(patches, null, 2))

  // ── Test 3: applyPatches ─────────────────────────────────────────────────
  console.log('\n=== TEST 3: applyPatches ===\n')
  const modified = applyPatches(SAMPLE_HTML, patches)

  // Extract just the img tags from the result for easy inspection
  const imgMatches = modified.match(/<img[^>]+>/g) ?? []
  console.log('Image tags after patch:')
  imgMatches.forEach(tag => console.log(' ', tag))

  // Verify all alts are now non-empty
  const emptyAlts = imgMatches.filter(tag => /alt=""/.test(tag) || !/alt=/.test(tag))
  console.log('\nImages still missing alt text:', emptyAlts.length === 0 ? 'NONE ✓' : emptyAlts)
}

main().catch(console.error)
