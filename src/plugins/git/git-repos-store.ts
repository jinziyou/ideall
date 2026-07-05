export const GIT_REPOS_STORAGE_KEY = "ideall:git:repos"
export const MAX_GIT_REPOS = 12

export type RepoStorage = Pick<Storage, "getItem" | "setItem">

export function normalizeGitRepos(value: unknown, limit = MAX_GIT_REPOS): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const repos: string[] = []
  for (const item of value) {
    if (typeof item !== "string") continue
    const path = item.trim()
    if (!path || seen.has(path)) continue
    seen.add(path)
    repos.push(path)
    if (repos.length >= limit) break
  }
  return repos
}

export function addGitRepo(repos: string[], repoPath: string, limit = MAX_GIT_REPOS): string[] {
  const path = repoPath.trim()
  if (!path) return normalizeGitRepos(repos, limit)
  return normalizeGitRepos([path, ...repos.filter((repo) => repo !== path)], limit)
}

export function removeGitRepo(repos: string[], repoPath: string): string[] {
  return normalizeGitRepos(repos.filter((repo) => repo !== repoPath))
}

export function loadGitRepos(storage: RepoStorage | undefined = browserStorage()): string[] {
  try {
    return normalizeGitRepos(JSON.parse(storage?.getItem(GIT_REPOS_STORAGE_KEY) ?? "[]"))
  } catch {
    return []
  }
}

export function saveGitRepos(
  repos: string[],
  storage: RepoStorage | undefined = browserStorage(),
): boolean {
  if (!storage) return false
  try {
    storage.setItem(GIT_REPOS_STORAGE_KEY, JSON.stringify(normalizeGitRepos(repos)))
    return true
  } catch {
    return false
  }
}

function browserStorage(): RepoStorage | undefined {
  try {
    if (typeof localStorage === "undefined") return undefined
    return localStorage
  } catch {
    return undefined
  }
}
