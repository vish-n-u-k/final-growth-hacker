# GitHub Auto-Fix — Feature Spec

## What this does

When the SEO module finds a fixable issue (e.g. missing title tag), the user can click "Apply fix" directly in the dashboard. The app reads the connected GitHub repo, understands the codebase, generates the correct code change, and opens a Pull Request — all without the user touching their editor.

---

## Decisions

| Question | Decision |
|----------|----------|
| Push method | Pull Request (user reviews + merges) |
| Multi-file fixes | Yes — one PR can touch multiple files |
| Diff preview before PR | Later (pin for now) |
| Which items are fixable | Tagged by Claude during SEO analysis (`fixable: true`) — only safe, targeted changes |

### What counts as fixable (safe)
- `<title>` tag
- `<meta name="description">`
- Canonical tag (`<link rel="canonical">`)
- Open Graph tags (`og:title`, `og:description`, `og:image`, etc.)
- Twitter card meta tags
- `robots` meta tag
- Viewport meta tag
- Structured data / JSON-LD (additive only)

### What is NOT fixable (too risky)
- URL structure changes (would break routes)
- Internal linking rewrites
- Image optimisation (file changes, not just HTML)
- Site architecture / navigation
- Page content / copy rewrites
- Anything requiring config file changes (next.config.js, vercel.json, etc.)

---

## Database changes

```sql
ALTER TABLE module_items ADD COLUMN IF NOT EXISTS fixable boolean DEFAULT false;
ALTER TABLE module_items ADD COLUMN IF NOT EXISTS agent_pr_url text;
```

**`fixable`** — set by the SEO agent at analysis time. Tells the UI whether to show the "Apply fix" button.

**`agent_pr_url`** — populated after a fix is applied. Stores the GitHub PR URL so the user can click through to review/merge.

---

## New files to create

```
lib/github/index.ts               — GitHub REST API helper
lib/modules/seo/fix-agent.ts      — two-step Claude fix generator
app/api/items/apply-fix/route.ts  — orchestration endpoint (POST)
```

---

## Files to update

```
lib/db/schema.ts                         — add fixable + agentPrUrl columns
lib/modules/types.ts                     — add fixable to DynamicModuleAnalysisResult
lib/modules/seo/agent.ts                 — instruct Claude to set fixable, parse it
app/api/modules/analyze/route.ts         — save fixable when upserting items
app/dashboard/[moduleId]/page.tsx        — fetch githubConnected, pass to component
components/ModuleDashboard.tsx           — Apply fix button + PR link in expanded items
```

---

## Detailed implementation

### `lib/github/index.ts`

All functions take `{ pat, repoUrl }` from `brand_integrations`.

**Helpers:**
```
parseRepoUrl(repoUrl)
  → { owner: string, repo: string }
  → e.g. "https://github.com/alice/mysite" → { owner: "alice", repo: "mysite" }

getDefaultBranch(owner, repo, pat)
  → string (e.g. "main" or "master")
  → GET /repos/{owner}/{repo}  →  .default_branch

getLatestCommitSha(owner, repo, branch, pat)
  → string (the SHA of HEAD on that branch)
  → GET /repos/{owner}/{repo}/branches/{branch}  →  .commit.sha

getFileTree(owner, repo, branch, pat)
  → string[] (all file paths in the repo)
  → GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1
  → filter to .blob entries only, return .path strings

getFileContent(owner, repo, path, pat)
  → { content: string, sha: string }
  → GET /repos/{owner}/{repo}/contents/{path}
  → decode base64 → return decoded text + file sha (needed for update)

createBranch(owner, repo, branchName, fromSha, pat)
  → void
  → POST /repos/{owner}/{repo}/git/refs
  → body: { ref: "refs/heads/{branchName}", sha: fromSha }

commitFile(owner, repo, path, content, fileSha, branch, message, pat)
  → void
  → PUT /repos/{owner}/{repo}/contents/{path}
  → body: { message, content: base64(content), sha: fileSha, branch }
  → if fileSha is null → creates new file (for cases where file doesn't exist yet)

createPullRequest(owner, repo, head, base, title, body, pat)
  → { prUrl: string, prNumber: number }
  → POST /repos/{owner}/{repo}/pulls
  → body: { title, body, head, base }
```

**Error handling:**
- 401 → PAT invalid or expired
- 403 → insufficient scopes (needs repo read+write)
- 404 → repo not found or branch doesn't exist
- 422 → branch already exists (use existing branch in that case)

---

### SEO agent changes (`lib/modules/seo/agent.ts`)

Add to the Claude prompt, per category:

> For each item, also include a `fixable` field (boolean). Set `fixable: true` only if the fix is a targeted, safe change to an HTML meta tag, title tag, canonical link, Open Graph tag, Twitter card, robots meta, or JSON-LD structured data block. Set `fixable: false` for anything structural, content-related, or that requires framework config changes.

Updated return type per item:
```typescript
{
  slug: string
  label: string
  weight: 1 | 2 | 3
  category: string
  detail: string
  narrative: string
  action: string
  verified: boolean
  fixable: boolean   // ← new
}
```

---

### `lib/modules/seo/fix-agent.ts`

**Two Claude calls.**

#### Call 1 — File discovery

Input:
```
- item.label
- item.ai_action  (e.g. "Add a <title> tag to your homepage layout file")
- framework       (e.g. "Next.js 15 (App Router)" — derived from package.json)
- fileTree        (string[] — all paths in the repo)
```

Prompt:
> You are a code assistant. Given a fix description and the file tree of a {framework} project, return a JSON array of file paths that need to be read to implement this fix. Return only paths that are directly relevant. Maximum 5 files.

Output: `string[]` — paths to fetch

#### Call 2 — Code generation

Input:
```
- item.label
- item.ai_action
- framework
- files: { path: string, content: string }[]   (fetched from GitHub)
```

Prompt:
> You are a code assistant. Given the following files from a {framework} project, implement this fix: "{ai_action}".
> Return a JSON array of { path, content } objects — only include files that need to change.
> Rules:
> - Do not change anything unrelated to the fix
> - Preserve all existing formatting, indentation, and code style
> - If a tag already exists, update it. If it doesn't exist, add it in the correct location.
> - Return the complete file content (not a diff)

Output: `{ path: string, content: string }[]` — modified files ready to commit

---

### `app/api/items/apply-fix/route.ts`

`POST /api/items/apply-fix`
Body: `{ itemId: string }`

**Full sequence:**

```
1. Auth check — get user from Supabase
2. Load item from module_items where id = itemId
   → verify item.fixable = true
   → verify item belongs to user's brand (join through modules → brands)
3. Load GitHub integration from brand_integrations
   → verify provider = 'github', status = 'connected'
   → extract pat = api_key, repoUrl = metadata.repo_url
4. Parse repoUrl → { owner, repo }
5. getDefaultBranch() → baseBranch
6. getLatestCommitSha() → baseSha
7. Fetch package.json from repo → detect framework
   → look for "next", "astro", "gatsby", "nuxt", "remix" in dependencies
   → default to "static HTML" if none found
8. getFileTree() → allPaths (filter to likely relevant extensions: .tsx .ts .jsx .js .html .astro .vue .svelte)
9. Call fix-agent Call 1 → filePaths[]
10. For each path: getFileContent() → { content, sha }
    → build files[] array + shaMap { path → sha }
11. Call fix-agent Call 2 → modifiedFiles[]
12. branchName = "fix/{item.slug}" (slugified, lowercase)
13. createBranch(branchName, baseSha)
14. For each modifiedFile:
    commitFile(path, content, shaMap[path], branchName, "fix: {item.label}")
15. prBody = build markdown summary:
    "## Applied fix\n**{item.label}**\n\n{item.ai_action}\n\n### Files changed\n- {path}\n\n---\n*Applied automatically by Growth Hacker*"
16. createPullRequest(branchName, baseBranch, "fix: {item.label}", prBody)
    → { prUrl }
17. UPDATE module_items SET agent_pr_url = prUrl, completed_by = 'agent', ai_verified = true WHERE id = itemId
18. Return { ok: true, prUrl }
```

`maxDuration = 60` (GitHub API + two Claude calls)

---

### Dashboard page (`app/dashboard/[moduleId]/page.tsx`)

Add one query before rendering:
```typescript
const githubIntegration = await db
  .select()
  .from(brandIntegrations)
  .where(
    and(
      eq(brandIntegrations.brandId, brand.id),
      eq(brandIntegrations.provider, 'github'),
      eq(brandIntegrations.status, 'connected')
    )
  )
  .limit(1)

const githubConnected = githubIntegration.length > 0
```

Pass `githubConnected` to `<ModuleDashboard>`.

Also update `DBItemFull` in `lib/modules/types.ts` and the DB fetch to include `fixable` and `agentPrUrl`.

---

### `ModuleDashboard.tsx` UI changes

In the expanded item body (the part that shows `ai_narrative` + `ai_action` box):

**If item is fixable AND github is connected AND no PR yet:**
Show an "Apply fix" button below the action box.

**While applying:**
Button becomes "Applying fix…" with a spinner. Disabled.

**On success:**
Button replaced with a green link: "PR opened — review on GitHub →" (opens in new tab).

**If item is fixable but github NOT connected:**
Show a muted note: "Connect GitHub in Settings to apply this fix automatically."

**If PR already exists (`agent_pr_url` is set):**
Always show the "PR opened →" link (even if user re-expands the item).

---

## Data flow diagram

```
User clicks "Apply fix"
        │
        ▼
POST /api/items/apply-fix { itemId }
        │
        ├─ load item (verify fixable=true, belongs to user)
        ├─ load GitHub integration (PAT + repo URL)
        │
        ▼
GitHub API
        ├─ getDefaultBranch()
        ├─ getLatestCommitSha()
        ├─ fetch package.json → detect framework
        └─ getFileTree() → all file paths
        │
        ▼
Claude (Sonnet) — Call 1: File discovery
        → returns: ["app/layout.tsx", "app/page.tsx"]
        │
        ▼
GitHub API — fetch each file → { content, sha }
        │
        ▼
Claude (Sonnet) — Call 2: Code generation
        → returns: [{ path: "app/layout.tsx", content: "..." }]
        │
        ▼
GitHub API
        ├─ createBranch("fix/title-tag-missing")
        ├─ commitFile(x2 if needed)
        └─ createPR() → prUrl
        │
        ▼
DB update: agent_pr_url = prUrl, completed_by = 'agent'
        │
        ▼
Return { prUrl } → UI shows "PR opened →" link
```

---

## Branch naming

Format: `fix/{item-slug}` e.g. `fix/title-tag-missing`, `fix/og-image-missing`

If the branch already exists (422 from GitHub), append `-2`, `-3` etc.

---

## PR body format

```markdown
## Applied fix
**Missing title tag on homepage**

Add a descriptive <title> tag to your homepage layout that includes your primary keyword.

### Files changed
- app/layout.tsx

### Why this matters
Title tags are the most important on-page SEO signal. They appear in search results as the clickable headline.

---
*Applied automatically by [Growth Hacker](https://yourdomain.com) · [View in dashboard](#)*
```

---

## Framework detection (from package.json)

| Dependency found | Framework label passed to Claude |
|-----------------|----------------------------------|
| `next` | `Next.js (App Router)` or `Next.js (Pages Router)` — check for `app/` dir |
| `astro` | `Astro` |
| `gatsby` | `Gatsby` |
| `nuxt` | `Nuxt.js` |
| `remix` | `Remix` |
| `@sveltejs/kit` | `SvelteKit` |
| none of above | `Static HTML` |

---

## Limitations (known, accepted for now)

- Only works on public or private repos the PAT has access to
- Won't work on monorepos where the website is in a subdirectory (future: add `subdirectory` field to GitHub integration)
- Won't work if the repo requires build step verification (CI will catch any errors in the PR)
- Large repos with many files may hit token limits in Call 1 — mitigate by filtering file tree to relevant extensions before sending to Claude

---

## Future improvements (not in scope now)

- Show diff preview in the app before creating PR
- Let user edit the PR title/description before submitting
- Support monorepos (add subdirectory field to integration)
- Auto-merge option (dangerous, opt-in only)
- Track PR merge status via GitHub webhooks → auto-mark item complete on merge
- Support Vercel integration: trigger redeploy after PR merge
