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
import { planFix, generateFix, detectFramework } from '@/lib/modules/seo/fix-agent'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { itemId } = await request.json() as { itemId: string }

  // ── Load + validate item ──────────────────────────────────────────────────────
  const [item] = await db.select().from(moduleItems).where(eq(moduleItems.id, itemId))
  if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  if (!item.fixable) return NextResponse.json({ error: 'This item cannot be auto-fixed' }, { status: 400 })

  // ── Verify ownership via module → brand chain ─────────────────────────────────
  const [mod] = await db.select().from(modules).where(eq(modules.id, item.moduleId))
  if (!mod) return NextResponse.json({ error: 'Module not found' }, { status: 404 })

  const [brand] = await db.select().from(brands).where(eq(brands.id, mod.brandId))
  if (!brand || brand.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // ── Load GitHub integration ───────────────────────────────────────────────────
  const [integration] = await db
    .select()
    .from(brandIntegrations)
    .where(
      and(
        eq(brandIntegrations.brandId, brand.id),
        eq(brandIntegrations.provider, 'github'),
        eq(brandIntegrations.status, 'connected'),
      ),
    )
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

  // ── Parse repo ────────────────────────────────────────────────────────────────
  let owner: string, repo: string
  try {
    ;({ owner, repo } = parseRepoUrl(repoUrl))
  } catch {
    return NextResponse.json({ error: 'Invalid GitHub repo URL in Settings.' }, { status: 400 })
  }

  const t = (label: string) => console.log(`[apply-fix] ${label} — ${Date.now()}ms`)

  // ── Commit directly to default branch ────────────────────────────────────────
  t('getting default branch')
  const defaultBranch = await getDefaultBranch(owner, repo, pat)
  console.log(`[apply-fix] default branch: ${defaultBranch}`)
  const activeBranch = defaultBranch

  // ── Detect framework ──────────────────────────────────────────────────────────
  t('detecting framework')
  let framework = 'static HTML'
  try {
    const { content } = await getFileContent(owner, repo, 'package.json', pat)
    framework = detectFramework(content)
  } catch {
    // Not a Node project — default is fine
  }
  console.log(`[apply-fix] framework: ${framework}`)

  // ── Get file tree ─────────────────────────────────────────────────────────────
  t('fetching file tree')
  const fileTree = await getFileTree(owner, repo, defaultBranch, pat)
  console.log(`[apply-fix] file tree size: ${fileTree.length} files`)
  if (fileTree.length === 0) {
    return NextResponse.json({ error: 'Repo file tree is empty or inaccessible.' }, { status: 422 })
  }

  // ── Call 0: Plan all changes needed ──────────────────────────────────────────
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
    if (!value) return NextResponse.json({ error: `${item.fixIntegrationProvider === 'google_analytics' ? 'Google Analytics' : 'Google Search Console'} integration is not connected. Go to Settings → Integrations to set it up.` }, { status: 400 })
    userInput = { [item.fixInputKey]: value }
  }

  t('claude call 0 — planning')
  const plan = await planFix(item.label, item.aiAction ?? '', framework, fileTree, userInput)
  console.log(`[apply-fix] plan:`, JSON.stringify(plan, null, 2))
  if (plan.files_to_read.length === 0 && plan.files_to_create.length === 0) {
    return NextResponse.json({ error: 'Could not build a fix plan for this item.' }, { status: 422 })
  }

  // ── Fetch existing file contents ──────────────────────────────────────────────
  t('fetching file contents')
  const fileContents: { path: string; content: string; sha: string; originalContent: string; headOnly: boolean }[] = []
  for (const path of plan.files_to_read) {
    try {
      const { content, sha } = await getFileContent(owner, repo, path, pat)
      console.log(`[apply-fix] fetched ${path} — ${content.length} chars`)

      // For large HTML files that only need <head> changes, extract just that section to reduce Claude input size.
      // Skip this optimisation if the plan says the file needs body changes (e.g. adding footer links).
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

  // ── Call 1: generate all file changes from the plan ──────────────────────────
  t('claude call 1 — code generation')
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
  console.log(`[apply-fix] modified files: ${modifiedFiles.map((f) => f.path).join(', ')}`)

  if (modifiedFiles.length === 0) {
    return NextResponse.json({ error: 'Fix agent determined no changes were needed.' }, { status: 422 })
  }

  // ── For head-only files, splice modified head back into the full original file ──
  const headOnlyMap = Object.fromEntries(
    fileContents.filter((f) => f.headOnly).map((f) => [f.path, f.originalContent]),
  )
  const finalFiles = modifiedFiles.map(({ path, content }) => {
    const original = headOnlyMap[path]
    if (original) {
      const reconstructed = original.replace(/<head[^>]*>[\s\S]*?<\/head>/i, content)
      console.log(`[apply-fix] reconstructed full ${path} (${reconstructed.length} chars)`)
      return { path, content: reconstructed }
    }
    return { path, content }
  })

  // ── Commit each changed file ──────────────────────────────────────────────────
  t('committing files')
  const shaMap = Object.fromEntries(fileContents.map((f) => [f.path, f.sha]))
  for (const { path, content } of finalFiles) {
    console.log(`[apply-fix] committing ${path}`)
    await commitFile(
      owner, repo, path, content,
      shaMap[path] ?? null,
      activeBranch,
      `fix(seo): ${item.label}`,
      pat,
    )
    console.log(`[apply-fix] committed ${path}`)
  }

  // ── Build repo URL to return to client ───────────────────────────────────────
  t('done')
  const repoHomeUrl = `https://github.com/${owner}/${repo}`

  // ── Mark item as agent-fixed ──────────────────────────────────────────────────
  await db
    .update(moduleItems)
    .set({ completedBy: 'agent', aiVerified: true, aiVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(moduleItems.id, itemId))

  return NextResponse.json({ ok: true, prUrl: repoHomeUrl })
}
