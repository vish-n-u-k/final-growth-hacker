import Anthropic from '@anthropic-ai/sdk'
import * as cheerio from 'cheerio'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Framework detection ───────────────────────────────────────────────────────

export function detectFramework(packageJsonContent: string): string {
  try {
    const pkg = JSON.parse(packageJsonContent) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    if (deps['next']) return 'Next.js'
    if (deps['astro']) return 'Astro'
    if (deps['gatsby']) return 'Gatsby'
    if (deps['nuxt'] || deps['nuxt3']) return 'Nuxt.js'
    if (deps['remix'] || deps['@remix-run/react']) return 'Remix'
    if (deps['@sveltejs/kit']) return 'SvelteKit'
    if (deps['vue'] || deps['@vue/core']) return 'Vue.js'
    return 'static HTML'
  } catch {
    return 'static HTML'
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// ── Brand context ─────────────────────────────────────────────────────────────

export interface BrandContext {
  name: string
  websiteUrl: string
  industry?: string | null
  targetAudience?: string | null
  usp?: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// PATH 1 — TEMPLATE (no AI)
// Head tag fixes where the value is fully deterministic.
// Returns the complete modified HTML string.
// ─────────────────────────────────────────────────────────────────────────────

export function applyTemplateFix(html: string, slug: string, brand: BrandContext): string {
  const $ = cheerio.load(html, { decodeEntities: false })

  switch (slug) {

    // ── Canonical ────────────────────────────────────────────────────────────
    case 'canonical.present':
    case 'canonical.self':
    case 'canonical.same_domain': {
      if ($('link[rel="canonical"]').length) {
        $('link[rel="canonical"]').attr('href', brand.websiteUrl)
      } else {
        $('head').append(`\n  <link rel="canonical" href="${brand.websiteUrl}" />`)
      }
      break
    }

    // ── Remove noindex ────────────────────────────────────────────────────────
    case 'robots.noindex': {
      $('meta[name="robots"]').each((_, el) => {
        if (/noindex/i.test($(el).attr('content') ?? '')) $(el).remove()
      })
      $('meta[name="googlebot"]').each((_, el) => {
        if (/noindex/i.test($(el).attr('content') ?? '')) $(el).remove()
      })
      break
    }

    // ── Open Graph — copy from existing head tags ─────────────────────────────
    case 'og.title': {
      const title = $('title').text().trim() || brand.name
      if ($('meta[property="og:title"]').length) {
        $('meta[property="og:title"]').attr('content', title)
      } else {
        $('head').append(`\n  <meta property="og:title" content="${escapeAttr(title)}" />`)
      }
      break
    }

    case 'og.description': {
      const desc = $('meta[name="description"]').attr('content') ?? ''
      if (!desc) break  // nothing to copy — og.description needs description.present fixed first
      if ($('meta[property="og:description"]').length) {
        $('meta[property="og:description"]').attr('content', desc)
      } else {
        $('head').append(`\n  <meta property="og:description" content="${escapeAttr(desc)}" />`)
      }
      break
    }

    case 'og.url': {
      if ($('meta[property="og:url"]').length) {
        $('meta[property="og:url"]').attr('content', brand.websiteUrl)
      } else {
        $('head').append(`\n  <meta property="og:url" content="${brand.websiteUrl}" />`)
      }
      break
    }

    case 'og.type': {
      if (!$('meta[property="og:type"]').length) {
        $('head').append(`\n  <meta property="og:type" content="website" />`)
      }
      break
    }

    // ── Viewport ──────────────────────────────────────────────────────────────
    case 'mobile.viewport': {
      const content = 'width=device-width, initial-scale=1'
      if ($('meta[name="viewport"]').length) {
        $('meta[name="viewport"]').attr('content', content)
      } else {
        $('head').prepend(`\n  <meta name="viewport" content="${content}" />`)
      }
      break
    }

    // ── Twitter card ──────────────────────────────────────────────────────────
    case 'schema.twitter-card': {
      if (!$('meta[name="twitter:card"]').length) {
        const title = $('title').text().trim() || brand.name
        const desc = $('meta[name="description"]').attr('content') ?? ''
        $('head').append(
          `\n  <meta name="twitter:card" content="summary_large_image" />` +
          `\n  <meta name="twitter:title" content="${escapeAttr(title)}" />` +
          `\n  <meta name="twitter:description" content="${escapeAttr(desc)}" />`
        )
      }
      break
    }

    // ── Images ────────────────────────────────────────────────────────────────
    case 'image.lazyload': {
      // Skip the first image (likely LCP candidate above the fold)
      $('img').slice(1).each((_, el) => {
        if (!$(el).attr('loading')) $(el).attr('loading', 'lazy')
      })
      break
    }

    case 'alt.present': {
      // Add empty alt to every img missing the attribute entirely
      $('img:not([alt])').attr('alt', '')
      break
    }

    default:
      throw new Error(`No template fix defined for slug: ${slug}`)
  }

  return $.html()
}

// ─────────────────────────────────────────────────────────────────────────────
// PATH 2 — VALUE (tiny AI call + cheerio apply)
// AI returns only the new string value. We apply it ourselves.
// ─────────────────────────────────────────────────────────────────────────────

// Step 2a — ask AI for just the value string
export async function getValueFromAI(
  slug: string,
  brand: BrandContext,
  aiDetail: string,
  aiAction: string,
): Promise<string> {
  const brandCtx = [
    `Brand: ${brand.name}`,
    `Website: ${brand.websiteUrl}`,
    brand.industry       ? `Industry: ${brand.industry}`             : null,
    brand.targetAudience ? `Target audience: ${brand.targetAudience}` : null,
    brand.usp            ? `USP: ${brand.usp}`                       : null,
  ].filter(Boolean).join('\n')

  let prompt: string
  let maxTokens: number

  if (slug.startsWith('title.')) {
    const issueMap: Record<string, string> = {
      'title.present': 'Title tag is completely missing.',
      'title.length':  `Title length is wrong. ${aiDetail}`,
      'title.keyword': `Primary keyword not in title. ${aiDetail}`,
      'title.brand':   `Brand name missing or poorly placed. ${aiDetail}`,
    }

    prompt = `${brandCtx}

Audit finding: ${issueMap[slug] ?? aiDetail}
Recommended fix: ${aiAction}

Write a replacement page title:
- 50–60 characters
- Brand name at the end after a pipe: "Page Topic | Brand"
- Naturally reflects what the site offers

Return ONLY the title text. No quotes, no explanation.`
    maxTokens = 80

  } else if (slug.startsWith('description.')) {
    const issueMap: Record<string, string> = {
      'description.present': 'Meta description is completely missing.',
      'description.length':  `Description length is wrong. ${aiDetail}`,
      'description.keyword': `Primary keyword not in description. ${aiDetail}`,
      'description.cta':     `Description lacks a call-to-action. ${aiDetail}`,
    }

    prompt = `${brandCtx}

Audit finding: ${issueMap[slug] ?? aiDetail}
Recommended fix: ${aiAction}

Write a replacement meta description:
- 140–155 characters
- Include the primary keyword naturally
- End with a clear call-to-action
- Specific to this brand, not generic

Return ONLY the description text. No quotes, no explanation.`
    maxTokens = 200

  } else if (slug === 'schema.present') {
    prompt = `${brandCtx}

Generate a JSON-LD Organization schema for this website.
Use real values from the brand context above — do not use placeholders.

Return ONLY the JSON object. No <script> tags, no markdown fences, no explanation.`
    maxTokens = 600

  } else {
    throw new Error(`No value prompt defined for slug: ${slug}`)
  }

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`[getValueFromAI] slug: ${slug} | model: haiku | max_tokens: ${maxTokens}`)
  console.log(`[getValueFromAI] ── PROMPT ──\n${prompt}`)
  console.log(`${'─'.repeat(60)}`)

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  })

  const result = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
  console.log(`[getValueFromAI] ── RESPONSE (${message.usage.output_tokens} tokens) ──\n${result}`)
  console.log(`${'─'.repeat(60)}\n`)
  return result
}

// Step 2b — apply the value to the HTML using cheerio
export function applyValueFix(html: string, slug: string, newValue: string): string {
  const $ = cheerio.load(html, { decodeEntities: false })

  if (slug.startsWith('title.')) {
    if ($('title').length) {
      $('title').text(newValue)
    } else {
      $('head').prepend(`\n  <title>${newValue}</title>`)
    }

  } else if (slug.startsWith('description.')) {
    if ($('meta[name="description"]').length) {
      $('meta[name="description"]').attr('content', newValue)
    } else {
      $('head').append(`\n  <meta name="description" content="${escapeAttr(newValue)}" />`)
    }

  } else if (slug === 'schema.present') {
    $('head').append(`\n  <script type="application/ld+json">\n${newValue}\n  </script>`)
  }

  return $.html()
}

// ─────────────────────────────────────────────────────────────────────────────
// PATH 3 — DOM MAP + SELECTOR PATCHES (body fixes)
//
// Instead of sending the full HTML file to Claude:
//   1. buildDomMap()     — Cheerio extracts a lightweight structural summary (no AI, no tokens)
//   2. getBodyPatches()  — only the DOM map is sent to Claude (~500–2k tokens vs full file)
//   3. Claude returns    — structured selector-based patches, never raw HTML
//   4. applyPatches()    — Cheerio applies each patch by selector (reliable, no string matching)
// ─────────────────────────────────────────────────────────────────────────────

// ── DOM Map ───────────────────────────────────────────────────────────────────

export interface DomMap {
  title: string | null
  hasH1: boolean
  h1Text: string | null
  metaDescription: string | null
  canonical: string | null
  sections: string[]
  headings: Array<{ tag: string; text: string; selector: string }>
  images: Array<{ filename: string; alt: string | null; context: string; selector: string }>
}

export function buildDomMap(html: string): DomMap {
  const $ = cheerio.load(html, { decodeEntities: false })

  // Major structural sections (direct children of body/main, excluding invisible tags)
  const SKIP_TAGS = new Set(['script', 'style', 'link', 'meta', 'title', 'head', 'noscript'])
  const sections: string[] = []
  $('body > *, main > *').each((_, el) => {
    const tag = (el as cheerio.Element & { tagName: string }).tagName
    if (SKIP_TAGS.has(tag)) return
    const id = $(el).attr('id')
    const cls = $(el).attr('class')?.split(/\s+/).filter(Boolean).slice(0, 2).join('.')
    if (id) sections.push(`#${id}`)
    else if (cls) sections.push(`${tag}.${cls}`)
    else sections.push(tag)
  })

  // All headings with usable selectors
  const headings: DomMap['headings'] = []
  $('h1, h2, h3').each((i, el) => {
    const tag = (el as cheerio.Element & { tagName: string }).tagName
    const text = $(el).text().trim().slice(0, 80)
    const id = $(el).attr('id')
    const cls = $(el).attr('class')?.split(/\s+/).filter(Boolean).slice(0, 1).join('.')
    let selector: string
    if (id) selector = `#${id}`
    else if (cls) selector = `${tag}.${cls}`
    else selector = `${tag}:nth-of-type(${i + 1})`
    headings.push({ tag, text, selector })
  })

  // All images with parent context and stable selectors
  const images: DomMap['images'] = []
  $('img').each((_, el) => {
    const src = $(el).attr('src') ?? ''
    const altAttr = $(el).attr('alt')
    // null = attribute missing entirely, '' = present but empty (both need fixing for alt.not_empty)
    const alt = altAttr === undefined ? null : altAttr === '' ? null : altAttr
    const parent = $(el).parent()
    const parentTag = ((parent[0] as cheerio.Element & { tagName: string })?.tagName ?? 'div')
    const parentCls = parent.attr('class')?.split(/\s+/).filter(Boolean).slice(0, 1).join('.') ?? ''
    const context = parentCls ? `${parentTag}.${parentCls}` : parentTag
    const filename = src.split('/').pop()?.split('?')[0] ?? src
    images.push({ filename, alt, context, selector: `img[src="${src}"]` })
  })

  return {
    title: $('title').text().trim() || null,
    hasH1: $('h1').length > 0,
    h1Text: $('h1').first().text().trim() || null,
    metaDescription: $('meta[name="description"]').attr('content') ?? null,
    canonical: $('link[rel="canonical"]').attr('href') ?? null,
    sections,
    headings,
    images,
  }
}

// ── Selector patch types ──────────────────────────────────────────────────────

export type SelectorPatch =
  | { action: 'setAttribute'; selector: string; attribute: string; value: string }
  | { action: 'setText';      selector: string; value: string }
  | { action: 'prepend';      selector: string; html: string }
  | { action: 'append';       selector: string; html: string }
  | { action: 'before';       selector: string; html: string }
  | { action: 'after';        selector: string; html: string }
  | { action: 'replaceWith';  selector: string; html: string }
  | { action: 'remove';       selector: string }

// ── Ask Claude for patches — DOM map only, full HTML never sent ───────────────

export async function getBodyPatches(
  domMap: DomMap,
  slug: string,
  label: string,
  action: string,
  brand: BrandContext,
): Promise<SelectorPatch[]> {
  const brandCtx = [
    `Brand: ${brand.name}`,
    `Website: ${brand.websiteUrl}`,
    brand.industry       ? `Industry: ${brand.industry}`             : null,
    brand.targetAudience ? `Target audience: ${brand.targetAudience}` : null,
    brand.usp            ? `USP: ${brand.usp}`                       : null,
  ].filter(Boolean).join('\n')

  const prompt = `You are fixing an SEO issue on a webpage.

${brandCtx}

SEO Issue: ${label}
What to do: ${action}

Page DOM Map:
${JSON.stringify(domMap, null, 2)}

Return a JSON array of patches to fix this issue.
Use selectors exactly as they appear in the DOM map above.

Supported patch actions:
- { "action": "setAttribute", "selector": "...", "attribute": "...", "value": "..." }
- { "action": "setText",      "selector": "...", "value": "..." }
- { "action": "prepend",      "selector": "...", "html": "..." }
- { "action": "append",       "selector": "...", "html": "..." }
- { "action": "before",       "selector": "...", "html": "..." }
- { "action": "after",        "selector": "...", "html": "..." }
- { "action": "replaceWith",  "selector": "...", "html": "..." }

Rules:
- Only use selectors from the DOM map — do not invent selectors
- For alt text: use setAttribute with attribute "alt" on each img selector from the map
- For H1 insertion: use prepend or before with the most relevant section selector
- Write specific, meaningful content using brand context — no placeholders
- Keep generated HTML minimal — no inline styles, no extra wrappers

Return ONLY a valid JSON array. No markdown fences, no explanation.`

  const domMapJson = JSON.stringify(domMap, null, 2)
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`[getBodyPatches] slug: ${slug} | model: haiku | max_tokens: 600`)
  console.log(`[getBodyPatches] ── DOM MAP SENT TO CLAUDE (${domMapJson.length} chars) ──\n${domMapJson}`)
  console.log(`[getBodyPatches] ── FULL PROMPT ──\n${prompt}`)
  console.log(`${'─'.repeat(60)}`)

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = message.content[0].type === 'text' ? message.content[0].text : '[]'
  console.log(`[getBodyPatches] ── RAW RESPONSE (${message.usage.output_tokens} tokens) ──\n${raw}`)
  console.log(`${'─'.repeat(60)}\n`)

  const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()

  try {
    const patches = JSON.parse(clean) as SelectorPatch[]
    if (!Array.isArray(patches)) throw new Error('Expected array')
    const filtered = patches.filter((p) => typeof p.action === 'string' && typeof p.selector === 'string')
    console.log(`[getBodyPatches] ${filtered.length} valid patch(es) parsed`)
    return filtered
  } catch {
    throw new Error('Patch agent returned invalid JSON — cannot apply fix')
  }
}

// ── Apply patches using Cheerio selectors ─────────────────────────────────────

export function applyPatches(html: string, patches: SelectorPatch[]): string {
  const $ = cheerio.load(html, { decodeEntities: false })

  for (const patch of patches) {
    const el = $(patch.selector)
    if (!el.length) {
      console.warn(`[apply-patch] selector not found: ${patch.selector}`)
      continue  // skip silently — other patches in the array still apply
    }
    switch (patch.action) {
      case 'setAttribute': el.attr((patch as Extract<SelectorPatch, { action: 'setAttribute' }>).attribute, (patch as Extract<SelectorPatch, { action: 'setAttribute' }>).value); break
      case 'setText':      el.text((patch as Extract<SelectorPatch, { action: 'setText' }>).value); break
      case 'prepend':      el.prepend((patch as Extract<SelectorPatch, { action: 'prepend' }>).html); break
      case 'append':       el.append((patch as Extract<SelectorPatch, { action: 'append' }>).html); break
      case 'before':       el.before((patch as Extract<SelectorPatch, { action: 'before' }>).html); break
      case 'after':        el.after((patch as Extract<SelectorPatch, { action: 'after' }>).html); break
      case 'replaceWith':  el.replaceWith((patch as Extract<SelectorPatch, { action: 'replaceWith' }>).html); break
      case 'remove':       el.remove(); break
    }
  }

  return $.html()
}

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY PATH — full file rewrite (kept for og.image, image.dimensions)
// Only used when item.fixType is undefined.
// ─────────────────────────────────────────────────────────────────────────────

export type FixPlan = {
  files_to_read: string[]
  files_to_create: string[]
  changes: { path: string; what: string }[]
}

export async function planFix(
  label: string,
  action: string,
  framework: string,
  fileTree: string[],
  userInput?: Record<string, string>,
): Promise<FixPlan> {
  const userInputStr = userInput && Object.keys(userInput).length > 0
    ? `\nUser-provided values:\n${Object.entries(userInput).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`
    : ''

  const prompt = `You are a code assistant planning a fix for an issue in a ${framework} project.

Fix needed: ${label}
Instruction: ${action}${userInputStr}

File tree:
${fileTree.join('\n')}

Think holistically. A complete fix often requires changes across multiple files. For example:
- Adding a privacy policy page also requires adding a footer link in index.html (or layout)
- Adding a sitemap also requires referencing it in robots.txt
- Adding schema markup may require updating a shared layout file

Return a JSON object describing the COMPLETE plan:
{
  "files_to_read": ["path/to/existing"],
  "files_to_create": ["path/to/new"],
  "changes": [
    { "path": "...", "what": "brief description of what to do in this file" }
  ]
}

Rules:
- files_to_read: only paths that exist in the file tree above (max 6)
- files_to_create: new file paths (may not be in the tree), correct for this framework:
    Static HTML → <name>.html in root
    Next.js App Router → app/<slug>/page.tsx
    Next.js Pages Router → pages/<slug>.tsx
    Astro → src/pages/<slug>.astro
- changes: EVERY file to be touched — includes both files_to_read (modified) and files_to_create
- If you are creating a new page, ALWAYS also include the file that should link to it in files_to_read

Return ONLY valid JSON. No markdown fences, no explanation.`

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`[planFix] label: "${label}" | framework: ${framework} | model: sonnet | max_tokens: 1000`)
  console.log(`[planFix] ── PROMPT ──\n${prompt}`)
  console.log(`${'─'.repeat(60)}`)

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = message.content[0].type === 'text' ? message.content[0].text : '{}'
  console.log(`[planFix] ── RESPONSE (${message.usage.output_tokens} tokens) ──\n${raw}`)
  console.log(`${'─'.repeat(60)}\n`)

  const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()

  try {
    const plan = JSON.parse(clean) as FixPlan
    const treeSet = new Set(fileTree)
    return {
      files_to_read: (plan.files_to_read ?? [])
        .filter((p) => typeof p === 'string' && treeSet.has(p))
        .slice(0, 6),
      files_to_create: (plan.files_to_create ?? [])
        .filter((p) => typeof p === 'string' && p.length > 0),
      changes: (plan.changes ?? [])
        .filter((c) => typeof c.path === 'string' && typeof c.what === 'string'),
    }
  } catch {
    return { files_to_read: [], files_to_create: [], changes: [] }
  }
}

export async function identifyFilesToFix(
  label: string,
  action: string,
  framework: string,
  fileTree: string[],
): Promise<string[]> {
  const plan = await planFix(label, action, framework, fileTree)
  return plan.files_to_read
}

export async function generateFix(
  label: string,
  action: string,
  framework: string,
  files: { path: string; content: string }[],
  plan: FixPlan,
  userInput?: Record<string, string>,
): Promise<{ path: string; content: string }[]> {
  const filesStr = files.length > 0
    ? files.map((f) => `=== FILE: ${f.path} ===\n${f.content}`).join('\n\n')
    : '(no existing files — all changes are new files)'

  const planStr = plan.changes
    .map((c) => `- ${c.path}: ${c.what}`)
    .join('\n')

  const userInputStr = userInput && Object.keys(userInput).length > 0
    ? `\n## User-provided values (use these exactly):\n${Object.entries(userInput).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`
    : ''

  const prompt = `You are a code assistant. Implement the following fix in this ${framework} project.

Fix: ${label}
Instruction: ${action}${userInputStr}

## Agreed plan (implement ALL of these):
${planStr}

## Existing file contents:
${filesStr}

Rules:
- Implement EVERY change listed in the plan above — do not skip any
- Only change what is necessary — preserve formatting, indentation, and style
- If a tag/value already exists, update it in place. If missing, add it in the correct location.
- For new pages: generate realistic placeholder content with proper structure (not lorem ipsum)
- Return the COMPLETE file content for every file in the plan (not diffs, not snippets)
- Include both modified existing files AND newly created files in the output

Return ONLY a valid JSON array: [{ "path": "...", "content": "..." }, ...]
No markdown fences, no explanation, no text outside the array.`

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`[generateFix] label: "${label}" | framework: ${framework} | model: sonnet | max_tokens: 16000`)
  console.log(`[generateFix] files being sent: ${files.map(f => `${f.path} (${f.content.length} chars)`).join(', ')}`)
  console.log(`[generateFix] ── PROMPT (${prompt.length} chars total) ──\n${prompt.slice(0, 1000)}${prompt.length > 1000 ? '\n... [truncated for log]' : ''}`)
  console.log(`${'─'.repeat(60)}`)

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 16000,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = message.content[0].type === 'text' ? message.content[0].text : '[]'
  console.log(`[generateFix] ── RESPONSE (${message.usage.input_tokens} in / ${message.usage.output_tokens} out tokens) ──`)
  console.log(`[generateFix] response length: ${raw.length} chars`)
  console.log(`${'─'.repeat(60)}\n`)

  const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()

  try {
    const results = JSON.parse(clean) as { path: string; content: string }[]
    const filtered = results.filter(
      (r) =>
        typeof r.path === 'string' &&
        r.path.length > 0 &&
        typeof r.content === 'string' &&
        r.content.length > 0,
    )
    console.log(`[generateFix] ${filtered.length} file(s) returned: ${filtered.map(f => f.path).join(', ')}`)
    return filtered
  } catch {
    throw new Error('Fix agent returned invalid JSON — cannot apply fix')
  }
}
