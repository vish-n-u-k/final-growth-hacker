import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules, moduleItems, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import {
  parseRepoUrl,
  getDefaultBranch,
  getFileTree,
  getFileContent,
  commitFile,
} from '@/lib/github'
import {
  applyTemplateFix,
  getValueFromAI,
  applyValueFix,
  buildDomMap,
  getBodyPatches,
  applyPatches,
  extractFooterSnippet,
  getFooterPatch,
  applyFooterReplacement,
  planFix,
  generateFix,
  detectFramework,
  type BrandContext,
  type SelectorPatch,
  type FixPlan,
} from '@/lib/modules/seo/fix-agent'

export const maxDuration = 60

// Deterministic HTML file lookup for static sites — no Claude needed
function findMainHtmlFile(fileTree: string[]): string | null {
  for (const candidate of ['index.html', 'index.htm', 'home.html']) {
    if (fileTree.includes(candidate)) return candidate
  }
  // Fall back to first .html at repo root (no subdirectory)
  return fileTree.find((f) => f.endsWith('.html') && !f.includes('/')) ?? null
}

// Mark item as agent-fixed in DB
async function markFixed(itemId: string) {
  await db
    .update(moduleItems)
    .set({ completedBy: 'agent', aiVerified: true, aiVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(moduleItems.id, itemId))
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { itemId, mode = 'execute', plan: providedPlan } = await request.json() as {
    itemId: string
    mode?: 'plan' | 'execute'
    plan?: FixPlan
  }

  // ── Load + validate item ──────────────────────────────────────────────────
  const [item] = await db.select().from(moduleItems).where(eq(moduleItems.id, itemId))
  if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  if (!item.fixable) return NextResponse.json({ error: 'This item cannot be auto-fixed' }, { status: 400 })

  // ── Verify ownership via module → brand chain ─────────────────────────────
  const [mod] = await db.select().from(modules).where(eq(modules.id, item.moduleId))
  if (!mod) return NextResponse.json({ error: 'Module not found' }, { status: 404 })

  const [brand] = await db.select().from(brands).where(eq(brands.id, mod.brandId))
  if (!brand || brand.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // ── Load GitHub integration ───────────────────────────────────────────────
  const [integration] = await db
    .select()
    .from(brandIntegrations)
    .where(and(
      eq(brandIntegrations.brandId, brand.id),
      eq(brandIntegrations.provider, 'github'),
      eq(brandIntegrations.status, 'connected'),
    ))
    .limit(1)

  if (!integration) {
    return NextResponse.json(
      { error: 'GitHub is not connected. Go to Settings → Integrations to connect your repo.' },
      { status: 400 },
    )
  }

  const pat = integration.apiKey
  const repoUrl = (integration.metadata as Record<string, string> | null)?.repo_url
  if (!pat || !repoUrl) {
    return NextResponse.json(
      { error: 'GitHub PAT or repo URL is missing. Update your GitHub integration in Settings.' },
      { status: 400 },
    )
  }

  // ── Parse repo ────────────────────────────────────────────────────────────
  let owner: string, repo: string
  try {
    ;({ owner, repo } = parseRepoUrl(repoUrl))
  } catch {
    return NextResponse.json({ error: 'Invalid GitHub repo URL in Settings.' }, { status: 400 })
  }

  const t = (label: string) => console.log(`[apply-fix] ${label} — ${Date.now()}ms`)

  t('getting default branch')
  const defaultBranch = await getDefaultBranch(owner, repo, pat)
  const repoHomeUrl = `https://github.com/${owner}/${repo}`

  const brandCtx: BrandContext = {
    name: brand.name,
    websiteUrl: brand.websiteUrl,
    industry: brand.industry,
    targetAudience: brand.targetAudience,
    usp: brand.usp,
  }

  const fixType = item.fixType ?? null

  // ══════════════════════════════════════════════════════════════════════════
  // PATH 1 — TEMPLATE (no AI)
  // Deterministic head tag — cheerio applies a known value directly.
  // 0 Claude calls. Cost: $0.
  // ══════════════════════════════════════════════════════════════════════════
  if (fixType === 'template') {
    // Template fixes are deterministic — no plan preview needed
    if (mode === 'plan') return NextResponse.json({ plan: null })

    t('template — fetching file tree')
    const fileTree = await getFileTree(owner, repo, defaultBranch, pat)
    const filePath = findMainHtmlFile(fileTree)
    if (!filePath) {
      return NextResponse.json({ error: 'No HTML file found in repo root.' }, { status: 422 })
    }

    t(`template — fetching ${filePath}`)
    const { content: html, sha } = await getFileContent(owner, repo, filePath, pat)

    t('template — applying fix')
    let modified: string
    try {
      modified = applyTemplateFix(html, item.slug, brandCtx)
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Template fix failed' },
        { status: 422 },
      )
    }

    t('template — committing')
    await commitFile(owner, repo, filePath, modified, sha, defaultBranch, `fix(seo): ${item.label}`, pat)
    await markFixed(itemId)

    t('done — template (0 AI calls)')
    return NextResponse.json({ ok: true, prUrl: repoHomeUrl })
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PATH 2 — VALUE (1 tiny AI call, cheerio applies)
  // AI returns only the new string. File content never sent to Claude.
  // max_tokens: 80–600 depending on slug (vs 16,000 in legacy).
  // ══════════════════════════════════════════════════════════════════════════
  if (fixType === 'value') {
    // Value fixes generate a string via AI — no plan preview needed
    if (mode === 'plan') return NextResponse.json({ plan: null })

    t('value — fetching file tree')
    const fileTree = await getFileTree(owner, repo, defaultBranch, pat)
    const filePath = findMainHtmlFile(fileTree)
    if (!filePath) {
      return NextResponse.json({ error: 'No HTML file found in repo root.' }, { status: 422 })
    }

    t(`value — fetching ${filePath}`)
    const { content: html, sha } = await getFileContent(owner, repo, filePath, pat)

    // Extract existing head values so AI can rewrite/shorten rather than invent from scratch
    const cheerio = await import('cheerio')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const $h = cheerio.load(html, { decodeEntities: false } as any)
    const existingValues: Record<string, string> = {
      'title.length':        $h('title').text().trim(),
      'title.keyword':       $h('title').text().trim(),
      'title.brand':         $h('title').text().trim(),
      'description.length':  $h('meta[name="description"]').attr('content') ?? '',
      'description.keyword': $h('meta[name="description"]').attr('content') ?? '',
      'description.cta':     $h('meta[name="description"]').attr('content') ?? '',
    }
    const existingValue = existingValues[item.slug] ?? ''

    t('value — calling AI for string value')
    let newValue: string
    try {
      newValue = await getValueFromAI(item.slug, brandCtx, item.aiDetail ?? '', item.aiAction ?? '', existingValue)
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Value generation failed' },
        { status: 500 },
      )
    }
    if (!newValue) {
      return NextResponse.json({ error: 'AI returned an empty value — cannot apply fix.' }, { status: 422 })
    }
    console.log(`[apply-fix] new value for ${item.slug}: "${newValue.slice(0, 80)}"`)

    t('value — applying fix')
    const modified = applyValueFix(html, item.slug, newValue)

    t('value — committing')
    await commitFile(owner, repo, filePath, modified, sha, defaultBranch, `fix(seo): ${item.label}`, pat)
    await markFixed(itemId)

    t('done — value (1 tiny AI call)')
    return NextResponse.json({ ok: true, prUrl: repoHomeUrl })
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PATH 3 — PATCH (full file in, find/replace out, cheerio applies)
  // Body-level changes. Claude sees the file but returns only { find, replace }.
  // max_tokens: 400 (vs 16,000 in legacy). No full-file rewrite.
  // ══════════════════════════════════════════════════════════════════════════
  if (fixType === 'patch') {
    t('patch — detecting framework')
    let framework = 'static HTML'
    try {
      const { content } = await getFileContent(owner, repo, 'package.json', pat)
      framework = detectFramework(content)
    } catch { /* not a Node project — default is fine */ }
    console.log(`[apply-fix] framework: ${framework}`)

    t('patch — fetching file tree')
    const fileTree = await getFileTree(owner, repo, defaultBranch, pat)
    if (fileTree.length === 0) {
      return NextResponse.json({ error: 'Repo file tree is empty or inaccessible.' }, { status: 422 })
    }

    t('patch — planning (which file?)')
    let plan: FixPlan
    if (mode === 'execute' && providedPlan) {
      plan = providedPlan
    } else {
      plan = await planFix(item.label, item.aiAction ?? '', framework, fileTree)
      if (mode === 'plan') return NextResponse.json({ plan })
    }
    if (plan.files_to_read.length === 0) {
      return NextResponse.json({ error: 'Could not identify which file needs to change.' }, { status: 422 })
    }

    let anyPatched = false

    for (const filePath of plan.files_to_read) {
      t(`patch — fetching ${filePath}`)
      let html: string, sha: string
      try {
        ;({ content: html, sha } = await getFileContent(owner, repo, filePath, pat))
      } catch {
        console.warn(`[apply-fix] could not fetch ${filePath} — skipping`)
        continue
      }

      // Use per-file action from plan if available, else fall back to item action
      const fileAction = plan.changes.find((c) => c.path === filePath)?.what ?? item.aiAction ?? ''

      const isFooterFix = /footer|link|nav|header|privacy|contact|terms/i.test(fileAction)

      let modified: string

      if (isFooterFix) {
        // ── Footer snippet path — extract footer, patch it, splice back ──────
        t(`patch — extracting footer from ${filePath}`)
        const snippet = extractFooterSnippet(html)

        if (snippet) {
          console.log(`[apply-fix] footer found via "${snippet.selector}" (${snippet.outerHtml.length} chars)`)
          let newFooterHtml: string
          try {
            newFooterHtml = await getFooterPatch(snippet.outerHtml, item.label, fileAction, brandCtx)
          } catch (err) {
            console.warn(`[apply-fix] footer patch failed for ${filePath}: ${err instanceof Error ? err.message : err}`)
            continue
          }
          if (!newFooterHtml) {
            console.warn(`[apply-fix] footer patch returned empty for ${filePath} — skipping`)
            continue
          }
          modified = applyFooterReplacement(html, snippet.selector, newFooterHtml)
        } else {
          // No footer found — fall back to DOM map
          console.log(`[apply-fix] no footer element found in ${filePath} — falling back to DOM map`)
          const domMap = buildDomMap(html)
          let patches: SelectorPatch[]
          try {
            patches = await getBodyPatches(domMap, item.slug, item.label, fileAction, brandCtx)
          } catch (err) {
            console.warn(`[apply-fix] fallback patch failed for ${filePath}: ${err instanceof Error ? err.message : err}`)
            continue
          }
          if (patches.length === 0) { console.log(`[apply-fix] no patches for ${filePath} — skipping`); continue }
          try { modified = applyPatches(html, patches) } catch { continue }
        }
      } else {
        // ── DOM map path — for non-footer fixes (alt text, H1, etc.) ─────────
        t(`patch — building DOM map for ${filePath}`)
        const domMap = buildDomMap(html)
        console.log(`[apply-fix] ${filePath} DOM map: ${domMap.images.length} images, ${domMap.headings.length} headings, ${domMap.sections.length} sections`)

        let patches: SelectorPatch[]
        try {
          patches = await getBodyPatches(domMap, item.slug, item.label, fileAction, brandCtx)
        } catch (err) {
          console.warn(`[apply-fix] patch generation failed for ${filePath}: ${err instanceof Error ? err.message : err}`)
          continue
        }
        if (patches.length === 0) {
          console.log(`[apply-fix] no patches needed for ${filePath} — skipping`)
          continue
        }
        console.log(`[apply-fix] ${patches.length} patch(es) to apply to ${filePath}:\n${JSON.stringify(patches, null, 2)}`)
        try {
          modified = applyPatches(html, patches)
        } catch (err) {
          console.warn(`[apply-fix] patch application failed for ${filePath}: ${err instanceof Error ? err.message : err}`)
          continue
        }
      }

      t(`patch — committing ${filePath}`)
      await commitFile(owner, repo, filePath, modified, sha, defaultBranch, `fix(seo): ${item.label}`, pat)
      anyPatched = true
    }

    if (!anyPatched) {
      return NextResponse.json({ error: 'Patch agent found no changes to apply across any of the target files.' }, { status: 422 })
    }

    await markFixed(itemId)
    t(`done — patch (${plan.files_to_read.length} file(s), DOM map only)`)
    return NextResponse.json({ ok: true, prUrl: repoHomeUrl })
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LEGACY PATH — full file rewrite (fixType === null)
  // Used for og.image, image.dimensions, and any items without fixType.
  // Unchanged from original implementation.
  // ══════════════════════════════════════════════════════════════════════════

  t('legacy — detecting framework')
  let framework = 'static HTML'
  try {
    const { content } = await getFileContent(owner, repo, 'package.json', pat)
    framework = detectFramework(content)
  } catch { /* not a Node project */ }
  console.log(`[apply-fix] framework: ${framework}`)

  t('legacy — fetching file tree')
  const fileTree = await getFileTree(owner, repo, defaultBranch, pat)
  if (fileTree.length === 0) {
    return NextResponse.json({ error: 'Repo file tree is empty or inaccessible.' }, { status: 422 })
  }

  // Auto-read assisted fix values from saved integrations
  let userInput: Record<string, string> | undefined
  if (item.fixInputKey && item.fixIntegrationProvider) {
    const [assistedIntegration] = await db
      .select()
      .from(brandIntegrations)
      .where(and(
        eq(brandIntegrations.brandId, brand.id),
        eq(brandIntegrations.provider, item.fixIntegrationProvider),
        eq(brandIntegrations.status, 'connected'),
      ))
      .limit(1)
    const value = (assistedIntegration?.metadata as Record<string, string> | null)?.[item.fixInputKey]
    if (item.fixIntegrationProvider === 'brand_assets') {
      if (value) userInput = { [item.fixInputKey]: value }
    } else {
      if (!value) {
        return NextResponse.json({
          error: `${item.fixIntegrationProvider === 'google_analytics' ? 'Google Analytics' : 'Google Search Console'} integration is not connected. Go to Settings → Integrations to set it up.`,
        }, { status: 400 })
      }
      userInput = { [item.fixInputKey]: value }
    }
  }

  // Keyword map: slug prefix → terms to search in file tree
  const SLUG_KEYWORDS: Record<string, string[]> = {
    'privacy':   ['privacy'],
    'terms':     ['terms', 'tos'],
    'contact':   ['contact'],
    'sitemap':   ['sitemap'],
    'robots':    ['robots'],
    'cookie':    ['cookie'],
    'about':     ['about'],
    'faq':       ['faq'],
    'blog':      ['blog'],
    'schema':    ['schema', 'structured-data'],
    'footer':    ['footer', 'layout'],
    'nav':       ['nav', 'header', 'layout'],
  }

  const slugKey = Object.keys(SLUG_KEYWORDS).find((k) => item.slug.includes(k))
  const keywords = slugKey ? SLUG_KEYWORDS[slugKey] : []
  const existingRelevantFiles = keywords.length > 0
    ? fileTree.filter((p) => keywords.some((k) => p.toLowerCase().includes(k)))
    : []

  if (existingRelevantFiles.length > 0) {
    console.log(`[apply-fix] existing relevant files for "${item.slug}": ${existingRelevantFiles.join(', ')}`)
  }

  t('legacy — planning')
  let plan: FixPlan
  if (mode === 'execute' && providedPlan) {
    plan = providedPlan
  } else {
    plan = await planFix(item.label, item.aiAction ?? '', framework, fileTree, userInput, existingRelevantFiles)
    if (mode === 'plan') return NextResponse.json({ plan })
  }
  if (plan.files_to_read.length === 0 && plan.files_to_create.length === 0) {
    return NextResponse.json({ error: 'Could not build a fix plan for this item.' }, { status: 422 })
  }

  t('legacy — fetching file contents')
  const fileContents: { path: string; content: string; sha: string; originalContent: string; headOnly: boolean }[] = []
  for (const path of plan.files_to_read) {
    try {
      const { content, sha } = await getFileContent(owner, repo, path, pat)
      console.log(`[apply-fix] fetched ${path} — ${content.length} chars`)

      const isHtml = path.endsWith('.html') || path.endsWith('.htm')
      const planEntry = plan.changes.find((c) => c.path === path)
      const needsBodyChange = planEntry && /footer|link|nav|body|menu/i.test(planEntry.what)
      if (isHtml && content.length > 15000 && !needsBodyChange) {
        const headMatch = content.match(/<head[^>]*>[\s\S]*?<\/head>/i)
        if (headMatch) {
          console.log(`[apply-fix] trimmed ${path} to head section (${headMatch[0].length} chars)`)
          fileContents.push({ path, content: headMatch[0], sha, originalContent: content, headOnly: true })
          continue
        }
      }

      fileContents.push({ path, content, sha, originalContent: content, headOnly: false })
    } catch {
      console.warn(`[apply-fix] could not fetch ${path}`)
    }
  }

  if (fileContents.length === 0 && plan.files_to_create.length === 0) {
    return NextResponse.json({ error: 'Could not fetch any of the target files from GitHub.' }, { status: 422 })
  }

  t('legacy — generating full file rewrite')
  let modifiedFiles: { path: string; content: string }[]
  try {
    modifiedFiles = await generateFix(
      item.label,
      item.aiAction ?? '',
      framework,
      fileContents.map(({ path, content }) => ({ path, content })),
      plan,
      userInput,
    )
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Fix generation failed' },
      { status: 500 },
    )
  }

  if (modifiedFiles.length === 0) {
    return NextResponse.json({ error: 'Fix agent determined no changes were needed.' }, { status: 422 })
  }

  // Splice modified head back into full original file where needed
  const headOnlyMap = Object.fromEntries(
    fileContents.filter((f) => f.headOnly).map((f) => [f.path, f.originalContent]),
  )
  const finalFiles = modifiedFiles.map(({ path, content }) => {
    const original = headOnlyMap[path]
    if (original) {
      const reconstructed = original.replace(/<head[^>]*>[\s\S]*?<\/head>/i, content)
      return { path, content: reconstructed }
    }
    return { path, content }
  })

  t('legacy — committing files')
  const shaMap = Object.fromEntries(fileContents.map((f) => [f.path, f.sha]))
  for (const { path, content } of finalFiles) {
    await commitFile(owner, repo, path, content, shaMap[path] ?? null, defaultBranch, `fix(seo): ${item.label}`, pat)
    console.log(`[apply-fix] committed ${path}`)
  }

  await markFixed(itemId)

  t('done — legacy (2 AI calls, full file rewrite)')
  return NextResponse.json({ ok: true, prUrl: repoHomeUrl })
}
