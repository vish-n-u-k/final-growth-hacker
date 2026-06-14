// ── GitHub REST API helpers ────────────────────────────────────────────────────
// All network calls use Node fetch. No external GitHub SDK needed.

const BASE = 'https://api.github.com'

function ghHeaders(pat: string): Record<string, string> {
  return {
    Authorization: `token ${pat}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  }
}

// ── URL parsing ───────────────────────────────────────────────────────────────

export function parseRepoUrl(repoUrl: string): { owner: string; repo: string } {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/\s]+?)(?:\.git)?(?:\/.*)?$/)
  if (!match) throw new Error(`Invalid GitHub repo URL: ${repoUrl}`)
  return { owner: match[1], repo: match[2] }
}

// ── Repo info ─────────────────────────────────────────────────────────────────

export async function getDefaultBranch(owner: string, repo: string, pat: string): Promise<string> {
  const res = await fetch(`${BASE}/repos/${owner}/${repo}`, { headers: ghHeaders(pat) })
  if (!res.ok) throw new Error(`GitHub: could not read repo (${res.status}) — check PAT and repo URL`)
  const data = await res.json() as { default_branch: string }
  return data.default_branch
}

export async function getLatestCommitSha(owner: string, repo: string, branch: string, pat: string): Promise<string> {
  const res = await fetch(`${BASE}/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`, { headers: ghHeaders(pat) })
  if (!res.ok) throw new Error(`GitHub: could not get branch "${branch}" (${res.status})`)
  const data = await res.json() as { commit: { sha: string } }
  return data.commit.sha
}

// ── File tree ─────────────────────────────────────────────────────────────────

const RELEVANT_EXTS = ['.tsx', '.ts', '.jsx', '.js', '.html', '.astro', '.vue', '.svelte', '.mdx']

export async function getFileTree(owner: string, repo: string, branch: string, pat: string): Promise<string[]> {
  const res = await fetch(
    `${BASE}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    { headers: ghHeaders(pat) },
  )
  if (!res.ok) throw new Error(`GitHub: could not get file tree (${res.status})`)
  const data = await res.json() as { tree: { type: string; path: string }[] }
  return data.tree
    .filter((f) => f.type === 'blob' && RELEVANT_EXTS.some((ext) => f.path.endsWith(ext)))
    .map((f) => f.path)
}

// ── File content ──────────────────────────────────────────────────────────────

export async function getFileContent(
  owner: string, repo: string, path: string, pat: string,
): Promise<{ content: string; sha: string }> {
  const res = await fetch(`${BASE}/repos/${owner}/${repo}/contents/${path}`, { headers: ghHeaders(pat) })
  if (!res.ok) throw new Error(`GitHub: could not read "${path}" (${res.status})`)
  const data = await res.json() as { content: string; sha: string }
  const content = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8')
  return { content, sha: data.sha }
}

// ── Branching ─────────────────────────────────────────────────────────────────

export async function createBranch(
  owner: string, repo: string, branchName: string, fromSha: string, pat: string,
): Promise<void> {
  const res = await fetch(`${BASE}/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    headers: ghHeaders(pat),
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: fromSha }),
  })
  if (res.status === 422) return // Branch already exists — use it as-is
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`GitHub: could not create branch (${res.status}): ${JSON.stringify(err)}`)
  }
}

// ── Committing ────────────────────────────────────────────────────────────────

export async function commitFile(
  owner: string,
  repo: string,
  path: string,
  content: string,
  fileSha: string | null,
  branch: string,
  message: string,
  pat: string,
): Promise<void> {
  const body: Record<string, string> = {
    message,
    content: Buffer.from(content).toString('base64'),
    branch,
  }
  if (fileSha) body.sha = fileSha

  const res = await fetch(`${BASE}/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: ghHeaders(pat),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`GitHub: could not commit "${path}" (${res.status}): ${JSON.stringify(err)}`)
  }
}

// ── Pull requests ─────────────────────────────────────────────────────────────

export async function createPullRequest(
  owner: string,
  repo: string,
  head: string,
  base: string,
  title: string,
  body: string,
  pat: string,
): Promise<{ prUrl: string; prNumber: number }> {
  const res = await fetch(`${BASE}/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: ghHeaders(pat),
    body: JSON.stringify({ title, body, head, base }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`GitHub: could not create PR (${res.status}): ${JSON.stringify(err)}`)
  }
  const data = await res.json() as { html_url: string; number: number }
  return { prUrl: data.html_url, prNumber: data.number }
}
