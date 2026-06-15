import Anthropic from '@anthropic-ai/sdk'

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

// ── Types ─────────────────────────────────────────────────────────────────────

export type FixPlan = {
  files_to_read: string[]    // existing files to fetch (modify or context)
  files_to_create: string[]  // new files that don't exist yet
  changes: { path: string; what: string }[]  // every file touched + what to do
}

// ── Call 0: Plan all changes needed (before fetching any files) ───────────────

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
  "files_to_read": ["path/to/existing"],  // existing files we need to fetch (to modify or for context when linking)
  "files_to_create": ["path/to/new"],     // new files that do not yet exist
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

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = message.content[0].type === 'text' ? message.content[0].text : '{}'
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

// ── Call 1 (legacy alias kept for compatibility) ──────────────────────────────

export async function identifyFilesToFix(
  label: string,
  action: string,
  framework: string,
  fileTree: string[],
): Promise<string[]> {
  const plan = await planFix(label, action, framework, fileTree)
  return plan.files_to_read
}

// ── Call 2: Generate all file changes from the plan ───────────────────────────

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

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 16000,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = message.content[0].type === 'text' ? message.content[0].text : '[]'
  const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()

  try {
    const results = JSON.parse(clean) as { path: string; content: string }[]
    return results.filter(
      (r) =>
        typeof r.path === 'string' &&
        r.path.length > 0 &&
        typeof r.content === 'string' &&
        r.content.length > 0,
    )
  } catch {
    throw new Error('Fix agent returned invalid JSON — cannot apply fix')
  }
}
